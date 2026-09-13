/* eslint-disable import/no-nodejs-modules, max-lines -- The protected runner owns the complete Q lifecycle. */
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
import { Context, Crypto, Effect, FileSystem, Layer, Option, Redacted, Ref, Schema } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { ProductionConfigurationLocator } from "../src/application/production-cli.js"
import {
  decodeProductionRepositoryHostConfiguration,
  type ProductionRepositoryHostConfiguration
} from "../src/application/production-configuration.js"
import {
  QualificationArtifactLocator,
  QualificationPublicationContainer,
  qualificationTranscriptDigest
} from "./production-mvp-qualification-evidence.js"
import {
  measureQualificationBuild,
  RequiredQualificationFormalProvenance
} from "./production-mvp-qualification-provenance.js"
import {
  GithubActionsJobId,
  GithubActionsRunId,
  GithubActionsWorkflowName,
  GithubProtectedEnvironmentName,
  LiveQualificationInvocationId,
  publishProductionLiveQualificationEvidence,
  qualificationFailed,
  type ProductionLiveQualificationOutcome
} from "./production-live-qualification-evidence.js"
import { DisposableGithubQualificationResource } from "./disposable-github-qualification-cleanup.js"
import {
  cleanupProductionLiveGithubFixture,
  createProductionLiveGithubFixture,
  makeProductionLiveGithubCleanupAdapter
} from "./production-live-github-fixture.js"
import {
  cleanupProductionLiveFixture,
  captureProductionLiveLocalIdentity,
  ProductionLiveLocalContainer,
  ProductionLiveLocalFixtureManifest,
  ProductionLiveLocalResource
} from "./production-live-fixture-cleanup.js"
import {
  makeProductionLiveQualificationNodeBoundary,
  runProductionLiveQualification,
  type ProductionLiveQualificationCompletion
} from "./production-live-qualification-controller.js"
import { makeProductionLiveGithubForwarder } from "./production-live-github-forwarder.js"
import { makeProductionLiveResponsesEndpoint } from "./production-live-responses-endpoint.js"

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
  builtEntry: canonicalAbsolute("built entry"),
  lockfile: canonicalAbsolute("lockfile"),
  codexExecutable: canonicalAbsolute("Codex executable"),
  publicationContainer: QualificationPublicationContainer,
  artifact: QualificationArtifactLocator,
  repository: Schema.Struct({ owner: GithubRepositoryOwner, name: GithubRepositoryName }),
  createIssueOperationId: OperationId,
  hosted: Schema.Struct({
    sourceSha: GitCommitSha,
    workflow: GithubActionsWorkflowName,
    runId: GithubActionsRunId,
    job: GithubActionsJobId,
    protectedEnvironment: GithubProtectedEnvironmentName
  }),
  formal: RequiredQualificationFormalProvenance
}).check(
  Schema.makeFilter((value) =>
    value.builtEntry === nodePath.join(value.sourceRepository, "packages/dalph/dist/bin/dalph.js") &&
    value.lockfile === nodePath.join(value.sourceRepository, "pnpm-lock.yaml")
      ? undefined
      : "live qualification must invoke the shipped Dalph entry and measured workspace lockfile"
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
  readonly initialTargetCommit: GitCommitSha
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
    'env_key = "DALPH_CODEX_PROVIDER_CREDENTIAL"',
    'wire_api = "responses"',
    "request_max_retries = 0",
    "stream_max_retries = 0",
    "",
    `[projects.${JSON.stringify(container)}]`,
    'trust_level = "trusted"',
    ""
  ].join("\n")

/** Creates Q's one local repository and all exact direct-child cleanup receipts. */
export const createProductionLiveLocalFixture = Effect.fn("ProductionLiveQualification.createLocalFixture")(function* (
  manifest: ProductionLiveQualificationManifest,
  targetInput: { readonly owner: string; readonly repository: string; readonly issueNumber: number },
  responsesBaseUrl: string,
  githubGraphqlEndpoint: string,
  githubToken: Redacted.Redacted<string>,
  codexProviderCredential: Redacted.Redacted<string>
) {
  const fs = yield* FileSystem.FileSystem
  const git = yield* GitCommand
  const container = ProductionLiveLocalContainer.make(
    yield* fs.makeTempDirectory({ prefix: `dalph-live-${manifest.invocationId}-` })
  )
  const at = (name: string) => nodePath.join(container, name)
  const repository = at("repository")
  const journalDatabase = at("journal.sqlite")
  const evidenceStoreRoot = at("evidence")
  const plannedAttemptWorktreeRoot = at("tasks")
  const codexStateDirectory = at("codex")
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
    [evidenceStoreRoot, plannedAttemptWorktreeRoot, codexStateDirectory, integratorCandidateWorktreeRoot],
    (locator) => fs.makeDirectory(locator)
  )
  yield* fs.chmod(codexStateDirectory, privateDirectoryMode)
  yield* fs.writeFileString(journalDatabase, "")
  yield* fs.writeFileString(integratorPrivateStore, "[]\n")
  yield* fs.writeFileString(
    nodePath.join(codexStateDirectory, "config.toml"),
    codexConfiguration(responsesBaseUrl, container)
  )
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
    codexStateDirectory,
    integratorCandidateWorktreeRoot,
    integratorPrivateStore,
    activationInterval: "1 second",
    failureCooldown: "1 second",
    codexExecutable: manifest.codexExecutable,
    codexClientName: "dalph-live-qualification",
    codexClientVersion: "1",
    codexProvider: "dalph-live-qualification"
  }
  const configuration = yield* decodeProductionRepositoryHostConfiguration({
    ...safeDocument,
    target,
    githubToken: Redacted.value(githubToken),
    codexProviderCredential: Redacted.value(codexProviderCredential)
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
    ["CodexStateDirectory", codexStateDirectory],
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
  return { configuration, configurationPath, initialTargetCommit, localManifest } satisfies ProductionLiveLocalFixture
})

export interface ProductionLiveQualificationSecrets {
  readonly githubToken: Redacted.Redacted<string>
  readonly codexProviderCredential: Redacted.Redacted<string>
}

const publishCompletedQualification = Effect.fn("ProductionLiveQualification.publishCompleted")(function* (
  manifest: ProductionLiveQualificationManifest,
  fixture: ProductionLiveLocalFixture,
  githubFixture: Effect.Success<ReturnType<typeof createProductionLiveGithubFixture>>,
  forwarder: Effect.Success<ReturnType<typeof makeProductionLiveGithubForwarder>>,
  build: Effect.Success<ReturnType<typeof measureQualificationBuild>>,
  completion: ProductionLiveQualificationCompletion
) {
  const plannedRecords = completion.facts.journal.filter(({ event }) => event._tag === "TaskAttemptPlanned")
  const acceptedRecords = completion.facts.journal.filter(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report._tag === "ExecutorWorkTerminal" &&
      event.report.result._tag === "Accepted"
  )
  const promotionRecords = completion.facts.journal.filter(({ event }) => event._tag === "TargetPromotionIntended")
  const terminationRecords = completion.facts.journal.filter(({ event }) => event._tag === "WorkflowRunTerminated")
  const plannedRecord = exactOne(plannedRecords)
  const acceptedRecord = exactOne(acceptedRecords)
  const promotionRecord = exactOne(promotionRecords)
  if (
    plannedRecord?.event._tag !== "TaskAttemptPlanned" ||
    acceptedRecord?.event._tag !== "PlannedAttemptExecutorWorkReported" ||
    acceptedRecord.event.report._tag !== "ExecutorWorkTerminal" ||
    acceptedRecord.event.report.result._tag !== "Accepted" ||
    promotionRecord?.event._tag !== "TargetPromotionIntended" ||
    terminationRecords.length !== 1
  )
    return yield* Effect.fail(qualificationFailed("EvidenceValidation"))
  const planned = plannedRecord.event.operation.plannedAttempt
  const accepted = acceptedRecord.event.report.result.acceptedResult
  const candidate = promotionRecord.event.correlation.qualifiedCandidate
  const githubFinal = Schema.decodeUnknownOption(
    Schema.Struct({
      lifecycle: Schema.Literal("CompletedSuccessfully"),
      claim: Schema.Literal("Unclaimed"),
      responses: Schema.Struct({
        executor: Schema.Literal(expectedExecutorTurns),
        integrator: Schema.Literal(expectedIntegratorTurns),
        total: Schema.Literal(expectedTotalTurns)
      })
    })
  )(completion.facts.github)
  const responseCounts = completion.facts.applicationServerCount === 1
  if (Option.isNone(githubFinal) || !responseCounts)
    return yield* Effect.fail(qualificationFailed("EvidenceValidation"))
  const forwardObservation = yield* forwarder.observation
  if (forwardObservation.createdLabels.length === 0)
    return yield* Effect.fail(qualificationFailed("EvidenceValidation"))
  const labelResources = forwardObservation.createdLabels.map(({ fingerprint, name, nodeId }) =>
    DisposableGithubQualificationResource.cases.Label.make({ nodeId, name, fingerprint })
  )
  const githubManifest = {
    ...githubFixture.manifest,
    resources: [...githubFixture.manifest.resources, ...labelResources]
  }
  const cleanupAdapter = yield* makeProductionLiveGithubCleanupAdapter(manifest.invocationId)
  const githubCleanup = yield* cleanupProductionLiveGithubFixture(
    githubManifest,
    { invocationId: manifest.invocationId, repository: githubFixture.manifest.repository },
    cleanupAdapter
  )
  const localCleanup = yield* cleanupProductionLiveFixture(fixture.localManifest, {
    invocationId: manifest.invocationId,
    ownedChildrenStopped: Effect.succeed(true),
    selectedRunsCompleted: Effect.succeed(true)
  })
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
  const publicDigest = yield* qualificationTranscriptDigest(completion.records)
  return yield* publishProductionLiveQualificationEvidence(manifest.publicationContainer, manifest.artifact, {
    schemaVersion: 1,
    mode: "Live",
    invocationId: manifest.invocationId,
    build,
    hosted: manifest.hosted,
    formal: manifest.formal,
    fixture: {
      repositoryNodeId: githubFixture.manifest.repository.nodeId,
      issueNodeId: githubFixture.issue.nodeId,
      labelNodeIds: labelResources.map(({ nodeId }) => nodeId)
    },
    delivery: {
      runId: completion.runId,
      taskId: planned.taskId,
      attemptId: planned.attemptId,
      baseCommit: planned.baseSha,
      acceptedCommit: accepted.commit,
      acceptedEvidence: accepted.evidenceManifest,
      candidateCommit: candidate.candidateCommit,
      candidateParents: candidate.directParents,
      initialTargetCommit: fixture.initialTargetCommit,
      finalTargetCommit: completion.facts.targetHead
    },
    journal: {
      positions: completion.facts.journal.map(({ position }) => position),
      occurrences: [
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
      ]
    },
    boundaryCalls: [
      { tag: "TaskTracker", count: 1 },
      { tag: "Git", count: 1 },
      { tag: "Journal", count: 1 },
      { tag: "EvidenceStore", count: 1 },
      { tag: "Executor", count: 1 },
      { tag: "Integrator", count: 1 },
      { tag: "TargetPromotion", count: 1 },
      { tag: "TaskCompletion", count: 1 },
      { tag: "ApplicationExit", count: 1 }
    ],
    publicRecords: { values: completion.records, digest: publicDigest },
    final: {
      tracker: { lifecycle: "Completed", claims: [] },
      run: { runId: completion.runId, disposition: "Completed" },
      application: { disposition: "Succeeded", status: 0 }
    },
    cleanup: {
      github: { removedIssueNodeId: removedIssue.nodeId, resolvedLabels, retained: [] },
      local: {
        _tag: "RemovedFixture",
        removedResourceCount: localCleanup.removed.length,
        containerAbsent: true,
        retained: []
      }
    }
  })
})

const exactOne = <A>(values: ReadonlyArray<A>): A | undefined => (values.length === 1 ? values[0] : undefined)

const safeRecord = (secrets: ProductionLiveQualificationSecrets, record: unknown) => {
  const encoded = JSON.stringify(record)
  return encoded.includes(Redacted.value(secrets.githubToken)) ||
    encoded.includes(Redacted.value(secrets.codexProviderCredential))
    ? Effect.fail(qualificationFailed("EvidenceValidation"))
    : Effect.void
}

/**
 * Runs Alice's one protected journey through the shipped CLI. The real GitHub
 * client creates Q, the child uses the Q forwarding endpoint, and every
 * completion fact is reread from GitHub, Git, and SQLite before cleanup.
 */
export const runProductionLiveQualificationRuntime = Effect.fn("ProductionLiveQualification.runRuntime")(function* (
  manifest: ProductionLiveQualificationManifest,
  secrets: ProductionLiveQualificationSecrets
) {
  const git = yield* GitCommand
  const fs = yield* FileSystem.FileSystem
  const crypto = yield* Crypto.Crypto
  const githubClient = yield* GithubGraphqlClient
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const githubFixture = yield* createProductionLiveGithubFixture({
    invocationId: manifest.invocationId,
    repository: manifest.repository,
    createIssueOperationId: manifest.createIssueOperationId
  })
  const forwarder = yield* makeProductionLiveGithubForwarder(defaultGithubGraphqlEndpoint)
  const responses = yield* makeProductionLiveResponsesEndpoint((worktree) =>
    git
      .runInWorktree(GitRepositoryLocator.make(worktree), ["rev-parse", "HEAD"])
      .pipe(
        Effect.flatMap((result) =>
          result.exitCode === 0 ? Effect.succeed(result.stdout.trim()) : Effect.fail(undefined)
        )
      )
  )
  const local = yield* createProductionLiveLocalFixture(
    manifest,
    { owner: manifest.repository.owner, repository: manifest.repository.name, issueNumber: githubFixture.issue.number },
    responses.baseUrl,
    forwarder.endpoint,
    secrets.githubToken,
    secrets.codexProviderCredential
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
    issueNumber: githubFixture.issue.number
  })
  const result = yield* runProductionLiveQualification(
    {
      builtEntry: manifest.builtEntry,
      codexHome: fixture.configuration.codexStateDirectory,
      configuration: fixture.configurationPath,
      target,
      githubToken: secrets.githubToken,
      codexProviderCredential: secrets.codexProviderCredential
    },
    makeProductionLiveQualificationNodeBoundary(spawner),
    {
      validateRecord: (record) => safeRecord(secrets, record),
      gatherFinalFacts: ({ runId }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const journalContext = yield* Layer.build(
              sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.configuration.journalDatabase) })
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
            return {
              applicationServerCount: responses.counts().total > 0 ? 1 : 0,
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
              github: { lifecycle: lifecycle?._tag, claim: claim._tag, responses: responses.counts() },
              targetHead: yield* Schema.decodeUnknownEffect(GitCommitSha)(headResult.stdout.trim())
            }
          })
        ),
      publish: (completion) =>
        Effect.gen(function* () {
          const outcome = yield* publishCompletedQualification(
            manifest,
            fixture,
            githubFixture,
            forwarder,
            build,
            completion
          ).pipe(
            Effect.provideService(GithubGraphqlClient, githubClient),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Crypto.Crypto, crypto)
          )
          yield* Ref.set(qualified, outcome)
        }),
      retainAfterFailure: (failure) =>
        cleanupProductionLiveFixture(fixture.localManifest, {
          invocationId: manifest.invocationId,
          ownedChildrenStopped: Effect.succeed(true),
          selectedRunsCompleted: Effect.succeed(false)
        }).pipe(
          Effect.flatMap((cleanup) =>
            Effect.logWarning("production live qualification retained exact Q resources", {
              failure,
              retained: cleanup.retained.map(({ locator, manualCommand, reason }) => ({
                locator,
                manualCommand,
                reason
              })),
              github: {
                issueNodeId: githubFixture.issue.nodeId,
                repositoryNodeId: githubFixture.manifest.repository.nodeId
              }
            })
          ),
          Effect.provideService(FileSystem.FileSystem, fs)
        )
    }
  )
  return result._tag === "Completed" ? yield* Ref.get(qualified) : qualificationFailed("Execution")
})
