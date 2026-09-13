/* eslint-disable max-lines -- One live evidence schema keeps cross-field validation and publication atomic. */
import {
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  IntegrationTargetRef,
  RunId,
  TaskId
} from "@dalph/contracts"
import {
  GithubIssueNodeId,
  GithubLabelNodeId,
  GithubRepositoryNodeId,
  IntegratorRunOrdinal,
  IntegratorSessionId,
  JournalPosition,
  TargetPromotionRequestId
} from "@dalph/orchestrator"
import { Effect, HashSet, Schema, type Crypto, FileSystem } from "effect"
import { CodexProcessIdentity } from "../application/codex-attempt-store.js"
import { ProductionCliRecord } from "../application/production-cli.js"
import { productionLiveGithubOperationTags } from "./live-github-forwarder.js"
import {
  QualificationArtifactLocator,
  qualificationTranscriptDigest,
  type QualificationPublicationContainer,
  writeQualificationArtifact
} from "./qualification-artifact.js"
import { QualificationBuild, RequiredQualificationFormalProvenance } from "./qualification-provenance.js"

/** Identifies one operator-approved live qualification invocation, not a hermetic fixture. */
export const LiveQualificationInvocationId = Schema.NonEmptyString.pipe(Schema.brand("LiveQualificationInvocationId"))
export type LiveQualificationInvocationId = typeof LiveQualificationInvocationId.Type

/** Wall-clock observation made by the protected controller, encoded as canonical UTC ISO milliseconds. */
export const LiveQualificationObservedTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
).pipe(Schema.brand("LiveQualificationObservedTimestamp"))
export type LiveQualificationObservedTimestamp = typeof LiveQualificationObservedTimestamp.Type

/** Identifies the protected GitHub Actions workflow that admitted the live provider mutations. */
export const GithubActionsWorkflowName = Schema.NonEmptyString.pipe(Schema.brand("GithubActionsWorkflowName"))
/** Identifies one GitHub Actions workflow run, independently of its job. */
export const GithubActionsRunId = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand("GithubActionsRunId"))
/** Identifies the exact job within the admitted workflow run. */
export const GithubActionsJobId = Schema.NonEmptyString.pipe(Schema.brand("GithubActionsJobId"))
/** Identifies the protected environment that released credentials to the live job. */
export const GithubProtectedEnvironmentName = Schema.NonEmptyString.pipe(Schema.brand("GithubProtectedEnvironmentName"))

const GithubActionsHostedProvenance = Schema.Struct({
  sourceSha: GitCommitSha,
  workflow: GithubActionsWorkflowName,
  runId: GithubActionsRunId,
  job: GithubActionsJobId,
  protectedEnvironment: GithubProtectedEnvironmentName
})

const liveQualificationOccurrenceTags = [
  "RunSelected",
  "ClaimAcquired",
  "AttemptPlanned",
  "ExecutorAccepted",
  "IntegrationStarted",
  "CandidateQualified",
  "TargetPromoted",
  "TaskCompleted",
  "ClaimsReleased",
  "RunCompleted"
] as const
const LiveQualificationOccurrenceTag = Schema.Literals(liveQualificationOccurrenceTags)

const responsesBoundaryTags = [
  "ExecutorRequest",
  "ExecutorRequest",
  "ExecutorGitReadHead",
  "IntegratorRequest",
  "IntegratorRequest",
  "IntegratorGitReadHead"
] as const
const ResponsesBoundaryTag = Schema.Literals([
  "ExecutorRequest",
  "ExecutorGitReadHead",
  "IntegratorRequest",
  "IntegratorGitReadHead"
])
const ControllerFinalBoundaryTags = Schema.Tuple([
  Schema.Literal("GitReadTargetHead"),
  Schema.Literal("TaskTrackerReadGraph"),
  Schema.Literal("TaskTrackerReadClaim")
])
const ProcessBoundaryTags = Schema.Tuple([Schema.Literal("Spawn"), Schema.Literal("Exit")])
const GithubOperationTag = Schema.Literals(productionLiveGithubOperationTags)

const ExactResponsesBoundaryTags = Schema.NonEmptyArray(ResponsesBoundaryTag).check(
  Schema.makeFilter((tags) =>
    tags.length === responsesBoundaryTags.length && tags.every((tag, index) => tag === responsesBoundaryTags[index])
      ? undefined
      : "Responses boundary tags must contain the exact request and Git-read chronology"
  )
)

const OperationCount = Schema.Struct({ tag: Schema.NonEmptyString, count: Schema.Int.check(Schema.isGreaterThan(0)) })
const OperationCounts = Schema.NonEmptyArray(OperationCount).check(
  Schema.makeFilter((counts) =>
    uniqueBy(counts, ({ tag }) => tag) ? undefined : "operation counts must contain each observed operation once"
  )
)

const uniqueBy = <A>(values: ReadonlyArray<A>, key: (value: A) => string): boolean => {
  let keys = HashSet.empty<string>()
  for (const value of values) {
    const current = key(value)
    if (HashSet.has(keys, current)) return false
    keys = HashSet.add(keys, current)
  }
  return true
}

const UniqueLabelNodeIds = Schema.NonEmptyArray(GithubLabelNodeId).check(
  Schema.makeFilter((ids) => (uniqueBy(ids, String) ? undefined : "label node IDs must be unique"))
)

const NormalRunProductionCliRecord = ProductionCliRecord.check(
  Schema.makeFilter((record) =>
    record._tag === "Failure" || record._tag === "ApplicationExitDisposition"
      ? "normal Run qualification evidence cannot contain failure or application Exit records"
      : undefined
  )
)

const ExactLiveQualificationOccurrences = Schema.NonEmptyArray(LiveQualificationOccurrenceTag).check(
  Schema.makeFilter((occurrences) =>
    occurrences.length === liveQualificationOccurrenceTags.length &&
    occurrences.every((tag, index) => tag === liveQualificationOccurrenceTags[index])
      ? undefined
      : "live qualification occurrences must be the exact observed normal-Run chronology"
  )
)

const DeliveryEvidence = Schema.Struct({
  runId: RunId,
  taskId: TaskId,
  attemptId: AttemptId,
  baseCommit: GitCommitSha,
  acceptedCommit: GitCommitSha,
  acceptedEvidence: EvidenceReference,
  candidateCommit: GitCommitSha,
  candidateParents: Schema.Tuple([GitCommitSha, GitCommitSha]),
  targetRef: IntegrationTargetRef,
  integration: Schema.Struct({ sessionId: IntegratorSessionId, runOrdinal: IntegratorRunOrdinal }),
  promotionRequestId: TargetPromotionRequestId,
  initialTargetCommit: GitCommitSha,
  finalTargetCommit: GitCommitSha
}).check(
  Schema.makeFilter((delivery) =>
    delivery.candidateParents[0] === delivery.baseCommit &&
    delivery.candidateParents[1] === delivery.acceptedCommit &&
    delivery.initialTargetCommit === delivery.baseCommit &&
    delivery.finalTargetCommit === delivery.candidateCommit
      ? undefined
      : "live delivery evidence must preserve H/C/M and the final target equality"
  )
)

export const LiveCodexAppServerProcessIdentity = CodexProcessIdentity.check(
  Schema.makeFilter((identity) =>
    /^linux:\d+:pid:\d+$/u.test(identity)
      ? undefined
      : "live Codex app-server identity must contain the observed Linux start time and pid"
  )
)

const ResolvedLabel = Schema.TaggedUnion({
  Removed: { nodeId: GithubLabelNodeId },
  AlreadyAbsent: { nodeId: GithubLabelNodeId }
})

const SuccessfulCleanup = Schema.Struct({
  github: Schema.Struct({
    removedIssueNodeId: GithubIssueNodeId,
    resolvedLabels: Schema.Array(ResolvedLabel),
    retained: Schema.Tuple([])
  }),
  local: Schema.TaggedStruct("RemovedFixture", {
    removedResourceCount: Schema.Int.check(Schema.isGreaterThan(0)),
    containerAbsent: Schema.Literal(true),
    retained: Schema.Tuple([])
  })
})

const QualificationCleanup = Schema.TaggedUnion({ Pending: {}, Completed: SuccessfulCleanup.fields })

const productionLiveQualificationEvidenceFields = {
  schemaVersion: Schema.Literal(1),
  scenario: Schema.Literal("ProductionHappy"),
  mode: Schema.Literal("Live"),
  invocationId: LiveQualificationInvocationId,
  startedAt: LiveQualificationObservedTimestamp,
  endedAt: LiveQualificationObservedTimestamp,
  build: QualificationBuild,
  hosted: GithubActionsHostedProvenance,
  formal: RequiredQualificationFormalProvenance,
  fixture: Schema.Struct({
    repositoryNodeId: GithubRepositoryNodeId,
    issueNodeId: GithubIssueNodeId,
    labelNodeIds: UniqueLabelNodeIds
  }),
  composition: Schema.Struct({
    applicationServerProcessIdentities: Schema.NonEmptyArray(LiveCodexAppServerProcessIdentity),
    taskWorktreeCount: Schema.Literal(1),
    integrationTargetCount: Schema.Literal(1)
  }),
  delivery: DeliveryEvidence,
  journal: Schema.Struct({
    positions: Schema.NonEmptyArray(JournalPosition),
    occurrences: ExactLiveQualificationOccurrences,
    orderedEventTags: Schema.NonEmptyArray(Schema.NonEmptyString)
  }).check(
    Schema.makeFilter((journal) =>
      journal.positions.length === journal.orderedEventTags.length
        ? undefined
        : "each observed journal position must have one ordered event tag"
    )
  ),
  orderedBoundaryTags: Schema.Struct({
    shippedGithub: Schema.NonEmptyArray(GithubOperationTag),
    responses: ExactResponsesBoundaryTags,
    controllerFinal: ControllerFinalBoundaryTags,
    process: ProcessBoundaryTags
  }),
  operationCounts: OperationCounts,
  publicRecords: Schema.Struct({ values: Schema.NonEmptyArray(NormalRunProductionCliRecord), digest: EvidenceDigest }),
  final: Schema.Struct({
    tracker: Schema.Struct({ lifecycle: Schema.Literal("Completed"), claims: Schema.Tuple([]) }),
    run: Schema.Struct({ runId: RunId, disposition: Schema.Literal("Completed") }),
    process: Schema.Struct({ status: Schema.Literal(0) })
  })
}

/**
 * Safe success evidence for the single protected live journey. It deliberately
 * contains no worktree, candidate-resource, provider-private session/thread,
 * configuration, environment, provider-response, prompt, or private-store representation.
 */
const PreCleanupProductionLiveQualificationEvidence = Schema.Struct({
  ...productionLiveQualificationEvidenceFields,
  artifactStage: Schema.Literal("PreCleanup"),
  cleanup: QualificationCleanup.cases.Pending
})

const FinalProductionLiveQualificationEvidence = Schema.Struct({
  ...productionLiveQualificationEvidenceFields,
  artifactStage: Schema.Literal("Final"),
  cleanup: QualificationCleanup.cases.Completed
})

export type ProductionLiveQualificationEvidence =
  | typeof PreCleanupProductionLiveQualificationEvidence.Type
  | typeof FinalProductionLiveQualificationEvidence.Type

type ProductionLiveQualificationEvidenceEncoded =
  | typeof PreCleanupProductionLiveQualificationEvidence.Encoded
  | typeof FinalProductionLiveQualificationEvidence.Encoded

type LiveQualificationEvidenceInvariant = (evidence: ProductionLiveQualificationEvidence) => string | undefined

const provenanceBindsOneSourceAndIndependentJobs: LiveQualificationEvidenceInvariant = (evidence) =>
  evidence.hosted.sourceSha === evidence.build.sourceSha &&
  evidence.formal.dedicated.sourceSha === evidence.build.sourceSha &&
  evidence.formal.stressed.sourceSha === evidence.build.sourceSha &&
  evidence.formal.dedicated.job.jobId !== evidence.formal.stressed.job.jobId
    ? undefined
    : "live qualification provenance must bind one source and two independent formal jobs"

const finalityBelongsToDeliveredRun: LiveQualificationEvidenceInvariant = (evidence) =>
  evidence.final.run.runId === evidence.delivery.runId
    ? undefined
    : "live qualification finality must belong to the delivered Run"

const observationsHaveNondecreasingTimestamps: LiveQualificationEvidenceInvariant = (evidence) =>
  evidence.startedAt <= evidence.endedAt ? undefined : "live qualification observations must end at or after they start"

const compositionHasOneApplicationServerProcess: LiveQualificationEvidenceInvariant = (evidence) =>
  evidence.composition.applicationServerProcessIdentities.length === 1
    ? undefined
    : "live qualification must observe exactly one Codex app-server process identity"

const observedOperationTags = (evidence: ProductionLiveQualificationEvidence): ReadonlyArray<string> => [
  ...evidence.journal.orderedEventTags.map((tag) => `JournalEvent.${tag}`),
  ...evidence.publicRecords.values.map(({ _tag }) => `PublicRecord.${_tag}`),
  ...evidence.orderedBoundaryTags.shippedGithub.map((tag) => `ShippedGithub.${tag}`),
  ...evidence.orderedBoundaryTags.responses.map((tag) => `Responses.${tag}`),
  ...evidence.orderedBoundaryTags.controllerFinal.map((tag) => `ControllerFinal.${tag}`),
  ...evidence.orderedBoundaryTags.process.map((tag) => `Process.${tag}`)
]

const operationCountsMatchOrderedObservations: LiveQualificationEvidenceInvariant = (evidence) => {
  const expectedCounts = observedOperationTags(evidence).reduce<Readonly<Record<string, number>>>(
    (counts, tag) => ({ ...counts, [tag]: (counts[tag] ?? 0) + 1 }),
    {}
  )
  const suppliedCounts = Object.fromEntries(evidence.operationCounts.map(({ count, tag }) => [tag, count]))
  return Object.keys(suppliedCounts).length === Object.keys(expectedCounts).length &&
    Object.entries(expectedCounts).every(([tag, count]) => suppliedCounts[tag] === count)
    ? undefined
    : "operation counts must exactly count every ordered journal, public, Responses, and final-controller observation"
}

const expectedGithubMutations = [
  "CreateClaimLabel",
  "CreateClaimLabel",
  "CloseIssue",
  "DeleteClaimLabel",
  "DeleteClaimLabel"
] as const

const githubMutationsMatchAcceptedChronology: LiveQualificationEvidenceInvariant = (evidence) => {
  const githubMutations = evidence.orderedBoundaryTags.shippedGithub.filter(
    (tag) => tag === "CreateClaimLabel" || tag === "CloseIssue" || tag === "DeleteClaimLabel"
  )
  return !evidence.orderedBoundaryTags.shippedGithub.includes("Unrecognized") &&
    JSON.stringify(githubMutations) === JSON.stringify(expectedGithubMutations)
    ? undefined
    : "live qualification must observe exactly the accepted claim, completion, and deletion mutations"
}

const claimRereadsAndFinalityReadAreOrdered: LiveQualificationEvidenceInvariant = (evidence) => {
  const operations = evidence.orderedBoundaryTags.shippedGithub
  const firstCreate = operations.indexOf("CreateClaimLabel")
  const secondCreate = operations.indexOf("CreateClaimLabel", firstCreate + 1)
  const close = operations.indexOf("CloseIssue")
  const finalDelete = operations.lastIndexOf("DeleteClaimLabel")
  const firstClaimReread = operations.indexOf("FindClaimLabel", firstCreate + 1)
  const completionClaimReread = operations.indexOf("FindClaimLabel", secondCreate + 1)
  const laterFinalityRead = operations.indexOf("ReadIssue", finalDelete + 1)
  return firstCreate >= 0 &&
    firstClaimReread > firstCreate &&
    firstClaimReread < secondCreate &&
    completionClaimReread > secondCreate &&
    completionClaimReread < close &&
    laterFinalityRead > finalDelete
    ? undefined
    : "live qualification must reread each claim and perform the later tracker finality read in order"
}

const cleanupMatchesExactFixture: LiveQualificationEvidenceInvariant = (evidence) => {
  if (evidence.cleanup._tag === "Pending") return undefined
  if (evidence.cleanup.github.removedIssueNodeId !== evidence.fixture.issueNodeId) {
    return "live qualification cleanup must remove the exact fixture issue"
  }
  const expectedLabels = evidence.fixture.labelNodeIds.map(String)
  const resolvedLabels = evidence.cleanup.github.resolvedLabels.map(({ nodeId }) => String(nodeId))
  return uniqueBy(evidence.cleanup.github.resolvedLabels, ({ nodeId }) => String(nodeId)) &&
    expectedLabels.length === resolvedLabels.length &&
    expectedLabels.every((nodeId) => resolvedLabels.includes(nodeId))
    ? undefined
    : "live qualification cleanup must resolve every exact fixture label once"
}

const liveQualificationEvidenceInvariants = [
  provenanceBindsOneSourceAndIndependentJobs,
  finalityBelongsToDeliveredRun,
  observationsHaveNondecreasingTimestamps,
  compositionHasOneApplicationServerProcess,
  operationCountsMatchOrderedObservations,
  githubMutationsMatchAcceptedChronology,
  claimRereadsAndFinalityReadAreOrdered,
  cleanupMatchesExactFixture
] as const

const firstLiveQualificationEvidenceViolation: LiveQualificationEvidenceInvariant = (evidence) => {
  for (const validate of liveQualificationEvidenceInvariants) {
    const violation = validate(evidence)
    if (violation !== undefined) return violation
  }
  return undefined
}

export const ProductionLiveQualificationEvidence: Schema.Codec<
  ProductionLiveQualificationEvidence,
  ProductionLiveQualificationEvidenceEncoded
> = Schema.Union([PreCleanupProductionLiveQualificationEvidence, FinalProductionLiveQualificationEvidence]).check(
  Schema.makeFilter(firstLiveQualificationEvidenceViolation)
)

const qualificationFailurePhases = [
  "Setup",
  "Execution",
  "EvidenceValidation",
  "ProvenanceValidation",
  "Cleanup",
  "Publication"
] as const

/** A failed live run cannot carry a partial value that callers could mistake for qualification evidence. */
export const QualificationFailed = Schema.TaggedStruct("QualificationFailed", {
  phase: Schema.Literals(qualificationFailurePhases)
})

const writeValidatedProductionLiveQualificationEvidence = Effect.fn("LiveQualification.writeValidatedEvidence")(
  function* (
    expectedStage: ProductionLiveQualificationEvidence["artifactStage"],
    container: QualificationPublicationContainer,
    locator: QualificationArtifactLocator,
    input: unknown
  ) {
    const evidence = yield* makeProductionLiveQualificationEvidence(input)
    if (evidence.artifactStage !== expectedStage) return yield* Effect.fail(qualificationFailed("EvidenceValidation"))
    const encoded = yield* Schema.encodeUnknownEffect(ProductionLiveQualificationEvidence)(evidence).pipe(
      Effect.mapError(() => qualificationFailed("EvidenceValidation"))
    )
    yield* writeQualificationArtifact(container, locator, JSON.stringify(encoded)).pipe(
      Effect.mapError(() => qualificationFailed("Publication"))
    )
    return evidence
  }
)

const comparableEvidence = (evidence: ProductionLiveQualificationEvidence) => {
  const { artifactStage: _artifactStage, cleanup: _cleanup, ...comparable } = evidence
  return comparable
}

/** Atomically replaces the exact pre-cleanup artifact after factual cleanup, preserving it if publication fails. */
const replacePreCleanupWithFinalEvidence = Effect.fn("LiveQualification.replacePreCleanupEvidence")(function* (
  container: QualificationPublicationContainer,
  locator: QualificationArtifactLocator,
  evidence: Extract<ProductionLiveQualificationEvidence, { readonly artifactStage: "Final" }>
) {
  const fs = yield* FileSystem.FileSystem
  const currentSource = yield* fs
    .readFileString(locator)
    .pipe(Effect.mapError(() => qualificationFailed("Publication")))
  const current = yield* Effect.try({
    try: () => JSON.parse(currentSource),
    catch: () => qualificationFailed("Publication")
  }).pipe(Effect.flatMap(makeProductionLiveQualificationEvidence))
  if (
    current.artifactStage !== "PreCleanup" ||
    JSON.stringify(comparableEvidence(current)) !== JSON.stringify(comparableEvidence(evidence))
  ) {
    return yield* Effect.fail(qualificationFailed("Publication"))
  }
  const encoded = yield* Schema.encodeUnknownEffect(ProductionLiveQualificationEvidence)(evidence).pipe(
    Effect.mapError(() => qualificationFailed("EvidenceValidation"))
  )
  const replacement = QualificationArtifactLocator.make(`${locator}.replacement`)
  yield* writeQualificationArtifact(container, replacement, JSON.stringify(encoded)).pipe(
    Effect.mapError(() => qualificationFailed("Publication"))
  )
  yield* fs.rename(replacement, locator).pipe(Effect.mapError(() => qualificationFailed("Publication")))
})
export type QualificationFailed = typeof QualificationFailed.Type

export const qualificationFailed = (phase: QualificationFailed["phase"]): QualificationFailed =>
  QualificationFailed.make({ phase })

export type ProductionLiveQualificationOutcome =
  | {
      readonly _tag: "Qualified"
      readonly evidence: ProductionLiveQualificationEvidence
      readonly artifact: QualificationArtifactLocator
    }
  | QualificationFailed

const provenanceMatches = (input: unknown): boolean => {
  const decoded = Schema.decodeUnknownOption(
    Schema.Struct({
      build: QualificationBuild,
      hosted: GithubActionsHostedProvenance,
      formal: RequiredQualificationFormalProvenance
    })
  )(input)
  if (decoded._tag === "None") return false
  const { build, formal, hosted } = decoded.value
  return (
    hosted.sourceSha === build.sourceSha &&
    formal.dedicated.sourceSha === build.sourceSha &&
    formal.stressed.sourceSha === build.sourceSha &&
    formal.dedicated.job.jobId !== formal.stressed.job.jobId
  )
}

/** Strictly validates one complete success and independently verifies its canonical public-record digest. */
export const makeProductionLiveQualificationEvidence: (
  input: unknown
) => Effect.Effect<ProductionLiveQualificationEvidence, QualificationFailed, Crypto.Crypto> = Effect.fn(
  "LiveQualification.makeEvidence"
)(function* (input: unknown) {
  if (!provenanceMatches(input)) return yield* Effect.fail(qualificationFailed("ProvenanceValidation"))
  const evidence = yield* Schema.decodeUnknownEffect(ProductionLiveQualificationEvidence, {
    onExcessProperty: "error",
    reportInput: false
  })(input).pipe(Effect.mapError(() => qualificationFailed("EvidenceValidation")))
  const digest = yield* qualificationTranscriptDigest(evidence.publicRecords.values).pipe(
    Effect.mapError(() => qualificationFailed("EvidenceValidation"))
  )
  if (evidence.publicRecords.digest !== digest) return yield* Effect.fail(qualificationFailed("EvidenceValidation"))
  return evidence
})

/** Publishes one validated success once; validation or writing failure never returns partial evidence. */
export const publishProductionLiveQualificationEvidence: (
  container: QualificationPublicationContainer,
  locator: QualificationArtifactLocator,
  input: unknown
) => Effect.Effect<
  Extract<ProductionLiveQualificationOutcome, { readonly _tag: "Qualified" }>,
  QualificationFailed,
  Crypto.Crypto | FileSystem.FileSystem
> = Effect.fn("LiveQualification.publishEvidence")(function* (
  container: QualificationPublicationContainer,
  locator: QualificationArtifactLocator,
  input: unknown
) {
  const evidence = yield* makeProductionLiveQualificationEvidence(input)
  if (evidence.artifactStage !== "Final") return yield* Effect.fail(qualificationFailed("EvidenceValidation"))
  yield* replacePreCleanupWithFinalEvidence(container, locator, evidence)
  return { _tag: "Qualified" as const, evidence, artifact: locator }
})

/** Captures immutable evidence outside Q before any destructive fixture cleanup is authorized. */
export const captureProductionLiveQualificationPreCleanupEvidence: (
  container: QualificationPublicationContainer,
  locator: QualificationArtifactLocator,
  input: unknown
) => Effect.Effect<
  { readonly evidence: ProductionLiveQualificationEvidence; readonly artifact: QualificationArtifactLocator },
  QualificationFailed,
  Crypto.Crypto | FileSystem.FileSystem
> = Effect.fn("LiveQualification.capturePreCleanupEvidence")(function* (
  container: QualificationPublicationContainer,
  locator: QualificationArtifactLocator,
  input: unknown
) {
  const evidence = yield* writeValidatedProductionLiveQualificationEvidence("PreCleanup", container, locator, input)
  return { evidence, artifact: locator }
})
