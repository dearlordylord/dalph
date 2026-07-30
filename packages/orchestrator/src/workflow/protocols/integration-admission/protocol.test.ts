import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { InitialControlPolicy } from "../../../control/policy.js"
import { defaultTaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import {
  AcceptedResultNotDurable,
  deriveIntegrationAdmission,
  queueAcceptedResultIntegrationResponsibility,
  selectStartableIntegrationResponsibilities,
  startQueuedIntegration
} from "./protocol.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"
import {
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { IntegrationResponsibilityBeganEvent, IntegrationStartedEvent } from "./events.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { deriveIntegrationFrontier } from "../../../coordination/frontier/integration-frontier.js"
import { reconstructRunState } from "../../../coordination/reconstruction/reduce.js"

const runId = RunId.make("integration-admission-run")
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repo/.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const otherIntegrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/other-repo/.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})

const plannedAttempt = (taskId: "A" | "B" | "C", ordinal: number) =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`attempt:${taskId}:${ordinal}`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/attempt-${taskId}`),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId,
    taskId: TaskId.make(taskId),
    taskRevision: TaskRevision.make(`revision-${taskId}`),
    worktree: WorktreeLocator.make(`/worktrees/${taskId}`)
  })

const acceptedResult = (commitDigit: string) =>
  AcceptedResult.make({ commit: GitCommitSha.make(commitDigit.repeat(40)) })

const beginRun = Effect.gen(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(
    runId,
    FixtureTarget.make("integration-admission-target"),
    InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity })
  )
})

const recordAcceptedTerminal = (attempt: PlannedTaskAttempt, result: AcceptedResult) =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(attempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      })
    )
    const ordinal = PlannedAttemptExecutorReportOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(attempt.attemptId, ordinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal,
        report: PlannedAttemptExecutorReport.cases.Terminal.make({
          correlation: { attemptId: attempt.attemptId, runId: attempt.runId },
          result: { _tag: "Accepted", acceptedResult: result }
        }),
        version: workflowJournalEventVersion
      })
    )
  })

it.effect("rejects a responsibility before the matching accepted terminal report is durable", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    yield* beginRun

    const failure = yield* Effect.flip(
      queueAcceptedResultIntegrationResponsibility(attempt, acceptedResult("a"), integrationTarget)
    )

    expect(failure).toEqual(new AcceptedResultNotDurable({ attemptId: attempt.attemptId, runId: attempt.runId }))
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("rejects persisted integration responsibility without a prior accepted terminal result", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    yield* beginRun
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      integrationResponsibilityBeganRecordKey(attempt.attemptId),
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: acceptedResult("a"),
        integrationTarget,
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      })
    )

    const reduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))

    expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
    if (reduction._tag !== "InvalidWorkflowJournalHistory") return
    expect(reduction.issues).toContainEqual(
      expect.objectContaining({
        detail: `integration responsibility for attempt ${attempt.attemptId} has no prior matching accepted terminal result`
      })
    )
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("rejects a foreign-run responsibility and a start that points at itself", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    const foreignAttempt = PlannedTaskAttempt.make({ ...attempt, runId: RunId.make("foreign-run") })
    yield* beginRun
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      integrationResponsibilityBeganRecordKey(foreignAttempt.attemptId),
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: acceptedResult("a"),
        integrationTarget,
        plannedAttempt: foreignAttempt,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      integrationStartedRecordKey(attempt.attemptId),
      IntegrationStartedEvent.make({
        acceptedResult: acceptedResult("a"),
        integrationTarget,
        plannedAttempt: attempt,
        responsibilityBeganAt: JournalPosition.make(3),
        version: workflowJournalEventVersion
      })
    )

    const reduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))

    expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
    if (reduction._tag !== "InvalidWorkflowJournalHistory") return
    expect(reduction.issues.flatMap((issue) => ("detail" in issue ? [issue.detail] : []))).toEqual(
      expect.arrayContaining([
        `integration work for attempt ${foreignAttempt.attemptId} binds run ${foreignAttempt.runId}`,
        `integration start for attempt ${attempt.attemptId} has no exact earlier responsibility at 3`
      ])
    )
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("orders accepted results by committed responsibility position after restart", () =>
  Effect.gen(function* () {
    const a = plannedAttempt("A", 0)
    const b = plannedAttempt("B", 1)
    const aResult = acceptedResult("a")
    const bResult = acceptedResult("b")
    yield* beginRun
    yield* recordAcceptedTerminal(a, aResult)
    yield* recordAcceptedTerminal(b, bResult)

    yield* queueAcceptedResultIntegrationResponsibility(a, aResult, integrationTarget)
    yield* queueAcceptedResultIntegrationResponsibility(b, bResult, integrationTarget)

    const records = yield* JournalStore.pipe(Effect.flatMap((journal) => journal.read(runId)))
    const recovered = deriveIntegrationAdmission(records)

    expect(recovered.responsibilities.map(({ acceptedResult: result }) => result.commit)).toEqual([
      aResult.commit,
      bResult.commit
    ])
    expect(recovered.responsibilities.map(({ queuedAt }) => queuedAt)).toEqual(
      recovered.responsibilities.map(({ queuedAt }) => queuedAt).toSorted((left, right) => left - right)
    )
    expect(JSON.stringify(records)).not.toContain("queueOrdinal")
    expect(
      selectStartableIntegrationResponsibilities(recovered).map(({ plannedAttempt: attempt }) => attempt.taskId)
    ).toEqual(["A"])
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("starts integration once and consumes only its pre-integration cancellation capability", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    yield* beginRun
    const result = acceptedResult("a")
    yield* recordAcceptedTerminal(attempt, result)
    yield* queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget)

    const journal = yield* JournalStore
    const before = deriveIntegrationAdmission(yield* journal.read(runId))
    const queued = before.responsibilities[0]
    expect(queued?._tag).toBe("QueuedIntegrationResponsibility")
    if (queued?._tag !== "QueuedIntegrationResponsibility") return yield* Effect.die("expected queued responsibility")

    const started = yield* startQueuedIntegration(queued)
    const idempotent = yield* startQueuedIntegration(queued)
    const after = deriveIntegrationAdmission(yield* journal.read(runId))

    expect(started).toEqual(idempotent)
    expect(after.responsibilities).toEqual([started])
    expect("_tag" in started && started._tag).toBe("StartedIntegrationResponsibility")
    expect("preIntegrationCancellation" in started).toBe(false)
    expect(selectStartableIntegrationResponsibilities(after)).toEqual([])
    expect((yield* journal.read(runId)).filter(({ event }) => event._tag === "IntegrationStarted")).toHaveLength(1)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("preserves same-target order while a blocker wait leaves another target usable", () =>
  Effect.gen(function* () {
    const a = plannedAttempt("A", 0)
    const b = plannedAttempt("B", 1)
    const c = plannedAttempt("C", 2)
    const aResult = acceptedResult("a")
    const bResult = acceptedResult("b")
    const cResult = acceptedResult("c")
    yield* beginRun
    yield* recordAcceptedTerminal(a, aResult)
    yield* recordAcceptedTerminal(b, bResult)
    yield* recordAcceptedTerminal(c, cResult)
    const queuedA = yield* queueAcceptedResultIntegrationResponsibility(a, aResult, integrationTarget)
    yield* queueAcceptedResultIntegrationResponsibility(b, bResult, integrationTarget)
    yield* queueAcceptedResultIntegrationResponsibility(c, cResult, otherIntegrationTarget)
    yield* startQueuedIntegration(queuedA)

    const admission = deriveIntegrationAdmission(
      yield* JournalStore.pipe(Effect.flatMap((journal) => journal.read(runId)))
    )

    expect(
      selectStartableIntegrationResponsibilities(admission).map(({ plannedAttempt: attempt }) => attempt.taskId)
    ).toEqual(["C"])
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("derives one start, one same-target wait, and in-progress work without tracker facts", () =>
  Effect.gen(function* () {
    const a = plannedAttempt("A", 0)
    const b = plannedAttempt("B", 1)
    const aResult = acceptedResult("a")
    const bResult = acceptedResult("b")
    yield* beginRun
    yield* recordAcceptedTerminal(a, aResult)
    yield* recordAcceptedTerminal(b, bResult)
    const queuedA = yield* queueAcceptedResultIntegrationResponsibility(a, aResult, integrationTarget)
    yield* queueAcceptedResultIntegrationResponsibility(b, bResult, integrationTarget)

    const journal = yield* JournalStore
    const queuedRun = reconstructRunState(runId, yield* journal.read(runId))
    expect(queuedRun._tag).toBe("ValidReconstructedRun")
    if (queuedRun._tag !== "ValidReconstructedRun") return yield* Effect.die("expected valid reconstruction")
    expect(deriveIntegrationFrontier(queuedRun.state)).toMatchObject({
      explanations: [{ _tag: "IntegrationTargetWait", taskId: "B" }],
      transitions: [{ _tag: "StartQueuedIntegration", responsibility: { plannedAttempt: { taskId: "A" } } }]
    })

    yield* startQueuedIntegration(queuedA)
    const startedRun = reconstructRunState(runId, yield* journal.read(runId))
    expect(startedRun._tag).toBe("ValidReconstructedRun")
    if (startedRun._tag !== "ValidReconstructedRun") return yield* Effect.die("expected valid reconstruction")
    expect(deriveIntegrationFrontier(startedRun.state)).toMatchObject({
      explanations: [
        { _tag: "IntegrationInProgress", taskId: "A" },
        { _tag: "IntegrationTargetWait", taskId: "B" }
      ],
      transitions: []
    })
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)
