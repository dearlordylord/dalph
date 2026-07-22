/** Canonical journal vocabulary owned by the technical-retry domain. */
export const technicalRetryEventTag = {
  deferralSuperseded: "TechnicalRetryDeferralSuperseded",
  policyCaptured: "TechnicalRetryPolicyCaptured",
  scheduled: "TechnicalRetryScheduled"
} as const

export const technicalRetryEventKinds = [
  technicalRetryEventTag.deferralSuperseded,
  technicalRetryEventTag.policyCaptured,
  technicalRetryEventTag.scheduled
] as const
