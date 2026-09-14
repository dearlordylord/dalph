/* eslint-disable import/no-nodejs-modules, max-lines -- The protected runner owns the complete Q lifecycle. */
/* eslint-disable import-x/no-unused-modules -- Shipped qualification and external test-support consume these boundary contracts outside the production lint graph. */
import nodePath from "node:path"
import { GitCommitSha, GitRepositoryLocator } from "@dalph/contracts"
import {
  GitCommand,
  GithubGraphqlClient,
  defaultGithubGraphqlEndpoint,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner,
  JournalDatabaseLocator,
  JournalStore,
  OperationId,
  TrackerGraphReader,
  TrackerMutation,
  githubDeliveryAuthorityLayer,
  sqliteJournalStoreLayer
} from "@dalph/orchestrator"
import { NodeCrypto } from "@effect/platform-node"
import { Context, Crypto, DateTime, Effect, FileSystem, Layer, Option, Redacted, Ref, Schema } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { ProductionConfigurationLocator } from "../application/production-cli.js"
import {
  decodeProductionRepositoryHostConfiguration,
  type ProductionRepositoryHostConfiguration
} from "../application/production-configuration.js"
import {
  QualificationArtifactLocator,
  QualificationPublicationContainer,
  qualificationTranscriptDigest
} from "./qualification-artifact.js"
import { measureQualificationBuild, RequiredQualificationFormalProvenance } from "./qualification-provenance.js"
import {
  GithubActionsJobId,
  GithubActionsRunId,
  GithubActionsRunAttempt,
  GithubActionsWorkflowName,
  GithubProtectedEnvironmentName,
  LiveCodexAppServerProcessIdentity,
  LiveQualificationInvocationId,
  LiveQualificationObservedTimestamp,
  captureProductionLiveQualificationPreCleanupEvidence,
  publishProductionLiveQualificationEvidence,
  qualificationFailed,
  type QualificationFailed,
  type ProductionLiveQualificationOutcome
} from "./live-qualification-evidence.js"
import { DisposableGithubQualificationResource } from "./disposable-github-qualification-cleanup.js"
import {
  cleanupProductionLiveGithubFixture,
  createProductionLiveGithubFixture,
  makeProductionLiveGithubCleanupAdapter
} from "./live-github-fixture.js"
import {
  cleanupProductionLiveFixture,
  captureProductionLiveLocalIdentity,
  ProductionLiveLocalContainer,
  ProductionLiveLocalFixtureManifest,
  ProductionLiveLocalResource,
  ProductionLiveLocalResourceLocator
} from "./live-fixture-cleanup.js"
import {
  makeProductionLiveQualificationNodeBoundary,
  ProductionLiveBuiltEntry,
  ProductionLiveCodexHome,
  runProductionLiveQualification,
  type ProductionLiveQualificationCompletion
} from "./live-qualification-controller.js"
import { makeProductionLiveGithubForwarder, type ProductionLiveGithubOperationTag } from "./live-github-forwarder.js"
import {
  makeProductionLiveResponsesEndpoint,
  type ProductionLiveResponsesObservation,
  type ProductionLiveResponsesObservationTag
} from "./live-responses-endpoint.js"

const canonicalAbsolute = (subject: string) =>
  Schema.NonEmptyString.check(
    Schema.makeFilter((value) =>
      nodePath.isAbsolute(value) && nodePath.normalize(value) === value ? undefined : `${subject} must be absolute`
    )
  )
const privateDirectoryMode = 0o700
const expectedExecutorTurns = 2
const expectedIntegratorTurns = 2
const expectedTotalTurns = 4
const missingChronologyIndex = -1
const observeLiveQualificationTimestamp = DateTime.now.pipe(
  Effect.map(DateTime.formatIso),
  Effect.flatMap(Schema.decodeUnknownEffect(LiveQualificationObservedTimestamp))
)

const CompletedLiveGithubObservation = Schema.Struct({
  lifecycle: Schema.Literal("CompletedSuccessfully"),
  claim: Schema.Literal("Unclaimed"),
  responses: Schema.Struct({
    counts: Schema.Struct({
      executor: Schema.Literal(expectedExecutorTurns),
      integrator: Schema.Literal(expectedIntegratorTurns),
      total: Schema.Literal(expectedTotalTurns)
    }),
    orderedTags: Schema.Array(
      Schema.Literals(["ExecutorRequest", "ExecutorGitReadHead", "IntegratorRequest", "IntegratorGitReadHead"])
    )
  })
})

class ProductionLiveGitObservationFailure extends Schema.TaggedError<ProductionLiveGitObservationFailure>()(
  "ProductionLiveGitObservationFailure",
  { operation: Schema.Literal("ReadHead") }
) {}

/** Locates the one operator-selected safe manifest file; it is not Q itself. */
export const ProductionLiveQualificationManifestLocator = canonicalAbsolute("live qualification manifest").pipe(
  Schema.brand("ProductionLiveQualificationManifestLocator")
)

/** Safe file-selected instructions for Q; provider credentials are deliberately absent. */
export const ProductionLiveQualificationManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  invocationId: LiveQualificationInvocationId,
  sourceRepository: GitRepositoryLocator.check(
    Schema.makeFilter((value) =>
      nodePath.isAbsolute(value) && nodePath.normalize(value) === value
        ? undefined
        : "source repository must be absolute"
    )
  ),
  sourceBaseSha: GitCommitSha,
  builtEntry: ProductionLiveBuiltEntry,
  lockfile: canonicalAbsolute("lockfile"),
  codexExecutable: canonicalAbsolute("Codex executable"),
  publicationContainer: QualificationPublicationContainer,
  artifact: QualificationArtifactLocator,
  /** Outside-Q destination for an exact, secret-free cleanup or retention report. */
  retentionReport: canonicalAbsolute("retention report"),
  repository: Schema.Struct({ owner: GithubRepositoryOwner, name: GithubRepositoryName }),
  createIssueOperationId: OperationId,
  hosted: Schema.Struct({
    sourceSha: GitCommitSha,
    workflow: GithubActionsWorkflowName,
    runId: GithubActionsRunId,
    runAttempt: GithubActionsRunAttempt,
    job: GithubActionsJobId,
    protectedEnvironment: GithubProtectedEnvironmentName
  }),
  formal: RequiredQualificationFormalProvenance
}).check(
  Schema.makeFilter((value) =>
    value.builtEntry === nodePath.join(value.sourceRepository, "packages/dalph/dist/bin/dalph.js") &&
    value.lockfile === nodePath.join(value.sourceRepository, "pnpm-lock.yaml") &&
    nodePath.dirname(value.retentionReport) === value.publicationContainer &&
    value.retentionReport !== value.artifact
      ? undefined
      : "live qualification must invoke the shipped Dalph entry, use the measured lockfile, and keep distinct outputs"
  )
)
export type ProductionLiveQualificationManifest = typeof ProductionLiveQualificationManifest.Type

/** Rejects excess manifest keys so secrets cannot be smuggled into the safe control document. */
export const decodeProductionLiveQualificationManifest = (input: unknown) =>
  Schema.decodeUnknownEffect(ProductionLiveQualificationManifest, { onExcessProperty: "error", reportInput: false })(
    input
  )

export interface ProductionLiveLocalFixture {
  readonly configuration: ProductionRepositoryHostConfiguration
  readonly configurationPath: ProductionConfigurationLocator
  readonly codexHome: ProductionLiveCodexHome
  readonly initialTargetCommit: GitCommitSha
  readonly applicationServerObservationPath: ProductionLiveLocalResourceLocator
  readonly localManifest: ProductionLiveLocalFixtureManifest
}

class ProductionLiveLocalSetupFailure extends Schema.TaggedError<ProductionLiveLocalSetupFailure>()(
  "ProductionLiveLocalSetupFailure",
  { operation: Schema.NonEmptyString }
) {}

const codexConfiguration = (baseUrl: string, container: string) =>
  [
    'model = "dalph-live-qualification"',
    'model_provider = "dalph-live-qualification"',
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    "",
    "[model_providers.dalph-live-qualification]",
    'name = "Dalph protected live qualification"',
    `base_url = ${JSON.stringify(baseUrl)}`,
    'env_key = "DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL"',
    'wire_api = "responses"',
    "request_max_retries = 0",
    "stream_max_retries = 0",
    "",
    `[projects.${JSON.stringify(container)}]`,
    'trust_level = "trusted"',
    ""
  ].join("\n")

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

const codexAppServerObservationWrapper = (codexExecutable: string, observationPath: string) =>
  [
    "#!/bin/sh",
    "set -eu",
    'test "${1-}" = "app-server"',
    "test -r /proc/self/stat",
    "start_identity=$(awk '{ print $22 }' /proc/$$/stat)",
    `printf 'linux:%s:pid:%s\\n' "$start_identity" "$$" >> ${shellQuote(observationPath)}`,
    `exec ${shellQuote(codexExecutable)} "$@"`,
    ""
  ].join("\n")

/** Creates Q's one local repository and all exact direct-child cleanup receipts. */
export const createProductionLiveLocalFixture = Effect.fn("ProductionLiveQualification.createLocalFixture")(function* (
  manifest: ProductionLiveQualificationManifest,
  targetInput: { readonly owner: string; readonly repository: string; readonly issueNumber: number },
  responsesBaseUrl: string,
  githubGraphqlEndpoint: string,
  githubToken: Redacted.Redacted<string>,
  observeContainer: (container: ProductionLiveLocalContainer) => Effect.Effect<void> = () => Effect.void
) {
  const fs = yield* FileSystem.FileSystem
  const git = yield* GitCommand
  const container = ProductionLiveLocalContainer.make(
    yield* fs.makeTempDirectory({ prefix: `dalph-live-${manifest.invocationId}-` })
  )
  yield* observeContainer(container)
  const at = (name: string) => nodePath.join(container, name)
  const repository = at("repository")
  const journalDatabase = at("journal.sqlite")
  const evidenceStoreRoot = at("evidence")
  const plannedAttemptWorktreeRoot = at("tasks")
  const codexHome = ProductionLiveCodexHome.make(at("codex-home"))
  const codexExecutorPrivateStateDirectory = at("codex-executor-private")
  const codexAppServerObservationPath = ProductionLiveLocalResourceLocator.make(
    nodePath.join(codexExecutorPrivateStateDirectory, "app-server-processes")
  )
  const codexAppServerWrapper = nodePath.join(codexExecutorPrivateStateDirectory, "codex-app-server-observer")
  const integratorCandidateWorktreeRoot = at("candidates")
  const integratorPrivateStore = at("private.json")
  const configurationPath = ProductionConfigurationLocator.make(at("production.json"))
  const manifestPath = at("manifest.json")
  const ownershipMarker = at("ownership.json")
  const runGit = (arguments_: ReadonlyArray<string>) =>
    git
      .runInWorktree(GitRepositoryLocator.make(repository), arguments_)
      .pipe(
        Effect.flatMap((result) =>
          result.exitCode === 0
            ? Effect.succeed(result.stdout.trim())
            : Effect.fail(new ProductionLiveLocalSetupFailure({ operation: `git.${arguments_[0] ?? "unknown"}` }))
        )
      )
  yield* fs.makeDirectory(repository)
  yield* runGit(["init", "--initial-branch=master"])
  yield* runGit(["config", "user.name", "Dalph Live Qualification"])
  yield* runGit(["config", "user.email", "live-qualification@example.invalid"])
  yield* fs.writeFileString(nodePath.join(repository, "README.md"), "Dalph protected live qualification\n")
  yield* runGit(["add", "README.md"])
  yield* runGit(["commit", "-m", "qualification base H"])
  const initialTargetCommit = yield* Schema.decodeUnknownEffect(GitCommitSha)(yield* runGit(["rev-parse", "HEAD"]))
  yield* Effect.forEach(
    [
      evidenceStoreRoot,
      plannedAttemptWorktreeRoot,
      codexHome,
      codexExecutorPrivateStateDirectory,
      integratorCandidateWorktreeRoot
    ],
    (locator) => fs.makeDirectory(locator)
  )
  yield* fs.chmod(codexHome, privateDirectoryMode)
  yield* fs.chmod(codexExecutorPrivateStateDirectory, privateDirectoryMode)
  yield* fs.writeFileString(codexAppServerObservationPath, "")
  yield* fs.writeFileString(
    codexAppServerWrapper,
    codexAppServerObservationWrapper(manifest.codexExecutable, codexAppServerObservationPath)
  )
  yield* fs.chmod(codexAppServerWrapper, privateDirectoryMode)
  yield* fs.writeFileString(journalDatabase, "")
  yield* fs.writeFileString(integratorPrivateStore, "[]\n")
  yield* fs.writeFileString(nodePath.join(codexHome, "config.toml"), codexConfiguration(responsesBaseUrl, container))
  const target = yield* Schema.decodeUnknownEffect(GithubIssueTarget)({
    _tag: "GithubIssue",
    owner: targetInput.owner,
    repository: targetInput.repository,
    issueNumber: targetInput.issueNumber
  })
  const safeDocument = {
    repository,
    githubGraphqlEndpoint,
    commonDirectory: nodePath.join(repository, ".git"),
    integrationRef: "refs/heads/master",
    plannedAttemptBaseSha: initialTargetCommit,
    plannedAttemptExecutor: "codex:live-qualification",
    claimOwner: `dalph:live-qualification:${manifest.invocationId}`,
    taskWorkCapacity: 1,
    journalDatabase,
    evidenceStoreRoot,
    plannedAttemptWorktreeRoot,
    codexExecutorPrivateStateDirectory,
    integratorCandidateWorktreeRoot,
    integratorPrivateStore,
    activationInterval: "1 second",
    failureCooldown: "1 second",
    codexExecutable: codexAppServerWrapper,
    codexClientName: "dalph-live-qualification",
    codexClientVersion: "1"
  }
  const configuration = yield* decodeProductionRepositoryHostConfiguration({
    ...safeDocument,
    target,
    githubToken: Redacted.value(githubToken)
  })
  yield* fs.writeFileString(configurationPath, JSON.stringify(safeDocument))
  yield* fs.writeFileString(
    manifestPath,
    JSON.stringify({ schemaVersion: 1, invocationId: manifest.invocationId, repository: targetInput })
  )
  yield* fs.writeFileString(ownershipMarker, JSON.stringify({ invocationId: manifest.invocationId }))
  const resourceInputs = [
    ["Repository", repository],
    ["JournalDatabase", journalDatabase],
    ["EvidenceRoot", evidenceStoreRoot],
    ["AttemptWorktreeRoot", plannedAttemptWorktreeRoot],
    ["CodexHome", codexHome],
    ["CodexExecutorPrivateStateDirectory", codexExecutorPrivateStateDirectory],
    ["CandidateRoot", integratorCandidateWorktreeRoot],
    ["ExpectedAtomicReplacement", integratorPrivateStore],
    ["ConfigurationDocument", configurationPath],
    ["ManifestDocument", manifestPath],
    ["OwnershipMarker", ownershipMarker]
  ] as const
  const resources = yield* Effect.forEach(resourceInputs, ([tag, locator]) =>
    Effect.gen(function* () {
      return yield* Schema.decodeUnknownEffect(ProductionLiveLocalResource)({
        _tag: tag,
        locator,
        identity: yield* captureProductionLiveLocalIdentity(locator)
      })
    })
  )
  const localManifest = ProductionLiveLocalFixtureManifest.make({
    invocationId: manifest.invocationId,
    container: { locator: container, identity: yield* captureProductionLiveLocalIdentity(container) },
    resources
  })
  return {
    configuration,
    configurationPath,
    codexHome,
    initialTargetCommit,
    applicationServerObservationPath: codexAppServerObservationPath,
    localManifest
  } satisfies ProductionLiveLocalFixture
})

export interface ProductionLiveQualificationSecrets {
  readonly githubToken: Redacted.Redacted<string>
}

interface ProductionLiveQualificationRedactionSecrets extends ProductionLiveQualificationSecrets {
  readonly controlledProviderCredential: Redacted.Redacted<string>
}

const controlledProviderCredentialByteLength = 32
const controlledProviderCredentialHexRadix = 16
const controlledProviderCredentialHexWidth = 2

/** Generates one invocation-local credential for the loopback provider; it is never persisted or logged. */
export const generateProductionLiveControlledProviderCredential = Effect.fn(
  "ProductionLiveQualification.generateControlledProviderCredential"
)(function* () {
  const crypto = yield* Crypto.Crypto
  return yield* crypto
    .randomBytes(controlledProviderCredentialByteLength)
    .pipe(
      Effect.map((bytes) =>
        Redacted.make(
          Array.from(bytes, (byte) =>
            byte.toString(controlledProviderCredentialHexRadix).padStart(controlledProviderCredentialHexWidth, "0")
          ).join("")
        )
      )
    )
})

const liveOccurrenceTags = [
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

const eventIndices = (journal: ProductionLiveQualificationCompletion["facts"]["journal"], tag: string) =>
  journal.flatMap(({ event }, index) => (event._tag === tag ? [index] : []))

interface ProductionLiveQualificationChronologyObservation {
  readonly selectedCount: number
  readonly completedDispositionCount: number
  readonly applicationExitDispositionCount: number
  readonly orderedJournalIndices: ReadonlyArray<ReadonlyArray<number>>
  readonly processStatus: number
}

/** Ordered calls observed outside the shipped child, including its controlled Responses endpoint. */
export const productionLiveQualificationBoundaryObservations = (
  shippedGithub: ReadonlyArray<ProductionLiveGithubOperationTag>,
  responses: ReadonlyArray<ProductionLiveResponsesObservationTag>
) => ({
  shippedGithub,
  responses,
  controllerFinal: ["GitReadTargetHead", "TaskTrackerReadGraph", "TaskTrackerReadClaim"] as const,
  process: ["Spawn", "Exit"] as const
})

/** Counts each concrete observed operation tag; it does not substitute boundary-family aggregates. */
export const productionLiveQualificationOperationCounts = (
  journalEventTags: ReadonlyArray<string>,
  publicRecordTags: ReadonlyArray<string>,
  boundaries: ReturnType<typeof productionLiveQualificationBoundaryObservations>
) => {
  const operationTags = [
    ...journalEventTags.map((tag) => `JournalEvent.${tag}`),
    ...publicRecordTags.map((tag) => `PublicRecord.${tag}`),
    ...boundaries.shippedGithub.map((tag) => `ShippedGithub.${tag}`),
    ...boundaries.responses.map((tag) => `Responses.${tag}`),
    ...boundaries.controllerFinal.map((tag) => `ControllerFinal.${tag}`),
    ...boundaries.process.map((tag) => `Process.${tag}`)
  ]
  return Object.entries(
    operationTags.reduce<Readonly<Record<string, number>>>(
      (counts, tag) => ({ ...counts, [tag]: (counts[tag] ?? 0) + 1 }),
      {}
    )
  ).map(([tag, count]) => ({ tag, count }))
}

/** Exact chronology rejects a missing, duplicate, reordered, or non-completed source event. */
export const productionLiveQualificationChronologyIsExact = (
  observation: ProductionLiveQualificationChronologyObservation
) =>
  observation.selectedCount === 1 &&
  observation.completedDispositionCount === 1 &&
  observation.applicationExitDispositionCount === 0 &&
  observation.processStatus === 0 &&
  observation.orderedJournalIndices.every(
    (indices, index) =>
      indices.length === 1 &&
      (index === 0 ||
        (observation.orderedJournalIndices[index - 1]?.[0] ?? missingChronologyIndex) <
          (indices[0] ?? missingChronologyIndex))
  )

/** Derives chronology and call counts only from exact public and owning-boundary observations. */
export const deriveProductionLiveQualificationEvidenceObservations = (
  completion: ProductionLiveQualificationCompletion,
  shippedGithub: ReadonlyArray<ProductionLiveGithubOperationTag>,
  responses: ProductionLiveResponsesObservation
) => {
  const journal = completion.facts.journal
  const accepted = journal.flatMap(({ event }, index) =>
    event._tag === "PlannedAttemptExecutorWorkReported" &&
    event.report._tag === "ExecutorWorkTerminal" &&
    event.report.result._tag === "Accepted"
      ? [index]
      : []
  )
  const prepared = journal.flatMap(({ event }, index) =>
    event._tag === "IntegratorRunResultRecorded" && event.result._tag === "PreparedCandidate" ? [index] : []
  )
  const completed = journal.flatMap(({ event }, index) =>
    event._tag === "WorkflowRunTerminated" && event.disposition === "Completed" ? [index] : []
  )
  const selected = completion.records.flatMap((record, index) => (record._tag === "RunSelected" ? [index] : []))
  const disposition = completion.records.flatMap((record, index) =>
    record._tag === "RunDisposition" && record.runId === completion.runId && record.disposition === "Completed"
      ? [index]
      : []
  )
  const required = [
    eventIndices(journal, "TaskClaimAcquired"),
    eventIndices(journal, "TaskAttemptPlanned"),
    accepted,
    eventIndices(journal, "IntegrationStarted"),
    prepared,
    eventIndices(journal, "TargetPromotionObservedSuccess"),
    eventIndices(journal, "CompletionTaskAcknowledged"),
    eventIndices(journal, "TaskClaimReleased"),
    eventIndices(journal, "CompletionClaimDeleted"),
    completed
  ]
  if (
    !productionLiveQualificationChronologyIsExact({
      selectedCount: selected.length,
      completedDispositionCount: disposition.length,
      applicationExitDispositionCount: completion.records.filter(({ _tag }) => _tag === "ApplicationExitDisposition")
        .length,
      orderedJournalIndices: required,
      processStatus: completion.processStatus
    }) ||
    shippedGithub.length <= 0
  )
    return Option.none()
  const final = Schema.decodeUnknownOption(CompletedLiveGithubObservation)(completion.facts.github)
  if (Option.isNone(final)) return Option.none()
  const gitObservationTags = new Set([
    "PlannedAttemptWorktreeObserved",
    "TargetLineageObserved",
    "IntegratorRunCandidateGitObserved",
    "CompletionTaskCandidateAncestryObserved"
  ])
  const observedGitReads = journal.filter(({ event }) => gitObservationTags.has(event._tag)).length
  if (observedGitReads === 0) return Option.none()
  const journalEventTags = journal.map(({ event }) => event._tag)
  const orderedBoundaryTags = productionLiveQualificationBoundaryObservations(shippedGithub, responses.orderedTags)
  const operationCounts = productionLiveQualificationOperationCounts(
    journalEventTags,
    completion.records.map(({ _tag }) => _tag),
    orderedBoundaryTags
  )
  return Option.some({
    occurrences: liveOccurrenceTags,
    journalEventTags,
    selectedRunsCompleted: true as const,
    orderedBoundaryTags,
    operationCounts
  })
}

const readApplicationServerProcessIdentities = Effect.fn(
  "ProductionLiveQualification.readApplicationServerProcessIdentities"
)(function* (fixture: ProductionLiveLocalFixture) {
  const fs = yield* FileSystem.FileSystem
  const source = yield* fs.readFileString(fixture.applicationServerObservationPath)
  return yield* Effect.forEach(
    source.split("\n").filter((line) => line.length > 0),
    (line) => Schema.decodeUnknownEffect(LiveCodexAppServerProcessIdentity)(line)
  )
})

const exactPlannedAttempt = (completion: ProductionLiveQualificationCompletion) => {
  const record = exactOne(completion.facts.journal.filter(({ event }) => event._tag === "TaskAttemptPlanned"))
  return record?.event._tag === "TaskAttemptPlanned" ? record.event.operation.plannedAttempt : undefined
}

const exactAcceptedResult = (completion: ProductionLiveQualificationCompletion) => {
  const record = exactOne(
    completion.facts.journal.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report._tag === "ExecutorWorkTerminal" &&
        event.report.result._tag === "Accepted"
    )
  )
  return record?.event._tag === "PlannedAttemptExecutorWorkReported" &&
    record.event.report._tag === "ExecutorWorkTerminal" &&
    record.event.report.result._tag === "Accepted"
    ? record.event.report.result.acceptedResult
    : undefined
}

const exactPromotion = (completion: ProductionLiveQualificationCompletion) => {
  const record = exactOne(completion.facts.journal.filter(({ event }) => event._tag === "TargetPromotionIntended"))
  return record?.event._tag === "TargetPromotionIntended" ? record.event.correlation : undefined
}

const hasExactCompletedTermination = (completion: ProductionLiveQualificationCompletion) => {
  const record = exactOne(completion.facts.journal.filter(({ event }) => event._tag === "WorkflowRunTerminated"))
  return record?.event._tag === "WorkflowRunTerminated" && record.event.disposition === "Completed"
}

const exactCompletionFacts = (completion: ProductionLiveQualificationCompletion) => {
  const planned = exactPlannedAttempt(completion)
  const accepted = exactAcceptedResult(completion)
  const promotion = exactPromotion(completion)
  if (
    planned === undefined ||
    accepted === undefined ||
    promotion === undefined ||
    !hasExactCompletedTermination(completion)
  )
    return Option.none()
  return Option.some({
    planned,
    accepted,
    candidate: promotion.qualifiedCandidate,
    promotionRequestId: promotion.requestId
  })
}

const observeExactCompletedQualification = Effect.fn("ProductionLiveQualification.observeExactCompleted")(function* (
  fixture: ProductionLiveLocalFixture,
  forwarder: Effect.Success<ReturnType<typeof makeProductionLiveGithubForwarder>>,
  completion: ProductionLiveQualificationCompletion
) {
  const facts = exactCompletionFacts(completion)
  if (Option.isNone(facts)) return yield* Effect.fail(qualificationFailed("EvidenceValidation"))
  const applicationServerProcessIdentities = yield* readApplicationServerProcessIdentities(fixture).pipe(
    Effect.mapError(() => qualificationFailed("EvidenceValidation"))
  )
  const githubFinal = Schema.decodeUnknownOption(CompletedLiveGithubObservation)(completion.facts.github)
  if (
    Option.isNone(githubFinal) ||
    completion.facts.applicationServerCount !== 1 ||
    applicationServerProcessIdentities.length !== 1
  )
    return yield* Effect.fail(qualificationFailed("EvidenceValidation"))
  const forwardObservation = yield* forwarder.observation
  const evidence = deriveProductionLiveQualificationEvidenceObservations(
    completion,
    forwardObservation.orderedOperations,
    githubFinal.value.responses
  )
  if (forwardObservation.createdLabels.length === 0 || Option.isNone(evidence))
    return yield* Effect.fail(qualificationFailed("EvidenceValidation"))
  return { ...facts.value, applicationServerProcessIdentities, forwardObservation, evidence: evidence.value }
})

const publishCompletedQualification = Effect.fn("ProductionLiveQualification.publishCompleted")(function* (
  manifest: ProductionLiveQualificationManifest,
  fixture: ProductionLiveLocalFixture,
  githubFixture: Effect.Success<ReturnType<typeof createProductionLiveGithubFixture>>,
  forwarder: Effect.Success<ReturnType<typeof makeProductionLiveGithubForwarder>>,
  build: Effect.Success<ReturnType<typeof measureQualificationBuild>>,
  completion: ProductionLiveQualificationCompletion,
  startedAt: LiveQualificationObservedTimestamp,
  cleanupState: {
    github?: Effect.Success<ReturnType<typeof cleanupProductionLiveGithubFixture>>
    local?: Effect.Success<ReturnType<typeof cleanupProductionLiveFixture>>
  }
) {
  const observation = yield* observeExactCompletedQualification(fixture, forwarder, completion)
  const labelResources = observation.forwardObservation.createdLabels.map(({ fingerprint, name, nodeId }) =>
    DisposableGithubQualificationResource.cases.Label.make({ nodeId, name, fingerprint })
  )
  const githubManifest = {
    ...githubFixture.manifest,
    resources: [...githubFixture.manifest.resources, ...labelResources]
  }
  const publicDigest = yield* qualificationTranscriptDigest(completion.records)
  const endedAt = yield* observeLiveQualificationTimestamp.pipe(
    Effect.mapError(() => qualificationFailed("EvidenceValidation"))
  )
  const evidenceBeforeCleanup = {
    schemaVersion: 1,
    artifactStage: "PreCleanup",
    scenario: "ProductionHappy",
    mode: "Live",
    invocationId: manifest.invocationId,
    startedAt,
    endedAt,
    build,
    hosted: manifest.hosted,
    formal: manifest.formal,
    fixture: {
      repositoryNodeId: githubFixture.manifest.repository.nodeId,
      issueNodeId: githubFixture.issue.nodeId,
      labelNodeIds: labelResources.map(({ nodeId }) => nodeId)
    },
    composition: {
      applicationServerProcessIdentities: observation.applicationServerProcessIdentities,
      taskWorktreeCount: 1,
      integrationTargetCount: 1
    },
    delivery: {
      runId: completion.runId,
      taskId: observation.planned.taskId,
      attemptId: observation.planned.attemptId,
      baseCommit: observation.planned.baseSha,
      acceptedCommit: observation.accepted.commit,
      acceptedEvidence: observation.accepted.evidenceManifest,
      candidateCommit: observation.candidate.candidateCommit,
      candidateParents: observation.candidate.directParents,
      targetRef: observation.candidate.run.session.integrationTarget.ref,
      integration: {
        sessionId: observation.candidate.run.session.sessionId,
        runOrdinal: observation.candidate.run.ordinal
      },
      promotionRequestId: observation.promotionRequestId,
      initialTargetCommit: fixture.initialTargetCommit,
      finalTargetCommit: completion.facts.targetHead
    },
    journal: {
      positions: completion.facts.journal.map(({ position }) => position),
      occurrences: observation.evidence.occurrences,
      orderedEventTags: observation.evidence.journalEventTags
    },
    orderedBoundaryTags: observation.evidence.orderedBoundaryTags,
    operationCounts: observation.evidence.operationCounts,
    publicRecords: { values: completion.records, digest: publicDigest },
    final: {
      tracker: { lifecycle: "Completed", claims: [] },
      run: { runId: completion.runId, disposition: "Completed" },
      process: { status: 0 }
    },
    cleanup: { _tag: "Pending" }
  } as const
  yield* captureProductionLiveQualificationPreCleanupEvidence(
    manifest.publicationContainer,
    manifest.artifact,
    evidenceBeforeCleanup
  )
  const cleanup = yield* collectCompletedCleanupReceipt(
    manifest,
    fixture,
    githubManifest,
    labelResources,
    observation.evidence.selectedRunsCompleted,
    cleanupState
  )
  return yield* publishProductionLiveQualificationEvidence(manifest.publicationContainer, manifest.artifact, {
    ...evidenceBeforeCleanup,
    artifactStage: "Final",
    cleanup
  })
})

const exactOne = <A>(values: ReadonlyArray<A>): A | undefined => (values.length === 1 ? values[0] : undefined)

const safeRecord = (secrets: ProductionLiveQualificationRedactionSecrets, record: unknown) => {
  const encoded = JSON.stringify(record)
  return encoded.includes(Redacted.value(secrets.githubToken)) ||
    encoded.includes(Redacted.value(secrets.controlledProviderCredential))
    ? Effect.fail(qualificationFailed("EvidenceValidation"))
    : Effect.void
}

const githubReadCommand = (nodeId: string) =>
  `gh api graphql -f query='query($id: ID!) { node(id: $id) { id __typename } }' -f id='${nodeId.replaceAll("'", "'\\''")}'`

/** Exact outside-Q report emitted for every non-qualified result. */
export const ProductionLiveQualificationRetentionReport = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  invocationId: LiveQualificationInvocationId,
  outcome: Schema.Literal("NotQualified"),
  phase: Schema.Literals([
    "Setup",
    "Execution",
    "EvidenceValidation",
    "ProvenanceValidation",
    "Cleanup",
    "Publication"
  ]),
  github: Schema.Array(
    Schema.Struct({
      _tag: Schema.Literals(["Issue", "Label"]),
      nodeId: Schema.NonEmptyString,
      disposition: Schema.Literals(["Removed", "AlreadyAbsent", "Retained"]),
      manualCommand: Schema.NonEmptyString
    })
  ),
  local: Schema.Array(
    Schema.Struct({
      locator: Schema.NonEmptyString,
      disposition: Schema.Literals(["Removed", "Retained"]),
      manualCommand: Schema.NonEmptyString
    })
  )
})

type GithubFixture = Effect.Success<ReturnType<typeof createProductionLiveGithubFixture>>
type GithubForwarder = Effect.Success<ReturnType<typeof makeProductionLiveGithubForwarder>>
type GithubCleanup = Effect.Success<ReturnType<typeof cleanupProductionLiveGithubFixture>>
type LocalCleanup = Effect.Success<ReturnType<typeof cleanupProductionLiveFixture>>

const collectCompletedCleanupReceipt = Effect.fn("ProductionLiveQualification.collectCompletedCleanupReceipt")(
  function* (
    manifest: ProductionLiveQualificationManifest,
    fixture: ProductionLiveLocalFixture,
    githubManifest: GithubFixture["manifest"],
    labelResources: ReadonlyArray<DisposableGithubQualificationResource & { readonly _tag: "Label" }>,
    selectedRunsCompleted: boolean,
    cleanupState: { github?: GithubCleanup; local?: LocalCleanup }
  ) {
    const cleanupAdapter = yield* makeProductionLiveGithubCleanupAdapter(manifest.invocationId)
    const githubCleanup = yield* cleanupProductionLiveGithubFixture(
      githubManifest,
      { invocationId: manifest.invocationId, repository: githubManifest.repository },
      cleanupAdapter
    )
    // eslint-disable-next-line functional/immutable-data -- Retention reporting must retain the last observed partial cleanup receipt if a later boundary fails.
    cleanupState.github = githubCleanup
    const localCleanup = yield* cleanupProductionLiveFixture(fixture.localManifest, {
      invocationId: manifest.invocationId,
      ownedChildrenStopped: Effect.succeed(true),
      selectedRunsCompleted: Effect.succeed(selectedRunsCompleted)
    })
    // eslint-disable-next-line functional/immutable-data -- Retention reporting must retain the last observed partial cleanup receipt if evidence publication fails.
    cleanupState.local = localCleanup
    if (githubCleanup.retained.length > 0 || localCleanup._tag !== "Removed" || localCleanup.retained.length > 0)
      return yield* Effect.fail(qualificationFailed("Cleanup"))
    const removedIssue = githubCleanup.removed.find((resource) => resource._tag === "Issue")
    if (removedIssue?._tag !== "Issue") return yield* Effect.fail(qualificationFailed("Cleanup"))
    const resolvedLabels = labelResources.map(({ nodeId }) => ({
      _tag: githubCleanup.removed.some((resource) => resource._tag === "Label" && resource.nodeId === nodeId)
        ? ("Removed" as const)
        : ("AlreadyAbsent" as const),
      nodeId
    }))
    return {
      _tag: "Completed" as const,
      github: { removedIssueNodeId: removedIssue.nodeId, resolvedLabels, retained: [] },
      local: {
        _tag: "RemovedFixture" as const,
        removedResourceCount: localCleanup.removed.length,
        containerAbsent: true as const,
        retained: []
      }
    }
  }
)

const observeCreatedLabels = (forwarder: GithubForwarder | undefined) =>
  forwarder === undefined
    ? Effect.succeed([])
    : forwarder.observation.pipe(Effect.map(({ createdLabels }) => createdLabels))

const githubResourceDisposition = (cleanup: GithubCleanup | undefined, nodeId: string) => {
  if (cleanup?.removed.some((resource) => resource.nodeId === nodeId)) return "Removed" as const
  if (cleanup?.alreadyAbsent.some((resource) => resource.nodeId === nodeId)) return "AlreadyAbsent" as const
  return "Retained" as const
}

const removedLocalContainerReport = (
  cleanup: LocalCleanup | undefined,
  fixture: ProductionLiveLocalFixture | undefined
) => {
  if (cleanup?._tag !== "Removed" || fixture === undefined) return []
  const locator = fixture.localManifest.container.locator
  return [{ locator, disposition: "Removed" as const, manualCommand: `stat -- '${locator.replaceAll("'", "'\\''")}'` }]
}

const removedLocalResourceReports = (
  cleanup: LocalCleanup | undefined,
  fixture: ProductionLiveLocalFixture | undefined
) => {
  if (fixture === undefined) return []
  const removed = new Set(cleanup?.removed.map(({ locator }) => locator) ?? [])
  return fixture.localManifest.resources
    .filter(({ locator }) => removed.has(locator))
    .map(({ locator }) => ({ locator, disposition: "Removed" as const, manualCommand: `stat -- '${locator}'` }))
}

const retainedLocalReports = (cleanup: LocalCleanup | undefined, fixture: ProductionLiveLocalFixture | undefined) => {
  if (cleanup !== undefined)
    return cleanup.retained.map(({ locator, manualCommand }) => ({
      locator,
      disposition: "Retained" as const,
      manualCommand
    }))
  if (fixture === undefined) return []
  const container = fixture.localManifest.container.locator
  return [
    {
      locator: container,
      disposition: "Retained" as const,
      manualCommand: `find '${container.replaceAll("'", "'\\''")}' -mindepth 1 -maxdepth 1 -print`
    },
    ...fixture.localManifest.resources.map(({ locator }) => ({
      locator,
      disposition: "Retained" as const,
      manualCommand: `stat -- '${locator.replaceAll("'", "'\\''")}'`
    }))
  ]
}

const localContainerFallbackReport = (
  fixture: ProductionLiveLocalFixture | undefined,
  container: ProductionLiveLocalContainer | undefined
) => {
  if (fixture !== undefined || container === undefined) return []
  return [
    {
      locator: container,
      disposition: "Retained" as const,
      manualCommand: `find '${container.replaceAll("'", "'\\''")}' -mindepth 1 -maxdepth 1 -print`
    }
  ]
}

export const writeProductionLiveQualificationFailureRetentionReport = Effect.fn(
  "ProductionLiveQualification.writeRetentionReport"
)(function* (
  manifest: ProductionLiveQualificationManifest,
  phase: QualificationFailed["phase"],
  githubFixture: GithubFixture | undefined,
  forwarder: GithubForwarder | undefined,
  localFixture: ProductionLiveLocalFixture | undefined,
  localContainer: ProductionLiveLocalContainer | undefined,
  cleanupState: { github?: GithubCleanup; local?: LocalCleanup }
) {
  const fs = yield* FileSystem.FileSystem
  const githubCleanup = cleanupState.github
  const observedLabels = yield* observeCreatedLabels(forwarder)
  const labelResources = observedLabels.map(({ fingerprint, name, nodeId }) =>
    DisposableGithubQualificationResource.cases.Label.make({ nodeId, name, fingerprint })
  )
  const githubResources = githubFixture === undefined ? [] : [...githubFixture.manifest.resources, ...labelResources]
  const localCleanup = cleanupState.local
  const report = yield* Schema.decodeUnknownEffect(ProductionLiveQualificationRetentionReport, {
    onExcessProperty: "error",
    reportInput: false
  })({
    schemaVersion: 1,
    invocationId: manifest.invocationId,
    outcome: "NotQualified",
    phase,
    github: githubResources.map((resource) => ({
      _tag: resource._tag,
      nodeId: resource.nodeId,
      disposition: githubResourceDisposition(githubCleanup, resource.nodeId),
      manualCommand: githubReadCommand(resource.nodeId)
    })),
    local: [
      ...removedLocalContainerReport(localCleanup, localFixture),
      ...removedLocalResourceReports(localCleanup, localFixture),
      ...retainedLocalReports(localCleanup, localFixture),
      ...localContainerFallbackReport(localFixture, localContainer)
    ]
  })
  yield* fs.writeFileString(manifest.retentionReport, JSON.stringify(report))
})

/**
 * Runs Alice's one protected journey through the shipped CLI. The real GitHub
 * client creates Q, the child uses the Q forwarding endpoint, and every
 * completion fact is reread from GitHub, Git, and SQLite before cleanup.
 */
export const runProductionLiveQualificationRuntime = Effect.fn("ProductionLiveQualification.runRuntime")(function* (
  manifest: ProductionLiveQualificationManifest,
  secrets: ProductionLiveQualificationSecrets
) {
  const startedAt = yield* observeLiveQualificationTimestamp
  let githubFixture: GithubFixture | undefined
  let forwarder: GithubForwarder | undefined
  let local: ProductionLiveLocalFixture | undefined
  let localContainer: ProductionLiveLocalContainer | undefined
  const cleanupState: { github?: GithubCleanup; local?: LocalCleanup } = {}
  const git = yield* GitCommand
  const fs = yield* FileSystem.FileSystem
  const crypto = yield* Crypto.Crypto
  const githubClient = yield* GithubGraphqlClient
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const controlledProviderCredential = yield* generateProductionLiveControlledProviderCredential()
  const redactionSecrets = { ...secrets, controlledProviderCredential }
  const attempt = yield* Effect.gen(function* () {
    const createdGithubFixture = yield* createProductionLiveGithubFixture({
      invocationId: manifest.invocationId,
      repository: manifest.repository,
      createIssueOperationId: manifest.createIssueOperationId
    })
    githubFixture = createdGithubFixture
    const runningForwarder = yield* makeProductionLiveGithubForwarder(defaultGithubGraphqlEndpoint)
    forwarder = runningForwarder
    const responses = yield* makeProductionLiveResponsesEndpoint((worktree) =>
      git
        .runInWorktree(GitRepositoryLocator.make(worktree), ["rev-parse", "HEAD"])
        .pipe(
          Effect.flatMap((result) =>
            result.exitCode === 0
              ? Effect.succeed(result.stdout.trim())
              : Effect.fail(new ProductionLiveGitObservationFailure({ operation: "ReadHead" }))
          )
        )
    )
    local = yield* createProductionLiveLocalFixture(
      manifest,
      {
        owner: manifest.repository.owner,
        repository: manifest.repository.name,
        issueNumber: createdGithubFixture.issue.number
      },
      responses.baseUrl,
      runningForwarder.endpoint,
      secrets.githubToken,
      (container) =>
        Effect.sync(() => {
          localContainer = container
        })
    )
    const fixture = local
    const build = yield* measureQualificationBuild(manifest.sourceRepository, manifest.sourceBaseSha, {
      builtEntry: manifest.builtEntry,
      lockfile: manifest.lockfile,
      configuration: fixture.configurationPath
    }).pipe(Effect.mapError(() => qualificationFailed("Setup")))
    const qualified = yield* Ref.make<ProductionLiveQualificationOutcome>(qualificationFailed("Execution"))
    const githubAuthorities = yield* Layer.build(
      githubDeliveryAuthorityLayer.pipe(
        Layer.provide(Layer.succeed(GithubGraphqlClient, githubClient)),
        Layer.provide(NodeCrypto.layer)
      )
    )
    const trackerReader = Context.get(githubAuthorities, TrackerGraphReader)
    const trackerMutation = Context.get(githubAuthorities, TrackerMutation)
    const target = GithubIssueTarget.make({
      owner: manifest.repository.owner,
      repository: manifest.repository.name,
      issueNumber: createdGithubFixture.issue.number
    })
    const result = yield* runProductionLiveQualification(
      {
        builtEntry: manifest.builtEntry,
        codexHome: fixture.codexHome,
        configuration: fixture.configurationPath,
        target,
        githubToken: secrets.githubToken,
        controlledProviderCredential
      },
      makeProductionLiveQualificationNodeBoundary(spawner),
      {
        validateRecord: (record) => safeRecord(redactionSecrets, record),
        gatherFinalFacts: ({ runId }) =>
          Effect.scoped(
            Effect.gen(function* () {
              const journalContext = yield* Layer.build(
                sqliteJournalStoreLayer({
                  filename: JournalDatabaseLocator.make(fixture.configuration.journalDatabase)
                })
              )
              const journal = yield* Context.get(journalContext, JournalStore).read(runId)
              const planned = journal.filter(({ event }) => event._tag === "TaskAttemptPlanned")
              const sessions = journal.filter(({ event }) => event._tag === "IntegratorSessionFixed")
              const headResult = yield* git.runInWorktree(fixture.configuration.repository, [
                "rev-parse",
                fixture.configuration.integrationRef
              ])
              if (headResult.exitCode !== 0) return yield* Effect.fail(qualificationFailed("EvidenceValidation"))
              const graph = yield* trackerReader.read(target)
              const plannedAttempt =
                planned[0]?.event._tag === "TaskAttemptPlanned" ? planned[0].event.operation.plannedAttempt : undefined
              if (plannedAttempt === undefined) return yield* Effect.fail(qualificationFailed("EvidenceValidation"))
              const lifecycle = Option.getOrUndefined(graph.lifecycleOf(plannedAttempt.taskId))
              const claim = yield* trackerMutation.readTaskClaim(plannedAttempt.taskId)
              const applicationServerProcessIdentities = yield* readApplicationServerProcessIdentities(fixture)
              const responsesObservation = yield* responses.observation
              return {
                applicationServerCount: applicationServerProcessIdentities.length,
                taskWorktreeCount: new Set(
                  planned.map(({ event }) =>
                    event._tag === "TaskAttemptPlanned" ? event.operation.plannedAttempt.worktree : ""
                  )
                ).size,
                integrationTargetCount: new Set(
                  sessions.map(({ event }) =>
                    event._tag === "IntegratorSessionFixed"
                      ? `${event.correlation.integrationTarget.repository}:${event.correlation.integrationTarget.ref}`
                      : ""
                  )
                ).size,
                journal,
                github: { lifecycle: lifecycle?._tag, claim: claim._tag, responses: responsesObservation },
                targetHead: yield* Schema.decodeUnknownEffect(GitCommitSha)(headResult.stdout.trim())
              }
            })
          ),
        publish: (completion) =>
          Effect.gen(function* () {
            const outcome = yield* publishCompletedQualification(
              manifest,
              fixture,
              createdGithubFixture,
              runningForwarder,
              build,
              completion,
              startedAt,
              cleanupState
            ).pipe(
              Effect.mapError((failure) =>
                failure._tag === "QualificationFailed" ? failure : qualificationFailed("Cleanup")
              ),
              Effect.tapError((failure) => Ref.set(qualified, failure)),
              Effect.provideService(GithubGraphqlClient, githubClient),
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Crypto.Crypto, crypto)
            )
            yield* Ref.set(qualified, outcome)
          }),
        retainAfterFailure: () => Effect.void
      }
    )
    if (result._tag === "Failed" && result.stage === "GatherFinalFacts")
      yield* Ref.set(qualified, qualificationFailed("EvidenceValidation"))
    return yield* Ref.get(qualified)
  }).pipe(Effect.result)
  if (attempt._tag === "Success" && attempt.success._tag === "Qualified") return attempt.success
  const failure =
    attempt._tag === "Success" && attempt.success._tag === "QualificationFailed"
      ? attempt.success
      : qualificationFailed("Setup")
  yield* writeProductionLiveQualificationFailureRetentionReport(
    manifest,
    failure.phase,
    githubFixture,
    forwarder,
    local,
    localContainer,
    cleanupState
  ).pipe(
    Effect.provideService(GithubGraphqlClient, githubClient),
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Crypto.Crypto, crypto)
  )
  return failure
})
