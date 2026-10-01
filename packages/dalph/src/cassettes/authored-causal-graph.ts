import { Schema } from "effect"

/** Stable cassette-local identity for one expected boundary occurrence. */
export const AuthoredOccurrenceId = Schema.NonEmptyString.pipe(Schema.brand("AuthoredOccurrenceId"))
export type AuthoredOccurrenceId = typeof AuthoredOccurrenceId.Type

export interface AuthoredOccurrence<A> {
  readonly id: AuthoredOccurrenceId
  readonly predecessors: ReadonlyArray<AuthoredOccurrenceId>
  readonly value: A
}

export class AuthoredOccurrenceGraphFailure extends Schema.TaggedError<AuthoredOccurrenceGraphFailure>()(
  "AuthoredOccurrenceGraphFailure",
  { detail: Schema.String }
) {}

export class AuthoredOccurrenceMatchFailure extends Schema.TaggedError<AuthoredOccurrenceMatchFailure>()(
  "AuthoredOccurrenceMatchFailure",
  { actual: Schema.String, detail: Schema.String }
) {}

/** Validation runs before any controlled boundary can be called. */
export interface AuthoredOccurrenceGraph<A> {
  readonly occurrences: ReadonlyArray<AuthoredOccurrence<A>>
  readonly byId: ReadonlyMap<AuthoredOccurrenceId, AuthoredOccurrence<A>>
}

export const compileAuthoredOccurrenceGraph = <A>(
  occurrences: ReadonlyArray<AuthoredOccurrence<A>>
): AuthoredOccurrenceGraph<A> | AuthoredOccurrenceGraphFailure => {
  const byId = new Map<AuthoredOccurrenceId, AuthoredOccurrence<A>>()
  for (const occurrence of occurrences) {
    if (byId.has(occurrence.id)) {
      return new AuthoredOccurrenceGraphFailure({ detail: `duplicate occurrence ${occurrence.id}` })
    }
    byId.set(occurrence.id, occurrence)
  }
  for (const occurrence of occurrences) {
    const seen = new Set<AuthoredOccurrenceId>()
    for (const predecessor of occurrence.predecessors) {
      if (seen.has(predecessor)) {
        return new AuthoredOccurrenceGraphFailure({
          detail: `occurrence ${occurrence.id} repeats predecessor ${predecessor}`
        })
      }
      seen.add(predecessor)
      if (!byId.has(predecessor)) {
        return new AuthoredOccurrenceGraphFailure({
          detail: `occurrence ${occurrence.id} has missing predecessor ${predecessor}`
        })
      }
    }
  }
  const visiting = new Set<AuthoredOccurrenceId>()
  const visited = new Set<AuthoredOccurrenceId>()
  const visit = (id: AuthoredOccurrenceId): AuthoredOccurrenceGraphFailure | undefined => {
    if (visiting.has(id)) return new AuthoredOccurrenceGraphFailure({ detail: `cycle reaches occurrence ${id}` })
    if (visited.has(id)) return undefined
    visiting.add(id)
    const occurrence = byId.get(id)
    if (occurrence === undefined) return new AuthoredOccurrenceGraphFailure({ detail: `missing occurrence ${id}` })
    for (const predecessor of occurrence.predecessors) {
      const failure = visit(predecessor)
      if (failure !== undefined) return failure
    }
    visiting.delete(id)
    visited.add(id)
    return undefined
  }
  for (const occurrence of occurrences) {
    const failure = visit(occurrence.id)
    if (failure !== undefined) return failure
  }
  return { occurrences, byId }
}

export interface AuthoredOccurrenceFrontier {
  readonly consumed: ReadonlySet<AuthoredOccurrenceId>
}

export const initialAuthoredOccurrenceFrontier = (): AuthoredOccurrenceFrontier => ({ consumed: new Set() })

/** An independent call may consume only one exact enabled occurrence. */
export const matchAuthoredOccurrence = <A>(
  graph: AuthoredOccurrenceGraph<A>,
  frontier: AuthoredOccurrenceFrontier,
  actual: string,
  matches: (value: A) => boolean
):
  | AuthoredOccurrenceMatchFailure
  | { readonly occurrence: AuthoredOccurrence<A>; readonly frontier: AuthoredOccurrenceFrontier } => {
  const unconsumed = graph.occurrences.filter((occurrence) => !frontier.consumed.has(occurrence.id))
  const structural = unconsumed.filter((occurrence) => matches(occurrence.value))
  const enabled = structural.filter((occurrence) =>
    occurrence.predecessors.every((predecessor) => frontier.consumed.has(predecessor))
  )
  if (enabled.length !== 1) {
    const detail =
      enabled.length > 1
        ? `ambiguous enabled occurrences: ${enabled.map(({ id }) => id).join(", ")}`
        : structural.length > 0
          ? `unmet predecessors: ${structural
              .flatMap((occurrence) => occurrence.predecessors.filter((id) => !frontier.consumed.has(id)))
              .join(", ")}`
          : `no unconsumed occurrence matches; enabled: ${unconsumed
              .filter((occurrence) => occurrence.predecessors.every((id) => frontier.consumed.has(id)))
              .map(({ id }) => id)
              .join(", ")}`
    return new AuthoredOccurrenceMatchFailure({ actual, detail })
  }
  const occurrence = enabled[0]
  if (occurrence === undefined)
    return new AuthoredOccurrenceMatchFailure({ actual, detail: "enabled occurrence vanished" })
  return { occurrence, frontier: { consumed: new Set([...frontier.consumed, occurrence.id]) } }
}

export const unconsumedAuthoredOccurrences = <A>(
  graph: AuthoredOccurrenceGraph<A>,
  frontier: AuthoredOccurrenceFrontier
): ReadonlyArray<AuthoredOccurrenceId> =>
  graph.occurrences.filter(({ id }) => !frontier.consumed.has(id)).map(({ id }) => id)

export const finishAuthoredOccurrenceGraph = <A>(
  graph: AuthoredOccurrenceGraph<A>,
  frontier: AuthoredOccurrenceFrontier
): AuthoredOccurrenceMatchFailure | undefined => {
  const remaining = unconsumedAuthoredOccurrences(graph, frontier)
  return remaining.length === 0
    ? undefined
    : new AuthoredOccurrenceMatchFailure({
        actual: "EndOfPlayback",
        detail: `unconsumed required occurrences: ${remaining.join(", ")}`
      })
}

/** Existing sequential stories compile to one edge between adjacent occurrences. */
export const sequenceAuthoredOccurrences = <A>(
  values: ReadonlyArray<{ readonly id: AuthoredOccurrenceId; readonly value: A }>
) =>
  values.map(({ id, value }, index): AuthoredOccurrence<A> => {
    const previous = values[index - 1]
    return { id, predecessors: previous === undefined ? [] : [previous.id], value }
  })
