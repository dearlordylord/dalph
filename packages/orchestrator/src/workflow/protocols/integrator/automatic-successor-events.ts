import { GitCommitSha } from "@dalph/contracts"
import { Schema } from "effect"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import { RemotePublicationCorrelation, type RemotePublicationRequestId } from "../direct-publication/events.js"

/** Stable identity of one authorization for one retained compatible-head occurrence. */
export const IntegratorCompetingHeadSuccessorAuthorizationId = Schema.NonEmptyString.pipe(
  Schema.brand("IntegratorCompetingHeadSuccessorAuthorizationId")
)
export type IntegratorCompetingHeadSuccessorAuthorizationId =
  typeof IntegratorCompetingHeadSuccessorAuthorizationId.Type

export const integratorCompetingHeadSuccessorAuthorizationIdFor = (
  requestId: RemotePublicationRequestId,
  retainedAt: JournalPosition,
  mergeBase: GitCommitSha,
  remoteHead: GitCommitSha
): IntegratorCompetingHeadSuccessorAuthorizationId =>
  IntegratorCompetingHeadSuccessorAuthorizationId.make(
    "automatic-competing-head:" + requestId + ":" + retainedAt + ":" + mergeBase + ":" + remoteHead
  )

/** Journal-first permission for one fresh-head successor after a compatible competing push. */
export const IntegratorCompetingHeadSuccessorAuthorizedEvent = Schema.TaggedStruct(
  "IntegratorCompetingHeadSuccessorAuthorized",
  {
    authorizationId: IntegratorCompetingHeadSuccessorAuthorizationId,
    correlation: RemotePublicationCorrelation,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    mergeBase: GitCommitSha,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    remoteHead: GitCommitSha,
    remotePublicationRetainedAt: JournalPosition,
    version: Schema.Literal(workflowJournalEventVersion)
  }
).check(
  Schema.makeFilter((event) =>
    event.authorizationId ===
    integratorCompetingHeadSuccessorAuthorizationIdFor(
      event.correlation.requestId,
      event.remotePublicationRetainedAt,
      event.mergeBase,
      event.remoteHead
    )
      ? undefined
      : "automatic successor authorization identity must bind the exact retained publication occurrence"
  )
)
export type IntegratorCompetingHeadSuccessorAuthorizedEvent =
  typeof IntegratorCompetingHeadSuccessorAuthorizedEvent.Type
