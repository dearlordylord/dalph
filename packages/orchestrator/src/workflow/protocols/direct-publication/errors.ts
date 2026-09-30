import { Schema } from "effect"
import { RunId } from "@dalph/contracts"
import {
  RemotePublicationBatchGrantRequestId,
  RemotePublicationRequestId,
  RemotePublicationResumeRequestId
} from "./events.js"

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

/** One batch-grant request identity was redelivered with unequal exact exhaustion facts. */
export class RemotePublicationBatchGrantRequestConflict extends Schema.TaggedError<RemotePublicationBatchGrantRequestConflict>()(
  "RemotePublicationBatchGrantRequestConflict",
  { requestId: RemotePublicationBatchGrantRequestId }
) {}

/** A batch grant does not name the exact retained publication exhaustion in this Run. */
export class RemotePublicationBatchGrantSubjectMismatch extends Schema.TaggedError<RemotePublicationBatchGrantSubjectMismatch>()(
  "RemotePublicationBatchGrantSubjectMismatch",
  { requestId: RemotePublicationBatchGrantRequestId, runId: RunId }
) {}
