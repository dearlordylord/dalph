import { Context, Effect, Layer, Ref, Schema } from "effect"
import type { CoordinatorOwnershipError } from "./coordinator-lock.js"
import {
  FailedProcessExitCode,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  Task,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorkerProcessId
} from "./domain.js"
import { taskRevisionFor } from "./task-dag.js"

const maximumExecutionOutputLength = 1_048_576
const ExecutionOutput = Schema.String.check(Schema.isMaxLength(maximumExecutionOutputLength))

/** Selects either provider-proved live execution or a locator-only pure simulation. */
export const TaskExecutionSessionBinding = Schema.TaggedUnion({
  EstablishedSession: { sessionId: TaskWorkSessionId },
  PlannedSession: { session: TaskWorkSessionLocator }
})
export type TaskExecutionSessionBinding = typeof TaskExecutionSessionBinding.Type

/** Requests one worker process or simulates that request for a planned task attempt. */
export const TaskExecutionRequest = Schema.Struct({
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt,
  session: TaskExecutionSessionBinding,
  task: Task
}).check(
  Schema.makeFilter((request) =>
    request.task.id === request.plannedAttempt.taskId
      ? undefined
      : {
        path: ["plannedAttempt", "taskId"],
        issue: "planned task attempt task identity must match the requested task"
      }
  ),
  Schema.makeFilter((request) =>
    taskRevisionFor(request.task) === request.plannedAttempt.taskRevision
      ? undefined
      : {
        path: ["plannedAttempt", "taskRevision"],
        issue: "planned task attempt task revision (fingerprint) must match the requested task"
      }
  )
)
export type TaskExecutionRequest = typeof TaskExecutionRequest.Type

/** The exact read-only query used to reconcile one task-execution request. */
export const TaskExecutionLookup = Schema.Struct({
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt,
  sessionId: TaskWorkSessionId
})
export type TaskExecutionLookup = typeof TaskExecutionLookup.Type

/** The execution adapter returned from a request; fresh observation still proves start. */
export const TaskExecutionRequestAcknowledgement = Schema.Struct({
  observationId: ProviderObservationId,
  providerRequestId: ProviderRequestId
})
export type TaskExecutionRequestAcknowledgement = typeof TaskExecutionRequestAcknowledgement.Type

const ExecutionEvidence = {
  observationId: ProviderObservationId,
  operationId: OperationId,
  processId: WorkerProcessId,
  sessionId: TaskWorkSessionId
}

/** Complete provider correlation proves that no process exists for this operation. */
export const NoTaskExecutionReported = Schema.TaggedStruct("NoTaskExecutionReported", {
  observationId: ProviderObservationId,
  operationId: OperationId,
  sessionId: TaskWorkSessionId
})

/** A fresh provider observation proves the admitted task execution began. */
export const RunningTaskExecutionReported = Schema.TaggedStruct("RunningTaskExecutionReported", {
  ...ExecutionEvidence
})

/** The exact worker process exited successfully and preserved its bounded output. */
export const SuccessfulTaskExecutionReported = Schema.TaggedStruct("SuccessfulTaskExecutionReported", {
  ...ExecutionEvidence,
  output: ExecutionOutput
})

/** Nonzero exit preserves the exact session, WIP, and bounded partial output. */
export const FailedTaskExecutionReported = Schema.TaggedStruct("FailedTaskExecutionReported", {
  ...ExecutionEvidence,
  exitCode: FailedProcessExitCode,
  partialOutput: ExecutionOutput,
  wipPreserved: Schema.Literal(true)
})

/** Provider interruption preserves the exact session, WIP, and bounded partial output. */
export const InterruptedTaskExecutionReported = Schema.TaggedStruct("InterruptedTaskExecutionReported", {
  ...ExecutionEvidence,
  partialOutput: ExecutionOutput,
  wipPreserved: Schema.Literal(true)
})

/** Provider evidence demonstrates a capacity emergency; unchanged automatic execution is forbidden. */
export const ResourceEmergencyTaskExecutionReported = Schema.TaggedStruct(
  "ResourceEmergencyTaskExecutionReported",
  {
    ...ExecutionEvidence,
    cause: Schema.Literals(["MemoryExhausted", "ProcessCapacityExhausted", "StorageExhausted"]),
    detail: Schema.NonEmptyString,
    partialOutput: ExecutionOutput,
    wipPreserved: Schema.Literal(true)
  }
)

/** The provider cannot determine a terminal process outcome from complete current evidence. */
export const AmbiguousTaskExecutionReported = Schema.TaggedStruct("AmbiguousTaskExecutionReported", {
  ...ExecutionEvidence,
  detail: Schema.NonEmptyString,
  partialOutput: ExecutionOutput,
  wipPreserved: Schema.Literal(true)
})

const TaskExecutionSessionConflictEvidence = Schema.Struct({
  detail: Schema.NonEmptyString,
  reportedSessionId: Schema.NullOr(TaskWorkSessionId)
})

/** Stale, replaced, foreign, or untracked session evidence blocks the attempt. */
export const TaskExecutionSessionConflictReported = Schema.TaggedStruct(
  "TaskExecutionSessionConflictReported",
  {
    conflict: Schema.Literals(["Stale", "Replaced", "Foreign", "Untracked"]),
    evidence: TaskExecutionSessionConflictEvidence,
    observationId: ProviderObservationId,
    operationId: OperationId,
    sessionId: TaskWorkSessionId
  }
)

export const TaskExecutionReport = Schema.Union([
  NoTaskExecutionReported,
  RunningTaskExecutionReported,
  SuccessfulTaskExecutionReported,
  FailedTaskExecutionReported,
  InterruptedTaskExecutionReported,
  ResourceEmergencyTaskExecutionReported,
  AmbiguousTaskExecutionReported,
  TaskExecutionSessionConflictReported
])
export type TaskExecutionReport = typeof TaskExecutionReport.Type

/** Fresh process evidence that can prove execution began, including terminal evidence. */
export const TaskExecutionStartedReport = Schema.Union([
  RunningTaskExecutionReported,
  SuccessfulTaskExecutionReported,
  FailedTaskExecutionReported,
  InterruptedTaskExecutionReported,
  ResourceEmergencyTaskExecutionReported,
  AmbiguousTaskExecutionReported
])
export type TaskExecutionStartedReport = typeof TaskExecutionStartedReport.Type

/** A request may have crossed the adapter boundary and therefore requires observation. */
export class TaskExecutionRequestFailure extends Schema.TaggedErrorClass<TaskExecutionRequestFailure>()(
  "TaskExecutionRequestFailure",
  { detail: Schema.String, observationId: ProviderObservationId, operationId: OperationId }
) {}

/** The execution adapter could not obtain complete session and process evidence. */
export class TaskExecutionObservationFailure extends Schema.TaggedErrorClass<TaskExecutionObservationFailure>()(
  "TaskExecutionObservationFailure",
  { detail: Schema.String, observationId: ProviderObservationId, operationId: OperationId }
) {}

/** Provider evidence names a session that cannot advance the exact planned task attempt. */
export class TaskExecutionSessionConflict extends Schema.TaggedErrorClass<TaskExecutionSessionConflict>()(
  "TaskExecutionSessionConflict",
  { report: TaskExecutionSessionConflictReported }
) {}

/** The provider reported an operation, session, or process identity other than the request. */
export class TaskExecutionEvidenceContradiction extends Schema.TaggedErrorClass<TaskExecutionEvidenceContradiction>()(
  "TaskExecutionEvidenceContradiction",
  { detail: Schema.NonEmptyString, report: TaskExecutionReport }
) {}

/** Durable terminal evidence and a later fresh report disagree for one operation. */
export class TaskExecutionReportContradiction extends Schema.TaggedErrorClass<TaskExecutionReportContradiction>()(
  "TaskExecutionReportContradiction",
  {
    durableReport: TaskExecutionReport,
    freshReport: TaskExecutionReport,
    operationId: OperationId
  }
) {}

/** An adapter returned a replacement identity for the admitted execution operation. */
export class TaskExecutionIdentityContradiction extends Schema.TaggedErrorClass<TaskExecutionIdentityContradiction>()(
  "TaskExecutionIdentityContradiction",
  { expectedOperationId: OperationId, observedOperationId: OperationId }
) {}

/** Fresh provider evidence cannot determine whether the exact worker process terminated. */
export class TaskExecutionOutcomeAmbiguous extends Schema.TaggedErrorClass<TaskExecutionOutcomeAmbiguous>()(
  "TaskExecutionOutcomeAmbiguous",
  { report: AmbiguousTaskExecutionReported }
) {}

/** The exact process began but has no terminal provider outcome yet. */
export class TaskExecutionStillRunning extends Schema.TaggedErrorClass<TaskExecutionStillRunning>()(
  "TaskExecutionStillRunning",
  { report: RunningTaskExecutionReported }
) {}

/** A locator-only simulation was presented to a live execution adapter. */
export class TaskExecutionModeContradiction extends Schema.TaggedErrorClass<TaskExecutionModeContradiction>()(
  "TaskExecutionModeContradiction",
  { operationId: OperationId }
) {}

/** Durable session or attempt evidence cannot authorize this execution operation. */
export class TaskExecutionHistoryContradiction extends Schema.TaggedErrorClass<TaskExecutionHistoryContradiction>()(
  "TaskExecutionHistoryContradiction",
  {
    operationId: OperationId,
    reason: Schema.Literals([
      "MissingSessionIntent",
      "MultipleSessionIntents",
      "AttemptMismatch",
      "MissingSessionOutcome",
      "MultipleSessionOutcomes",
      "SessionMismatch",
      "MultipleIntents",
      "IntentMismatch",
      "OutcomeWithoutIntent"
    ])
  }
) {}

/** The planned execution attempt belongs to a different durable workflow run. */
export class TaskExecutionRunContradiction extends Schema.TaggedErrorClass<TaskExecutionRunContradiction>()(
  "TaskExecutionRunContradiction",
  {
    journalRunId: RunId,
    operationId: OperationId,
    plannedAttemptRunId: RunId
  }
) {}

export const TaskExecutionOutcome = Schema.TaggedUnion({
  Succeeded: { ...ExecutionEvidence, output: ExecutionOutput },
  Failed: {
    ...ExecutionEvidence,
    exitCode: FailedProcessExitCode,
    partialOutput: ExecutionOutput,
    wipPreserved: Schema.Literal(true)
  },
  Interrupted: {
    ...ExecutionEvidence,
    partialOutput: ExecutionOutput,
    wipPreserved: Schema.Literal(true)
  },
  ResourceEmergency: {
    ...ExecutionEvidence,
    cause: Schema.Literals(["MemoryExhausted", "ProcessCapacityExhausted", "StorageExhausted"]),
    detail: Schema.NonEmptyString,
    partialOutput: ExecutionOutput,
    wipPreserved: Schema.Literal(true)
  }
})
export type TaskExecutionOutcome = typeof TaskExecutionOutcome.Type

export interface TaskExecutorService {
  readonly observeTaskExecution: (
    lookup: TaskExecutionLookup
  ) => Effect.Effect<TaskExecutionReport, TaskExecutionObservationFailure>
  readonly requestTaskExecution: (
    request: TaskExecutionRequest
  ) => Effect.Effect<
    TaskExecutionRequestAcknowledgement,
    CoordinatorOwnershipError | TaskExecutionRequestFailure
  >
}

/** Provider-neutral boundary for exact worker-process requests and fresh observations. */
export class TaskExecutor extends Context.Service<TaskExecutor, TaskExecutorService>()(
  "@dalph/TaskExecutor"
) {}

type ControlledObservation = TaskExecutionReport | TaskExecutionObservationFailure

interface TestTaskExecutorService extends TaskExecutorService {
  readonly lookups: () => Effect.Effect<ReadonlyArray<TaskExecutionLookup>>
  readonly requests: () => Effect.Effect<ReadonlyArray<TaskExecutionRequest>>
  readonly setObservations: (observations: ReadonlyArray<ControlledObservation>) => Effect.Effect<void>
}

export class TestTaskExecutor extends Context.Service<TestTaskExecutor, TestTaskExecutorService>()(
  "@dalph/TaskExecutor/Test"
) {}

export const taskExecutorTestLayer = Layer.effectContext(Effect.gen(function*() {
  const lookups = yield* Ref.make<ReadonlyArray<TaskExecutionLookup>>([])
  const requests = yield* Ref.make<ReadonlyArray<TaskExecutionRequest>>([])
  const observations = yield* Ref.make<ReadonlyArray<ControlledObservation>>([])
  const service = TestTaskExecutor.of({
    observeTaskExecution: Effect.fn("TaskExecutor.Test.observeTaskExecution")(function*(lookup) {
      yield* Ref.update(lookups, (current) => [...current, lookup])
      const next = yield* Ref.modify(observations, (current) => [current[0], current.slice(1)] as const)
      if (next === undefined) {
        return yield* new TaskExecutionObservationFailure({
          detail: "no controlled observation remains",
          observationId: ProviderObservationId.make(`test-execution-observation:${lookup.operationId}`),
          operationId: lookup.operationId
        })
      }
      return next instanceof TaskExecutionObservationFailure ? yield* next : next
    }),
    requestTaskExecution: Effect.fn("TaskExecutor.Test.requestTaskExecution")(function*(request) {
      yield* Ref.update(requests, (current) => [...current, request])
      return TaskExecutionRequestAcknowledgement.make({
        observationId: ProviderObservationId.make(`test-execution-request:${request.operationId}`),
        providerRequestId: ProviderRequestId.make(`test-execution-provider-request:${request.operationId}`)
      })
    }),
    lookups: () => Ref.get(lookups),
    requests: () => Ref.get(requests),
    setObservations: (next) => Ref.set(observations, next)
  })
  return Context.empty().pipe(
    Context.add(TaskExecutor, service),
    Context.add(TestTaskExecutor, service)
  )
}))

const reportMatches = (lookup: TaskExecutionLookup, report: TaskExecutionReport): boolean =>
  report.operationId === lookup.operationId && report.sessionId === lookup.sessionId

/** Rejects foreign operation or session evidence before it reaches observers. */
export const validateTaskExecutionReport = (
  lookup: TaskExecutionLookup,
  report: TaskExecutionReport
): Effect.Effect<void, TaskExecutionEvidenceContradiction> =>
  reportMatches(lookup, report)
    ? Effect.void
    : Effect.fail(
      new TaskExecutionEvidenceContradiction({
        detail: "provider evidence does not match the requested operation and session",
        report
      })
    )

export const taskExecutionOutcomeFromReport = (
  lookup: TaskExecutionLookup,
  report: TaskExecutionReport
): Effect.Effect<
  TaskExecutionOutcome,
  | TaskExecutionEvidenceContradiction
  | TaskExecutionOutcomeAmbiguous
  | TaskExecutionSessionConflict
  | TaskExecutionStillRunning
> => {
  if (!reportMatches(lookup, report)) {
    return Effect.fail(
      new TaskExecutionEvidenceContradiction({
        detail: "provider evidence does not match the requested operation and session",
        report
      })
    )
  }
  switch (report._tag) {
    case "NoTaskExecutionReported":
      return Effect.fail(
        new TaskExecutionEvidenceContradiction({
          detail: "no execution exists after the request returned",
          report
        })
      )
    case "TaskExecutionSessionConflictReported":
      return Effect.fail(new TaskExecutionSessionConflict({ report }))
    case "AmbiguousTaskExecutionReported":
      return Effect.fail(new TaskExecutionOutcomeAmbiguous({ report }))
    case "RunningTaskExecutionReported": {
      return Effect.fail(new TaskExecutionStillRunning({ report }))
    }
    case "SuccessfulTaskExecutionReported": {
      const { _tag: _reported, ...evidence } = report
      return Effect.succeed(TaskExecutionOutcome.cases.Succeeded.make(evidence))
    }
    case "FailedTaskExecutionReported": {
      const { _tag: _reported, ...evidence } = report
      return Effect.succeed(TaskExecutionOutcome.cases.Failed.make(evidence))
    }
    case "InterruptedTaskExecutionReported": {
      const { _tag: _reported, ...evidence } = report
      return Effect.succeed(TaskExecutionOutcome.cases.Interrupted.make(evidence))
    }
    case "ResourceEmergencyTaskExecutionReported": {
      const { _tag: _reported, ...evidence } = report
      return Effect.succeed(TaskExecutionOutcome.cases.ResourceEmergency.make(evidence))
    }
  }
}
