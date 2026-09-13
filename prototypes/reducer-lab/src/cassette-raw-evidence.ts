import { Schema } from "effect"
import type { CassetteLabResult } from "./cassette-lab.ts"
import { journalEvidenceRows } from "./cassette-lab-view.ts"

/** Zero-based position within one retained raw-evidence collection, not a Journal position or workflow authority. */
export const CassetteRawEvidenceIndex = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("CassetteRawEvidenceIndex")
)
export type CassetteRawEvidenceIndex = typeof CassetteRawEvidenceIndex.Type

export interface CassetteRawEvidenceItem {
  readonly collection:
    | "JournalRecord"
    | "ObservationCapture"
    | "ObservationMoment"
    | "DeliveryFrame"
    | "ProtocolEvidence"
    | "AuthoredCassette"
    | "AuthoredHistory"
    | "AuthoredObservedBehavior"
    | "AuthoredActivationOrdinals"
    | "AuthoredObservationPlaybackWork"
    | "AuthoredCaptureCopyCount"
    | "AuthoredRunIdentity"
    | "PreparedTraceCursor"
  readonly index: CassetteRawEvidenceIndex
  readonly label: string
  readonly value: unknown
}

/** Indexes original retained objects using existing journal-row metadata; never formats their nested artifact payloads. */
export const cassetteRawEvidenceItems = (
  result: Extract<CassetteLabResult, { readonly _tag: "Completed" }>
): ReadonlyArray<CassetteRawEvidenceItem> => {
  const rows = journalEvidenceRows(result)
  const source = result.rawEvidenceSource
  const authoredFields: ReadonlyArray<CassetteRawEvidenceItem> =
    source._tag === "Authored"
      ? [
          {
            collection: "AuthoredCassette",
            index: CassetteRawEvidenceIndex.make(0),
            label: "Exact authored cassette",
            value: source.evidence.cassette
          },
          {
            collection: "AuthoredHistory",
            index: CassetteRawEvidenceIndex.make(0),
            label: "Exact authored workflow history",
            value: source.evidence.history
          },
          {
            collection: "AuthoredObservedBehavior",
            index: CassetteRawEvidenceIndex.make(0),
            label: "Exact authored observed behavior",
            value: source.evidence.observedBehavior
          },
          {
            collection: "AuthoredActivationOrdinals",
            index: CassetteRawEvidenceIndex.make(0),
            label: "Exact authored activation ordinals",
            value: source.evidence.activationOrdinals
          },
          {
            collection: "AuthoredObservationPlaybackWork",
            index: CassetteRawEvidenceIndex.make(0),
            label: "Exact authored observation playback work",
            value: source.evidence.observationPlaybackWork
          },
          {
            collection: "AuthoredCaptureCopyCount",
            index: CassetteRawEvidenceIndex.make(0),
            label: "Exact authored capture snapshot copied-reference count",
            value: source.evidence.observationCaptureSnapshotCopiedReferences
          },
          {
            collection: "AuthoredRunIdentity",
            index: CassetteRawEvidenceIndex.make(0),
            label: "Exact authored Run identity",
            value: source.evidence.runId
          },
          ...source.evidence.preparedTrace.cursors.map((value, index) => ({
            collection: "PreparedTraceCursor" as const,
            index: CassetteRawEvidenceIndex.make(index),
            label: `Prepared trace cursor ${value.position} · Run ${value.runId}`,
            value
          }))
        ]
      : [
          {
            collection: "ProtocolEvidence",
            index: CassetteRawEvidenceIndex.make(0),
            label: "Exact protocol execution evidence",
            value: source.evidence
          }
        ]
  return [
    ...rows.map((row, index) => ({
      collection: "JournalRecord" as const,
      index: CassetteRawEvidenceIndex.make(index),
      label: `Journal ${row.position} · ${row.eventTag} · Run ${row.runId}`,
      value: result.journalRecords[index]
    })),
    ...result.observationCaptures.map((value, index) => ({
      collection: "ObservationCapture" as const,
      index: CassetteRawEvidenceIndex.make(index),
      label: `Capture ${value.captureOrder} · ${value._tag} · activation ${value.activationOrdinal} · story ${value.storyPosition}`,
      value
    })),
    ...(result.observationMoments?.map((value, index) => ({
      collection: "ObservationMoment" as const,
      index: CassetteRawEvidenceIndex.make(index),
      label: `Moment ${value.captureOrder} · ${value._tag} · activation ${value.activationOrdinal} · story ${value.storyPosition}`,
      value
    })) ?? []),
    ...(result.deliveryFrames?.map((value, index) => ({
      collection: "DeliveryFrame" as const,
      index: CassetteRawEvidenceIndex.make(index),
      label: `Delivery frame ${index} · activation ${value.activationOrdinal} · story ${value.storyPosition}`,
      value
    })) ?? []),
    ...authoredFields
  ]
}

/** The passive raw disclosure formats only Alice's selected original artifact while open. */
export const renderCassetteRawEvidence = (
  parent: HTMLElement,
  result: Extract<CassetteLabResult, { readonly _tag: "Completed" }>
): void => {
  const items = cassetteRawEvidenceItems(result)
  const selections = new Map(items.map((item) => [`${item.collection}:${item.index}`, item]))
  const details = document.createElement("details")
  details.dataset.role = "raw-execution-result"
  const summary = document.createElement("summary")
  summary.textContent = "Raw execution result · select one exact retained artifact"
  const selector = document.createElement("select")
  selector.dataset.role = "raw-evidence-selector"
  selector.setAttribute("aria-label", "Exact retained raw-evidence artifact")
  const placeholder = document.createElement("option")
  placeholder.value = ""
  placeholder.textContent = "Select an exact record, capture, moment, or frame"
  selector.append(placeholder)
  for (const item of items) {
    const option = document.createElement("option")
    option.value = `${item.collection}:${item.index}`
    option.dataset.collection = item.collection
    option.dataset.collectionIndex = String(item.index)
    option.textContent = item.label
    selector.append(option)
  }
  const exact = document.createElement("pre")
  exact.dataset.role = "raw-evidence-exact-item"
  const showSelected = (): void => {
    if (!details.open) return
    const selected = selections.get(selector.value)
    exact.textContent = selected === undefined ? "" : JSON.stringify(selected.value, null, 2)
  }
  selector.addEventListener("change", showSelected)
  details.addEventListener("toggle", () => {
    if (details.open) showSelected()
    else exact.textContent = ""
  })
  details.append(summary, selector, exact)
  parent.append(details)
}
