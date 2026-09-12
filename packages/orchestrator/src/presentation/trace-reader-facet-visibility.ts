import type {
  TraceObservationGap,
  TraceRetainedResponsibility,
  TraceDispositionFact,
  TracePreservationDisposition
} from "./trace-reader.js"
import type { JournalPosition } from "../workflow-journal/identity.js"
import { Option } from "effect"

/** Half-open visibility of one immutable accepted facet version. */
export interface FacetVisibility<Value> {
  readonly start: JournalPosition
  readonly end: JournalPosition | undefined
  readonly order: JournalPosition
  readonly value: Value
}

interface VisibilityNode<Value> {
  readonly center: JournalPosition
  readonly byStart: ReadonlyArray<FacetVisibility<Value>>
  readonly byEnd: ReadonlyArray<FacetVisibility<Value>>
  readonly left: VisibilityNode<Value> | undefined
  readonly right: VisibilityNode<Value> | undefined
}

const binaryPartitionDivisor = 2
const intervalOrderBefore = -1
const intervalOrderAfter = 1
const retainedOrderingsPerInterval = 2

// This private static index serves only historical visibility facets below.
// Each accepted version is retained at exactly one node, not once per cursor.
const visibilityIndex = <Value>(intervals: ReadonlyArray<FacetVisibility<Value>>) => {
  let buildComparisons = 0
  let queryComparisons = 0
  let nodes = 0
  let retainedIntervalReferences = 0
  const versionCount = intervals.length
  const build = (input: ReadonlyArray<FacetVisibility<Value>>): VisibilityNode<Value> | undefined => {
    if (input.length === 0) return undefined
    const center = Option.getOrThrow(
      Option.fromUndefinedOr(input[Math.floor(input.length / binaryPartitionDivisor)])
    ).start
    const left: Array<FacetVisibility<Value>> = []
    const right: Array<FacetVisibility<Value>> = []
    const crossing: Array<FacetVisibility<Value>> = []
    for (const interval of input) {
      buildComparisons += 1
      if (interval.end !== undefined && interval.end <= center) left.push(interval)
      else if (interval.start > center) right.push(interval)
      else crossing.push(interval)
    }
    nodes += 1
    retainedIntervalReferences += crossing.length * retainedOrderingsPerInterval
    return {
      center,
      byStart: crossing,
      byEnd: crossing.toSorted((first, second) => {
        buildComparisons += 1
        if (first.end === undefined) return second.end === undefined ? 0 : intervalOrderBefore
        if (second.end === undefined) return intervalOrderAfter
        return second.end - first.end
      }),
      left: build(left),
      right: build(right)
    }
  }
  const root = build(
    intervals
      .filter(({ end, start }) => end === undefined || start < end)
      .toSorted((left, right) => {
        buildComparisons += 1
        return left.start - right.start
      })
  )
  return {
    at: (position: JournalPosition): ReadonlyArray<Value> => {
      const selected: Array<FacetVisibility<Value>> = []
      let node = root
      while (node !== undefined) {
        queryComparisons += 1
        const before = position < node.center
        for (const interval of before ? node.byStart : node.byEnd) {
          queryComparisons += 1
          if (before ? interval.start > position : interval.end !== undefined && interval.end <= position) break
          selected.push(interval)
        }
        node = before ? node.left : node.right
      }
      return selected
        .sort((left, right) => {
          queryComparisons += 1
          return left.order - right.order
        })
        .map(({ value }) => value)
    },
    counts: () => ({ buildComparisons, queryComparisons, nodes, versions: versionCount, retainedIntervalReferences })
  }
}

/** Sealed point indexes for historical visibility versions, never builder references. */
export const prepareFacetVisibility = (input: {
  readonly gaps: ReadonlyArray<FacetVisibility<TraceObservationGap>>
  readonly responsibilities: ReadonlyArray<FacetVisibility<TraceRetainedResponsibility>>
  readonly dispositions: ReadonlyArray<FacetVisibility<TraceDispositionFact>>
  readonly preservation: ReadonlyArray<FacetVisibility<TracePreservationDisposition>>
}) => {
  const gaps = visibilityIndex(input.gaps)
  const responsibilities = visibilityIndex(input.responsibilities)
  const dispositions = visibilityIndex(input.dispositions)
  const preservation = visibilityIndex(input.preservation)
  return {
    gapsAt: gaps.at,
    responsibilitiesAt: responsibilities.at,
    dispositionsAt: dispositions.at,
    preservationAt: preservation.at,
    counts: () => ({
      gaps: gaps.counts(),
      responsibilities: responsibilities.counts(),
      dispositions: dispositions.counts(),
      preservation: preservation.counts()
    })
  }
}
