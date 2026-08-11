import { it } from "@effect/vitest"
import { acceptedResultFixture } from "../../../../test/support/evidence.js"
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
  attemptChoiceAppliedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { OperationId } from "../../identity.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
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
  AttemptChoiceNotAvailable,
  AttemptChoiceOutsidePreIntegrationPhase,
  AttemptChoiceRequestIdentityContradiction,
  AttemptChoiceResultNotFound,
  attemptChoiceControlLayer
} from "./control.js"
import { AttemptChoiceAppliedEvent, AttemptChoiceRequestId } from "./events.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"

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
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
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
  requestId: AttemptChoiceRequestId.make({ nonce: requestId, runId }),
  subject: { observedTaskRevision: observedRevision, plannedAttempt }
})

const appendIntegrationCutoff = Effect.fn("AttemptChoiceTest.appendIntegrationCutoff")(function* () {
  const journal = yield* JournalStore
  const integrationTarget = IntegrationTarget.make({
    repository: GitRepositoryLocator.make("/repositories/attempt-choice.git"),
    ref: IntegrationTargetRef.make("refs/heads/master")
  })
  const acceptedResult = acceptedResultFixture(GitCommitSha.make("2".repeat(40)))
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
    const input = request("ContinueExistingAttempt", "continue-D1")
    const applied = yield* (yield* AttemptChoiceControl).apply(input)

    expect(applied.application.event).toMatchObject({
      _tag: "AttemptChoiceApplied",
      choice: "ContinueExistingAttempt",
      requestId: input.requestId,
      subject: { observedTaskRevision: observedRevision, plannedAttempt }
    })
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("coalesces exact Stop redelivery and rejects request identity reuse", () =>
  Effect.gen(function* () {
    yield* appendExposedChoice()
    const control = yield* AttemptChoiceControl
    const input = request("StopTaskImplementation", "stable-D2")
    const first = yield* control.apply(input)

    expect(first).toMatchObject({ _tag: "StopApplied", status: { _tag: "AwaitingQuiescence" } })
    expect(yield* control.apply(input)).toEqual(first)
    expect(yield* control.read(input.requestId)).toEqual(first)
    const contradiction = yield* control.apply(request("ContinueExistingAttempt", "stable-D2")).pipe(Effect.flip)
    expect(contradiction).toBeInstanceOf(AttemptChoiceRequestIdentityContradiction)
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("rejects every later fingerprint choice after Stop wins the exact attempt", () =>
  Effect.gen(function* () {
    yield* appendExposedChoice()
    const control = yield* AttemptChoiceControl
    yield* control.apply(request("StopTaskImplementation", "terminal-stop-D2"))
    const target = FixtureTarget.make("attempt-choice-target")
    const changedAgain = makeTaskWorkSpecification({ body: "Changed body F3", taskId, title: "Changed title F3" })
    const operation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("attempt-choice-observe-F3"),
      target,
      taskId,
      []
    )
    const journal = yield* JournalStore
    yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      taskTrackerFactsObservedEvent(
        operation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(operation, changedAgain)
      )
    )

    for (const [choice, nonce] of [
      ["ContinueExistingAttempt", "after-stop-continue-F3"],
      ["StopTaskImplementation", "after-stop-stop-F3"]
    ] as const) {
      const rejection = yield* control
        .apply({
          choice,
          requestId: AttemptChoiceRequestId.make({ nonce, runId }),
          subject: { observedTaskRevision: changedAgain.fingerprint, plannedAttempt }
        })
        .pipe(Effect.flip)
      expect(rejection).toBeInstanceOf(AttemptChoiceAlreadyApplied)
    }
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

it.effect("rejects an attempt-choice request identity bound to another Run", () =>
  Effect.gen(function* () {
    const foreignRunId = RunId.make("attempt-choice-foreign-run")
    const foreignAttempt = PlannedTaskAttempt.make({ ...plannedAttempt, runId: foreignRunId })
    const contradiction = yield* (yield* AttemptChoiceControl)
      .apply({
        choice: "ContinueExistingAttempt",
        requestId: AttemptChoiceRequestId.make({ nonce: "run-bound-direction", runId }),
        subject: { observedTaskRevision: observedRevision, plannedAttempt: foreignAttempt }
      })
      .pipe(Effect.flip)

    expect(contradiction).toMatchObject({
      _tag: "AttemptChoiceRequestRunMismatch",
      boundRunId: runId,
      subjectRunId: foreignRunId
    })
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("requires the Run and exact planned attempt before exposing Alice's choice", () =>
  Effect.gen(function* () {
    const control = yield* AttemptChoiceControl

    expect(yield* control.apply(request("ContinueExistingAttempt", "before-run")).pipe(Effect.flip)).toMatchObject({
      _tag: "WorkflowRunNotBegan",
      runId
    })

    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("attempt-choice-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const unavailable = yield* control.apply(request("ContinueExistingAttempt", "before-plan")).pipe(Effect.flip)
    expect(unavailable).toBeInstanceOf(AttemptChoiceNotAvailable)
    expect(unavailable).toMatchObject({ reason: "AttemptNotPlanned" })
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("reports an unknown attempt-choice request identity without inventing a result", () =>
  Effect.gen(function* () {
    const requestId = AttemptChoiceRequestId.make({ nonce: "unknown-choice", runId })
    const missing = yield* (yield* AttemptChoiceControl).read(requestId).pipe(Effect.flip)

    expect(missing).toBeInstanceOf(AttemptChoiceResultNotFound)
    expect(missing).toMatchObject({ requestId })
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("does not expose a choice from a safe report older than a later executor request", () =>
  Effect.gen(function* () {
    yield* appendExposedChoice()
    const journal = yield* JournalStore
    const ordinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, ordinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )

    const unavailable = yield* (yield* AttemptChoiceControl)
      .apply(request("StopTaskImplementation", "stale-safe-stop"))
      .pipe(Effect.flip)
    expect(unavailable).toMatchObject({ _tag: "AttemptChoiceNotAvailable", reason: "ExecutorNotSafelySuspended" })
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("requires Alice's choice to name the latest observed task fingerprint", () =>
  Effect.gen(function* () {
    yield* appendExposedChoice()
    const stale = yield* (yield* AttemptChoiceControl)
      .apply({
        choice: "ContinueExistingAttempt",
        requestId: AttemptChoiceRequestId.make({ nonce: "stale-fingerprint", runId }),
        subject: { observedTaskRevision: TaskRevision.make("observed-fingerprint-F3"), plannedAttempt }
      })
      .pipe(Effect.flip)

    expect(stale).toBeInstanceOf(AttemptChoiceNotAvailable)
    expect(stale).toMatchObject({ reason: "ObservedFingerprintNotCurrent" })
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

    const forgedRequest = request("ContinueExistingAttempt", "forged-after-cutoff")
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      attemptChoiceAppliedRecordKey(forgedRequest.requestId),
      AttemptChoiceAppliedEvent.make({
        ...forgedRequest,
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    const reduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
    expect(reduction).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("follows the exact integration-start cutoff") })
      ])
    })
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
