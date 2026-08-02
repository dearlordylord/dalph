import { Context, Effect, Option } from "effect"
import {
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedTaskAttempt,
  type TaskId
} from "@dalph/contracts"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import {
  deriveIntegrationAdmission,
  deriveUnqueuedAcceptedResults
} from "../../workflow/protocols/integration-admission/protocol.js"
import { deriveIntegrationCandidateConstruction } from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import {
  deriveRunnableFrontier,
  runnableTransitionTaskId,
  type FrontierExplanation,
  type RunnableFrontier,
  type RunnableFrontierTransition
} from "../frontier/frontier.js"
import { workflowResponsibilityKey } from "../reconstruction/state.js"
import type { CurrentDeliveryFrame } from "../run/current-delivery-relation.js"
import {
  TrackerGraphState,
  type ExactTicketDeliveryEvidence,
  type TicketDeliveryEvidence,
  type TicketDeliveries
} from "./relations.js"
import { boundedParallelTicketsOf, frontierOf, ticketDeliveriesOf } from "./ticket-delivery-projection.js"
import { integrationDeliveryWaitsOf, type IntegrationDeliveryWait } from "../frontier/integration-frontier.js"
import type { DeliveryProjectionEvidence } from "../frontier/delivery-projection-evidence.js"

const responsibilityTaskId = (facts: ResponsibilityFreshFacts): TaskId =>
  facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
    ? facts.responsibility.plannedAttempt.taskId
    : facts.responsibility.taskId

const syntheticExecutorEvidenceOf = (
  frame: Extract<CurrentDeliveryFrame, { readonly _tag: "SyntheticCurrentDeliveryFrame" }>
): ReadonlyArray<TicketDeliveryEvidence> => {
  const latestByAttempt = new Map<
    string,
    Extract<(typeof frame.workflowFacts)[number], { readonly _tag: "PlannedAttemptExecutorWorkReported" }>
  >()
  for (const fact of frame.workflowFacts) {
    if (fact._tag === "PlannedAttemptExecutorWorkReported") {
      latestByAttempt.set(
        plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(fact.plannedAttempt)),
        fact
      )
    }
  }
  return [...latestByAttempt.values()].map((fact) => ({
    _tag: "SyntheticExecutorFacts",
    plannedAttempt: fact.plannedAttempt,
    report: fact.report
  }))
}

const journaledIntegrationEvidenceOf = (
  frame: Extract<CurrentDeliveryFrame, { readonly _tag: "JournaledCurrentDeliveryFrame" }>
): ReadonlyArray<ExactTicketDeliveryEvidence> => {
  const evidence: Array<ExactTicketDeliveryEvidence> = deriveUnqueuedAcceptedResults(frame.workflowHistory.records).map(
    (accepted) => ({ _tag: "AcceptedAwaitingIntegration", accepted })
  )
  for (const responsibility of deriveIntegrationAdmission(frame.workflowHistory.records).responsibilities) {
    evidence.push(
      responsibility._tag === "QueuedIntegrationResponsibility"
        ? { _tag: "QueuedIntegration", responsibility }
        : { _tag: "StartedIntegration", responsibility }
    )
    if (responsibility._tag === "StartedIntegrationResponsibility") {
      const state = deriveIntegrationCandidateConstruction(frame.workflowHistory.records, responsibility)
      if (state !== undefined) evidence.push({ _tag: "IntegrationCandidate", responsibility, state })
    }
  }
  return evidence
}

/** Derives exact delivery evidence from accepted facts, never from the legacy runnable frontier. */
export const ticketDeliveryEvidenceOf = (
  frame: CurrentDeliveryFrame,
  responsibilityFacts: ReadonlyArray<ResponsibilityFreshFacts>
): ReadonlyArray<TicketDeliveryEvidence> => {
  const evidence: ReadonlyArray<TicketDeliveryEvidence> = responsibilityFacts.map((facts) => ({
    _tag: "ResponsibilityFacts",
    facts
  }))
  return frame._tag === "SyntheticCurrentDeliveryFrame"
    ? [...evidence, ...syntheticExecutorEvidenceOf(frame)]
    : [...evidence, ...journaledIntegrationEvidenceOf(frame)]
}

const explanationTaskId = (
  explanation: FrontierExplanation,
  responsibilityTaskIds: ReadonlyMap<string, TaskId>
): TaskId | undefined => {
  if ("taskId" in explanation) return explanation.taskId
  if ("plannedAttempt" in explanation) return explanation.plannedAttempt.taskId
  if ("operationId" in explanation) return responsibilityTaskIds.get(`operation:${explanation.operationId}`)
  if ("correlation" in explanation) return responsibilityTaskIds.get(JSON.stringify(explanation.correlation))
  return undefined
}

const transitionResponsibilityKey = (transition: RunnableFrontierTransition): string | undefined => {
  if ("operationId" in transition) return `operation:${transition.operationId}`
  if ("plannedAttempt" in transition) {
    return JSON.stringify({ attemptId: transition.plannedAttempt.attemptId, runId: transition.plannedAttempt.runId })
  }
  if (transition._tag === "ReleaseExternallyCompletedTaskClaim") {
    return `operation:${transition.operation.release.operationId}`
  }
  return undefined
}

const explanationResponsibilityKey = (explanation: FrontierExplanation): string | undefined => {
  if ("operationId" in explanation) return `operation:${String(explanation.operationId)}`
  if ("correlation" in explanation) return JSON.stringify(explanation.correlation)
  return undefined
}

const legacyResponsibilityKeys = (frontier: RunnableFrontier): ReadonlyArray<string> =>
  [
    ...frontier.transitions.map(transitionResponsibilityKey),
    ...frontier.explanations.map(explanationResponsibilityKey)
  ].flatMap((key) => (key === undefined ? [] : [key]))

const responsibilitySituationKeys = (
  frontier: RunnableFrontier,
  knownResponsibilityKeys: ReadonlySet<string>
): ReadonlyArray<string> =>
  [
    ...frontier.transitions.map((transition) => ({ item: transition, key: transitionResponsibilityKey(transition) })),
    ...frontier.explanations.map((explanation) => ({
      item: explanation,
      key: explanationResponsibilityKey(explanation)
    }))
  ]
    .flatMap(({ item, key }) =>
      key !== undefined && knownResponsibilityKeys.has(key) ? [`${key}:${JSON.stringify(item)}`] : []
    )
    .toSorted()

const expectedResponsibilityFrontier = (facts: ReadonlyArray<ResponsibilityFreshFacts>): RunnableFrontier =>
  deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: { entries: facts.map(({ responsibility }) => responsibility) },
    responsibilityFacts: facts
  })

const integrationAttemptIdentity = (plannedAttempt: PlannedTaskAttempt): string =>
  plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(plannedAttempt))

const integrationWaitIdentity = (wait: IntegrationDeliveryWait): string => JSON.stringify(wait)

const exactIntegrationIdentities = (evidence: ReadonlyArray<TicketDeliveryEvidence>): ReadonlySet<string> =>
  new Set(
    evidence.flatMap((item) => {
      if (item._tag === "AcceptedAwaitingIntegration") {
        return [integrationAttemptIdentity(item.accepted.plannedAttempt)]
      }
      return item._tag === "QueuedIntegration" ||
        item._tag === "StartedIntegration" ||
        item._tag === "IntegrationCandidate"
        ? [integrationAttemptIdentity(item.responsibility.plannedAttempt)]
        : []
    })
  )

const legacyIntegrationIdentities = (frontier: RunnableFrontier): ReadonlySet<string> =>
  new Set([
    ...frontier.transitions.flatMap((transition) => {
      if (transition._tag === "QueueAcceptedResultIntegrationResponsibility") {
        return [integrationAttemptIdentity(transition.accepted.plannedAttempt)]
      }
      return transition._tag === "StartQueuedIntegration" ||
        transition._tag === "AcquireStartedIntegrationTarget" ||
        transition._tag === "ContinueStartedIntegrationCandidate" ||
        transition._tag === "ReleaseStartedIntegrationTarget"
        ? [integrationAttemptIdentity(transition.responsibility.plannedAttempt)]
        : []
    }),
    ...frontier.explanations.flatMap((explanation) =>
      explanation._tag === "IntegrationDependencyWait" ||
      explanation._tag === "IntegrationConfigurationWait" ||
      explanation._tag === "IntegrationTaskClaimConstraint" ||
      explanation._tag === "IntegrationInProgress" ||
      explanation._tag === "IntegrationTrackerFactsWait" ||
      explanation._tag === "IntegrationTargetWait"
        ? [integrationAttemptIdentity(explanation.plannedAttempt)]
        : []
    )
  ])

const symmetricDifference = (left: ReadonlySet<string>, right: ReadonlySet<string>): ReadonlyArray<string> =>
  [...[...left].filter((value) => !right.has(value)), ...[...right].filter((value) => !left.has(value))].toSorted()

export type DeliveryShadowComparison =
  | {
      readonly _tag: "ComparedDeliveryProjection"
      readonly acceptedAt: JournalPosition | null
      readonly deliveries: TicketDeliveries
      readonly legacyOnlyTaskIds: ReadonlyArray<TaskId>
      readonly newOnlyTaskIds: ReadonlyArray<TaskId>
      readonly integrationIdentityDifferences: ReadonlyArray<string>
      readonly integrationWaitDifferences: ReadonlyArray<string>
      readonly responsibilityIdentityDifferences: ReadonlyArray<string>
      readonly responsibilitySituationDifferences: ReadonlyArray<string>
    }
  | { readonly _tag: "SkippedDeliveryProjectionEpochUnavailable"; readonly frame: JournalPosition }
  | { readonly _tag: "SkippedDeliveryProjectionResponsibilityFactsUnavailable" }
  | {
      readonly _tag: "SkippedMixedAcceptedEpoch"
      readonly after: JournalPosition
      readonly before: JournalPosition
      readonly frame: JournalPosition
      readonly responsibilities: JournalPosition
    }

export interface DeliveryShadowInput {
  readonly acceptedAfter: JournalPosition | void
  readonly acceptedBefore: JournalPosition | void
  readonly evidence: DeliveryProjectionEvidence
  readonly frame: CurrentDeliveryFrame
  readonly legacy: RunnableFrontier
}

const incoherentJournalEpoch = (
  input: DeliveryShadowInput & {
    readonly evidence: Extract<
      DeliveryShadowInput["evidence"],
      { readonly _tag: "AvailableDeliveryProjectionEvidence" }
    >
    readonly frame: Extract<CurrentDeliveryFrame, { readonly _tag: "JournaledCurrentDeliveryFrame" }>
  }
): Exclude<DeliveryShadowComparison, { readonly _tag: "ComparedDeliveryProjection" }> | undefined => {
  if (input.acceptedBefore === undefined || input.acceptedAfter === undefined || input.evidence.acceptedAt === null) {
    return { _tag: "SkippedDeliveryProjectionEpochUnavailable", frame: input.frame.acceptedAt }
  }
  if (
    input.acceptedBefore === input.acceptedAfter &&
    input.frame.acceptedAt === input.acceptedBefore &&
    input.evidence.acceptedAt === input.acceptedBefore
  ) {
    return undefined
  }
  return {
    _tag: "SkippedMixedAcceptedEpoch",
    after: input.acceptedAfter,
    before: input.acceptedBefore,
    frame: input.frame.acceptedAt,
    responsibilities: input.evidence.acceptedAt
  }
}

/** Produces non-authoritative comparison evidence and never changes the legacy turn. */
export const compareDeliveryShadow = (input: DeliveryShadowInput): DeliveryShadowComparison => {
  if (input.evidence._tag === "UnavailableDeliveryProjectionEvidence") {
    return { _tag: "SkippedDeliveryProjectionResponsibilityFactsUnavailable" }
  }
  if (input.frame._tag === "JournaledCurrentDeliveryFrame") {
    const skipped = incoherentJournalEpoch({ ...input, evidence: input.evidence, frame: input.frame })
    if (skipped !== undefined) return skipped
  }
  const graph = TrackerGraphState.cases.GraphEstablished.make({ snapshot: input.frame.currentGraph })
  const tickets = boundedParallelTicketsOf(frontierOf(graph), input.frame.runControlPolicy)
  const exactEvidence = ticketDeliveryEvidenceOf(input.frame, input.evidence.facts)
  const deliveries = ticketDeliveriesOf(tickets, [
    ...exactEvidence,
    ...input.evidence.integrationWaits.map((wait): TicketDeliveryEvidence => ({ _tag: "IntegrationWait", wait }))
  ])
  const responsibilityTaskIds = new Map(
    input.evidence.facts.map((facts) => [workflowResponsibilityKey(facts.responsibility), responsibilityTaskId(facts)])
  )
  const legacyTaskIds = new Set<TaskId>([
    ...input.legacy.transitions.map(runnableTransitionTaskId),
    ...input.legacy.explanations.flatMap((explanation) => {
      const taskId = explanationTaskId(explanation, responsibilityTaskIds)
      return taskId === undefined ? [] : [taskId]
    })
  ])
  const deliveryTaskIds = new Set(deliveries.deliveries.map(({ taskId }) => taskId))
  const exactResponsibilityKeys = new Set(
    input.evidence.facts.map(({ responsibility }) => workflowResponsibilityKey(responsibility))
  )
  const legacyKeys = new Set(legacyResponsibilityKeys(input.legacy).filter((key) => exactResponsibilityKeys.has(key)))
  const expectedSituations = new Set(
    responsibilitySituationKeys(expectedResponsibilityFrontier(input.evidence.facts), exactResponsibilityKeys)
  )
  const legacySituations = new Set(responsibilitySituationKeys(input.legacy, exactResponsibilityKeys))
  return {
    _tag: "ComparedDeliveryProjection",
    acceptedAt: input.frame._tag === "JournaledCurrentDeliveryFrame" ? input.frame.acceptedAt : null,
    deliveries,
    integrationIdentityDifferences: symmetricDifference(
      exactIntegrationIdentities(exactEvidence),
      legacyIntegrationIdentities(input.legacy)
    ),
    integrationWaitDifferences: symmetricDifference(
      new Set(input.evidence.integrationWaits.map(integrationWaitIdentity)),
      new Set(integrationDeliveryWaitsOf(input.legacy).map(integrationWaitIdentity))
    ),
    legacyOnlyTaskIds: [...legacyTaskIds].filter((taskId) => !deliveryTaskIds.has(taskId)).toSorted(),
    newOnlyTaskIds: [...deliveryTaskIds].filter((taskId) => !legacyTaskIds.has(taskId)).toSorted(),
    responsibilityIdentityDifferences: symmetricDifference(exactResponsibilityKeys, legacyKeys),
    responsibilitySituationDifferences: symmetricDifference(expectedSituations, legacySituations)
  }
}

export interface DeliveryShadowDiagnosticsService {
  /** Records immediately into a bounded process-local sink; it must not perform an Effect or boundary call. */
  readonly record: (comparison: DeliveryShadowComparison) => void
}

/** Optional process-local diagnostic sink; absence means the shadow remains silent. */
export class DeliveryShadowDiagnostics extends Context.Service<
  DeliveryShadowDiagnostics,
  DeliveryShadowDiagnosticsService
>()("@dalph/DeliveryShadowDiagnostics") {}

/** Evaluates and records the observational shadow without entering the production failure channel. */
export const observeDeliveryShadow = (input: DeliveryShadowInput) =>
  Effect.sync(() => compareDeliveryShadow(input)).pipe(
    Effect.flatMap((comparison) =>
      Effect.context<never>().pipe(
        Effect.flatMap((context) =>
          Option.match(Context.getOption(context, DeliveryShadowDiagnostics), {
            onNone: () => Effect.void,
            onSome: ({ record }) => Effect.sync(() => record(comparison))
          })
        )
      )
    ),
    Effect.ignoreCause
  )
