import { Schema } from "effect"

export const AuthoredAttemptChoiceRejection = Schema.TaggedStruct("Rejected", {
  reason: Schema.Literals(["AlreadyApplied", "IdentityContradiction", "NotAvailable", "OutsidePreIntegrationPhase"])
})

export const AuthoredContinueAttemptResult = Schema.Union([
  Schema.TaggedStruct("Applied", {}),
  AuthoredAttemptChoiceRejection
])

export const AuthoredStopAttemptResult = Schema.Union([
  Schema.TaggedStruct("Applied", {
    status: Schema.Literals([
      "AwaitingQuiescence",
      "ImplementationAbandonedClaimDispositionPending",
      "ImplementationAbandonedClaimReleasePending",
      "SettledNoRelease",
      "SettledReleased"
    ])
  }),
  AuthoredAttemptChoiceRejection
])
