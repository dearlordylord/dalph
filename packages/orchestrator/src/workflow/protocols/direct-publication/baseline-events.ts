import { GitCommitSha, IntegrationTarget, RemotePublicationTarget, RunId } from "@dalph/contracts"
import { Context, type Effect, Schema } from "effect"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import { IntegratorResponsibilityFacts } from "../integrator/events.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"

/** Stable identity for one remote-baseline read and its optional local catch-up. */
export const RemoteBaselineId = Schema.NonEmptyString.pipe(Schema.brand("RemoteBaselineId"))
export type RemoteBaselineId = typeof RemoteBaselineId.Type

/** One exact baseline observation round within an automatic-successor authorization. */
export const RemoteBaselineRound = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("RemoteBaselineRound")
)
export type RemoteBaselineRound = typeof RemoteBaselineRound.Type
/** Explicit ordinal for the first read under one automatic-successor authorization. */
export const initialAutomaticCompetingHeadBaselineRound = RemoteBaselineRound.make(1)

const remoteBaselineIdParts = (
  runId: RunId,
  responsibility: IntegratorResponsibilityFacts,
  localTarget: IntegrationTarget,
  remoteTarget: RemotePublicationTarget
): ReadonlyArray<string> => [
  "remote-baseline",
  runId,
  responsibility.plannedAttempt.attemptId,
  localTarget.repository,
  localTarget.ref,
  remoteTarget.endpoint,
  remoteTarget.branch
]

const initialRemoteBaselineIdFor = (
  runId: RunId,
  responsibility: IntegratorResponsibilityFacts,
  localTarget: IntegrationTarget,
  remoteTarget: RemotePublicationTarget
): RemoteBaselineId =>
  RemoteBaselineId.make(
    [...remoteBaselineIdParts(runId, responsibility, localTarget, remoteTarget), "initial"].join(":")
  )

const automaticCompetingHeadRemoteBaselineIdFor = (
  runId: RunId,
  responsibility: IntegratorResponsibilityFacts,
  localTarget: IntegrationTarget,
  remoteTarget: RemotePublicationTarget,
  authorizationAt: JournalPosition,
  baselineRound: RemoteBaselineRound
): RemoteBaselineId =>
  RemoteBaselineId.make(
    [
      ...remoteBaselineIdParts(runId, responsibility, localTarget, remoteTarget),
      "automatic-competing-head",
      authorizationAt,
      "baseline-round",
      baselineRound
    ].join(":")
  )

const remoteBaselineCorrelationFields = {
  localTarget: IntegrationTarget,
  remoteTarget: RemotePublicationTarget,
  responsibility: IntegratorResponsibilityFacts,
  runId: RunId
}

type RemoteBaselineCorrelationFields = {
  readonly localTarget: Schema.Schema.Type<typeof IntegrationTarget>
  readonly remoteTarget: Schema.Schema.Type<typeof RemotePublicationTarget>
  readonly responsibility: Schema.Schema.Type<typeof IntegratorResponsibilityFacts>
  readonly runId: Schema.Schema.Type<typeof RunId>
}

export type InitialRemoteBaselineCorrelation = RemoteBaselineCorrelationFields & {
  readonly _tag: "Initial"
  readonly baselineId: RemoteBaselineId
}

export type AutomaticCompetingHeadRemoteBaselineCorrelation = RemoteBaselineCorrelationFields & {
  readonly _tag: "AutomaticCompetingHead"
  readonly authorizationAt: JournalPosition
  readonly baselineId: RemoteBaselineId
  readonly baselineRound: RemoteBaselineRound
}

export type RemoteBaselineCorrelation =
  | InitialRemoteBaselineCorrelation
  | AutomaticCompetingHeadRemoteBaselineCorrelation

const RemoteBaselineCorrelationVariants = Schema.TaggedUnion({
  Initial: {
    ...remoteBaselineCorrelationFields,
    baselineId: RemoteBaselineId
  },
  AutomaticCompetingHead: {
    ...remoteBaselineCorrelationFields,
    authorizationAt: JournalPosition,
    baselineId: RemoteBaselineId,
    baselineRound: RemoteBaselineRound
  }
})

/** Compact public codec type keeps the tagged correlation from expanding every trace schema. */
export const RemoteBaselineCorrelation: Schema.Codec<RemoteBaselineCorrelation, unknown, never, never> =
  RemoteBaselineCorrelationVariants.check(
    Schema.makeFilter((correlation) => {
      const expectedBaselineId =
        correlation._tag === "Initial"
          ? initialRemoteBaselineIdFor(
              correlation.runId,
              correlation.responsibility,
              correlation.localTarget,
              correlation.remoteTarget
            )
          : automaticCompetingHeadRemoteBaselineIdFor(
              correlation.runId,
              correlation.responsibility,
              correlation.localTarget,
              correlation.remoteTarget,
              correlation.authorizationAt,
              correlation.baselineRound
            )
      return correlation.runId === correlation.responsibility.plannedAttempt.runId &&
        correlation.localTarget.repository === correlation.responsibility.integrationTarget.repository &&
        correlation.localTarget.ref === correlation.responsibility.integrationTarget.ref &&
        correlation.baselineId === expectedBaselineId
        ? undefined
        : "remote baseline correlation must bind its responsibility, local target, Run, and deterministic identity"
    })
  )

export const remoteBaselineCorrelationFor = (
  runId: RunId,
  responsibility: IntegratorResponsibilityFacts,
  localTarget: IntegrationTarget,
  remoteTarget: RemotePublicationTarget
): InitialRemoteBaselineCorrelation =>
  RemoteBaselineCorrelationVariants.cases.Initial.make({
    baselineId: initialRemoteBaselineIdFor(runId, responsibility, localTarget, remoteTarget),
    localTarget,
    remoteTarget,
    responsibility,
    runId
  })

/** Correlates a fresh remote/local baseline with one durable automatic-successor authorization. */
export const automaticCompetingHeadRemoteBaselineCorrelationFor = (
  runId: RunId,
  responsibility: IntegratorResponsibilityFacts,
  localTarget: IntegrationTarget,
  remoteTarget: RemotePublicationTarget,
  authorizationAt: JournalPosition,
  baselineRound: RemoteBaselineRound
): AutomaticCompetingHeadRemoteBaselineCorrelation =>
  RemoteBaselineCorrelationVariants.cases.AutomaticCompetingHead.make({
    authorizationAt,
    baselineRound,
    baselineId: automaticCompetingHeadRemoteBaselineIdFor(
      runId,
      responsibility,
      localTarget,
      remoteTarget,
      authorizationAt,
      baselineRound
    ),
    localTarget,
    remoteTarget,
    responsibility,
    runId
  })

export const RemoteBaselineFailureReason = Schema.Literals([
  "AncestryUnavailable",
  "EndpointMappingChanged",
  "ResponseDeadline",
  "SenderStopUnproven",
  "TargetUnreadable"
])
export type RemoteBaselineFailureReason = typeof RemoteBaselineFailureReason.Type

/** Complete initial relation between the local integration target and the freshly read remote branch. */
export const RemoteBaselineObservation = Schema.TaggedUnion({
  Aligned: { localHead: GitCommitSha, remoteHead: GitCommitSha },
  Diverged: { localHead: GitCommitSha, remoteHead: GitCommitSha },
  LocalAhead: { localHead: GitCommitSha, remoteHead: GitCommitSha },
  LocalAncestor: { localHead: GitCommitSha, remoteHead: GitCommitSha },
  RemoteMissing: {},
  Unavailable: { reason: RemoteBaselineFailureReason }
}).check(
  Schema.makeFilter((observation) =>
    observation._tag === "Aligned" && observation.localHead !== observation.remoteHead
      ? "aligned remote baseline must name one exact local and remote head"
      : undefined
  )
)
export type RemoteBaselineObservation = typeof RemoteBaselineObservation.Type

export const LocalTargetCatchUpResult = Schema.TaggedUnion({
  AlreadyCurrent: { currentHead: GitCommitSha },
  Applied: { newHead: GitCommitSha },
  Rejected: { observedHead: GitCommitSha },
  Unavailable: { reason: RemoteBaselineFailureReason }
})
export type LocalTargetCatchUpResult = typeof LocalTargetCatchUpResult.Type

export class RemoteBaselineFailure extends Schema.TaggedError<RemoteBaselineFailure>()("RemoteBaselineFailure", {
  reason: RemoteBaselineFailureReason
}) {}

export interface RemoteBaselineGitService {
  readonly catchUp: (
    correlation: RemoteBaselineCorrelation,
    expectedLocalHead: GitCommitSha,
    remoteHead: GitCommitSha
  ) => Effect.Effect<LocalTargetCatchUpResult, RemoteBaselineFailure>
  readonly observe: (
    correlation: RemoteBaselineCorrelation
  ) => Effect.Effect<RemoteBaselineObservation, RemoteBaselineFailure>
  readonly reconcileCatchUp: (
    correlation: RemoteBaselineCorrelation,
    expectedLocalHead: GitCommitSha,
    remoteHead: GitCommitSha
  ) => Effect.Effect<LocalTargetCatchUpResult, RemoteBaselineFailure>
}

export class RemoteBaselineGit extends Context.Service<RemoteBaselineGit, RemoteBaselineGitService>()(
  "@dalph/RemoteBaselineGit"
) {}

export const RemoteBaselineReadIntendedEvent = Schema.TaggedStruct("RemoteBaselineReadIntended", {
  correlation: RemoteBaselineCorrelation,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  version: Schema.Literal(workflowJournalEventVersion)
})
export type RemoteBaselineReadIntendedEvent = typeof RemoteBaselineReadIntendedEvent.Type

export const RemoteBaselineObservedEvent = Schema.TaggedStruct("RemoteBaselineObserved", {
  correlation: RemoteBaselineCorrelation,
  observation: RemoteBaselineObservation,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  version: Schema.Literal(workflowJournalEventVersion)
})
export type RemoteBaselineObservedEvent = typeof RemoteBaselineObservedEvent.Type

export const LocalTargetCatchUpIntendedEvent = Schema.TaggedStruct("LocalTargetCatchUpIntended", {
  correlation: RemoteBaselineCorrelation,
  expectedLocalHead: GitCommitSha,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  remoteHead: GitCommitSha,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type LocalTargetCatchUpIntendedEvent = typeof LocalTargetCatchUpIntendedEvent.Type

export const LocalTargetCatchUpObservedEvent = Schema.TaggedStruct("LocalTargetCatchUpObserved", {
  correlation: RemoteBaselineCorrelation,
  expectedLocalHead: GitCommitSha,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  remoteHead: GitCommitSha,
  result: LocalTargetCatchUpResult,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type LocalTargetCatchUpObservedEvent = typeof LocalTargetCatchUpObservedEvent.Type

export const RemoteBaselineJournalEvent = Schema.Union([
  RemoteBaselineReadIntendedEvent,
  RemoteBaselineObservedEvent,
  LocalTargetCatchUpIntendedEvent,
  LocalTargetCatchUpObservedEvent
])
export type RemoteBaselineJournalEvent = typeof RemoteBaselineJournalEvent.Type
