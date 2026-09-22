import { GitCommitSha, IntegrationTarget, RemotePublicationTarget, RunId } from "@dalph/contracts"
import { Context, type Effect, Schema } from "effect"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import { IntegratorResponsibilityFacts } from "../integrator/events.js"

/** Stable identity for the initial remote-baseline read and optional local catch-up. */
export const RemoteBaselineId = Schema.NonEmptyString.pipe(Schema.brand("RemoteBaselineId"))
export type RemoteBaselineId = typeof RemoteBaselineId.Type

const remoteBaselineIdFor = (
  runId: RunId,
  responsibility: IntegratorResponsibilityFacts,
  localTarget: IntegrationTarget,
  remoteTarget: RemotePublicationTarget
): RemoteBaselineId =>
  RemoteBaselineId.make(
    `remote-baseline:${runId}:${responsibility.plannedAttempt.attemptId}:${localTarget.repository}:${localTarget.ref}:${remoteTarget.endpoint}:${remoteTarget.branch}`
  )

export const RemoteBaselineCorrelation = Schema.Struct({
  baselineId: RemoteBaselineId,
  localTarget: IntegrationTarget,
  remoteTarget: RemotePublicationTarget,
  responsibility: IntegratorResponsibilityFacts,
  runId: RunId
}).check(
  Schema.makeFilter((correlation) =>
    correlation.runId === correlation.responsibility.plannedAttempt.runId &&
    correlation.localTarget.repository === correlation.responsibility.integrationTarget.repository &&
    correlation.localTarget.ref === correlation.responsibility.integrationTarget.ref &&
    correlation.baselineId ===
      remoteBaselineIdFor(
        correlation.runId,
        correlation.responsibility,
        correlation.localTarget,
        correlation.remoteTarget
      )
      ? undefined
      : "remote baseline correlation must bind its responsibility, local target, Run, and deterministic identity"
  )
)
export type RemoteBaselineCorrelation = typeof RemoteBaselineCorrelation.Type

export const remoteBaselineCorrelationFor = (
  runId: RunId,
  responsibility: IntegratorResponsibilityFacts,
  localTarget: IntegrationTarget,
  remoteTarget: RemotePublicationTarget
): RemoteBaselineCorrelation =>
  RemoteBaselineCorrelation.make({
    baselineId: remoteBaselineIdFor(runId, responsibility, localTarget, remoteTarget),
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
