import { type RunId, TaskId } from "@dalph/contracts"
import { Effect, Option, Schema } from "effect"
import { OperationSelected } from "../../../presentation/tracker-workflow-trace.js"
import type { WorkflowInterpreterService, WorkflowTrace } from "../../interpretation/interpreter.js"
import { type OperationId } from "../../identity.js"
import { makeTaskClaimAcquisitionOperation } from "../../registry/operation.js"
import type { InRunJournal } from "../../../workflow-journal/store.js"
import type { TaskClaimAcquisitionPlanner } from "../task-claim-acquisition/plan.js"
import type { TaskClaimReacquisitionRequestId } from "./events.js"
import { taskClaimReacquisitionOperationId } from "./plan.js"

/** A selected explicit reacquisition has no configured identity planner. */
export class TaskClaimReacquisitionPlannerUnavailable extends Schema.TaggedErrorClass<TaskClaimReacquisitionPlannerUnavailable>()(
  "TaskClaimReacquisitionPlannerUnavailable",
  { taskId: TaskId }
) {}

/** The configured planner could not allocate the replacement claim identity. */
export class TaskClaimReacquisitionPlanningFailed extends Schema.TaggedErrorClass<TaskClaimReacquisitionPlanningFailed>()(
  "TaskClaimReacquisitionPlanningFailed",
  { detail: Schema.String, taskId: TaskId }
) {}

/* v8 ignore start -- @preserve Planner failure rendering is a defensive fallback around a typed Effect boundary. */
const planningFailureDetail = (failure: unknown): string =>
  typeof failure === "object" && failure !== null && "_tag" in failure
    ? String(failure._tag)
    : "TaskClaimAcquisitionPlanner.plan failed"
/* v8 ignore stop -- @preserve */

/** Executes one graph-selected explicit claim reacquisition through its action-owned protocol. */
export const runTaskClaimReacquisition = Effect.fn("TaskClaimReacquisition.run")(function* (input: {
  readonly execution: { readonly recordIntent: (operationId: OperationId) => Effect.Effect<void, never, never> }
  readonly interpreter: WorkflowInterpreterService
  readonly journal: InRunJournal["Service"]
  readonly planner: Option.Option<TaskClaimAcquisitionPlanner["Service"]>
  readonly requestId: TaskClaimReacquisitionRequestId
  readonly runId: RunId
  readonly taskId: TaskId
  readonly trace: Option.Option<WorkflowTrace["Service"]>
}) {
  const planner = yield* Option.match(input.planner, {
    onNone: () => Effect.fail(new TaskClaimReacquisitionPlannerUnavailable({ taskId: input.taskId })),
    onSome: Effect.succeed
  })
  const records = yield* input.journal.read(input.runId)
  const priorClaim = records.findLast(
    ({ event }) => event._tag === "TaskClaimAcquired" && event.claim.taskId === input.taskId
  )?.event
  const observation = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "FocusedTaskClaimFacts" ||
        event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
      event.observation.coverage.taskId === input.taskId
  )?.event
  const operationId = taskClaimReacquisitionOperationId(input.requestId)
  const operation = makeTaskClaimAcquisitionOperation({
    acquisition: yield* planner.plan(operationId, input.taskId).pipe(
      Effect.mapError(
        /* v8 ignore next -- @preserve The unavailable-planner path is tested; provider-specific planner failures are wrapped here. */
        (failure) =>
          new TaskClaimReacquisitionPlanningFailed({ detail: planningFailureDetail(failure), taskId: input.taskId })
      )
    ),
    authority: { _tag: "ExplicitTaskClaimReacquisitionAuthority", requestId: input.requestId },
    predecessorOperationIds: [
      /* v8 ignore next -- @preserve Valid reacquisition history always includes the claim whose authority was lost. */
      ...(priorClaim?._tag === "TaskClaimAcquired" ? [priorClaim.claim.operationId] : []),
      /* v8 ignore next -- @preserve Valid reacquisition history always includes the missing or foreign observation. */
      ...(observation?._tag === "TaskTrackerFactsObserved" ? [observation.operationId] : [])
    ]
  })
  if (Option.isSome(input.trace)) {
    yield* input.trace.value.emit(OperationSelected.make({ operation }))
  }
  yield* input.interpreter.acquireTaskClaim(operation, input.execution.recordIntent(operationId))
})
