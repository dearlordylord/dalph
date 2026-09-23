import { Schema } from "effect"
import { RunId } from "@dalph/contracts"
import { RemotePublicationRequestId, RemotePublicationResumeRequestId } from "./events.js"

/** Durable direct-publication history cannot be reduced to one exact request. */
export class RemotePublicationHistoryContradiction extends Schema.TaggedError<RemotePublicationHistoryContradiction>()(
  "RemotePublicationHistoryContradiction",
  { detail: Schema.String, requestId: RemotePublicationRequestId }
) {}

/** A caller supplied a publication result that does not belong to its exact intended request. */
export class RemotePublicationResultContradiction extends Schema.TaggedError<RemotePublicationResultContradiction>()(
  "RemotePublicationResultContradiction",
  { detail: Schema.String, requestId: RemotePublicationRequestId }
) {}

/** One resume request identity was redelivered with unequal Run-responsibility facts. */
export class RemotePublicationResumeRequestConflict extends Schema.TaggedError<RemotePublicationResumeRequestConflict>()(
  "RemotePublicationResumeRequestConflict",
  { requestId: RemotePublicationResumeRequestId }
) {}

/** A transport-neutral resume request does not name this exact retained subject. */
export class RemotePublicationResumeSubjectMismatch extends Schema.TaggedError<RemotePublicationResumeSubjectMismatch>()(
  "RemotePublicationResumeSubjectMismatch",
  { requestId: RemotePublicationResumeRequestId, runId: RunId }
) {}
