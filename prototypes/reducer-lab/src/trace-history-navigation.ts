import { describeWorkflowOccurrence, type TraceHistoryItem } from "@dalph/orchestrator"

export type TraceOccurrenceClassification = "InitiatedAction" | "NonActionOccurrence"

export type FoldedTraceHistoryEntry =
  | {
    readonly _tag: "ExactTraceItem"
    readonly item: TraceHistoryItem
  }
  | {
    readonly _tag: "FoldedTraceItems"
    readonly classification: TraceOccurrenceClassification
    readonly count: number
    readonly first: TraceHistoryItem["identity"]
    readonly items: ReadonlyArray<TraceHistoryItem>
    readonly last: TraceHistoryItem["identity"]
    readonly occurrenceTag: TraceHistoryItem["occurrence"]["_tag"]
  }

const productionClassification = (item: TraceHistoryItem): TraceOccurrenceClassification =>
  describeWorkflowOccurrence(item.occurrence).presentation.classification

/**
 * Folds only consecutive-journal non-action occurrences with the same
 * canonical tag. Initiated boundary calls remain exact, and the exact ordered
 * items remain the expansion payload.
 */
export const foldRepeatedTraceItems = (
  items: ReadonlyArray<TraceHistoryItem>,
  classificationOf: (item: TraceHistoryItem) => TraceOccurrenceClassification = productionClassification
): ReadonlyArray<FoldedTraceHistoryEntry> => {
  const folded: Array<FoldedTraceHistoryEntry> = []
  let index = 0
  while (index < items.length) {
    const first = items[index]
    if (first === undefined) break
    const classification = classificationOf(first)
    let end = index + 1
    while (classification === "NonActionOccurrence" && end < items.length) {
      const candidate = items[end]
      if (
        candidate === undefined
        || candidate.identity.runId !== first.identity.runId
        || candidate.identity.position !== (items[end - 1]?.identity.position ?? -1) + 1
        || candidate.occurrence._tag !== first.occurrence._tag
        || classificationOf(candidate) !== classification
      ) break
      end += 1
    }
    const repeated = items.slice(index, end)
    const last = repeated.at(-1)
    folded.push(repeated.length === 1 || last === undefined
      ? { _tag: "ExactTraceItem", item: first }
      : {
        _tag: "FoldedTraceItems",
        classification,
        count: repeated.length,
        first: first.identity,
        items: repeated,
        last: last.identity,
        occurrenceTag: first.occurrence._tag
      })
    index = end
  }
  return folded
}
