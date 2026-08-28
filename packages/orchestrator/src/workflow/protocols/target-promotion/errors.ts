import { GitCommitSha } from "@dalph/contracts"
import { Schema } from "effect"
import { TargetPromotionRequestId } from "./events.js"

/** A provider returned a successful mutation for a commit other than the requested M. */
export class TargetPromotionResultContradiction extends Schema.TaggedError<TargetPromotionResultContradiction>()(
  "TargetPromotionResultContradiction",
  { candidateCommit: GitCommitSha, detail: Schema.String }
) {}

/** Fails closed when one request id is reused for a different exact promotion correlation. */
export class TargetPromotionCorrelationContradiction extends Schema.TaggedError<TargetPromotionCorrelationContradiction>()(
  "TargetPromotionCorrelationContradiction",
  { detail: Schema.String, requestId: TargetPromotionRequestId }
) {}
