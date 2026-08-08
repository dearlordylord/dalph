import { Schema } from "effect"

/** Delivery selected promotion but the active Run has no coherent Git capability. */
export class TargetPromotionRuntimeUnavailable extends Schema.TaggedErrorClass<TargetPromotionRuntimeUnavailable>()(
  "TargetPromotionRuntimeUnavailable",
  {}
) {}
