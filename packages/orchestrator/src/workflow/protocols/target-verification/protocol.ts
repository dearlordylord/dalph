import { Effect, Option, Schema } from "effect"
import {
  targetVerificationCorrelationContradictedRecordKey,
  targetVerificationEvidenceSealedRecordKey,
  targetVerificationIntentRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { EvidenceReference, EvidenceStore } from "./evidence-store.js"
import {
  TargetVerificationBoundary,
  TargetVerificationArtifactName,
  TargetVerificationCorrelation,
  TargetVerificationCorrelationContradictedEvent,
  TargetVerificationEvidenceSealedEvent,
  TargetVerificationIntendedEvent,
  TargetVerificationPlanId,
  type TargetVerificationPlan,
  TargetVerificationRequestId,
  targetVerificationCorrelationEquals,
  targetVerificationCorrelationFor,
  targetVerificationOutcomeFor,
  targetVerificationRequestIdForCandidate,
  type TargetVerificationCandidate,
  type TargetVerificationTerminal
} from "./events.js"
import {
  decodeTargetVerificationManifest,
  encodeTargetVerificationManifest,
  TargetVerificationManifest,
  TargetVerificationManifestArtifact,
  TargetVerificationManifestInvalid
} from "./manifest.js"

/** Configuration changed the selected plan after Dalph durably fixed it in an intent. */
export class TargetVerificationPlanChanged extends Schema.TaggedErrorClass<TargetVerificationPlanChanged>()(
  "TargetVerificationPlanChanged",
  {
    recordedPlanId: TargetVerificationPlanId,
    requestId: TargetVerificationRequestId,
    selectedPlanId: TargetVerificationPlanId
  }
) {}

/** A durable request identity was presented with a different candidate binding. */
export class TargetVerificationIntentContradiction extends Schema.TaggedErrorClass<TargetVerificationIntentContradiction>()(
  "TargetVerificationIntentContradiction",
  { recorded: TargetVerificationCorrelation, requested: TargetVerificationCorrelation }
) {}

/** The configured plan belongs to a different repository/ref target. */
export class TargetVerificationPlanTargetMismatch extends Schema.TaggedErrorClass<TargetVerificationPlanTargetMismatch>()(
  "TargetVerificationPlanTargetMismatch",
  { requestId: TargetVerificationRequestId }
) {}

/** One wrapper report repeated an artifact name and therefore could not form a canonical manifest. */
export class TargetVerificationArtifactNamesContradict extends Schema.TaggedErrorClass<TargetVerificationArtifactNamesContradict>()(
  "TargetVerificationArtifactNamesContradict",
  { artifactName: TargetVerificationArtifactName, requestId: TargetVerificationRequestId }
) {}

/** The durable terminal state consumed by later promotion planning. */
export const TargetVerificationState = Schema.TaggedUnion({
  VerificationContradicted: { expected: TargetVerificationCorrelation, received: TargetVerificationCorrelation },
  VerificationPassed: { correlation: TargetVerificationCorrelation, manifest: EvidenceReference },
  VerificationPending: { correlation: TargetVerificationCorrelation },
  VerificationStopped: {
    correlation: TargetVerificationCorrelation,
    manifest: EvidenceReference,
    outcome: Schema.Literals(["Failed", "Killed", "Partial", "TimedOut"])
  }
})
export type TargetVerificationState = typeof TargetVerificationState.Type

const recordsForRequest = (records: ReadonlyArray<JournalRecord>, requestId: TargetVerificationRequestId) =>
  records.filter((record) => {
    const event = record.event
    if (event._tag === "TargetVerificationCorrelationContradicted") return event.expected.requestId === requestId
    return (
      (event._tag === "TargetVerificationIntended" || event._tag === "TargetVerificationEvidenceSealed") &&
      event.correlation.requestId === requestId
    )
  })

type TargetVerificationTerminalEvent = Extract<
  JournalRecord["event"],
  { readonly _tag: "TargetVerificationCorrelationContradicted" | "TargetVerificationEvidenceSealed" }
>

const isTargetVerificationTerminalRecord = (
  record: JournalRecord
): record is JournalRecord & { readonly event: TargetVerificationTerminalEvent } =>
  record.event._tag === "TargetVerificationEvidenceSealed" ||
  record.event._tag === "TargetVerificationCorrelationContradicted"

const isTargetVerificationIntentRecord = (
  record: JournalRecord
): record is JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TargetVerificationIntended" }>
} => record.event._tag === "TargetVerificationIntended"

const stateFromTerminal = (terminal: TargetVerificationTerminalEvent): TargetVerificationState => {
  if (terminal._tag === "TargetVerificationCorrelationContradicted") {
    return TargetVerificationState.cases.VerificationContradicted.make({
      expected: terminal.expected,
      received: terminal.received
    })
  }
  return terminal.terminal === "Passed"
    ? TargetVerificationState.cases.VerificationPassed.make({
        correlation: terminal.correlation,
        manifest: terminal.manifest
      })
    : TargetVerificationState.cases.VerificationStopped.make({
        correlation: terminal.correlation,
        manifest: terminal.manifest,
        outcome: terminal.terminal
      })
}

const stateFromRecords = (
  records: ReadonlyArray<JournalRecord>,
  requestId: TargetVerificationRequestId
): TargetVerificationState | undefined => {
  const relevant = recordsForRequest(records, requestId)
  const terminal = relevant.findLast(isTargetVerificationTerminalRecord)
  if (terminal !== undefined) return stateFromTerminal(terminal.event)
  const intent = relevant.find(isTargetVerificationIntentRecord)
  return intent !== undefined
    ? TargetVerificationState.cases.VerificationPending.make({ correlation: intent.event.correlation })
    : undefined
}

/** Reconstructs the durable verification state for one exact candidate, without acting. */
export const deriveTargetVerificationState = (
  records: ReadonlyArray<JournalRecord>,
  candidate: TargetVerificationCandidate
): TargetVerificationState | undefined =>
  stateFromRecords(records, targetVerificationRequestIdForCandidate(candidate.correlation.candidateId))

const putAndReconfirmArtifacts = Effect.fn("TargetVerification.putAndReconfirmArtifacts")(function* (
  terminal: TargetVerificationTerminal
) {
  const evidence = yield* EvidenceStore
  const sorted = [...terminal.artifacts].sort((left, right) => left.name.localeCompare(right.name))
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    if (previous !== undefined && current !== undefined && previous.name === current.name) {
      return yield* new TargetVerificationArtifactNamesContradict({
        artifactName: current.name,
        requestId: terminal.correlation.requestId
      })
    }
  }
  const manifested: Array<TargetVerificationManifestArtifact> = []
  for (const artifact of sorted) {
    const reference = yield* evidence.put(artifact.bytes)
    yield* evidence.read(reference)
    manifested.push(TargetVerificationManifestArtifact.make({ name: artifact.name, reference }))
  }
  return manifested
})

const sealManifest = Effect.fn("TargetVerification.sealManifest")(function* (terminal: TargetVerificationTerminal) {
  const evidence = yield* EvidenceStore
  const artifacts = yield* putAndReconfirmArtifacts(terminal)
  const manifest = TargetVerificationManifest.make({
    artifacts,
    correlation: terminal.correlation,
    formatVersion: 1,
    outcome: targetVerificationOutcomeFor(terminal)
  })
  const bytes = yield* encodeTargetVerificationManifest(manifest)
  const reference = yield* evidence.put(bytes)
  const reread = yield* evidence.read(reference)
  const decoded = yield* decodeTargetVerificationManifest(reread, terminal.correlation.requestId)
  if (JSON.stringify(decoded) !== JSON.stringify(manifest)) {
    return yield* new TargetVerificationManifestInvalid({
      detail: "reread manifest differs from the exact bytes Dalph sealed",
      requestId: terminal.correlation.requestId
    })
  }
  return reference
})

const appendContradiction = Effect.fn("TargetVerification.appendContradiction")(function* (
  expected: TargetVerificationCorrelation,
  received: TargetVerificationCorrelation
) {
  const journal = yield* InRunJournal
  yield* journal.append(
    expected.candidateCorrelation.runId,
    targetVerificationCorrelationContradictedRecordKey(expected.requestId),
    TargetVerificationCorrelationContradictedEvent.make({ expected, received, version: workflowJournalEventVersion })
  )
})

type PendingVerificationState = Extract<TargetVerificationState, { readonly _tag: "VerificationPending" }>

const resolveVerificationCorrelation = Effect.fn("TargetVerification.resolveCorrelation")(function* (
  existing: PendingVerificationState | undefined,
  desired: TargetVerificationCorrelation,
  plan: TargetVerificationPlan
) {
  if (existing?.correlation.planId !== undefined && existing.correlation.planId !== plan.planId) {
    return yield* new TargetVerificationPlanChanged({
      recordedPlanId: existing.correlation.planId,
      requestId: desired.requestId,
      selectedPlanId: plan.planId
    })
  }
  const correlation = existing?.correlation ?? desired
  if (!targetVerificationCorrelationEquals(correlation, desired)) {
    return yield* new TargetVerificationIntentContradiction({ recorded: correlation, requested: desired })
  }
  return correlation
})

const runVerificationBoundary = Effect.fn("TargetVerification.runBoundary")(function* (
  correlation: TargetVerificationCorrelation
) {
  const journal = yield* InRunJournal
  const boundary = yield* TargetVerificationBoundary
  const terminal = yield* boundary.runOrResume(correlation)
  if (!targetVerificationCorrelationEquals(terminal.correlation, correlation)) {
    yield* appendContradiction(correlation, terminal.correlation)
    return TargetVerificationState.cases.VerificationContradicted.make({
      expected: correlation,
      received: terminal.correlation
    })
  }
  const manifest = yield* sealManifest(terminal)
  yield* journal.append(
    correlation.candidateCorrelation.runId,
    targetVerificationEvidenceSealedRecordKey(correlation.requestId),
    TargetVerificationEvidenceSealedEvent.make({
      correlation,
      manifest,
      terminal: targetVerificationOutcomeFor(terminal),
      version: workflowJournalEventVersion
    })
  )
  return Option.getOrThrow(
    Option.fromUndefinedOr(
      stateFromRecords(yield* journal.read(correlation.candidateCorrelation.runId), correlation.requestId)
    )
  )
})

/** Runs or reconciles one initial public-wrapper request without an internal retry loop. */
export const runTargetVerification = Effect.fn("TargetVerification.run")(function* (
  candidate: TargetVerificationCandidate,
  plan: TargetVerificationPlan
) {
  const journal = yield* InRunJournal
  const desired = targetVerificationCorrelationFor(candidate, plan.planId)
  const runId = candidate.correlation.runId
  const requestId = targetVerificationRequestIdForCandidate(candidate.correlation.candidateId)
  if (
    plan.target.repository !== candidate.correlation.integrationTarget.repository ||
    plan.target.ref !== candidate.correlation.integrationTarget.ref
  ) {
    return yield* new TargetVerificationPlanTargetMismatch({ requestId })
  }
  const initialRecords = yield* journal.read(runId)
  const existing = stateFromRecords(initialRecords, requestId)
  if (existing !== undefined && existing._tag !== "VerificationPending") return existing
  const correlation = yield* resolveVerificationCorrelation(existing, desired, plan)
  if (existing === undefined) {
    yield* journal.append(
      runId,
      targetVerificationIntentRecordKey(requestId),
      TargetVerificationIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
    )
  }
  return yield* runVerificationBoundary(correlation)
})
