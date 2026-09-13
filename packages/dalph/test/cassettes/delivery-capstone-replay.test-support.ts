import { expect } from "vitest"
import { Effect } from "effect"
import { decodeFreshWorkflowRunIdForDiagnostics, journalRecordAt } from "@dalph/orchestrator"
import type { EvidenceReference, RunId } from "@dalph/contracts"
import type { AuthoredScenarioCassetteRun } from "../../src/cassettes/authored-runner.js"
import { acceptedManifestReferenceFor } from "./delivery-capstone-authored-correlations.test-support.js"
import { comparisonValue, firstDifference } from "./delivery-capstone-replay-comparison.test-support.js"

const declaredStoryLength = 402
/** Descriptor substitution is permitted only after independently checking the original exact bytes. */
const verifiedManifestReferences = (run: AuthoredScenarioCassetteRun, referenceRun: RunId) => {
  const references = run.records.reduce((previousReferences, { event }) => {
    if (
      event._tag !== "PlannedAttemptExecutorWorkReported" ||
      event.report._tag !== "ExecutorWorkTerminal" ||
      event.report.result._tag !== "Accepted"
    )
      return previousReferences
    const { correlation, result } = event.report
    expect(correlation.runId).toBe(run.runId)
    const original = acceptedManifestReferenceFor(correlation, result.acceptedResult.commit)
    expect(result.acceptedResult.evidenceManifest).toEqual(original)
    const reference = acceptedManifestReferenceFor(
      { ...correlation, runId: referenceRun },
      result.acceptedResult.commit
    )
    const references = new Map<string, EvidenceReference>([
      ...previousReferences,
      [`${original.byteLength}:${original.digest}`, reference] as const
    ])
    expect(comparisonValue({ evidenceManifest: original }, run.runId, referenceRun, "", references)).toEqual({
      evidenceManifest: reference
    })
    expect(comparisonValue({ digest: original.digest }, run.runId, referenceRun, "", references)).toEqual({
      digest: original.digest
    })
    expect(
      comparisonValue(
        { evidenceManifest: { ...original, byteLength: original.byteLength + 1 } },
        run.runId,
        referenceRun,
        "",
        references
      )
    ).not.toEqual({ evidenceManifest: reference })
    expect(
      comparisonValue(
        { evidenceManifest: { ...original, digest: `invalid:${original.digest}` } },
        run.runId,
        referenceRun,
        "",
        references
      )
    ).not.toEqual({ evidenceManifest: reference })
    return references
  }, new Map<string, EvidenceReference>())
  expect(references.size).toBeGreaterThan(0)
  return references
}

const comparableRun = (run: AuthoredScenarioCassetteRun) => {
  if (run.history._tag !== "ValidWorkflowJournalHistory") return expect.fail("fresh capstone history is invalid")
  const history = run.history
  return {
    activationOrdinals: run.activationOrdinals,
    cassette: run.cassette,
    deliveryFrames: run.deliveryFrames,
    observationCaptures: run.observationCaptures,
    observationMoments: run.observationMoments,
    history: {
      _tag: history._tag,
      runId: history.runId,
      runState: history.runState,
      prefix: {
        runId: history.prefix.runId,
        lastPosition: history.prefix.lastPosition,
        records: Array.from({ length: history.prefix.records.length }, (_, offset) =>
          journalRecordAt(history.prefix.records, offset)
        )
      }
    },
    observedBehavior: run.observedBehavior,
    records: run.records,
    runId: run.runId,
    // PreparedTrace.select is a fresh closure, not an observation. Its public
    // cursor inventory is compared; records and observation payloads above are
    // compared in full, without repeatedly materializing every trace prefix.
    preparedTraceCursors: run.preparedTrace.cursors,
    observationPlaybackWork: run.observationPlaybackWork,
    observationCaptureSnapshotCopiedReferences: run.observationCaptureSnapshotCopiedReferences
  }
}

/** The canonical facade read surface, with independently owned fixture contents. */
const readonlySetFixture = (values: ReadonlyArray<string>): ReadonlySet<string> => {
  const source = new Set(values)
  const view: ReadonlySet<string> = {
    get size() {
      return source.size
    },
    entries: () => source.entries(),
    forEach: (callback, thisArg) => source.forEach((value) => callback.call(thisArg, value, value, view)),
    has: (value) => source.has(value),
    keys: () => source.keys(),
    values: () => source.values(),
    [Symbol.iterator]: () => source[Symbol.iterator]()
  }
  return Object.freeze(view)
}

const readonlyMapFixture = (entries: ReadonlyArray<readonly [string, unknown]>): ReadonlyMap<string, unknown> => {
  const source = new Map(entries)
  const view: ReadonlyMap<string, unknown> = {
    get size() {
      return source.size
    },
    entries: () => source.entries(),
    forEach: (callback, thisArg) => source.forEach((value, key) => callback.call(thisArg, value, key, view)),
    get: (key) => source.get(key),
    has: (key) => source.has(key),
    keys: () => source.keys(),
    values: () => source.values(),
    [Symbol.iterator]: () => source[Symbol.iterator]()
  }
  return Object.freeze(view)
}

/** Alice's same declared chronology must survive two independent fresh journals. */
export const assertDeliveryCapstoneFreshReplay = Effect.fn("Test.assertDeliveryCapstoneFreshReplay")(function* (
  first: AuthoredScenarioCassetteRun,
  second: AuthoredScenarioCassetteRun
) {
  expect(firstDifference({ field: "Executing" }, { field: "Suspended" })).toContain('$replay["field"]')
  expect(firstDifference(new Map([["task:A", "Executing"]]), new Map([["task:A", "Suspended"]]))).toContain(
    "Map[0].value"
  )
  const operation = `cassette:${second.runId}:activation:1:operation:3`
  const candidate = {
    _tag: "FreshTaskCandidate",
    runId: second.runId,
    taskId: "A",
    taskRevision: "revision:1",
    id: JSON.stringify(["fresh-task-candidate", second.runId, "A", "revision:1"])
  }
  const normalizedCandidate = {
    ...candidate,
    runId: first.runId,
    id: JSON.stringify(["fresh-task-candidate", first.runId, "A", "revision:1"])
  }
  expect(comparisonValue(candidate, second.runId, first.runId)).toEqual(normalizedCandidate)
  const embeddedCandidate = { freshCandidateId: candidate.id }
  const normalizedEmbeddedCandidate = { freshCandidateId: normalizedCandidate.id }
  expect(comparisonValue(embeddedCandidate, second.runId, first.runId)).toEqual(normalizedEmbeddedCandidate)
  expect(comparisonValue({ arbitraryCandidateId: candidate.id }, second.runId, first.runId)).toEqual({
    arbitraryCandidateId: candidate.id
  })
  for (const id of [
    "arbitrary text",
    '["fresh-task-candidate",',
    JSON.stringify(["other-candidate", second.runId, "A", "revision:1"]),
    JSON.stringify(["fresh-task-candidate", second.runId, "A", "revision:1", "extra"]),
    JSON.stringify(["fresh-task-candidate", "foreignRun", "A", "revision:1"])
  ])
    expect(comparisonValue({ freshCandidateId: id }, second.runId, first.runId)).toEqual({ freshCandidateId: id })
  expect(
    comparisonValue(
      { freshCandidateId: JSON.stringify(["fresh-task-candidate", second.runId, "A", "revision:2"]) },
      second.runId,
      first.runId
    )
  ).not.toEqual(normalizedEmbeddedCandidate)
  const candidateDiagnostic = { exact: JSON.stringify(embeddedCandidate) }
  expect(comparisonValue(candidateDiagnostic, second.runId, first.runId)).toEqual({
    exact: JSON.stringify(normalizedEmbeddedCandidate)
  })
  expect(comparisonValue({ id: candidate.id }, second.runId, first.runId)).toEqual({ id: candidate.id })
  expect(comparisonValue({ ...candidate, id: `arbitrary:${second.runId}` }, second.runId, first.runId)).toEqual({
    ...normalizedCandidate,
    id: `arbitrary:${second.runId}`
  })
  expect(comparisonValue({ ...candidate, taskId: "B" }, second.runId, first.runId)).not.toEqual(normalizedCandidate)
  expect(comparisonValue({ ...candidate, taskRevision: "revision:2" }, second.runId, first.runId)).not.toEqual(
    normalizedCandidate
  )
  expect(comparisonValue({ ...candidate, runId: "foreignRun" }, second.runId, first.runId)).toEqual({
    ...candidate,
    runId: "foreignRun"
  })
  const snapshot = (value: unknown, field: string) => comparisonValue(value, second.runId, first.runId, field)
  const taskSet = snapshot(readonlySetFixture(["A", "B"]), "entryCapableTaskIds")
  expect(snapshot(readonlySetFixture(["A", "B"]), "entryCapableTaskIds")).toEqual(taskSet)
  expect(snapshot(readonlySetFixture(["B", "A"]), "entryCapableTaskIds")).not.toEqual(taskSet)
  expect(snapshot(readonlySetFixture(["A", "C"]), "entryCapableTaskIds")).not.toEqual(taskSet)
  expect(snapshot(readonlySetFixture(["A"]), "entryCapableTaskIds")).not.toEqual(taskSet)
  expect(snapshot(new Set(["A", "B"]), "entryCapableTaskIds")).not.toEqual(taskSet)
  const taskMap = snapshot(
    readonlyMapFixture([
      ["A", "Executing"],
      ["B", "Safe"]
    ]),
    "occupied"
  )
  expect(
    snapshot(
      readonlyMapFixture([
        ["A", "Executing"],
        ["B", "Safe"]
      ]),
      "occupied"
    )
  ).toEqual(taskMap)
  expect(
    snapshot(
      readonlyMapFixture([
        ["B", "Safe"],
        ["A", "Executing"]
      ]),
      "occupied"
    )
  ).not.toEqual(taskMap)
  expect(
    snapshot(
      readonlyMapFixture([
        ["A", "Suspended"],
        ["B", "Safe"]
      ]),
      "occupied"
    )
  ).not.toEqual(taskMap)
  const evidence = { taskId: "A", claimOperationId: operation }
  const referenceEvidence = { taskId: "A", claimOperationId: `cassette:${first.runId}:activation:1:operation:3` }
  expect(snapshot(readonlyMapFixture([[JSON.stringify(["A", operation]), evidence]]), "releaseEvidence")).toEqual(
    comparisonValue(
      readonlyMapFixture([[JSON.stringify(["A", referenceEvidence.claimOperationId]), referenceEvidence]]),
      first.runId,
      first.runId,
      "releaseEvidence"
    )
  )
  expect(snapshot(readonlyMapFixture([[operation, evidence]]), "releaseEvidence")).toEqual({
    collection: "ReadonlyMapFacade",
    size: 1,
    entries: [[operation, referenceEvidence]]
  })
  expect(
    snapshot(
      new Map([
        ["A", "Executing"],
        ["B", "Safe"]
      ]),
      "occupied"
    )
  ).not.toEqual(
    snapshot(
      new Map([
        ["B", "Safe"],
        ["A", "Executing"]
      ]),
      "occupied"
    )
  )
  const revisionFacts = { taskId: "A", operationId: operation, trackerRevision: `authored-completion:A:${operation}` }
  const normalizedRevisionFacts = {
    taskId: "A",
    operationId: `cassette:${first.runId}:activation:1:operation:3`,
    trackerRevision: `authored-completion:A:cassette:${first.runId}:activation:1:operation:3`
  }
  expect(comparisonValue(revisionFacts, second.runId, first.runId)).toEqual(normalizedRevisionFacts)
  expect(comparisonValue({ trackerRevision: revisionFacts.trackerRevision }, second.runId, first.runId)).toEqual({
    trackerRevision: revisionFacts.trackerRevision
  })
  expect(
    comparisonValue({ ...revisionFacts, trackerRevision: `provider:${second.runId}` }, second.runId, first.runId)
  ).toEqual({ ...normalizedRevisionFacts, trackerRevision: `provider:${second.runId}` })
  expect(
    comparisonValue(
      { ...revisionFacts, trackerRevision: revisionFacts.trackerRevision.replace(":operation:3", ":operation:4") },
      second.runId,
      first.runId
    )
  ).not.toEqual(normalizedRevisionFacts)
  const observation = { graphObservationOperationId: operation }
  const normalizedObservation = { graphObservationOperationId: `cassette:${first.runId}:activation:1:operation:3` }
  expect(comparisonValue(observation, second.runId, first.runId)).toEqual(normalizedObservation)
  expect(
    comparisonValue(
      { graphObservationOperationId: operation.replace(":operation:3", ":operation:4") },
      second.runId,
      first.runId
    )
  ).not.toEqual(normalizedObservation)
  expect(comparisonValue({ arbitraryObservationOperationId: operation }, second.runId, first.runId)).toEqual({
    arbitraryObservationOperationId: operation
  })
  const summary = `Read task A · waits for live operation ${operation} · planned by the tracker layer`
  const diagnostic = { summary, exact: JSON.stringify({ waitsForLiveOperationId: operation }) }
  const normalized = comparisonValue(diagnostic, second.runId, first.runId)
  expect(normalized).toEqual({
    summary: `Read task A · waits for live operation cassette:${first.runId}:activation:1:operation:3 · planned by the tracker layer`,
    exact: JSON.stringify({ waitsForLiveOperationId: `cassette:${first.runId}:activation:1:operation:3` })
  })
  expect(comparisonValue({ summary }, second.runId, first.runId)).toEqual({ summary })
  expect(comparisonValue({ detail: operation }, second.runId, first.runId)).toEqual({ detail: operation })
  expect(
    comparisonValue({ ...diagnostic, summary: `${summary} ${second.runId}` }, second.runId, first.runId)
  ).not.toEqual(normalized)
  expect(
    comparisonValue(
      { summary: summary.replace(":operation:3", ":operation:4"), exact: diagnostic.exact },
      second.runId,
      first.runId
    )
  ).not.toEqual(normalized)
  expect(second).not.toBe(first)
  expect(second.records).not.toBe(first.records)
  expect(second.runId).not.toBe(first.runId)
  const firstIdentity = yield* decodeFreshWorkflowRunIdForDiagnostics(first.runId)
  const secondIdentity = yield* decodeFreshWorkflowRunIdForDiagnostics(second.runId)
  expect(secondIdentity.target).toEqual(firstIdentity.target)
  expect(secondIdentity.freshness).not.toBe(firstIdentity.freshness)
  for (const run of [first, second]) {
    expect(run.cassette.story).toHaveLength(declaredStoryLength)
    const occurrences = run.observationCaptures.filter((capture) => capture._tag === "AuthoredStoryOccurrenceCaptured")
    expect(occurrences.map(({ occurrence, storyPosition }) => ({ storyPosition, occurrence }))).toEqual(
      run.cassette.story.map((occurrence, index) => ({ storyPosition: index + 1, occurrence }))
    )
    expect(run.records[0]?.event._tag).toBe("WorkflowRunBegan")
  }
  const actual = comparisonValue(
    comparableRun(second),
    second.runId,
    first.runId,
    "",
    verifiedManifestReferences(second, first.runId)
  )
  const reference = comparisonValue(
    comparableRun(first),
    first.runId,
    first.runId,
    "",
    verifiedManifestReferences(first, first.runId)
  )
  expect(
    actual,
    firstDifference(actual, reference) ?? "No enumerable structural difference; full equality still required"
  ).toEqual(reference)
})
