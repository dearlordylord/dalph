import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"

/** The result of reconstructing one immutable, operation-scoped cleanup prefix. */
type CleanupHistoryValidation =
  | { readonly _tag: "Valid"; readonly detail: string }
  | { readonly _tag: "Invalid"; readonly detail: string }

const valid = (detail: string): CleanupHistoryValidation => ({ _tag: "Valid", detail })
const invalid = (detail: string): CleanupHistoryValidation => ({ _tag: "Invalid", detail })
const lastElementOffset = -1

type Event = JournalRecord["event"]

/**
 * Family-specific schemas supply only identity and subject checks. This one
 * reducer owns the shared chronology: Authorized -> read intent -> observed
 * facts -> bounded mutation intent/result -> fresh absence -> Settled.
 */
interface CleanupHistoryDescriptorData<Authorization> {
  readonly operationId: string
  readonly runId: string
  readonly familyTags: ReadonlyArray<string>
  readonly authorizationTag: string
  readonly observationIntentTag: string
  readonly observedTag: string
  readonly mutationIntentTag: string
  readonly mutationResultTag: string
  readonly maxMutationAttempts: number
  readonly absenceTag: string
  readonly contradictionTag: string
  readonly settledTag: string
  readonly authorizedKey: JournalRecord["key"]
  readonly authorization: Authorization
  readonly successDetail: string
}

interface CleanupHistoryDescriptorStrategies<Authorization> {
  readonly authorizationOf: (event: Event) => Authorization | undefined
  readonly authorizationEquals: (candidate: Authorization, expected: Authorization) => boolean
  readonly observationIntent: (
    event: Event
  ) => { readonly key: string; readonly recordKey: JournalRecord["key"] } | undefined
  readonly observationResult: (
    event: Event
  ) =>
    | {
        readonly key: string
        readonly operationId: string
        readonly identityMatches: boolean
        readonly recordKey: JournalRecord["key"]
      }
    | undefined
  readonly mutationIntent: (
    event: Event
  ) => { readonly attempt: string; readonly operationId: string; readonly recordKey: JournalRecord["key"] } | undefined
  readonly mutationResult: (
    event: Event
  ) =>
    | {
        readonly attempt: string
        readonly operationId: string
        readonly identityMatches: boolean
        readonly recordKey: JournalRecord["key"]
      }
    | undefined
  readonly absence: (
    event: Event,
    observations: ReadonlyMap<string, JournalRecord>
  ) =>
    | {
        readonly key: string
        readonly identityMatches: boolean
        readonly observationMatches: boolean
        readonly cause: string
        readonly recordKey: JournalRecord["key"]
      }
    | undefined
  readonly contradiction: (
    event: Event
  ) => { readonly identityMatches: boolean; readonly recordKey: JournalRecord["key"] } | undefined
  readonly settled: (
    event: Event
  ) => { readonly identityMatches: boolean; readonly recordKey: JournalRecord["key"] } | undefined
  readonly isPresentObservation: (event: Event) => boolean
  readonly isAbsentObservation: (event: Event) => boolean
}

/** Immutable data and pure callbacks are kept as separate descriptor parts. */
export interface CleanupHistoryDescriptor<Authorization> {
  readonly data: CleanupHistoryDescriptorData<Authorization>
  readonly strategies: CleanupHistoryDescriptorStrategies<Authorization>
}

interface CleanupHistoryState {
  readonly intents: ReadonlyMap<string, JournalRecord>
  readonly observations: ReadonlyMap<string, JournalRecord>
  readonly mutations: ReadonlyMap<string, JournalRecord>
  readonly mutationResults: ReadonlyMap<string, JournalRecord>
  readonly settledPosition: JournalPosition | undefined
}

const emptyState = (): CleanupHistoryState => ({
  intents: new Map(),
  observations: new Map(),
  mutations: new Map(),
  mutationResults: new Map(),
  settledPosition: undefined
})

const mapWith = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> =>
  new Map<K, V>([...map, [key, value]])

const eventAuthorization = (event: Event): unknown => ("authorization" in event ? event.authorization : undefined)

const eventOperationId = (event: Event): string | undefined => {
  const authorization = eventAuthorization(event)
  if (typeof authorization !== "object" || authorization === null || !("operationId" in authorization)) return undefined
  return typeof authorization.operationId === "string" ? authorization.operationId : undefined
}

const prefixFor = <Authorization>(
  records: ReadonlyArray<JournalRecord>,
  descriptor: CleanupHistoryDescriptor<Authorization>
):
  | { readonly _tag: "Valid"; readonly family: ReadonlyArray<JournalRecord> }
  | { readonly _tag: "Invalid"; readonly detail: string } => {
  const { data, strategies } = descriptor
  const family = records
    .filter(
      (record) => data.familyTags.includes(record.event._tag) && eventOperationId(record.event) === data.operationId
    )
    .toSorted((left, right) => Number(left.position) - Number(right.position))
  if (family.length === 0) return { _tag: "Valid", family }
  const authorized = family.filter(({ event }) => event._tag === data.authorizationTag)
  if (authorized.length === 0) {
    return { _tag: "Invalid", detail: "cleanup history contains family events without an authorization prefix" }
  }
  if (authorized.length !== 1) {
    return { _tag: "Invalid", detail: "cleanup history contains duplicate authorization records for one operation" }
  }
  const authorizationRecord = authorized[0]
  if (authorizationRecord === undefined) {
    return { _tag: "Invalid", detail: "cleanup history authorization disappeared during reconstruction" }
  }
  const recordedAuthorization = strategies.authorizationOf(authorizationRecord.event)
  if (
    authorizationRecord.runId !== data.runId ||
    authorizationRecord.key !== data.authorizedKey ||
    recordedAuthorization === undefined ||
    !strategies.authorizationEquals(recordedAuthorization, data.authorization)
  ) {
    return { _tag: "Invalid", detail: "cleanup history contains a foreign or mis-keyed authorization" }
  }
  if (family.some(({ position }) => position < authorizationRecord.position)) {
    return { _tag: "Invalid", detail: "cleanup history contains a family event before authorization" }
  }
  return { _tag: "Valid", family }
}

const exactRecord = (record: JournalRecord, runId: string, key: JournalRecord["key"]): boolean =>
  record.runId === runId && record.key === key

const latest = (records: ReadonlyMap<string, JournalRecord>): JournalRecord | undefined =>
  [...records.values()].at(lastElementOffset)

/** Reconstructs one family through the same immutable ordered-prefix machine. */
export const validateCleanupHistory = <Authorization>(
  records: ReadonlyArray<JournalRecord>,
  descriptor: CleanupHistoryDescriptor<Authorization>
): CleanupHistoryValidation => {
  const prefix = prefixFor(records, descriptor)
  if (prefix._tag === "Invalid") return prefix
  const { data, strategies } = descriptor
  let state = emptyState()

  for (const record of prefix.family) {
    const event = record.event
    if (event._tag === data.authorizationTag) continue
    if (state.settledPosition !== undefined) {
      return invalid("cleanup history contains an event after terminal settlement")
    }
    const recordedAuthorization = strategies.authorizationOf(event)
    if (
      recordedAuthorization !== undefined &&
      !strategies.authorizationEquals(recordedAuthorization, data.authorization)
    ) {
      return invalid("cleanup history contains a conflicting authorization")
    }

    if (event._tag === data.observationIntentTag) {
      const identity = strategies.observationIntent(event)
      if (
        identity === undefined ||
        !exactRecord(record, data.runId, identity.recordKey) ||
        state.intents.has(identity.key)
      ) {
        return invalid("cleanup observation intent has a foreign key, authorization, or duplicate identity")
      }
      state = { ...state, intents: mapWith(state.intents, identity.key, record) }
      continue
    }

    if (event._tag === data.observedTag) {
      const identity = strategies.observationResult(event)
      const intent = identity === undefined ? undefined : state.intents.get(identity.key)
      if (
        identity === undefined ||
        intent === undefined ||
        !exactRecord(record, data.runId, identity.recordKey) ||
        !identity.identityMatches ||
        state.observations.has(identity.key)
      ) {
        return invalid("cleanup observation result has no exact preceding intent or subject identity")
      }
      state = { ...state, observations: mapWith(state.observations, identity.key, record) }
      continue
    }

    if (event._tag === data.mutationIntentTag) {
      const identity = strategies.mutationIntent(event)
      const precedingObservation = latest(state.observations)
      if (
        identity === undefined ||
        !Number.isInteger(Number(identity.attempt)) ||
        Number(identity.attempt) < 1 ||
        Number(identity.attempt) > data.maxMutationAttempts ||
        !exactRecord(record, data.runId, identity.recordKey) ||
        state.mutations.has(identity.attempt) ||
        precedingObservation === undefined ||
        precedingObservation.event._tag !== data.observedTag ||
        !strategies.isPresentObservation(precedingObservation.event)
      ) {
        return invalid("cleanup mutation intent is not preceded by exact present facts or has a foreign identity")
      }
      state = { ...state, mutations: mapWith(state.mutations, identity.attempt, record) }
      continue
    }

    if (event._tag === data.mutationResultTag) {
      const identity = strategies.mutationResult(event)
      const intent = identity === undefined ? undefined : state.mutations.get(identity.attempt)
      if (
        identity === undefined ||
        intent === undefined ||
        !exactRecord(record, data.runId, identity.recordKey) ||
        identity.operationId !==
          (intent.event._tag === data.mutationIntentTag
            ? strategies.mutationIntent(intent.event)?.operationId
            : undefined) ||
        !identity.identityMatches ||
        state.mutationResults.has(identity.attempt)
      ) {
        return invalid("cleanup mutation result has no exact preceding intent or subject identity")
      }
      state = { ...state, mutationResults: mapWith(state.mutationResults, identity.attempt, record) }
      continue
    }

    if (event._tag === data.absenceTag) {
      const identity = strategies.absence(event, state.observations)
      const observed = identity === undefined ? undefined : state.observations.get(identity.key)
      const latestMutationResult = latest(state.mutationResults)
      if (
        identity === undefined ||
        observed === undefined ||
        !exactRecord(record, data.runId, identity.recordKey) ||
        !identity.identityMatches ||
        !identity.observationMatches ||
        observed.event._tag !== data.observedTag ||
        !strategies.isAbsentObservation(observed.event) ||
        (state.mutations.size > 0 &&
          (latestMutationResult === undefined ||
            observed.position >= record.position ||
            observed.position <= latestMutationResult.position)) ||
        identity.cause !== (state.mutations.size > 0 ? "MutationResponseReconciliation" : "InitialAbsence")
      ) {
        return invalid("cleanup absence confirmation lacks the exact fresh absence and cause")
      }
      continue
    }

    if (event._tag === data.contradictionTag) {
      const identity = strategies.contradiction(event)
      if (identity === undefined || !exactRecord(record, data.runId, identity.recordKey) || !identity.identityMatches) {
        return invalid("cleanup contradiction has a foreign key, authorization, or subject")
      }
      continue
    }

    if (event._tag === data.settledTag) {
      const absence = [...prefix.family]
        .reverse()
        .find((candidate) => candidate.position < record.position && candidate.event._tag === data.absenceTag)
      const identity = strategies.settled(event)
      const latestMutationResult = [...state.mutationResults.values()].at(lastElementOffset)
      if (
        identity === undefined ||
        absence === undefined ||
        !exactRecord(record, data.runId, identity.recordKey) ||
        !identity.identityMatches ||
        (state.mutations.size > 0 &&
          (latestMutationResult === undefined || absence.position <= latestMutationResult.position))
      ) {
        return invalid("cleanup settlement lacks the exact preceding absence and result identity")
      }
      state = { ...state, settledPosition: record.position }
      continue
    }
  }

  return valid(data.successDetail)
}
