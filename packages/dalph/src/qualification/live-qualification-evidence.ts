import { AttemptId, EvidenceDigest, EvidenceReference, GitCommitSha, RunId, TaskId } from "@dalph/contracts"
import { GithubIssueNodeId, GithubLabelNodeId, GithubRepositoryNodeId, JournalPosition } from "@dalph/orchestrator"
import { Effect, HashSet, Schema, type Crypto, type FileSystem } from "effect"
import { ProductionCliRecord } from "../application/production-cli.js"
import {
  qualificationTranscriptDigest,
  type QualificationArtifactLocator,
  type QualificationPublicationContainer,
  writeQualificationArtifact
} from "./qualification-artifact.js"
import { QualificationBuild, RequiredQualificationFormalProvenance } from "./qualification-provenance.js"

/** Identifies one operator-approved live qualification invocation, not a hermetic fixture. */
export const LiveQualificationInvocationId = Schema.NonEmptyString.pipe(Schema.brand("LiveQualificationInvocationId"))
export type LiveQualificationInvocationId = typeof LiveQualificationInvocationId.Type

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

const LiveQualificationOccurrenceTag = Schema.Literals([
  "RunSelected",
  "ClaimAcquired",
  "AttemptPlanned",
  "ExecutorAccepted",
  "IntegrationStarted",
  "CandidateQualified",
  "TargetPromoted",
  "TaskCompleted",
  "ClaimsReleased",
  "RunCompleted",
  "ApplicationExited"
])

const LiveQualificationBoundaryTag = Schema.Literals([
  "TaskTracker",
  "Git",
  "Journal",
  "EvidenceStore",
  "Executor",
  "Integrator",
  "TargetPromotion",
  "TaskCompletion",
  "ApplicationExit"
])

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

const NonFailureProductionCliRecord = ProductionCliRecord.check(
  Schema.makeFilter((record) =>
    record._tag === "Failure" ? "live qualification evidence cannot contain a failure record" : undefined
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

const BoundaryCalls = Schema.NonEmptyArray(
  Schema.Struct({ tag: LiveQualificationBoundaryTag, count: Schema.Int.check(Schema.isGreaterThan(0)) })
).check(
  Schema.makeFilter((calls) => (uniqueBy(calls, ({ tag }) => tag) ? undefined : "boundary call tags must be unique"))
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

/**
 * Safe success evidence for the single protected live journey. It deliberately
 * contains no worktree, candidate-resource, session, thread, configuration,
 * environment, provider-response, prompt, or private-store representation.
 */
export const ProductionLiveQualificationEvidence = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  mode: Schema.Literal("Live"),
  invocationId: LiveQualificationInvocationId,
  build: QualificationBuild,
  hosted: GithubActionsHostedProvenance,
  formal: RequiredQualificationFormalProvenance,
  fixture: Schema.Struct({
    repositoryNodeId: GithubRepositoryNodeId,
    issueNodeId: GithubIssueNodeId,
    labelNodeIds: UniqueLabelNodeIds
  }),
  delivery: DeliveryEvidence,
  journal: Schema.Struct({
    positions: Schema.NonEmptyArray(JournalPosition),
    occurrences: Schema.NonEmptyArray(LiveQualificationOccurrenceTag)
  }),
  boundaryCalls: BoundaryCalls,
  publicRecords: Schema.Struct({ values: Schema.NonEmptyArray(NonFailureProductionCliRecord), digest: EvidenceDigest }),
  final: Schema.Struct({
    tracker: Schema.Struct({ lifecycle: Schema.Literal("Completed"), claims: Schema.Tuple([]) }),
    run: Schema.Struct({ runId: RunId, disposition: Schema.Literal("Completed") }),
    application: Schema.Struct({ disposition: Schema.Literal("Succeeded"), status: Schema.Literal(0) })
  }),
  cleanup: SuccessfulCleanup
}).check(
  Schema.makeFilter((evidence) => {
    if (
      evidence.hosted.sourceSha !== evidence.build.sourceSha ||
      evidence.formal.dedicated.sourceSha !== evidence.build.sourceSha ||
      evidence.formal.stressed.sourceSha !== evidence.build.sourceSha ||
      evidence.formal.dedicated.job.jobId === evidence.formal.stressed.job.jobId
    ) {
      return "live qualification provenance must bind one source and two independent formal jobs"
    }
    if (evidence.final.run.runId !== evidence.delivery.runId) {
      return "live qualification finality must belong to the delivered Run"
    }
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
  })
)
export type ProductionLiveQualificationEvidence = typeof ProductionLiveQualificationEvidence.Type

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
  const encoded = yield* Schema.encodeUnknownEffect(ProductionLiveQualificationEvidence)(evidence).pipe(
    Effect.mapError(() => qualificationFailed("EvidenceValidation"))
  )
  yield* writeQualificationArtifact(container, locator, JSON.stringify(encoded)).pipe(
    Effect.mapError(() => qualificationFailed("Publication"))
  )
  return { _tag: "Qualified" as const, evidence, artifact: locator }
})
