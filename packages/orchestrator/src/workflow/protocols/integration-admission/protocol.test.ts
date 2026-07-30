import { it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
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
  PreIntegrationCancellationCapability,
  QueuedIntegrationResponsibility,
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
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../registry/operation.js"
import { IntegrationResponsibilityBeganEvent, IntegrationStartedEvent } from "./events.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { deriveIntegrationFrontier } from "../../../coordination/frontier/integration-frontier.js"
import { reconstructRunState } from "../../../coordination/reconstruction/reduce.js"
import { makeIntegrationTargetResourceController } from "../../../coordination/admission/integration-target-resource.js"
import { runIntegrationTransition } from "../../../coordination/run/integration-transition-runtime.js"
import { runnableTransitionTaskId, RunnableFrontierTransition } from "../../../coordination/frontier/frontier.js"
import { OperationId } from "../../identity.js"
import {
  makeJournaledFreshRunRecoveryActivation,
  makeRunRecoveryActivation
} from "../../../coordination/run/recovery-activation.js"
import { controlledFakePlannedAttemptExecutorLayer } from "../../../../test/controlled-planned-attempt-executor.js"
import { trustedPlannedAttemptRecoveryAuthorityLayer } from "../../../coordination/run/recovery-authority.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../../workflow/interpretation/interpreter.js"
import { taskTrackerGraphFactsObserved } from "../../../../test/task-tracker-facts.js"
import { TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"

import { makeTaskWorkSpecification } from "../../../authorities/task-tracker/task-work-specification.js"
import {
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"

const exactClaimAuthorities = (...attemptIds: ReadonlyArray<AttemptId>) =>
  new Map(attemptIds.map((attemptId) => [attemptId, { _tag: "Exact" as const }]))

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

const claimFor = (attempt: PlannedTaskAttempt) =>
  ActiveTaskClaim.make({
    operationId: OperationId.make(`claim:${attempt.attemptId}`),
    owner: ClaimOwner.make("integration-test-owner"),
    taskId: attempt.taskId,
    token: ClaimToken.make(`claim-token:${attempt.attemptId}`)
  })

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
    const claim = claimFor(attempt)
    yield* journal.append(
      runId,
      intentRecordKey(claim.operationId),
      TaskClaimAcquisitionIntendedEvent.make({
        operation: makeTaskClaimAcquisitionOperation({ acquisition: claim, predecessorOperationIds: [] }),
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(claim.operationId),
      TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      attemptPlanRecordKey(attempt.attemptId),
      TaskAttemptPlannedEvent.make({
        operation: makeTaskAttemptPlanOperation({
          operationId: OperationId.make(`plan:${attempt.attemptId}`),
          plannedAttempt: attempt,
          predecessorOperationIds: [claim.operationId]
        }),
        version: workflowJournalEventVersion
      })
    )
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

it.effect("rejects a responsibility whose planned attempt differs from the durable executor responsibility", () =>
  Effect.gen(function* () {
    const durableAttempt = plannedAttempt("A", 0)
    const result = acceptedResult("a")
    yield* beginRun
    yield* recordAcceptedTerminal(durableAttempt, result)
    const contradictoryAttempt = PlannedTaskAttempt.make({
      ...durableAttempt,
      baseSha: GitCommitSha.make("2".repeat(40))
    })

    const failure = yield* Effect.flip(
      queueAcceptedResultIntegrationResponsibility(contradictoryAttempt, result, integrationTarget)
    )

    expect(failure).toEqual(
      new AcceptedResultNotDurable({ attemptId: contradictoryAttempt.attemptId, runId: contradictoryAttempt.runId })
    )
    expect(
      (yield* JournalStore.pipe(Effect.flatMap((journal) => journal.read(runId)))).some(
        ({ event }) => event._tag === "IntegrationResponsibilityBegan"
      )
    ).toBe(false)
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

it.effect("reconciles durable accepted terminals in order and idempotently after restart", () =>
  Effect.gen(function* () {
    const firstAttempt = plannedAttempt("A", 0)
    const secondAttempt = plannedAttempt("B", 1)
    const firstResult = acceptedResult("a")
    const secondResult = acceptedResult("b")
    yield* beginRun
    yield* recordAcceptedTerminal(firstAttempt, firstResult)
    yield* recordAcceptedTerminal(secondAttempt, secondResult)
    const journal = yield* JournalStore
    const reconstructed = reconstructRunState(runId, yield* journal.read(runId))
    expect(reconstructed._tag).toBe("ValidReconstructedRun")
    if (reconstructed._tag !== "ValidReconstructedRun") {
      return yield* Effect.die("expected accepted terminal reconstruction")
    }

    const frontier = deriveIntegrationFrontier(reconstructed.state, {
      currentTrackerTaskIds: new Set([firstAttempt.taskId, secondAttempt.taskId]),
      heldResponsibilityPositions: new Set(),
      integrationTarget: Option.some(integrationTarget),
      taskClaimAuthorityByAttemptId: exactClaimAuthorities(firstAttempt.attemptId, secondAttempt.attemptId)
    })
    expect(deriveIntegrationFrontier(reconstructed.state).explanations).toContainEqual({
      _tag: "IntegrationTaskClaimConstraint",
      claimState: "Unobserved",
      taskId: firstAttempt.taskId,
      wakeCondition: "TaskClaimFactsObserved"
    })
    expect(frontier.transitions).toMatchObject([
      {
        _tag: "QueueAcceptedResultIntegrationResponsibility",
        accepted: { acceptedResult: firstResult, plannedAttempt: firstAttempt }
      }
    ])
    expect(frontier.transitions).toHaveLength(1)

    const recovery = yield* makeRunRecoveryActivation(runId, integrationTarget)
    for (const attempt of [firstAttempt, secondAttempt]) {
      const read = makeTaskClaimObservationOperation(
        OperationId.make(`post-restart-claim:${attempt.attemptId}`),
        FixtureTarget.make("integration-admission-target"),
        attempt.taskId
      )
      yield* journal.append(runId, intentRecordKey(read.operationId), taskTrackerReadIntent(read))
      yield* journal.append(
        runId,
        outcomeRecordKey(read.operationId),
        taskTrackerFactsObservedEvent(read.operationId, makeFocusedTaskClaimFactsObserved(read, claimFor(attempt)))
      )
    }
    const firstTransition = (yield* recovery.readFrontier).transitions[0]
    if (firstTransition?._tag !== "QueueAcceptedResultIntegrationResponsibility") {
      return yield* Effect.die("expected queue reconciliation")
    }
    expect(runnableTransitionTaskId(firstTransition)).toBe(firstAttempt.taskId)
    yield* recovery.runTransition(firstTransition, undefined as never)
    yield* recovery.runTransition(firstTransition, undefined as never)

    const secondFrontier = yield* recovery.readFrontier
    expect(secondFrontier.transitions).toHaveLength(1)
    const secondTransition = secondFrontier.transitions[0]
    if (secondTransition?._tag !== "QueueAcceptedResultIntegrationResponsibility") {
      return yield* Effect.die("expected second queue reconciliation")
    }
    expect(runnableTransitionTaskId(secondTransition)).toBe(secondAttempt.taskId)
    yield* recovery.runTransition(secondTransition, undefined as never)

    const responsibilities = deriveIntegrationAdmission(yield* journal.read(runId)).responsibilities
    expect(responsibilities.map(({ plannedAttempt }) => plannedAttempt.attemptId)).toEqual([
      firstAttempt.attemptId,
      secondAttempt.attemptId
    ])
    expect(responsibilities[0]?.queuedAt).toBeLessThan(responsibilities[1]?.queuedAt ?? JournalPosition.make(1))
    const waitingFrontier = yield* recovery.readFrontier
    expect(waitingFrontier.explanations.filter(({ _tag }) => _tag === "IntegrationTrackerFactsWait")).toEqual([
      { _tag: "IntegrationTrackerFactsWait", taskId: "A", wakeCondition: "TaskTrackerFactsObserved" },
      { _tag: "IntegrationTrackerFactsWait", taskId: "B", wakeCondition: "TaskTrackerFactsObserved" }
    ])
    expect(waitingFrontier.transitions).toEqual([])

    const focusedRead = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("post-restart-focused-specification"),
      FixtureTarget.make("integration-admission-target"),
      firstAttempt.taskId
    )
    yield* journal.append(runId, intentRecordKey(focusedRead.operationId), taskTrackerReadIntent(focusedRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(focusedRead.operationId),
      taskTrackerFactsObservedEvent(
        focusedRead.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(
          focusedRead,
          makeTaskWorkSpecification({
            body: "Integrate the accepted result.",
            taskId: firstAttempt.taskId,
            title: "Integrate result"
          })
        )
      )
    )
    expect((yield* recovery.readFrontier).transitions).toEqual([])

    const graphRead = makeTrackerGraphObservationOperation(
      OperationId.make("post-restart-integration-facts"),
      FixtureTarget.make("integration-admission-target")
    )
    yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(graphRead.operationId),
      taskTrackerGraphFactsObserved(graphRead, {
        revision: TrackerRevision.make("post-restart-integration-revision"),
        taskIds: [firstAttempt.taskId, secondAttempt.taskId]
      })
    )
    expect(yield* recovery.readFrontier).toMatchObject({
      transitions: [{ _tag: "StartQueuedIntegration", responsibility: { plannedAttempt: { taskId: "A" } } }]
    })
  }).pipe(
    Effect.provide(memoryJournalStoreLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTrackerGraph: () => Effect.die("unused"),
        readTaskWorkSpecification: () => Effect.die("unused"),
        reconcileTaskWorktree: () => Effect.die("unused"),
        recordTaskAttemptPlan: () => Effect.die("unused"),
        releaseTaskClaim: () => Effect.die("unused")
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)

it.effect("journaled fresh activation fails closed on a non-integration recovered transition", () =>
  Effect.gen(function* () {
    const activation = yield* makeJournaledFreshRunRecoveryActivation(runId, integrationTarget)
    if (activation._tag !== "JournaledFreshRunActivation") {
      return yield* Effect.die("expected journaled fresh activation")
    }
    const exit = yield* Effect.exit(
      activation.runTransition(
        RunnableFrontierTransition.ContinueFreshWorkflowOperation({
          operationId: OperationId.make("not-recovered-in-fresh"),
          taskId: TaskId.make("A")
        }),
        undefined as never
      )
    )

    expect(exit._tag).toBe("Failure")
  }).pipe(Effect.provide(Layer.merge(memoryJournalStoreLayer, controlledFakePlannedAttemptExecutorLayer)))
)

it.effect("acquires, releases, and reacquires the process-local target around one started responsibility", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    const result = acceptedResult("a")
    yield* beginRun
    yield* recordAcceptedTerminal(attempt, result)
    const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget)
    const resources = yield* makeIntegrationTargetResourceController()

    expect(
      yield* runIntegrationTransition(
        RunnableFrontierTransition.StartQueuedIntegration({ responsibility: queued }),
        resources
      )
    ).toBe(true)
    const started = deriveIntegrationAdmission(
      yield* JournalStore.pipe(Effect.flatMap((journal) => journal.read(runId)))
    ).responsibilities[0]
    if (started?._tag !== "StartedIntegrationResponsibility") {
      return yield* Effect.die("expected started responsibility")
    }
    expect((yield* resources.snapshot).heldResponsibilityPositions).toEqual(new Set([queued.queuedAt]))

    const runState = reconstructRunState(
      runId,
      yield* JournalStore.pipe(Effect.flatMap((journal) => journal.read(runId)))
    )
    if (runState._tag !== "ValidReconstructedRun") return yield* Effect.die("expected valid started run")
    yield* resources.release(started)
    expect(
      deriveIntegrationFrontier(runState.state, {
        currentTrackerTaskIds: new Set([started.plannedAttempt.taskId]),
        heldResponsibilityPositions: new Set(),
        integrationTarget: Option.some(integrationTarget),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(started.plannedAttempt.attemptId)
      }).transitions
    ).toContainEqual(RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility: started }))
    yield* resources.acquire(started)

    expect(
      yield* runIntegrationTransition(
        RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility: started }),
        resources
      )
    ).toBe(true)
    expect((yield* resources.snapshot).heldResponsibilityPositions).toEqual(new Set())
    expect(
      yield* runIntegrationTransition(
        RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility: started }),
        resources
      )
    ).toBe(true)
    expect((yield* resources.snapshot).heldResponsibilityPositions).toEqual(new Set([queued.queuedAt]))
    expect(
      yield* runIntegrationTransition(
        RunnableFrontierTransition.ContinueFreshWorkflowOperation({
          operationId: OperationId.make("not-integration"),
          taskId: attempt.taskId
        }),
        resources
      )
    ).toBe(false)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("releases the process-local target when the cutoff append fails", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    yield* beginRun
    yield* JournalStore.pipe(Effect.flatMap((journal) => journal.terminateRun(runId)))
    const queued = QueuedIntegrationResponsibility.make({
      acceptedResult: acceptedResult("a"),
      integrationTarget,
      plannedAttempt: attempt,
      preIntegrationCancellation: PreIntegrationCancellationCapability.make({
        attemptId: attempt.attemptId,
        queuedAt: JournalPosition.make(1),
        runId: attempt.runId
      }),
      queuedAt: JournalPosition.make(1)
    })
    const resources = yield* makeIntegrationTargetResourceController()

    yield* Effect.flip(
      runIntegrationTransition(RunnableFrontierTransition.StartQueuedIntegration({ responsibility: queued }), resources)
    )

    expect((yield* resources.snapshot).heldResponsibilityPositions).toEqual(new Set())
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

it.effect("fails closed without current tracker facts and orders authorized integration work", () =>
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
      explanations: [
        { _tag: "IntegrationTrackerFactsWait", taskId: "A" },
        { _tag: "IntegrationTrackerFactsWait", taskId: "B" }
      ],
      transitions: []
    })
    const foreignClaimFrontier = deriveIntegrationFrontier(queuedRun.state, {
      currentTrackerTaskIds: new Set([a.taskId, b.taskId]),
      heldResponsibilityPositions: new Set(),
      integrationTarget: Option.some(integrationTarget),
      taskClaimAuthorityByAttemptId: new Map([
        [a.attemptId, { _tag: "Foreign" as const }],
        [b.attemptId, { _tag: "Exact" as const }]
      ])
    })
    expect(deriveIntegrationAdmission(queuedRun.state.workflowHistory.records).responsibilities).toHaveLength(2)
    expect(foreignClaimFrontier.transitions).toEqual([])
    expect(foreignClaimFrontier.explanations).toContainEqual({
      _tag: "IntegrationTaskClaimConstraint",
      claimState: "Foreign",
      taskId: a.taskId,
      wakeCondition: "ExplicitTaskClaimReacquisitionRequested"
    })
    expect(
      deriveIntegrationFrontier(queuedRun.state, {
        currentTrackerTaskIds: new Set([a.taskId, b.taskId]),
        heldResponsibilityPositions: new Set(),
        integrationTarget: Option.some(integrationTarget),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(a.attemptId, b.attemptId)
      })
    ).toMatchObject({
      explanations: [{ _tag: "IntegrationTargetWait", taskId: "B" }],
      transitions: [{ _tag: "StartQueuedIntegration", responsibility: { plannedAttempt: { taskId: "A" } } }]
    })

    yield* startQueuedIntegration(queuedA)
    const startedRun = reconstructRunState(runId, yield* journal.read(runId))
    expect(startedRun._tag).toBe("ValidReconstructedRun")
    if (startedRun._tag !== "ValidReconstructedRun") return yield* Effect.die("expected valid reconstruction")
    const staleStartedFrontier = deriveIntegrationFrontier(startedRun.state)
    expect(staleStartedFrontier.explanations).toContainEqual({
      _tag: "IntegrationTrackerFactsWait",
      taskId: "A",
      wakeCondition: "TaskTrackerFactsObserved"
    })
    expect(staleStartedFrontier.transitions).toEqual([])
    expect(
      deriveIntegrationFrontier(startedRun.state, {
        currentTrackerTaskIds: new Set([a.taskId, b.taskId]),
        heldResponsibilityPositions: new Set([queuedA.queuedAt]),
        integrationTarget: Option.some(integrationTarget),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(a.attemptId, b.attemptId)
      })
    ).toMatchObject({
      explanations: [
        { _tag: "IntegrationInProgress", taskId: "A" },
        { _tag: "IntegrationTargetWait", taskId: "B" }
      ],
      transitions: []
    })
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)
