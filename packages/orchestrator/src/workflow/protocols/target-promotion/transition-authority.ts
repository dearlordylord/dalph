import type {
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionCompareAndSetResult,
  TargetPromotionCorrelation
} from "./events.js"
import type { TargetPromotionState } from "./state.js"

const readAuthorizationBrand: unique symbol = Symbol.for("@dalph/TargetPromotionReadAuthorization")
const attemptAuthorizationBrand: unique symbol = Symbol.for("@dalph/TargetPromotionAttemptAuthorization")
const intendedAttemptBrand: unique symbol = Symbol.for("@dalph/TargetPromotionIntendedAttempt")

/** Process-local permission to perform exactly one promotion read; it is never durable authority. */
export type TargetPromotionReadAuthorization = {
  readonly _tag: "TargetPromotionReadAuthorized"
  readonly [readAuthorizationBrand]: true
  readonly authority: "ReadOnly" | "RetryAuthorized"
  readonly correlation: TargetPromotionCorrelation
  readonly durableBasis: "DeferredTargetReadFailed" | "PendingAttempt" | "PendingInitial"
  readonly previousAttemptOrdinal: TargetPromotionAttemptOrdinal | undefined
}

/** Process-local proof that one exact-head read authorizes the next numbered attempt intent. */
export type TargetPromotionAttemptAuthorization = {
  readonly _tag: "TargetPromotionAttemptAuthorized"
  readonly [attemptAuthorizationBrand]: true
  readonly attemptOrdinal: TargetPromotionAttemptOrdinal
  readonly correlation: TargetPromotionCorrelation
  readonly durableBasis: "DeferredRetryAuthority" | "DeferredTargetReadFailed" | "PendingAttempt" | "PendingInitial"
  readonly reason: TargetPromotionAttemptReason
}

/** Process-local proof that the exact numbered attempt intent was appended before Git is called. */
export type TargetPromotionIntendedAttempt = {
  readonly _tag: "TargetPromotionAttemptIntended"
  readonly [intendedAttemptBrand]: true
  readonly attemptOrdinal: TargetPromotionAttemptOrdinal
  readonly correlation: TargetPromotionCorrelation
  readonly reason: TargetPromotionAttemptReason
}

/** The one Git compare-and-set returned a result that a later transition must settle durably. */
export type TargetPromotionObservedAttempt = {
  readonly _tag: "TargetPromotionAttemptObserved"
  readonly attemptOrdinal: TargetPromotionAttemptOrdinal
  readonly correlation: TargetPromotionCorrelation
  readonly result: TargetPromotionCompareAndSetResult
}

/** The one Git compare-and-set has no trustworthy response and must be reconciled by a read. */
export type TargetPromotionAmbiguousAttempt = {
  readonly _tag: "TargetPromotionAttemptAmbiguous"
  readonly attemptOrdinal: TargetPromotionAttemptOrdinal
  readonly correlation: TargetPromotionCorrelation
}

export type TargetPromotionAttemptBoundaryResult = TargetPromotionObservedAttempt | TargetPromotionAmbiguousAttempt

export type TargetPromotionProgress =
  | TargetPromotionState
  | TargetPromotionReadAuthorization
  | TargetPromotionAttemptAuthorization

export const makeTargetPromotionReadAuthorization = (
  correlation: TargetPromotionCorrelation,
  previousAttemptOrdinal: TargetPromotionAttemptOrdinal | undefined,
  authority: "ReadOnly" | "RetryAuthorized",
  durableBasis: TargetPromotionReadAuthorization["durableBasis"]
): TargetPromotionReadAuthorization => ({
  _tag: "TargetPromotionReadAuthorized",
  [readAuthorizationBrand]: true,
  authority,
  correlation,
  durableBasis,
  previousAttemptOrdinal
})

export const makeTargetPromotionAttemptAuthorization = (
  correlation: TargetPromotionCorrelation,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  reason: TargetPromotionAttemptReason,
  durableBasis: TargetPromotionAttemptAuthorization["durableBasis"]
): TargetPromotionAttemptAuthorization => ({
  _tag: "TargetPromotionAttemptAuthorized",
  [attemptAuthorizationBrand]: true,
  attemptOrdinal,
  correlation,
  durableBasis,
  reason
})

export const makeTargetPromotionIntendedAttempt = (
  authorization: TargetPromotionAttemptAuthorization
): TargetPromotionIntendedAttempt => ({
  _tag: "TargetPromotionAttemptIntended",
  [intendedAttemptBrand]: true,
  attemptOrdinal: authorization.attemptOrdinal,
  correlation: authorization.correlation,
  reason: authorization.reason
})
