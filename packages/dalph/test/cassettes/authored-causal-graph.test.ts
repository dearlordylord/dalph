import { expect, it } from "vitest"
import {
  AuthoredOccurrenceGraphFailure,
  AuthoredOccurrenceId,
  AuthoredOccurrenceMatchFailure,
  compileAuthoredOccurrenceGraph,
  finishAuthoredOccurrenceGraph,
  initialAuthoredOccurrenceFrontier,
  matchAuthoredOccurrence,
  sequenceAuthoredOccurrences,
  unconsumedAuthoredOccurrences,
  type AuthoredOccurrence
} from "../../src/cassettes/authored-causal-graph.js"

const id = (name: string) => AuthoredOccurrenceId.make(name)
const occurrence = (name: string, predecessors: ReadonlyArray<string> = []): AuthoredOccurrence<string> => ({
  id: id(name),
  predecessors: predecessors.map(id),
  value: name
})
const graph = (nodes: ReadonlyArray<AuthoredOccurrence<string>>) => {
  const compiled = compileAuthoredOccurrenceGraph(nodes)
  if (compiled instanceof AuthoredOccurrenceGraphFailure) throw compiled
  return compiled
}
const consume = (
  compiled: ReturnType<typeof graph>,
  frontier: ReturnType<typeof initialAuthoredOccurrenceFrontier>,
  name: string
) => matchAuthoredOccurrence(compiled, frontier, name, (value) => value === name)

it("accepts opposite topological orders of independent boundary chains", () => {
  const compiled = graph([
    occurrence("A graph"),
    occurrence("A specification", ["A graph"]),
    occurrence("B graph"),
    occurrence("B specification", ["B graph"])
  ])
  for (const order of [
    ["A graph", "A specification", "B graph", "B specification"],
    ["B graph", "A graph", "B specification", "A specification"]
  ]) {
    let frontier = initialAuthoredOccurrenceFrontier()
    for (const name of order) {
      const result = consume(compiled, frontier, name)
      expect(result).not.toBeInstanceOf(AuthoredOccurrenceMatchFailure)
      if (result instanceof AuthoredOccurrenceMatchFailure) throw result
      frontier = result.frontier
    }
    expect(unconsumedAuthoredOccurrences(compiled, frontier)).toEqual([])
    expect(finishAuthoredOccurrenceGraph(compiled, frontier)).toBeUndefined()
  }
})

it("rejects an early boundary with its exact unmet predecessor", () => {
  const compiled = graph([occurrence("graph"), occurrence("specification", ["graph"])])
  const result = consume(compiled, initialAuthoredOccurrenceFrontier(), "specification")
  expect(result).toBeInstanceOf(AuthoredOccurrenceMatchFailure)
  if (result instanceof AuthoredOccurrenceMatchFailure) expect(result.detail).toContain("graph")
})

it("rejects two enabled same-shaped occurrences instead of picking array order", () => {
  const compiled = graph([occurrence("same"), { ...occurrence("other"), value: "same" }])
  const result = consume(compiled, initialAuthoredOccurrenceFrontier(), "same")
  expect(result).toBeInstanceOf(AuthoredOccurrenceMatchFailure)
  if (result instanceof AuthoredOccurrenceMatchFailure) expect(result.detail).toContain("ambiguous")
})

it("rejects duplicate consumption and exposes unconsumed required nodes", () => {
  const compiled = graph([occurrence("first"), occurrence("second")])
  const first = consume(compiled, initialAuthoredOccurrenceFrontier(), "first")
  if (first instanceof AuthoredOccurrenceMatchFailure) throw first
  expect(unconsumedAuthoredOccurrences(compiled, first.frontier)).toEqual([id("second")])
  expect(finishAuthoredOccurrenceGraph(compiled, first.frontier)).toBeInstanceOf(AuthoredOccurrenceMatchFailure)
  expect(consume(compiled, first.frontier, "first")).toBeInstanceOf(AuthoredOccurrenceMatchFailure)
})

it("rejects duplicate IDs, missing predecessors, repeated edges, and cycles before playback", () => {
  for (const nodes of [
    [occurrence("A"), occurrence("A")],
    [occurrence("A", ["missing"])],
    [occurrence("A"), occurrence("B", ["A", "A"])],
    [occurrence("A", ["B"]), occurrence("B", ["A"])]
  ]) {
    expect(compileAuthoredOccurrenceGraph(nodes)).toBeInstanceOf(AuthoredOccurrenceGraphFailure)
  }
})

it("compiles sequential stories into strict adjacent predecessor edges", () => {
  const compiled = graph(sequenceAuthoredOccurrences(["first", "second"].map((value) => ({ id: id(value), value }))))
  expect(consume(compiled, initialAuthoredOccurrenceFrontier(), "second")).toBeInstanceOf(
    AuthoredOccurrenceMatchFailure
  )
})
