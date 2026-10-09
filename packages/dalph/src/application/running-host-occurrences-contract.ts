import { TraceCursor, TraceHistoryItem } from "@dalph/orchestrator"
import { Schema } from "effect"

const SafeInteger = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
const PositiveCount = SafeInteger.check(Schema.isGreaterThanOrEqualTo(1))

/** A continuation names the exact next occurrence at the original committed prefix. */
export const OccurrenceContinuation = Schema.Struct({ prefix: TraceCursor, next: TraceCursor }).check(
  Schema.makeFilter(
    ({ next, prefix }) =>
      (prefix.runId === next.runId && next.position <= prefix.position) ||
      "continuation must belong to its fixed prefix"
  )
)
/** Supported encoded-response capacity in UTF-8 bytes, including the host envelope. */
export const OccurrencePageCapacity = SafeInteger.check(Schema.isBetween({ minimum: 1024, maximum: 1048576 })).pipe(
  Schema.brand("OccurrencePageCapacity")
)
const lastOccurrenceOffset = -1
export const OccurrencePage = Schema.TaggedStruct("OccurrencePage", {
  prefix: TraceCursor,
  covered: Schema.NullOr(Schema.Struct({ first: TraceCursor, last: TraceCursor })),
  items: Schema.Array(TraceHistoryItem),
  progress: Schema.TaggedUnion({ Complete: {}, Partial: { continuation: OccurrenceContinuation } })
}).check(
  Schema.makeFilter((page) => {
    const first = page.items[0]
    const last = page.items.at(lastOccurrenceOffset)
    if (first === undefined || last === undefined)
      return (
        (page.covered === null && page.progress._tag === "Complete") ||
        "empty pages must be complete with no covered positions"
      )
    const same = Schema.toEquivalence(TraceCursor)
    return (
      (page.covered !== null &&
        same(first.identity, page.covered.first) &&
        same(last.identity, page.covered.last) &&
        page.items.every(
          (item, index) =>
            item.identity.runId === page.prefix.runId &&
            item.identity.position <= page.prefix.position &&
            (index === 0 || item.identity.position > (page.items[index - 1]?.identity.position ?? 0))
        ) &&
        (page.progress._tag === "Complete" ||
          (same(page.prefix, page.progress.continuation.prefix) &&
            page.progress.continuation.next.position > last.identity.position))) ||
      "page items, covered positions and continuation must agree with the fixed prefix"
    )
  })
)
export type OccurrencePage = typeof OccurrencePage.Type
export const OccurrenceTooLarge = Schema.TaggedStruct("OccurrenceTooLarge", {
  prefix: TraceCursor,
  identity: TraceCursor,
  capacityBytes: OccurrencePageCapacity,
  occurrenceBytes: PositiveCount,
  requiredResponseBytes: PositiveCount,
  continuation: OccurrenceContinuation
})
