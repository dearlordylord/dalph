import { PlannedAttemptExecutor, plannedAttemptExecutorCorrelation, type RunId } from "@dalph/contracts"
import { Effect } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { PlannedAttemptExecutorCorrelationMismatch } from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import { DeliveryActionExecutor } from "./delivery-action-executor.js"
import { makeLiveDeliveryActionExecutor } from "./live-delivery-action-executor.js"
import type { SyntheticDeliveryAcceptedFactsService } from "./synthetic-delivery-relations.js"

const correlationsMatch = (
  expected: ReturnType<typeof plannedAttemptExecutorCorrelation>,
  observed: ReturnType<typeof plannedAttemptExecutorCorrelation>
): boolean => expected.attemptId === observed.attemptId && expected.runId === observed.runId

export const validateSyntheticExecutorCorrelation = (
  expected: ReturnType<typeof plannedAttemptExecutorCorrelation>,
  observed: ReturnType<typeof plannedAttemptExecutorCorrelation>
): Effect.Effect<void, PlannedAttemptExecutorCorrelationMismatch> =>
  correlationsMatch(expected, observed)
    ? Effect.void
    : Effect.fail(new PlannedAttemptExecutorCorrelationMismatch({ expected, observed }))

/**
 * Interprets the synthetic executor boundary. The surrounding synthetic Run
 * supplies the same journaled interpreter as live execution; only executor
 * reports remain process-local synthetic facts.
 */
export const makeSyntheticDeliveryActionExecutorWithAcceptedFacts = Effect.fn(
  "DeliveryActionExecutor.makeSyntheticWithAcceptedFacts"
)(function* (runId: RunId, target: TrackerTarget, acceptedFacts: SyntheticDeliveryAcceptedFactsService) {
  const live = yield* makeLiveDeliveryActionExecutor(runId, target)
  const executor = yield* PlannedAttemptExecutor
  return DeliveryActionExecutor.of({
    execute: (action, lease) => {
      const result = (() => {
        if (action._tag !== "IdentityFreeAction" || action.proposal.route._tag !== "FreshExecutorWorkflowRoute") {
          return live.execute(action, lease)
        }
        const plannedAttempt = action.proposal.route.step.plannedAttempt
        const expected = plannedAttemptExecutorCorrelation(plannedAttempt)
        return Effect.gen(function* () {
          yield* acceptedFacts.authorizeExecutorContinuation(expected)
          yield* lease.bindPlannedAttemptPosition(expected)
          const report = yield* executor.startOrContinue(plannedAttempt)
          yield* validateSyntheticExecutorCorrelation(expected, report.correlation)
          if (report._tag === "SafelySuspended" || report._tag === "Terminal") {
            yield* lease.releasePlannedAttemptPosition(expected)
          }
          return { _tag: "ExecutorReportPublished" as const, plannedAttempt, proposalId: action.proposal.id, report }
        })
      })()
      return result.pipe(Effect.tap((accepted) => acceptedFacts.publish(accepted)))
    }
  })
})
