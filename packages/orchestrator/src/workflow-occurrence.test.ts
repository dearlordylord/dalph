import { it } from "@effect/vitest"
import {
  AuthenticatedOperatorIdentity,
  ControlCommandId,
  FixtureTarget,
  JournalPosition,
  JournalRecordKey,
  OperationId,
  RunId,
  TaskId,
  TaskWorkCapacity,
  TrackerRevision
} from "./domain.js"
import { ControlCommand, ControlCommandRecordedEvent } from "./control-command.js"
import {
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved,
  type JournalRecord,
  JournalStore,
  WorkflowJournalEvent
} from "./journal-store.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import { intentRecordKey, outcomeRecordKey } from "./journal-record-key.js"
import { makeManagedRecoveryActivation, ManagedRecoveryActivation } from "./managed-activation.js"
import { controlledFakePlannedAttemptExecutorLayer } from "./planned-attempt-executor.js"
import { trustedPlannedAttemptRecoveryAuthorityLayer } from "./planned-attempt-recovery-authority.js"
import { projectTrackerSnapshot } from "./task-dag.js"
import { TaskClaimAcquisitionPlanner } from "./task-claim-planning.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "./task-work-planning.js"
import { makeTrackerGraphObservationOperation } from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"
import { runWorkflow } from "./workflow-run.js"
import { WorkflowInterpreter, WorkflowTrace } from "./workflow.js"
import {
  AppliedControlDirection,
  decodeWorkflowOccurrence,
  originatingActionForTrackerObservation,
  presentWorkflowOccurrence,
  projectWorkflowOccurrences,
  WorkflowActor,
  type WorkflowOccurrence,
  WorkflowOccurrenceProjection
} from "./workflow-occurrence.js"
import { Deferred, Effect, Fiber, Layer, Option, Schema } from "effect"
import { expect } from "vitest"

const runId = RunId.make("occurrence-run")
const operation = makeTrackerGraphObservationOperation(
  OperationId.make("read-target-closure"),
  FixtureTarget.make("occurrence-fixture")
)

const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`occurrence-record-${position}`),
  position: JournalPosition.make(position),
  runId
})

it("classifies an initiated tracker read separately from its observed result", () => {
  const projection = projectWorkflowOccurrences([
    record(1, trackerGraphObservationIntent(operation)),
    record(
      2,
      trackerGraphOutcomeObserved(
        operation.operationId,
        WorkflowOutcome.cases.TrackerGraphObserved.make({
          revision: TrackerRevision.make("tracker-revision-1"),
          taskIds: []
        })
      )
    )
  ])

  expect(projection.occurrences).toMatchObject([
    {
      _tag: "TrackerGraphReadInitiated",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      recordedAt: 1
    },
    {
      _tag: "TaskTrackerFactsObserved",
      evidence: {
        completeness: "Complete",
        consistency: "PotentiallyMixedTime",
        freshness: "FreshAtReadBoundary",
        observedAt: 2,
        target: "occurrence-fixture"
      },
      occurrenceClassification: "NonActionOccurrence"
    }
  ])
  const observed = projection.occurrences.at(1)
  if (observed === undefined) throw new Error("expected the tracker observation occurrence")
  expect("initiatedBy" in observed).toBe(false)
})

it("follows a tracker observation to its exact initiating action without copying the actor", () => {
  const projection = projectWorkflowOccurrences([
    record(1, trackerGraphObservationIntent(operation)),
    record(
      2,
      trackerGraphOutcomeObserved(
        operation.operationId,
        WorkflowOutcome.cases.TrackerGraphObserved.make({
          revision: TrackerRevision.make("tracker-revision-2"),
          taskIds: []
        })
      )
    )
  ])
  const observation = projection.occurrences.find((occurrence) => occurrence._tag === "TaskTrackerFactsObserved")
  if (observation?._tag !== "TaskTrackerFactsObserved") {
    throw new Error("expected a tracker observation occurrence")
  }

  const action = originatingActionForTrackerObservation(projection, observation)

  expect(Option.getOrThrow(action)).toMatchObject({
    _tag: "TrackerGraphReadInitiated",
    initiatedBy: { _tag: "DalphCoordinator" },
    operation: { operationId: observation.originatingActionOperationId }
  })
  expect("initiatedBy" in observation).toBe(false)
})

it.effect("does not turn a constructed or proposed tracker read into a past-tense event", () =>
  Effect.gen(function* () {
    const failure = yield* decodeWorkflowOccurrence(operation).pipe(Effect.flip)
    expect(failure._tag).toBe("SchemaError")
  })
)

it("does not infer a tracker-edit action from changed observed facts", () => {
  const laterOperation = makeTrackerGraphObservationOperation(
    OperationId.make("reread-target-closure"),
    FixtureTarget.make("occurrence-fixture"),
    [operation.operationId]
  )
  const projection = projectWorkflowOccurrences([
    record(1, trackerGraphObservationIntent(operation)),
    record(
      2,
      trackerGraphOutcomeObserved(
        operation.operationId,
        WorkflowOutcome.cases.TrackerGraphObserved.make({
          revision: TrackerRevision.make("before-external-edit"),
          taskIds: []
        })
      )
    ),
    record(3, trackerGraphObservationIntent(laterOperation)),
    record(
      4,
      trackerGraphOutcomeObserved(
        laterOperation.operationId,
        WorkflowOutcome.cases.TrackerGraphObserved.make({
          revision: TrackerRevision.make("after-external-edit"),
          taskIds: [TaskId.make("newly-observed-task")]
        })
      )
    )
  ])

  expect(
    projection.occurrences.filter(({ occurrenceClassification }) => occurrenceClassification === "InitiatedAction")
  ).toHaveLength(2)
  expect(projection.occurrences.filter(({ _tag }) => _tag === "TaskTrackerFactsObserved")).toHaveLength(2)
  const occurrenceTags: ReadonlyArray<string> = projection.occurrences.map(({ _tag }) => _tag)
  expect(occurrenceTags).not.toContain("TrackerFactsEdited")
})

it("classifies an applied operator direction as an initiated action", () => {
  const occurrence = AppliedControlDirection.make({
    direction: "Pause",
    initiatedBy: WorkflowActor.cases.Operator.make({}),
    occurrenceClassification: "InitiatedAction",
    subject: { _tag: "Task", runId, taskId: TaskId.make("paused-task") }
  })

  expect(occurrence).toMatchObject({
    _tag: "AppliedControlDirection",
    direction: "Pause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction"
  })
})

it.effect("rejects operator identity and command receipt as occurrence classification", () =>
  Effect.gen(function* () {
    const appliedDirection = {
      _tag: "AppliedControlDirection",
      direction: "Pause",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      operatorId: "unsupported-operator-identity",
      subject: { _tag: "Run", runId }
    }
    const commandReceipt = { _tag: "ControlCommandRecorded", occurrenceClassification: "InitiatedAction" }

    expect((yield* decodeWorkflowOccurrence(appliedDirection).pipe(Effect.flip))._tag).toBe("SchemaError")
    expect((yield* decodeWorkflowOccurrence(commandReceipt).pipe(Effect.flip))._tag).toBe("SchemaError")
    const receiptEvent = ControlCommandRecordedEvent.make({
      command: ControlCommand.cases.RequestRunPause.make({
        commandId: ControlCommandId.make("receipt-is-not-occurrence"),
        operatorId: AuthenticatedOperatorIdentity.make("transitional-operator"),
        runId
      }),
      version: workflowJournalEventVersion
    })
    expect(projectWorkflowOccurrences([record(1, receiptEvent)]).occurrences).toEqual([])
  })
)

it.effect("reconstructs after process loss without a coordinator-crash journal event", () =>
  Effect.gen(function* () {
    const retainedIntent: JournalRecord = {
      event: trackerGraphObservationIntent(operation),
      key: intentRecordKey(operation.operationId),
      position: JournalPosition.make(1),
      runId
    }
    const retainedOutcome: JournalRecord = {
      event: trackerGraphOutcomeObserved(
        operation.operationId,
        WorkflowOutcome.cases.TrackerGraphObserved.make({
          revision: TrackerRevision.make("retained-prefix-revision"),
          taskIds: []
        })
      ),
      key: outcomeRecordKey(operation.operationId),
      position: JournalPosition.make(2),
      runId
    }
    const retainedPrefixes: ReadonlyArray<ReadonlyArray<JournalRecord>> = [
      [],
      [retainedIntent],
      [retainedIntent, retainedOutcome]
    ]
    const projected = projectTrackerSnapshot({ revision: "startup-authority-reread", tasks: [] })
    const snapshot = Option.getOrThrow(
      Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
    )

    for (const prefix of retainedPrefixes) {
      const trackerRead = yield* Deferred.make<void>()
      const interpreter = WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("startup authority reread must not reach task claiming"),
        readTrackerGraph: () => Deferred.succeed(trackerRead, undefined).pipe(Effect.as(snapshot)),
        reconcileTaskWorktree: () => Effect.die("startup authority reread must not reach Git"),
        recordTaskAttemptPlan: () => Effect.die("startup authority reread must not reach attempt planning")
      })
      const startupLayer = Layer.mergeAll(
        Layer.succeed(
          JournalStore,
          JournalStore.of({
            append: () => Effect.die("startup authority reread must not append"),
            read: () => Effect.succeed(prefix),
            scan: () => Effect.die("startup authority reread must not scan")
          })
        ),
        Layer.succeed(WorkflowInterpreter, interpreter),
        Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
        controlledFakePlannedAttemptExecutorLayer,
        trustedPlannedAttemptRecoveryAuthorityLayer
      )
      const recovery = yield* makeManagedRecoveryActivation(runId).pipe(Effect.provide(startupLayer))
      const workflowLayer = Layer.mergeAll(
        Layer.succeed(ManagedRecoveryActivation, recovery),
        Layer.succeed(WorkflowInterpreter, interpreter),
        Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
        Layer.succeed(
          OperationIdAllocator,
          OperationIdAllocator.of({ allocate: () => Effect.succeed(OperationId.make("startup-reread")) })
        ),
        Layer.succeed(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("no eligible startup task") })
        ),
        Layer.succeed(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("no eligible startup task") })
        )
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(
            runWorkflow(FixtureTarget.make("occurrence-fixture"), TaskWorkCapacity.make(1)).pipe(
              Effect.provide(workflowLayer)
            )
          )
          yield* Deferred.await(trackerRead)
          yield* Fiber.interrupt(fiber)
        })
      )
    }

    const projection = projectWorkflowOccurrences([retainedIntent])
    expect(projection.occurrences.map(({ _tag }) => _tag)).toEqual(["TrackerGraphReadInitiated"])
    expect(projection.occurrences.map(({ _tag }) => _tag)).not.toContain("CoordinatorCrashed")
  })
)

it.effect("rejects a synthetic coordinator-crash row from the workflow journal union", () =>
  Effect.gen(function* () {
    const failure = yield* Schema.decodeUnknownEffect(WorkflowJournalEvent)({
      _tag: "CoordinatorCrashed",
      version: workflowJournalEventVersion
    }).pipe(Effect.flip)

    expect(failure._tag).toBe("SchemaError")
  })
)

it("generic occurrence consumer renders every runtime classification without event-name mapping", () => {
  const projection = projectWorkflowOccurrences([
    record(1, trackerGraphObservationIntent(operation)),
    record(
      2,
      trackerGraphOutcomeObserved(
        operation.operationId,
        WorkflowOutcome.cases.TrackerGraphObserved.make({
          revision: TrackerRevision.make("generic-consumer-revision"),
          taskIds: []
        })
      )
    )
  ])
  const appliedDirection = AppliedControlDirection.make({
    direction: "Unpause",
    initiatedBy: WorkflowActor.cases.Operator.make({}),
    occurrenceClassification: "InitiatedAction",
    subject: { _tag: "Run", runId }
  })

  expect([...projection.occurrences, appliedDirection].map(presentWorkflowOccurrence)).toEqual([
    { actor: "DalphCoordinator", classification: "InitiatedAction" },
    { classification: "NonActionOccurrence" },
    { actor: "Operator", classification: "InitiatedAction" }
  ])
})

it.effect("schema round-trip tests preserve classification and typed relationships", () =>
  Effect.gen(function* () {
    const projection = projectWorkflowOccurrences([
      record(1, trackerGraphObservationIntent(operation)),
      record(
        2,
        trackerGraphOutcomeObserved(
          operation.operationId,
          WorkflowOutcome.cases.TrackerGraphObserved.make({
            revision: TrackerRevision.make("round-trip-revision"),
            taskIds: []
          })
        )
      )
    ])

    const encoded = yield* Schema.encodeUnknownEffect(WorkflowOccurrenceProjection)(projection)
    const decoded = yield* Schema.decodeUnknownEffect(WorkflowOccurrenceProjection, { onExcessProperty: "error" })(
      encoded
    )

    expect(decoded).toEqual(projection)
    const observation = decoded.occurrences.find(({ _tag }) => _tag === "TaskTrackerFactsObserved")
    if (observation?._tag !== "TaskTrackerFactsObserved") {
      throw new Error("expected round-tripped tracker observation")
    }
    expect(Option.isSome(originatingActionForTrackerObservation(decoded, observation))).toBe(true)
  })
)

it.effect("rejects an observation whose exact initiating action is absent, later, or ambiguous", () =>
  Effect.gen(function* () {
    const valid = projectWorkflowOccurrences([
      record(1, trackerGraphObservationIntent(operation)),
      record(
        2,
        trackerGraphOutcomeObserved(
          operation.operationId,
          WorkflowOutcome.cases.TrackerGraphObserved.make({
            revision: TrackerRevision.make("unrelated-observation-revision"),
            taskIds: []
          })
        )
      )
    ])
    const observation = valid.occurrences.find(({ _tag }) => _tag === "TaskTrackerFactsObserved")
    if (observation?._tag !== "TaskTrackerFactsObserved") throw new Error("expected a tracker observation")

    const action = valid.occurrences.find(({ _tag }) => _tag === "TrackerGraphReadInitiated")
    if (action?._tag !== "TrackerGraphReadInitiated") throw new Error("expected a tracker action")
    const laterDurableAction = { ...action, recordedAt: JournalPosition.make(observation.evidence.observedAt + 1) }
    const mismatchedEvidence = {
      ...observation,
      evidence: { ...observation.evidence, target: FixtureTarget.make("different-target") }
    }
    const invalidOccurrenceOrders = [
      [observation],
      [observation, action],
      [action, action, observation],
      [laterDurableAction, observation],
      [action, mismatchedEvidence]
    ]
    for (const occurrences of invalidOccurrenceOrders) {
      const failure = yield* Schema.decodeUnknownEffect(WorkflowOccurrenceProjection)({
        occurrences,
        version: valid.version
      }).pipe(Effect.flip)
      expect(failure._tag).toBe("SchemaError")
    }

    const otherRunOutcome = {
      ...record(
        2,
        trackerGraphOutcomeObserved(
          operation.operationId,
          WorkflowOutcome.cases.TrackerGraphObserved.make({
            revision: observation.evidence.revision,
            taskIds: observation.evidence.taskIds
          })
        )
      ),
      runId: RunId.make("different-run")
    }
    expect(
      projectWorkflowOccurrences([record(1, trackerGraphObservationIntent(operation)), otherRunOutcome]).occurrences
    ).toHaveLength(1)
  })
)

it("compile-time exhaustive fixtures cover every occurrence and actor variant", () => {
  const occurrenceVariants = {
    AppliedControlDirection: true,
    TaskTrackerFactsObserved: true,
    TrackerGraphReadInitiated: true
  } satisfies Record<WorkflowOccurrence["_tag"], true>
  const actorVariants = { DalphCoordinator: true, Operator: true } satisfies Record<WorkflowActor["_tag"], true>

  expect(Object.keys(occurrenceVariants)).toHaveLength(3)
  expect(Object.keys(actorVariants)).toHaveLength(2)
})
