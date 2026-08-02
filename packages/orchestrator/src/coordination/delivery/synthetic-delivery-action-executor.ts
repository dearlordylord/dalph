import { PlannedAttemptExecutor, plannedAttemptExecutorCorrelation, type RunId } from "@dalph/contracts"
import { Effect } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { PlannedAttemptExecutorCorrelationMismatch } from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import { DeliveryActionExecutor } from "./delivery-action-executor.js"
import { makeLiveDeliveryActionExecutor } from "./live-delivery-action-executor.js"

const correlationsMatch = (
  expected: ReturnType<typeof plannedAttemptExecutorCorrelation>,
  observed: ReturnType<typeof plannedAttemptExecutorCorrelation>
): boolean => expected.attemptId === observed.attemptId && expected.runId === observed.runId

/**
 * Interprets the synthetic executor boundary without asserting journal facts.
 * Every other action uses the same leaf adapters as journaled delivery.
 */
export const makeSyntheticDeliveryActionExecutor = Effect.fn("DeliveryActionExecutor.makeSynthetic")(function* (
  runId: RunId,
  target: TrackerTarget
) {
  const live = yield* makeLiveDeliveryActionExecutor(runId, target)
  const executor = yield* PlannedAttemptExecutor
  return DeliveryActionExecutor.of({
    execute: (action, lease) => {
      if (action._tag !== "IdentityFreeAction" || action.proposal.route._tag !== "FreshExecutorWorkflowRoute") {
        return live.execute(action, lease)
      }
      const plannedAttempt = action.proposal.route.step.plannedAttempt
      const expected = plannedAttemptExecutorCorrelation(plannedAttempt)
      return Effect.gen(function* () {
        yield* lease.bindPlannedAttemptPosition(expected)
        const report = yield* executor.startOrContinue(plannedAttempt)
        if (!correlationsMatch(expected, report.correlation)) {
          return yield* new PlannedAttemptExecutorCorrelationMismatch({ expected, observed: report.correlation })
        }
        if (report._tag === "SafelySuspended" || report._tag === "Terminal") {
          yield* lease.releasePlannedAttemptPosition(expected)
        }
        return { _tag: "ExecutorReportPublished" as const, plannedAttempt, proposalId: action.proposal.id, report }
      })
    }
  })
})
