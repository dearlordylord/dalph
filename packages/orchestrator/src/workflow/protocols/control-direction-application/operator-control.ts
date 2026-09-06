import { type RunId } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import type { TrackerTarget } from "../../../authorities/task-tracker/target.js"
import { OperationSelected, TaskTrackerFactsObservedTrace } from "../../../presentation/tracker-workflow-trace.js"
import { InRunJournalRunMismatch } from "../../../workflow-journal/store.js"
import type { WorkflowInterpreterService, WorkflowTraceService } from "../../interpretation/interpreter.js"
import { makeTrackerGraphObservationOperation } from "../../registry/operation.js"
import { makeCompleteTaskTrackerFactsObserved } from "../../task-tracker-facts/observation.js"
import type { OperationIdAllocatorService } from "../task-attempt-planning/plan.js"
import type { ControlDirectionApplication } from "./protocol.js"
import { ApplyControlDirectionRequest } from "./request.js"
import { taskControlSubjectIsCurrent, TaskControlSubjectOutsideRun } from "./task-subject.js"

interface OperatorControlDirectionDependencies {
  readonly allocator: OperationIdAllocatorService
  readonly application: ControlDirectionApplication["Service"]
  /** Keeps a task-control graph read ahead of concurrent delivery reads in a controlled boundary. */
  readonly graphReadBoundary?: OperatorControlGraphReadBoundary
  readonly interpreter: WorkflowInterpreterService
  readonly trace: WorkflowTraceService
}

export type OperatorControlGraphReadBoundary = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>

/** Reads and journals current task membership before delegating an accepted Operator direction to its action protocol. */
export const applyOperatorControlDirection = Effect.fn("OperatorControlDirection.apply")(function* (
  activeRunId: RunId,
  target: TrackerTarget,
  input: unknown,
  dependencies: OperatorControlDirectionDependencies
) {
  const request = yield* Schema.decodeUnknownEffect(ApplyControlDirectionRequest, { onExcessProperty: "error" })(input)
  const requestedRunId = request.subject.runId
  if (requestedRunId !== activeRunId) {
    return yield* new InRunJournalRunMismatch({ expectedRunId: activeRunId, requestedRunId })
  }
  if (request.subject._tag === "Run") return yield* dependencies.application.apply(request)

  const operation = makeTrackerGraphObservationOperation(
    { _tag: "TaskControlMembershipCheck" },
    yield* dependencies.allocator.allocate(),
    target,
    [],
    [request.subject.taskId]
  )
  const graph = yield* (dependencies.graphReadBoundary ?? identityOperatorControlGraphReadBoundary)(
    Effect.gen(function* () {
      yield* dependencies.trace.emit(OperationSelected.make({ operation }))
      return yield* dependencies.interpreter.readTrackerGraph(operation)
    })
  )
  yield* dependencies.trace.emit(
    TaskTrackerFactsObservedTrace.make({
      observation: makeCompleteTaskTrackerFactsObserved(operation, graph),
      operation
    })
  )
  if (!taskControlSubjectIsCurrent(graph, request.subject.taskId)) {
    return yield* new TaskControlSubjectOutsideRun({
      direction: request.direction,
      reason: "OutsideCurrentTargetClosure",
      runId: request.subject.runId,
      taskId: request.subject.taskId
    })
  }
  return yield* dependencies.application.apply(request)
})

const identityOperatorControlGraphReadBoundary: OperatorControlGraphReadBoundary = (effect) => effect
