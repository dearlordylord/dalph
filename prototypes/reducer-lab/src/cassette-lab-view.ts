import type { CassetteLabResult } from "./cassette-lab.ts"

export const resultStatusText = (result: CassetteLabResult): string => {
  if (result._tag === "Completed") {
    return `completed · ${result.consumedItemCount}/${result.totalItemCount} items · ${result.journalRecordCount} journal records`
  }
  const progress = result.location._tag === "Unknown"
    ? `consumed count unavailable/${result.totalItemCount}`
    : `${result.location.consumedItemCount}/${result.totalItemCount} items`
  const failedItem = result.location._tag === "Unknown"
    ? ""
    : ` · stopped at ${result.location.storyPosition}:${result.location.failedItemTag}`
  return `failed · ${progress}${failedItem}`
}

export const resultEvidenceText = (result: CassetteLabResult): string =>
  result._tag === "Failed" ? result.detail : JSON.stringify(result.executionEvidence, null, 2)

export const runAllSummaryText = (results: ReadonlyArray<CassetteLabResult>): string => {
  const completed = results.filter(({ _tag }) => _tag === "Completed").length
  return `${completed} completed · ${results.length - completed} failed · ${results.length} total`
}
