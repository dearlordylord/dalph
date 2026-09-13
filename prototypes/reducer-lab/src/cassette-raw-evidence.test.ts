import { strict as assert } from "node:assert"
import { parseHTML } from "linkedom"
import { runMaintainedCassette } from "./cassette-lab.ts"
import { journalEvidenceRows, resultEvidenceText } from "./cassette-lab-view.ts"
import { cassetteRawEvidenceItems, renderCassetteRawEvidence } from "./cassette-raw-evidence.ts"

const result = await runMaintainedCassette("authored:singletonTaskCompletes")
if (
  result._tag !== "Completed" ||
  result.observationMoments === null ||
  result.deliveryFrames === null ||
  result.preparedTrace === null ||
  result.rawEvidenceSource._tag !== "Authored"
) {
  throw new Error("The real authored raw-evidence fixture did not complete")
}
let formatted = 0
const original = result.observationMoments[0]
if (original === undefined) throw new Error("The real fixture has no moment")
const observed = {
  ...original,
  toJSON: () => {
    formatted += 1
    return original
  }
}
const guarded = {
  ...result,
  observationMoments: [observed, ...result.observationMoments.slice(1)],
  executionEvidence: {
    toJSON: () => {
      throw new Error("Do not flatten the raw artifact")
    }
  }
}
assert.ok(resultEvidenceText(guarded).includes("singletonTaskCompletes"))
assert.equal(formatted, 0)
const items = cassetteRawEvidenceItems(guarded)
assert.deepEqual(
  items
    .filter(
      ({ collection }) =>
        !["JournalRecord", "ObservationCapture", "ObservationMoment", "DeliveryFrame"].includes(collection)
    )
    .map(({ collection }) => collection),
  [
    "AuthoredCassette",
    "AuthoredHistory",
    "AuthoredObservedBehavior",
    "AuthoredActivationOrdinals",
    "AuthoredObservationPlaybackWork",
    "AuthoredCaptureCopyCount",
    "AuthoredRunIdentity",
    ...result.preparedTrace.cursors.map(() => "PreparedTraceCursor")
  ]
)
const source = result.rawEvidenceSource.evidence
assert.equal(source, result.executionEvidence, "The typed source must be the same retained raw artifact")
assert.deepEqual(
  Object.keys(source).sort(),
  [
    "activationOrdinals",
    "cassette",
    "deliveryFrames",
    "history",
    "observationCaptures",
    "observationMoments",
    "observationPlaybackWork",
    "observationCaptureSnapshotCopiedReferences",
    "observedBehavior",
    "records",
    "runId",
    "preparedTrace"
  ].sort()
)
for (const [collection, value] of [
  ["AuthoredCassette", source.cassette],
  ["AuthoredHistory", source.history],
  ["AuthoredObservedBehavior", source.observedBehavior],
  ["AuthoredActivationOrdinals", source.activationOrdinals],
  ["AuthoredObservationPlaybackWork", source.observationPlaybackWork],
  ["AuthoredCaptureCopyCount", source.observationCaptureSnapshotCopiedReferences],
  ["AuthoredRunIdentity", source.runId]
] as const) {
  const matching = items.filter((item) => item.collection === collection)
  assert.equal(matching.length, 1)
  assert.equal(matching[0]?.value, value)
}
const cursors = items.filter((item) => item.collection === "PreparedTraceCursor")
assert.equal(cursors.length, source.preparedTrace.cursors.length)
for (const [index, cursor] of source.preparedTrace.cursors.entries()) {
  assert.equal(cursors[index]?.index, index)
  assert.equal(cursors[index]?.value, cursor)
}
const moments = items.filter(({ collection }) => collection === "ObservationMoment")
assert.equal(moments.length, result.observationMoments.length)
assert.deepEqual(
  moments.map(({ index }) => Number(index)),
  result.observationMoments.map((_, index) => index)
)
assert.equal(moments[0]?.value, observed)
for (const [collection, source] of [
  ["JournalRecord", guarded.journalRecords],
  ["ObservationCapture", guarded.observationCaptures],
  ["ObservationMoment", guarded.observationMoments],
  ["DeliveryFrame", guarded.deliveryFrames]
] as const) {
  if (source === null) throw new Error("The authored fixture has a missing retained collection")
  const indexed = items.filter((item) => item.collection === collection)
  assert.equal(indexed.length, source.length)
  for (const [index, value] of source.entries()) {
    assert.equal(indexed[index]?.index, index)
    assert.equal(indexed[index]?.value, value, "Each original retained artifact must be reachable once in order")
  }
}
assert.equal(formatted, 0)
const { document, window } = parseHTML("<main></main>")
Object.assign(globalThis, { document, Event: window.Event })
const host = document.querySelector("main")
if (host === null) throw new Error("Raw-evidence host is missing")
renderCassetteRawEvidence(host, guarded)
const disclosure = host.querySelector<HTMLDetailsElement>("details")
const selector = host.querySelector<HTMLSelectElement>("select")
const exact = host.querySelector<HTMLPreElement>("pre")
if (disclosure === null || selector === null || exact === null) throw new Error("Raw-evidence controls are missing")
assert.equal(exact.textContent, "")
assert.equal(formatted, 0)
for (const option of selector.options) {
  if (option.value === "ObservationMoment:0") option.setAttribute("selected", "")
  else option.removeAttribute("selected")
}
selector.dispatchEvent(new window.Event("change"))
assert.equal(formatted, 0, "Closed disclosure must not format even a selected item")
disclosure.open = true
disclosure.dispatchEvent(new window.Event("toggle"))
assert.equal(formatted, 1)
assert.equal(exact.textContent, JSON.stringify(original, null, 2))
const invalid = document.createElement("option")
invalid.value = "ObservationMoment:01"
selector.append(invalid)
for (const option of selector.options) {
  if (option === invalid) option.setAttribute("selected", "")
  else option.removeAttribute("selected")
}
selector.dispatchEvent(new window.Event("change"))
assert.equal(exact.textContent, "", "An unknown selection must not guess an artifact")
assert.equal(formatted, 1)
for (const collection of [
  "JournalRecord",
  "ObservationCapture",
  "DeliveryFrame",
  "AuthoredCassette",
  "AuthoredHistory",
  "AuthoredObservedBehavior",
  "AuthoredActivationOrdinals",
  "AuthoredObservationPlaybackWork",
  "AuthoredCaptureCopyCount",
  "AuthoredRunIdentity",
  "PreparedTraceCursor"
] as const) {
  for (const option of selector.options) {
    if (option.value === `${collection}:0`) option.setAttribute("selected", "")
    else option.removeAttribute("selected")
  }
  selector.dispatchEvent(new window.Event("change"))
  const item = items.find((entry) => entry.collection === collection && Number(entry.index) === 0)
  if (item === undefined) throw new Error("The retained artifact is missing")
  assert.equal(exact.textContent, JSON.stringify(item.value, null, 2))
}
disclosure.open = false
disclosure.dispatchEvent(new window.Event("toggle"))
assert.equal(exact.textContent, "")
assert.equal(result.observationMoments[0], original)
const record = result.journalRecords[0]
if (
  typeof record !== "object" ||
  record === null ||
  !("event" in record) ||
  typeof record.event !== "object" ||
  record.event === null
) {
  throw new Error("The real fixture has no journal event")
}
let formattedEvents = 0
const event = {
  ...record.event,
  toJSON: () => {
    formattedEvents += 1
    return record.event
  }
}
const rows = journalEvidenceRows({ ...result, journalRecords: [{ ...record, event }] })
assert.equal(formattedEvents, 0, "Collapsed journal rows must retain events without serializing them")
assert.equal(rows[0]?.rawEvent(), JSON.stringify(record.event, null, 2))
assert.equal(formattedEvents, 1)
console.log("✓ raw evidence indexes retained moments without flattening and formats only the selected open item")
