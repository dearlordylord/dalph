import type { RunId } from "@dalph/contracts"
import { Match } from "effect"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { targetPromotionRunIdOf } from "../../workflow/protocols/target-promotion/events.js"

export const setMapValue = <K, V>(map: Map<K, V>, key: K, value: V): void => {
  Map.prototype.set.call(map, key, value)
}

type TargetPromotionRunBindingEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "TargetPromotionIntended"
      | "TargetPromotionAttemptIntended"
      | "TargetPromotionObservedSuccess"
      | "TargetPromotionStale"
      | "TargetPromotionNonConvergence"
  }
>

const invalidTargetPromotionRunBinding = (event: TargetPromotionRunBindingEvent, runId: RunId): string | undefined =>
  targetPromotionRunIdOf(event.correlation) === runId
    ? undefined
    : `target promotion binds run ${targetPromotionRunIdOf(event.correlation)}`

const invalidRunBinding = (event: WorkflowJournalEvent, runId: RunId): string | undefined =>
  Match.value(event).pipe(
    Match.tags({
      TargetPromotionIntended: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      TargetPromotionAttemptIntended: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      TargetPromotionObservedSuccess: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      TargetPromotionStale: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      TargetPromotionNonConvergence: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      IntegratorSessionFixed: (candidate) =>
        candidate.correlation.plannedAttempt.runId === runId
          ? undefined
          : `Integrator session binds run ${candidate.correlation.plannedAttempt.runId}`,
      IntegratorSuccessorSessionFixed: (candidate) =>
        candidate.predecessor.plannedAttempt.runId === runId && candidate.successor.plannedAttempt.runId === runId
          ? undefined
          : "Integrator successor session binds a foreign run",
      IntegratorRunStarted: (candidate) =>
        candidate.run.session.plannedAttempt.runId === runId
          ? undefined
          : `Integrator run start binds run ${candidate.run.session.plannedAttempt.runId}`,
      IntegratorResultRecorded: (candidate) =>
        candidate.result.correlation.plannedAttempt.runId === runId
          ? undefined
          : `Integrator result binds run ${candidate.result.correlation.plannedAttempt.runId}`,
      IntegratorRunResultRecorded: (candidate) =>
        candidate.run.session.plannedAttempt.runId === runId
          ? undefined
          : `Integrator run result binds run ${candidate.run.session.plannedAttempt.runId}`,
      IntegratorCandidateGitReadIntended: (candidate) =>
        candidate.correlation.plannedAttempt.runId === runId
          ? undefined
          : `Integrator candidate Git-read intent binds run ${candidate.correlation.plannedAttempt.runId}`,
      IntegratorRunCandidateGitReadIntended: (candidate) =>
        candidate.run.session.plannedAttempt.runId === runId
          ? undefined
          : `Integrator run candidate Git-read intent binds run ${candidate.run.session.plannedAttempt.runId}`,
      IntegratorCandidateGitObserved: (candidate) =>
        candidate.correlation.plannedAttempt.runId === runId
          ? undefined
          : `Integrator candidate Git observation binds run ${candidate.correlation.plannedAttempt.runId}`,
      IntegratorRunCandidateGitObserved: (candidate) =>
        candidate.run.session.plannedAttempt.runId === runId
          ? undefined
          : `Integrator run candidate Git observation binds run ${candidate.run.session.plannedAttempt.runId}`,
      IntegrationQuarantineDirectionApplied: (candidate) =>
        candidate.requestId.runId === runId
          ? undefined
          : `integration quarantine direction binds run ${candidate.requestId.runId}`,
      IntegrationProviderRunActivityAbsent: (candidate) => {
        const correlationRunId = candidate.correlation.plannedAttempt.runId
        const exactRunId = candidate.run.session.plannedAttempt.runId
        return correlationRunId === runId && exactRunId === runId
          ? undefined
          : `Integrator provider-activity absence binds run ${exactRunId}`
      }
    }),
    Match.orElse(() => undefined)
  )

export const invalidIntegrationRunBinding = (event: WorkflowJournalEvent, runId: RunId): string | undefined => {
  if (event._tag === "IntegrationResponsibilityBegan" || event._tag === "IntegrationStarted") {
    return event.plannedAttempt.runId === runId
      ? undefined
      : `integration work for attempt ${event.plannedAttempt.attemptId} binds run ${event.plannedAttempt.runId}`
  }
  return invalidRunBinding(event, runId)
}
