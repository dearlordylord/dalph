import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  PlannedAttemptExecutorReport,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { legacyMemoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { OperationId } from "../../identity.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"
import { makeTaskWorkSpecification } from "../../../authorities/task-tracker/task-work-specification.js"
import {
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"
import { TaskAttemptPlannedEvent, taskTrackerReadIntent } from "../../registry/event.js"
import { IntegrationResponsibilityBeganEvent, IntegrationStartedEvent } from "../integration-admission/events.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskWorkSpecificationObservationOperation
} from "../../registry/operation.js"
import {
  AttemptChoiceAlreadyApplied,
  AttemptChoiceControl,
  AttemptChoiceOutsidePreIntegrationPhase,
  AttemptChoiceRequestIdentityContradiction,
  attemptChoiceControlLayer
} from "./control.js"
import { AttemptChoiceRequestId } from "./events.js"

const runId = RunId.make("attempt-choice-run")
const taskId = TaskId.make("attempt-choice-task-A")
const plannedRevision = TaskRevision.make("planned-fingerprint-F1")
const observedRevision = TaskRevision.make("observed-fingerprint-F2")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-choice-P"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-choice-P"),
  executor: TaskExecutorLocator.make("executor:attempt-choice"),
  runId,
  taskId,
  taskRevision: plannedRevision,
  worktree: WorktreeLocator.make("/worktrees/attempt-choice-P")
})

const appendExposedChoice = Effect.fn("AttemptChoiceTest.appendExposedChoice")(function* () {
  const journal = yield* JournalStore
  const target = FixtureTarget.make("attempt-choice-target")
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("attempt-choice-plan"),
    plannedAttempt,
    predecessorOperationIds: []
  })
  yield* journal.append(
    runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
  const ordinal = PlannedAttemptExecutorReportOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, ordinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal,
      report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId }
      }),
      version: workflowJournalEventVersion
    })
  )
  const specification = makeTaskWorkSpecification({ body: "Changed body F2", taskId, title: "Changed title F2" })
  const operation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("attempt-choice-observe-F2"),
    target,
    taskId,
    []
  )
  yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
  yield* journal.append(
    runId,
    outcomeRecordKey(operation.operationId),
    taskTrackerFactsObservedEvent(
      operation.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(operation, { ...specification, fingerprint: observedRevision })
    )
  )
})

const request = (choice: "ContinueExistingAttempt" | "StopTaskImplementation", requestId: string) => ({
  choice,
  requestId: AttemptChoiceRequestId.make(requestId),
  subject: { observedTaskRevision: observedRevision, plannedAttempt }
})

const appendIntegrationCutoff = Effect.fn("AttemptChoiceTest.appendIntegrationCutoff")(function* () {
  const journal = yield* JournalStore
  const integrationTarget = IntegrationTarget.make({
    repository: GitRepositoryLocator.make("/repositories/attempt-choice.git"),
    ref: IntegrationTargetRef.make("refs/heads/master")
  })
  const acceptedResult = { commit: GitCommitSha.make("2".repeat(40)) }
  const began = yield* journal.append(
    runId,
    integrationResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult,
      integrationTarget,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    integrationStartedRecordKey(plannedAttempt.attemptId),
    IntegrationStartedEvent.make({
      acceptedResult,
      integrationTarget,
      plannedAttempt,
      responsibilityBeganAt: began.position,
      version: workflowJournalEventVersion
    })
  )
})

it.effect("records both task fingerprints when Alice continues the exact attempt", () =>
  Effect.gen(function* () {
    yield* appendExposedChoice()
    const applied = yield* (yield* AttemptChoiceControl).apply(request("ContinueExistingAttempt", "continue-D1"))

    expect(applied.event).toMatchObject({
      _tag: "AttemptChoiceApplied",
      choice: "ContinueExistingAttempt",
      requestId: "continue-D1",
      subject: { observedTaskRevision: observedRevision, plannedAttempt }
    })
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("coalesces exact Continue redelivery and rejects request identity reuse", () =>
  Effect.gen(function* () {
    yield* appendExposedChoice()
    const control = yield* AttemptChoiceControl
    const first = yield* control.apply(request("ContinueExistingAttempt", "stable-D1"))
    expect(yield* control.apply(request("ContinueExistingAttempt", "stable-D1"))).toEqual(first)

    const contradiction = yield* control.apply(request("StopTaskImplementation", "stable-D1")).pipe(Effect.flip)
    expect(contradiction).toBeInstanceOf(AttemptChoiceRequestIdentityContradiction)
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("lets the first journaled valid choice win a concurrent Continue and Stop race", () =>
  Effect.gen(function* () {
    yield* appendExposedChoice()
    const control = yield* AttemptChoiceControl
    const results = yield* Effect.all(
      [
        control
          .apply(request("ContinueExistingAttempt", "race-continue"))
          .pipe(
            Effect.match({
              onFailure: (failure) => ({ _tag: "Failure" as const, failure }),
              onSuccess: (record) => ({ _tag: "Success" as const, record })
            })
          ),
        control
          .apply(request("StopTaskImplementation", "race-stop"))
          .pipe(
            Effect.match({
              onFailure: (failure) => ({ _tag: "Failure" as const, failure }),
              onSuccess: (record) => ({ _tag: "Success" as const, record })
            })
          )
      ],
      { concurrency: "unbounded" }
    )

    expect(results.filter(({ _tag }) => _tag === "Success")).toHaveLength(1)
    const stale = results.find(({ _tag }) => _tag === "Failure")
    expect(stale?._tag === "Failure" ? stale.failure : undefined).toBeInstanceOf(AttemptChoiceAlreadyApplied)
    expect(
      (yield* (yield* JournalStore).read(runId)).filter(({ event }) => event._tag === "AttemptChoiceApplied")
    ).toHaveLength(1)
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("rejects Continue and Stop after the exact integration cutoff", () =>
  Effect.gen(function* () {
    yield* appendExposedChoice()
    yield* appendIntegrationCutoff()
    const control = yield* AttemptChoiceControl

    for (const [choice, requestId] of [
      ["ContinueExistingAttempt", "late-continue"],
      ["StopTaskImplementation", "late-stop"]
    ] as const) {
      expect(yield* control.apply(request(choice, requestId)).pipe(Effect.flip)).toBeInstanceOf(
        AttemptChoiceOutsidePreIntegrationPhase
      )
    }
    expect(
      (yield* (yield* JournalStore).read(runId)).filter(({ event }) => event._tag === "AttemptChoiceApplied")
    ).toHaveLength(0)
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("returns exact pre-cutoff redelivery after integration has begun", () =>
  Effect.gen(function* () {
    yield* appendExposedChoice()
    const control = yield* AttemptChoiceControl
    const first = yield* control.apply(request("ContinueExistingAttempt", "pre-cutoff-direction"))
    yield* appendIntegrationCutoff()

    expect(yield* control.apply(request("ContinueExistingAttempt", "pre-cutoff-direction"))).toEqual(first)
    expect(
      (yield* (yield* JournalStore).read(runId)).filter(({ event }) => event._tag === "AttemptChoiceApplied")
    ).toHaveLength(1)
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)
