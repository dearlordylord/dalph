import { Data, Duration, Effect, Schema } from "effect"
import { GitCommitSha } from "@dalph/contracts"
import { ProviderResultRejectionReason } from "./provider-semantic-result.js"

/** Private response-cycle identity allocated by Dalph, never transcribed by a model. */
export const ProviderResultCycleId = Schema.NonEmptyString.pipe(Schema.brand("ProviderResultCycleId"))
export type ProviderResultCycleId = typeof ProviderResultCycleId.Type

/** Exact owned provider request token retained before crossing the request boundary. */
export const ProviderResultRequestToken = Schema.NonEmptyString.pipe(Schema.brand("ProviderResultRequestToken"))
export type ProviderResultRequestToken = typeof ProviderResultRequestToken.Type

/** Absolute epoch time observed at a response request/observation boundary. */
export const ProviderResultInstantMilliseconds = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("ProviderResultInstantMilliseconds")
)
export type ProviderResultInstantMilliseconds = typeof ProviderResultInstantMilliseconds.Type

/** Persisted original expiry of one additional response, independent of process activation. */
export const ProviderResultDeadlineMilliseconds = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("ProviderResultDeadlineMilliseconds")
)
export type ProviderResultDeadlineMilliseconds = typeof ProviderResultDeadlineMilliseconds.Type

/** One initial response followed by no more than two additional responses. */
const firstCorrectionOrdinal = 2
const secondCorrectionOrdinal = 3
const lastResponseOffset = -1
export const ProviderResultResponseOrdinal = Schema.Literals([1, firstCorrectionOrdinal, secondCorrectionOrdinal]).pipe(
  Schema.brand("ProviderResultResponseOrdinal")
)
export type ProviderResultResponseOrdinal = typeof ProviderResultResponseOrdinal.Type

// eslint-disable-next-line no-magic-numbers -- The accepted additional-response allowance is thirty seconds.
export const providerResultCorrectionMilliseconds = 30_000

const initialRequest = Schema.TaggedStruct("Initial", {
  ordinal: Schema.Literal(1).pipe(Schema.brand("ProviderResultResponseOrdinal")),
  token: ProviderResultRequestToken,
  intendedAt: ProviderResultInstantMilliseconds
})
const additionalRequest = Schema.TaggedStruct("Correction", {
  ordinal: Schema.Literals([firstCorrectionOrdinal, secondCorrectionOrdinal]).pipe(
    Schema.brand("ProviderResultResponseOrdinal")
  ),
  token: ProviderResultRequestToken,
  intendedAt: ProviderResultInstantMilliseconds,
  deadline: ProviderResultDeadlineMilliseconds
}).check(
  Schema.makeFilter((request) =>
    request.deadline - request.intendedAt === providerResultCorrectionMilliseconds
      ? undefined
      : "correction must retain its original thirty-second allowance"
  )
)

/** Initial verification has no correction deadline; only additional requests have one. */
export const ProviderResultResponseIntent = Schema.Union([initialRequest, additionalRequest])
export type ProviderResultResponseIntent = typeof ProviderResultResponseIntent.Type

/** Deadline expiry describes an unfinished request; it grants neither absence proof nor permission to resend. */
export class ProviderResultDeadlineElapsed extends Schema.TaggedError<ProviderResultDeadlineElapsed>()(
  "ProviderResultDeadlineElapsed",
  { token: ProviderResultRequestToken, deadline: ProviderResultDeadlineMilliseconds }
) {}

/** Bound a request/read/validation effect by the original durable additional-response deadline. */
export const withinProviderResultDeadline = <A, E, R>(
  request: ProviderResultResponseIntent,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | ProviderResultDeadlineElapsed, R> =>
  Effect.gen(function* () {
    if (request._tag === "Initial") return yield* effect
    const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
    const expired = () =>
      Effect.fail(new ProviderResultDeadlineElapsed({ token: request.token, deadline: request.deadline }))
    if (now >= request.deadline) return yield* expired()
    return yield* effect.pipe(
      Effect.timeoutOrElse({ duration: Duration.millis(request.deadline - now), orElse: expired })
    )
  })

/** Compare persisted intent facts before effects; replay cannot change token, ordinal or deadline. */
export const sameProviderResultResponseIntent = (
  left: ProviderResultResponseIntent,
  right: ProviderResultResponseIntent
): boolean =>
  left._tag === right._tag &&
  left.ordinal === right.ordinal &&
  left.token === right.token &&
  left.intendedAt === right.intendedAt &&
  (left._tag !== "Correction" || (right._tag === "Correction" && left.deadline === right.deadline))

/** Expiry refuses another effect; it supplies no process-absence or safe-capacity proof. */
export const providerResultResponseExpired = (
  request: ProviderResultResponseIntent,
  now: ProviderResultInstantMilliseconds
): boolean => request._tag === "Correction" && now >= request.deadline

/** Exact provider-observed turn identity, distinct from the request token and previous turn. */
export const ProviderResultTurnId = Schema.NonEmptyString.pipe(Schema.brand("ProviderResultTurnId"))
export type ProviderResultTurnId = typeof ProviderResultTurnId.Type

/** These are observed execution facts, not terminal workflow outcomes or stopped-writer proof. */
export const ProviderResultResponseRecord = Schema.TaggedUnion({
  RequestIntended: { intent: ProviderResultResponseIntent },
  TurnObserved: { intent: ProviderResultResponseIntent, turnId: ProviderResultTurnId },
  ResponseRejected: {
    intent: ProviderResultResponseIntent,
    turnId: ProviderResultTurnId,
    /** Completion observation time, retained independently of later validation/recovery work. */
    responseObservedAt: ProviderResultInstantMilliseconds,
    reason: ProviderResultRejectionReason
  }
})
export type ProviderResultResponseRecord = typeof ProviderResultResponseRecord.Type

/** A resumed provider turn belongs to the same logical response and never grants another correction allowance. */
export const ProviderResultTransportContinuation = Schema.Struct({
  responseOrdinal: ProviderResultResponseOrdinal,
  token: ProviderResultRequestToken,
  intendedAt: ProviderResultInstantMilliseconds,
  turnId: Schema.optionalKey(ProviderResultTurnId)
})
export type ProviderResultTransportContinuation = typeof ProviderResultTransportContinuation.Type

const maximumResponsesPerCycle = secondCorrectionOrdinal

/** The budget is derived from immutable response intents, never persisted as a second counter. */
export const ProviderResultCycle = Schema.Struct({
  cycleId: ProviderResultCycleId,
  /** Immutable Git planning fact; legacy cycles without it cannot qualify lineage. */
  plannedBaseSha: Schema.optionalKey(GitCommitSha),
  responses: Schema.Array(ProviderResultResponseRecord),
  transportContinuations: Schema.optionalKey(Schema.Array(ProviderResultTransportContinuation))
}).check(
  Schema.makeFilter((cycle) => {
    if (cycle.responses.length === 0 || cycle.responses.length > maximumResponsesPerCycle)
      return "a response cycle contains one initial response and at most two corrections"
    const tokens = new Set<string>()
    const turns = new Set<string>()
    for (const [index, response] of cycle.responses.entries()) {
      if (response.intent.ordinal !== index + 1) return "response intents must have contiguous original ordinals"
      if (tokens.has(response.intent.token)) return "distinct responses cannot reuse an owned request token"
      tokens.add(response.intent.token)
      if (response._tag !== "RequestIntended") {
        if (turns.has(response.turnId)) return "a predecessor turn cannot stand in for the correction turn"
        turns.add(response.turnId)
      }
      if (response._tag === "ResponseRejected") {
        if (response.responseObservedAt < response.intent.intendedAt) return "response preceded its request intent"
        if (response.intent._tag === "Correction" && response.responseObservedAt >= response.intent.deadline)
          return "expired correction cannot become an on-time rejected response"
      }
      const previous = cycle.responses[index - 1]
      if (previous !== undefined) {
        if (previous._tag !== "ResponseRejected") return "another response requires a proven predecessor rejection"
        if (response.intent.intendedAt < previous.responseObservedAt) return "correction preceded the rejected response"
      }
    }
    let previousContinuation: ProviderResultTransportContinuation | undefined
    for (const [index, continuation] of (cycle.transportContinuations ?? []).entries()) {
      const response = cycle.responses.find((entry) => entry.intent.ordinal === continuation.responseOrdinal)
      if (
        response === undefined ||
        continuation.intendedAt < response.intent.intendedAt ||
        providerResultResponseExpired(response.intent, continuation.intendedAt)
      )
        return "continuation must retain an unexpired logical response"
      if (tokens.has(continuation.token)) return "continuation request tokens must be distinct"
      tokens.add(continuation.token)
      if (
        previousContinuation !== undefined &&
        (continuation.responseOrdinal < previousContinuation.responseOrdinal ||
          continuation.intendedAt < previousContinuation.intendedAt)
      )
        return "continuation chronology cannot reverse"
      if (
        continuation.turnId === undefined &&
        (index !== (cycle.transportContinuations?.length ?? 0) - 1 ||
          continuation.responseOrdinal !== cycle.responses.at(lastResponseOffset)?.intent.ordinal)
      )
        return "an unresolved transport must remain the latest logical response ownership"
      previousContinuation = continuation
      if (continuation.turnId !== undefined) {
        if (turns.has(continuation.turnId)) return "continuation turns must be distinct"
        turns.add(continuation.turnId)
      }
    }
    return undefined
  })
)
export type ProviderResultCycle = typeof ProviderResultCycle.Type

const sameResponseRecord = (left: ProviderResultResponseRecord, right: ProviderResultResponseRecord): boolean =>
  sameProviderResultResponseIntent(left.intent, right.intent) &&
  left._tag === right._tag &&
  (left._tag === "RequestIntended" || (right._tag !== "RequestIntended" && left.turnId === right.turnId)) &&
  (left._tag !== "ResponseRejected" ||
    (right._tag === "ResponseRejected" &&
      left.reason === right.reason &&
      left.responseObservedAt === right.responseObservedAt))

/** Check same-cycle writes before persistence; new-cycle authorization belongs to the Run owner. */
export const providerResultCycleTransitionProblem = (
  previous: ProviderResultCycle | undefined,
  next: ProviderResultCycle
): string | undefined => {
  if (previous === undefined)
    return next.responses.length === 1 &&
      next.responses[0]?._tag === "RequestIntended" &&
      (next.transportContinuations?.length ?? 0) === 0
      ? undefined
      : "a new cycle must begin with one durable initial intent"
  if (previous.cycleId !== next.cycleId) return "a different cycle requires distinct explicit recovery authorization"
  if (previous.plannedBaseSha !== next.plannedBaseSha) return "the original Git planning Base cannot change"
  if (next.responses.length < previous.responses.length) return "response budget cannot be replenished"
  if (next.responses.length > previous.responses.length + 1) return "only one response intent may be added"
  const beforeTransports = previous.transportContinuations ?? []
  const afterTransports = next.transportContinuations ?? []
  if (afterTransports.length < beforeTransports.length || afterTransports.length > beforeTransports.length + 1)
    return "transport continuation history cannot reset or skip an intent"
  for (const [index, before] of beforeTransports.entries()) {
    const after = afterTransports[index]
    if (
      before.turnId === undefined &&
      after?.turnId !== undefined &&
      (index !== beforeTransports.length - 1 ||
        afterTransports.length !== beforeTransports.length ||
        previous.responses.length !== next.responses.length ||
        previous.responses.some((response, ordinal) => {
          const successor = next.responses[ordinal]
          return successor === undefined || !sameResponseRecord(response, successor)
        }))
    )
      return "transport observation must settle only its latest intent before response facts change"
    if (
      after === undefined ||
      before.token !== after.token ||
      before.responseOrdinal !== after.responseOrdinal ||
      before.intendedAt !== after.intendedAt ||
      (before.turnId !== undefined && before.turnId !== after.turnId)
    )
      return "retained transport ownership cannot change"
  }
  if (
    afterTransports.length > beforeTransports.length &&
    (next.responses.length !== previous.responses.length ||
      afterTransports.at(lastResponseOffset)?.turnId !== undefined)
  )
    return "Resume records an unobserved transport without another response"
  if (afterTransports.length > beforeTransports.length) {
    const last = previous.responses.at(lastResponseOffset)
    if (
      last?._tag !== "TurnObserved" ||
      !sameResponseRecord(last, next.responses.at(lastResponseOffset) ?? last) ||
      afterTransports.at(lastResponseOffset)?.responseOrdinal !== last.intent.ordinal
    )
      return "Resume must retain the same observed logical response"
  }
  const lastIndex = previous.responses.length - 1
  for (const [index, response] of previous.responses.entries()) {
    const successor = next.responses[index]
    if (successor === undefined) return "retained response disappeared"
    if (sameResponseRecord(response, successor)) continue
    if (index !== lastIndex || next.responses.length !== previous.responses.length)
      return "historical response facts cannot change"
    if (!sameProviderResultResponseIntent(response.intent, successor.intent)) return "original response intent changed"
    if (response._tag === "RequestIntended" && successor._tag === "TurnObserved") continue
    if (
      response._tag === "TurnObserved" &&
      successor._tag === "ResponseRejected" &&
      response.turnId === successor.turnId
    )
      continue
    return "response observation cannot reverse or skip its intent"
  }
  if (
    next.responses.length > previous.responses.length &&
    next.responses.at(lastResponseOffset)?._tag !== "RequestIntended"
  )
    return "a new response must first record request intent"
  return undefined
}

/** A prepared intent grants no provider effect until its exact successor cycle is durably written. */
export type ProviderResultCorrectionDecision = Data.TaggedEnum<{
  ReconcileOwnedRequest: { readonly request: ProviderResultResponseIntent }
  CorrectionIntentPrepared: { readonly cycle: ProviderResultCycle; readonly request: ProviderResultResponseIntent }
  OperatorRequired: { readonly reason: "Deadline" | "CorrectionExhausted" }
}>
export const ProviderResultCorrectionDecision = Data.taggedEnum<ProviderResultCorrectionDecision>()

/** A provider observation must name the retained request, never a predecessor or guessed turn. */
export class ProviderResultObservationMismatch extends Schema.TaggedError<ProviderResultObservationMismatch>()(
  "ProviderResultObservationMismatch",
  { reason: Schema.Literals(["RequestToken", "TurnIdentity", "Expired", "ObservationStage", "ResponseFacts"]) }
) {}

/** Current physical ownership for the last logical response; prior transport bindings remain history. */
export const providerResultResponseOwnership = (cycle: ProviderResultCycle) => {
  const response = cycle.responses.at(lastResponseOffset)
  if (response === undefined) return undefined
  const continuation = cycle.transportContinuations?.findLast(
    (entry) => entry.responseOrdinal === response.intent.ordinal
  )
  return continuation !== undefined
    ? { token: continuation.token, turnId: continuation.turnId }
    : { token: response.intent.token, turnId: response._tag === "RequestIntended" ? undefined : response.turnId }
}

export const observeProviderResultTurn = Effect.fn("ProviderResult.observeTurn")(function* (
  cycle: ProviderResultCycle,
  token: ProviderResultRequestToken,
  turnId: ProviderResultTurnId,
  now: ProviderResultInstantMilliseconds
) {
  const retained = yield* Schema.decodeUnknownEffect(ProviderResultCycle)(cycle)
  const current = yield* Schema.decodeUnknownEffect(ProviderResultResponseRecord)(
    retained.responses.at(lastResponseOffset)
  )
  const ownership = providerResultResponseOwnership(retained)
  if (ownership?.token !== token) return yield* new ProviderResultObservationMismatch({ reason: "RequestToken" })
  const continuation = retained.transportContinuations?.at(lastResponseOffset)
  if (continuation?.responseOrdinal === current.intent.ordinal) {
    if (continuation.turnId !== undefined) {
      if (continuation.turnId !== turnId)
        return yield* new ProviderResultObservationMismatch({ reason: "TurnIdentity" })
      return retained
    }
    if (current._tag !== "TurnObserved")
      return yield* new ProviderResultObservationMismatch({ reason: "ObservationStage" })
    if (providerResultResponseExpired(current.intent, now))
      return yield* new ProviderResultObservationMismatch({ reason: "Expired" })
    return yield* Schema.decodeUnknownEffect(ProviderResultCycle)({
      ...retained,
      transportContinuations: [
        ...(retained.transportContinuations ?? []).slice(0, lastResponseOffset),
        { ...continuation, turnId }
      ]
    })
  }
  if (current._tag !== "RequestIntended") {
    if (current.turnId !== turnId) return yield* new ProviderResultObservationMismatch({ reason: "TurnIdentity" })
    return retained
  }
  if (providerResultResponseExpired(current.intent, now))
    return yield* new ProviderResultObservationMismatch({ reason: "Expired" })
  return yield* Schema.decodeUnknownEffect(ProviderResultCycle)({
    ...retained,
    responses: [
      ...retained.responses.slice(0, lastResponseOffset),
      { _tag: "TurnObserved", intent: current.intent, turnId }
    ]
  })
})

/** Persist one proven defect against its exact observed response before preparing another intent. */
export const rejectProviderResultResponse = Effect.fn("ProviderResult.rejectResponse")(function* (
  cycle: ProviderResultCycle,
  token: ProviderResultRequestToken,
  turnId: ProviderResultTurnId,
  responseObservedAt: ProviderResultInstantMilliseconds,
  reason: ProviderResultRejectionReason
) {
  const retained = yield* Schema.decodeUnknownEffect(ProviderResultCycle)(cycle)
  const current = yield* Schema.decodeUnknownEffect(ProviderResultResponseRecord)(
    retained.responses.at(lastResponseOffset)
  )
  const ownership = providerResultResponseOwnership(retained)
  if (ownership?.token !== token) return yield* new ProviderResultObservationMismatch({ reason: "RequestToken" })
  if (current._tag === "RequestIntended")
    return yield* new ProviderResultObservationMismatch({ reason: "ObservationStage" })
  if (ownership.turnId !== turnId) return yield* new ProviderResultObservationMismatch({ reason: "TurnIdentity" })
  if (current._tag === "ResponseRejected") {
    if (current.reason !== reason || current.responseObservedAt !== responseObservedAt)
      return yield* new ProviderResultObservationMismatch({ reason: "ResponseFacts" })
    return retained
  }
  if (providerResultResponseExpired(current.intent, responseObservedAt))
    return yield* new ProviderResultObservationMismatch({ reason: "Expired" })
  return yield* Schema.decodeUnknownEffect(ProviderResultCycle)({
    ...retained,
    responses: [
      ...retained.responses.slice(0, lastResponseOffset),
      { _tag: "ResponseRejected", intent: current.intent, turnId: current.turnId, responseObservedAt, reason }
    ]
  })
})

/** Select from observed private facts; pending or ambiguous delivery never consumes a new ordinal. */
export const prepareProviderResultCorrection = Effect.fn("ProviderResult.prepareCorrection")(function* (
  cycle: ProviderResultCycle,
  freshToken: ProviderResultRequestToken,
  now: ProviderResultInstantMilliseconds
) {
  const retained = yield* Schema.decodeUnknownEffect(ProviderResultCycle)(cycle)
  const previous = yield* Schema.decodeUnknownEffect(ProviderResultResponseRecord)(
    retained.responses.at(lastResponseOffset)
  )
  if (previous._tag !== "ResponseRejected") {
    return providerResultResponseExpired(previous.intent, now)
      ? ProviderResultCorrectionDecision.OperatorRequired({ reason: "Deadline" })
      : ProviderResultCorrectionDecision.ReconcileOwnedRequest({ request: previous.intent })
  }
  if (retained.responses.length === maximumResponsesPerCycle)
    return ProviderResultCorrectionDecision.OperatorRequired({ reason: "CorrectionExhausted" })
  const request = yield* Schema.decodeUnknownEffect(ProviderResultResponseIntent)({
    _tag: "Correction",
    ordinal: retained.responses.length + 1,
    token: freshToken,
    intendedAt: now,
    deadline: now + providerResultCorrectionMilliseconds
  })
  const next = yield* Schema.decodeUnknownEffect(ProviderResultCycle)({
    ...retained,
    responses: [...retained.responses, { _tag: "RequestIntended", intent: request }]
  })
  return ProviderResultCorrectionDecision.CorrectionIntentPrepared({ cycle: next, request })
})

/** Persists physical Resume ownership while retaining the original response ordinal and deadline. */
export const prepareProviderResultContinuation = Effect.fn("ProviderResult.prepareContinuation")(function* (
  cycle: ProviderResultCycle,
  token: ProviderResultRequestToken,
  now: ProviderResultInstantMilliseconds
) {
  const retained = yield* Schema.decodeUnknownEffect(ProviderResultCycle)(cycle)
  const response = retained.responses.at(lastResponseOffset)
  if (response === undefined || response._tag !== "TurnObserved")
    return yield* new ProviderResultObservationMismatch({ reason: "ObservationStage" })
  if (response.intent._tag === "Correction" && providerResultResponseExpired(response.intent, now))
    return yield* new ProviderResultDeadlineElapsed({
      token: response.intent.token,
      deadline: response.intent.deadline
    })
  const pending = retained.transportContinuations?.at(lastResponseOffset)
  if (pending?.responseOrdinal === response.intent.ordinal && pending.turnId === undefined)
    return yield* new ProviderResultObservationMismatch({ reason: "ObservationStage" })
  const continuation = ProviderResultTransportContinuation.make({
    responseOrdinal: response.intent.ordinal,
    token,
    intendedAt: now
  })
  return yield* Schema.decodeUnknownEffect(ProviderResultCycle)({
    ...retained,
    transportContinuations: [...(retained.transportContinuations ?? []), continuation]
  })
})
