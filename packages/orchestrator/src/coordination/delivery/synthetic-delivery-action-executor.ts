import { PlannedAttemptExecutor, plannedAttemptExecutorCorrelation, type RunId } from "@dalph/contracts"
import { Effect } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { InRunJournal } from "../../workflow-journal/store.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { PlannedAttemptExecutorCorrelationMismatch } from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import { DeliveryActionExecutor, type MaterializedDeliveryAction } from "./delivery-action-executor.js"
import { makeLiveDeliveryActionExecutor } from "./live-delivery-action-executor.js"
import { executeTrackerGraphRead } from "./delivery-action-adapter-common.js"
import type { DeliveryActionAdapterEnvironment } from "./delivery-action-adapter-environment.js"
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

/** Synthetic graph reads use the ordinary journal boundary before publishing their result. */
const executeSyntheticTrackerGraphRead = Effect.fn("DeliveryAction.executeSyntheticTrackerGraphRead")(function* (
  runId: RunId,
  action: Extract<MaterializedDeliveryAction, { readonly _tag: "FreshOperationAction" }>,
  route: Extract<MaterializedDeliveryAction["proposal"]["route"], { readonly _tag: "TrackerGraphReadRoute" }>
) {
  const operation = makeTrackerGraphObservationOperation(action.operationId, route.target)
  const journal = yield* InRunJournal
  yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
  const snapshot = yield* executeTrackerGraphRead(operation)
  yield* journal.append(
    runId,
    outcomeRecordKey(operation.operationId),
    taskTrackerFactsObservedEvent(operation.operationId, makeCompleteTaskTrackerFactsObserved(operation, snapshot))
  )
  return {
    _tag: "TrackerGraphObservationPublished" as const,
    operationId: action.operationId,
    proposalId: action.proposal.id,
    snapshot
  }
})

/**
 * Interprets the synthetic executor boundary: graph reads journal ordinary intent and outcome facts before
 * publishing a journaled snapshot, while other actions use the same leaf adapters as live delivery.
 */
export const makeSyntheticDeliveryActionExecutorWithAcceptedFacts = Effect.fn(
  "DeliveryActionExecutor.makeSyntheticWithAcceptedFacts"
)(function* (runId: RunId, target: TrackerTarget, acceptedFacts: SyntheticDeliveryAcceptedFactsService) {
  const live = yield* makeLiveDeliveryActionExecutor(runId, target)
  const dependencies = yield* Effect.context<DeliveryActionAdapterEnvironment>()
  const executor = yield* PlannedAttemptExecutor
  return DeliveryActionExecutor.of({
    execute: (action, lease) => {
      const result = (() => {
        if (action._tag === "FreshOperationAction" && action.proposal.route._tag === "TrackerGraphReadRoute") {
          return executeSyntheticTrackerGraphRead(runId, action, action.proposal.route).pipe(
            Effect.provide(dependencies)
          )
        }
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
