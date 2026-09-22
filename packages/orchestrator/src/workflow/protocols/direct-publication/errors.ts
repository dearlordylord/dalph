import { Schema } from "effect"
import { RemotePublicationRequestId } from "./events.js"

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
