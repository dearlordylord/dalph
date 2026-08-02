import { Effect, Option, Stream } from "effect"
import {
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedTaskAttempt,
  type RunId,
  type TaskId
} from "@dalph/contracts"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import { deriveIntegrationAdmission } from "../../workflow/protocols/integration-admission/protocol.js"
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
  deliveryProposalFrontierOf,
  currentSignalOf,
  type DeliveryProposalFrontier,
  type DeliveryRuntimeSnapshot,
  type TicketDeliveryEvidence,
  type TicketDeliveries,
  type TrackerGraphActionProposal
} from "./relations.js"
import { boundedParallelTicketsOf, frontierOf, ticketDeliveriesOf } from "./ticket-delivery-projection.js"
import { integrationDeliveryWaitsOf, type IntegrationDeliveryWait } from "../frontier/integration-frontier.js"
import type { DeliveryProjectionEvidence } from "../frontier/delivery-projection-evidence.js"
import type { FreshWorkflowDecision } from "../run/fresh-workflow.js"
import { deliveryProposalsOf } from "./delivery-proposal.js"
import { makeSelectedTransitionIdentity, selectedTransitionKey } from "../activation/selected-transition.js"
import type { OperationId } from "../../workflow/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { acceptedOperationIdOf } from "../../workflow/registry/event-descriptor.js"
import { delivery } from "./delivery.js"
import { makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import { recordDeliveryShadowComparison } from "./delivery-shadow-diagnostics.js"
import { ticketDeliveryEvidenceOf } from "./delivery-shadow-evidence.js"

export { DeliveryShadowDiagnostics } from "./delivery-shadow-diagnostics.js"
export { ticketDeliveryEvidenceOf } from "./delivery-shadow-evidence.js"

const responsibilityTaskId = (facts: ResponsibilityFreshFacts): TaskId =>
  facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
    ? facts.responsibility.plannedAttempt.taskId
    : facts.responsibility.taskId

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

export const symmetricDifference = (left: ReadonlySet<string>, right: ReadonlySet<string>): ReadonlyArray<string> =>
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
      readonly proposalFrontier: DeliveryProposalFrontier
      readonly proposalPresenceDifferences: ReadonlyArray<string>
    }
  | {
      readonly _tag: "ComparedBoundaryDeliveryProposals"
      readonly acceptedAt: JournalPosition | null
      readonly proposalFrontier: DeliveryProposalFrontier
      readonly proposalPresenceDifferences: ReadonlyArray<string>
    }
  | {
      readonly _tag: "ComparedQuiescenceDeliveryProposal"
      readonly acceptedAt: JournalPosition
      readonly proposalFrontier: DeliveryProposalFrontier
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
  readonly fresh: ReadonlyArray<FreshWorkflowDecision>
  readonly legacy: RunnableFrontier
  readonly runId: RunId
}

interface EvaluatedDeliveryShadowRelation {
  readonly proposalFrontier: DeliveryProposalFrontier
  readonly snapshot: DeliveryRuntimeSnapshot
}

export const acceptedOperationIdsOf = (records: ReadonlyArray<JournalRecord>): ReadonlySet<OperationId> =>
  new Set(records.flatMap(({ event }) => Option.toArray(Option.fromUndefinedOr(acceptedOperationIdOf(event)))))

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

type AvailableProjectionEvidence = Extract<
  DeliveryShadowInput["evidence"],
  { readonly _tag: "AvailableDeliveryProjectionEvidence" }
>

const journalShadowFactsOf = (frame: CurrentDeliveryFrame) => {
  if (frame._tag === "SyntheticCurrentDeliveryFrame") {
    return { acceptedAt: null, integrationResponsibilities: [], records: [] } as const
  }
  return {
    acceptedAt: frame.acceptedAt,
    integrationResponsibilities: deriveIntegrationAdmission(frame.workflowHistory.records).responsibilities,
    records: frame.workflowHistory.records
  }
}

const deliveriesCompared = (
  evaluated: EvaluatedDeliveryShadowRelation | undefined,
  projected: TicketDeliveries
): TicketDeliveries => (evaluated === undefined ? projected : evaluated.snapshot.ticketDeliveries)

const proposalFrontierCompared = (
  evaluated: EvaluatedDeliveryShadowRelation | undefined,
  contributions: ReturnType<typeof deliveryProposalsOf>
): DeliveryProposalFrontier =>
  evaluated === undefined
    ? deliveryProposalFrontierOf([contributions.ticketDelivery, contributions.deliverySettlement], contributions.issues)
    : evaluated.proposalFrontier

const selectedProposalKeys = (
  proposalFrontier: DeliveryProposalFrontier,
  contributions: ReturnType<typeof deliveryProposalsOf>
): ReadonlySet<string> =>
  new Set(proposalFrontier._tag === "DeliveryProposalsAvailable" ? contributions.selectedTransitionKeys : [])

const comparedDeliveryProjection = (
  input: DeliveryShadowInput,
  evidence: AvailableProjectionEvidence,
  evaluated?: EvaluatedDeliveryShadowRelation
): Extract<DeliveryShadowComparison, { readonly _tag: "ComparedDeliveryProjection" }> => {
  const graph = TrackerGraphState.cases.GraphEstablished.make({ snapshot: input.frame.currentGraph })
  const tickets = boundedParallelTicketsOf(frontierOf(graph), input.frame.runControlPolicy)
  const exactEvidence = ticketDeliveryEvidenceOf(input.frame, evidence.facts)
  const projectedDeliveries = ticketDeliveriesOf(tickets, [
    ...exactEvidence,
    ...evidence.integrationWaits.map((wait): TicketDeliveryEvidence => ({ _tag: "IntegrationWait", wait }))
  ])
  const responsibilityTaskIds = new Map(
    evidence.facts.map((facts) => [workflowResponsibilityKey(facts.responsibility), responsibilityTaskId(facts)])
  )
  const legacyTaskIds = new Set<TaskId>([
    ...input.legacy.transitions.map(runnableTransitionTaskId),
    ...input.legacy.explanations.flatMap((explanation) =>
      Option.toArray(Option.fromUndefinedOr(explanationTaskId(explanation, responsibilityTaskIds)))
    )
  ])
  const deliveries = deliveriesCompared(evaluated, projectedDeliveries)
  const deliveryTaskIds = new Set(deliveries.deliveries.map(({ taskId }) => taskId))
  const exactResponsibilityKeys = new Set(
    evidence.facts.map(({ responsibility }) => workflowResponsibilityKey(responsibility))
  )
  const legacyKeys = new Set(legacyResponsibilityKeys(input.legacy).filter((key) => exactResponsibilityKeys.has(key)))
  const expectedSituations = new Set(
    responsibilitySituationKeys(expectedResponsibilityFrontier(evidence.facts), exactResponsibilityKeys)
  )
  const legacySituations = new Set(responsibilitySituationKeys(input.legacy, exactResponsibilityKeys))
  const journal = journalShadowFactsOf(input.frame)
  const proposalContributions = deliveryProposalsOf({
    acceptedAt: journal.acceptedAt,
    acceptedOperationIds: acceptedOperationIdsOf(journal.records),
    fresh: input.fresh,
    integrationResponsibilities: journal.integrationResponsibilities,
    runId: input.runId,
    responsibilities: input.frame.responsibility.entries,
    transitions: input.legacy.transitions
  })
  const proposalFrontier = proposalFrontierCompared(evaluated, proposalContributions)
  const legacySelectionKeys = new Set(
    input.legacy.transitions.map((transition) =>
      selectedTransitionKey(makeSelectedTransitionIdentity(input.runId, transition))
    )
  )
  const proposedSelectionKeys = selectedProposalKeys(proposalFrontier, proposalContributions)
  return {
    _tag: "ComparedDeliveryProjection",
    acceptedAt: journal.acceptedAt,
    deliveries,
    integrationIdentityDifferences: symmetricDifference(
      exactIntegrationIdentities(exactEvidence),
      legacyIntegrationIdentities(input.legacy)
    ),
    integrationWaitDifferences: symmetricDifference(
      new Set(evidence.integrationWaits.map(integrationWaitIdentity)),
      new Set(integrationDeliveryWaitsOf(input.legacy).map(integrationWaitIdentity))
    ),
    legacyOnlyTaskIds: [...legacyTaskIds].filter((taskId) => !deliveryTaskIds.has(taskId)).toSorted(),
    newOnlyTaskIds: [...deliveryTaskIds].filter((taskId) => !legacyTaskIds.has(taskId)).toSorted(),
    proposalFrontier,
    proposalPresenceDifferences: symmetricDifference(legacySelectionKeys, proposedSelectionKeys),
    responsibilityIdentityDifferences: symmetricDifference(exactResponsibilityKeys, legacyKeys),
    responsibilitySituationDifferences: symmetricDifference(expectedSituations, legacySituations)
  }
}

/** Produces non-authoritative comparison evidence and never changes the legacy turn. */
export const compareDeliveryShadow = (
  input: DeliveryShadowInput,
  evaluated?: EvaluatedDeliveryShadowRelation
): DeliveryShadowComparison => {
  if (input.evidence._tag === "UnavailableDeliveryProjectionEvidence") {
    return { _tag: "SkippedDeliveryProjectionResponsibilityFactsUnavailable" }
  }
  if (input.frame._tag === "JournaledCurrentDeliveryFrame") {
    const skipped = incoherentJournalEpoch({ ...input, evidence: input.evidence, frame: input.frame })
    if (skipped !== undefined) return skipped
  }
  return comparedDeliveryProjection(input, input.evidence, evaluated)
}

export const evaluateDeliveryRelation = (input: {
  readonly exactEvidence: ReadonlyArray<TicketDeliveryEvidence>
  readonly graph: TrackerGraphState
  readonly policy: CurrentDeliveryFrame["runControlPolicy"]
  readonly proposalContributions: ReturnType<typeof deliveryProposalsOf>
  readonly trackerGraphProposals?: ReadonlyArray<TrackerGraphActionProposal>
}) =>
  Effect.gen(function* () {
    const layerInput = {
      exactEvidence: currentSignalOf(input.exactEvidence),
      graph: currentSignalOf(input.graph),
      policy: currentSignalOf(input.policy),
      proposalContributions: currentSignalOf(input.proposalContributions),
      ...(input.trackerGraphProposals === undefined
        ? {}
        : { trackerGraphProposals: currentSignalOf(input.trackerGraphProposals) })
    }
    const relation = yield* delivery.pipe(Effect.provide(makeDeliveryRelationsLayer(layerInput)))
    const snapshot = yield* relation.current.changes.pipe(Stream.runHead, Effect.map(Option.getOrThrow))
    const proposalFrontier = yield* relation.proposedActions.changes.pipe(Stream.runHead, Effect.map(Option.getOrThrow))
    return { proposalFrontier, snapshot } satisfies EvaluatedDeliveryShadowRelation
  })

/** Evaluates the literal flat delivery Effect as a side-effect-free production shadow. */
const evaluateDeliveryShadowRelation = (input: DeliveryShadowInput) => {
  const records = input.frame._tag === "JournaledCurrentDeliveryFrame" ? input.frame.workflowHistory.records : []
  const proposalContributions = deliveryProposalsOf({
    acceptedAt: input.frame._tag === "JournaledCurrentDeliveryFrame" ? input.frame.acceptedAt : null,
    acceptedOperationIds: acceptedOperationIdsOf(records),
    fresh: input.fresh,
    integrationResponsibilities:
      input.frame._tag === "JournaledCurrentDeliveryFrame" ? deriveIntegrationAdmission(records).responsibilities : [],
    responsibilities: input.frame.responsibility.entries,
    runId: input.runId,
    transitions: input.legacy.transitions
  })
  const exactEvidence =
    input.evidence._tag === "AvailableDeliveryProjectionEvidence"
      ? [
          ...ticketDeliveryEvidenceOf(input.frame, input.evidence.facts),
          ...input.evidence.integrationWaits.map((wait): TicketDeliveryEvidence => ({ _tag: "IntegrationWait", wait }))
        ]
      : []
  return evaluateDeliveryRelation({
    exactEvidence,
    graph: TrackerGraphState.cases.GraphEstablished.make({ snapshot: input.frame.currentGraph }),
    policy: input.frame.runControlPolicy,
    proposalContributions
  })
}

/** Evaluates and records the observational shadow without entering the production failure channel. */
export const observeDeliveryShadow = (input: DeliveryShadowInput) =>
  evaluateDeliveryShadowRelation(input).pipe(
    Effect.map((evaluated) => compareDeliveryShadow(input, evaluated)),
    Effect.flatMap(recordDeliveryShadowComparison),
    Effect.ignoreCause
  )
