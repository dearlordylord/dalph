import { Context, Effect, Layer, Ref, Schema } from "effect"
import type { CoordinatorOwnershipError } from "./coordinator-lock.js"
import {
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  ProviderRequestId,
  ProviderWorkUnitId,
  Task,
  TaskWorkSessionId,
  WorkerProcessId
} from "./domain.js"

/** The immutable evidence-bearing request to establish one task-work session. */
export const TaskWorkStartRequest = Schema.Struct({
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt,
  task: Task
}).check(
  Schema.makeFilter((request) =>
    request.task.id === request.plannedAttempt.taskId
      ? undefined
      : {
        path: ["plannedAttempt", "taskId"],
        issue: "planned attempt task identity must match the requested task"
      }
  )
)
export type TaskWorkStartRequest = typeof TaskWorkStartRequest.Type

/** The exact read-only query used to reconcile a task-work start request. */
export const TaskWorkSessionLookup = Schema.Struct({
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt
})
export type TaskWorkSessionLookup = typeof TaskWorkSessionLookup.Type

/** Evidence that one provider call returned; it does not prove a session exists. */
export const TaskWorkStartRequestAcknowledgement = Schema.Struct({
  observationId: ProviderObservationId,
  providerRequestId: ProviderRequestId
})
export type TaskWorkStartRequestAcknowledgement = typeof TaskWorkStartRequestAcknowledgement.Type

/** The provider can currently report this registry-known work unit. */
export const AvailableProviderWorkUnit = Schema.TaggedStruct(
  "AvailableProviderWorkUnit",
  { providerWorkUnitId: ProviderWorkUnitId }
)

/** The provider proves this registry-known work unit was intentionally purged. */
export const PurgedProviderWorkUnit = Schema.TaggedStruct(
  "PurgedProviderWorkUnit",
  { providerWorkUnitId: ProviderWorkUnitId }
)

/** The provider registry retains the work unit but cannot currently read it. */
export const UnreadableProviderWorkUnit = Schema.TaggedStruct(
  "UnreadableProviderWorkUnit",
  { detail: Schema.String, providerWorkUnitId: ProviderWorkUnitId }
)

/** One worker process currently reported for a task-work session. */
export const ReportedWorkerProcess = Schema.TaggedStruct(
  "ReportedWorkerProcess",
  { processId: WorkerProcessId }
)

const ProviderWorkUnitReport = Schema.Union([
  AvailableProviderWorkUnit,
  PurgedProviderWorkUnit,
  UnreadableProviderWorkUnit
])

export const TaskWorkSessionWork = Schema.TaggedUnion({
  NoProviderWorkReported: {},
  ProviderWorkUnitsReported: {
    workUnits: Schema.NonEmptyArray(ProviderWorkUnitReport)
  },
  WorkerProcessesReported: {
    processes: Schema.NonEmptyArray(ReportedWorkerProcess)
  }
})
export type TaskWorkSessionWork = typeof TaskWorkSessionWork.Type

/** Complete durable correlation proves that no matching session exists. */
export const NoMatchingTaskWorkSessionReported = Schema.TaggedStruct(
  "NoMatchingTaskWorkSessionReported",
  { observationId: ProviderObservationId }
)

/** Exactly one provider session matches the operation and planned attempt. */
export const MatchingTaskWorkSessionReported = Schema.TaggedStruct(
  "MatchingTaskWorkSessionReported",
  {
    observationId: ProviderObservationId,
    sessionId: TaskWorkSessionId,
    work: TaskWorkSessionWork
  }
)

const TaskWorkSessionConflictEvidence = Schema.Struct({
  detail: Schema.NonEmptyString,
  sessionId: TaskWorkSessionId
})

/** Provider records contradict the requested operation or planned attempt. */
export const TaskWorkSessionCorrelationConflict = Schema.TaggedStruct(
  "TaskWorkSessionCorrelationConflict",
  {
    conflicts: Schema.NonEmptyArray(TaskWorkSessionConflictEvidence),
    observationId: ProviderObservationId
  }
)

export const TaskWorkSessionReport = Schema.Union([
  NoMatchingTaskWorkSessionReported,
  MatchingTaskWorkSessionReported,
  TaskWorkSessionCorrelationConflict
])
export type TaskWorkSessionReport = typeof TaskWorkSessionReport.Type

export const TaskWorkSessionResult = Schema.TaggedUnion({
  Completed: { evidence: Schema.NonEmptyString },
  Failed: { evidence: Schema.NonEmptyString },
  Interrupted: { evidence: Schema.NonEmptyString }
})
export type TaskWorkSessionResult = typeof TaskWorkSessionResult.Type

/** A terminal provider result for one session; it does not decide task success. */
export const TaskWorkSessionResultReported = Schema.TaggedStruct(
  "TaskWorkSessionResultReported",
  {
    observationId: ProviderObservationId,
    result: TaskWorkSessionResult,
    sessionId: TaskWorkSessionId
  }
)
export type TaskWorkSessionResultReported = typeof TaskWorkSessionResultReported.Type

/** The task-work provider could not establish complete correlation evidence. */
export class TaskWorkSessionLookupFailure extends Schema.TaggedErrorClass<TaskWorkSessionLookupFailure>()(
  "TaskWorkSessionLookupFailure",
  {
    detail: Schema.String,
    observationId: ProviderObservationId
  }
) {}

/** The state-changing request returned no acknowledgement and may have applied. */
export class TaskWorkStartRequestFailure extends Schema.TaggedErrorClass<TaskWorkStartRequestFailure>()(
  "TaskWorkStartRequestFailure",
  {
    detail: Schema.String,
    observationId: ProviderObservationId
  }
) {}

export interface TaskRunnerService {
  readonly lookupTaskWorkSession: (
    lookup: TaskWorkSessionLookup
  ) => Effect.Effect<TaskWorkSessionReport, TaskWorkSessionLookupFailure>
  readonly requestTaskWorkStart: (
    request: TaskWorkStartRequest
  ) => Effect.Effect<
    TaskWorkStartRequestAcknowledgement,
    CoordinatorOwnershipError | TaskWorkStartRequestFailure
  >
}

/** Provider-neutral boundary for task-work start requests and fresh session reads. */
export class TaskRunner extends Context.Service<TaskRunner, TaskRunnerService>()(
  "@dalph/TaskRunner"
) {}

type ControlledLookupResult = TaskWorkSessionReport | TaskWorkSessionLookupFailure

interface TestTaskRunnerService extends TaskRunnerService {
  readonly lookups: () => Effect.Effect<ReadonlyArray<TaskWorkSessionLookup>>
  readonly requests: () => Effect.Effect<ReadonlyArray<TaskWorkStartRequest>>
  readonly setLookupResults: (
    results: ReadonlyArray<ControlledLookupResult>
  ) => Effect.Effect<void>
}

/** Per-test controls for the same fake object injected through `TaskRunner`. */
export class TestTaskRunner extends Context.Service<
  TestTaskRunner,
  TestTaskRunnerService
>()("@dalph/TaskRunner/Test") {}

export const taskRunnerTestLayer = Layer.effectContext(
  Effect.gen(function*() {
    const observedLookups = yield* Ref.make<ReadonlyArray<TaskWorkSessionLookup>>([])
    const observedRequests = yield* Ref.make<ReadonlyArray<TaskWorkStartRequest>>([])
    const lookupResults = yield* Ref.make<ReadonlyArray<ControlledLookupResult>>([])

    const service = TestTaskRunner.of({
      lookupTaskWorkSession: Effect.fn("TaskRunner.Test.lookupTaskWorkSession")(function*(lookup) {
        yield* Ref.update(observedLookups, (current) => [...current, lookup])
        const result = yield* Ref.modify(lookupResults, (current) =>
          [
            current[0],
            current.slice(1)
          ] as const)
        if (result === undefined) {
          return yield* new TaskWorkSessionLookupFailure({
            detail: "no controlled lookup result remains",
            observationId: ProviderObservationId.make(`test-lookup:${lookup.operationId}`)
          })
        }
        return result instanceof TaskWorkSessionLookupFailure
          ? yield* result
          : result
      }),
      requestTaskWorkStart: Effect.fn("TaskRunner.Test.requestTaskWorkStart")(function*(request) {
        yield* Ref.update(observedRequests, (current) => [...current, request])
        const count = (yield* Ref.get(observedRequests)).length
        return TaskWorkStartRequestAcknowledgement.make({
          observationId: ProviderObservationId.make(`test-request-observation:${request.operationId}:${count}`),
          providerRequestId: ProviderRequestId.make(`test-request:${request.operationId}:${count}`)
        })
      }),
      lookups: () => Ref.get(observedLookups),
      requests: () => Ref.get(observedRequests),
      setLookupResults: (results) => Ref.set(lookupResults, results)
    })

    return Context.empty().pipe(
      Context.add(TaskRunner, service),
      Context.add(TestTaskRunner, service)
    )
  })
)
