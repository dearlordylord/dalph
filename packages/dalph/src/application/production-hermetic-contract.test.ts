/* eslint-disable import/no-nodejs-modules -- the fixture intentionally uses exact local paths. */

import nodePath from "node:path"
import { NodeServices } from "@effect/platform-node"
import {
  EvidenceDigest,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTargetRef,
  IntegrationTarget
} from "@dalph/contracts"
import {
  EvidenceStoreLocator,
  GitCommand,
  GitCommonDirectoryLocator,
  JournalDatabaseLocator,
  OperationId
} from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Schema } from "effect"
import { describe, expect } from "vitest"
import {
  BoundaryReached,
  authorizeHermeticFixture,
  HermeticBuiltEntry,
  HermeticFixtureManifest,
  HermeticInvocationId,
  HermeticOwnershipMarker,
  HermeticOwnershipMarkerContents,
  type HermeticFixtureManifest as HermeticFixtureManifestType
} from "./production-hermetic-contract.js"
import { IntegratorCandidateWorktreeRoot, IntegratorPrivateStoreLocator } from "./codex-integrator-private-store.js"
import {
  decodeProductionRepositoryHostConfiguration,
  ProductionCodexStateDirectory,
  ProductionPlannedAttemptWorktreeRoot
} from "./production-configuration.js"

const sourceBaseSha = GitCommitSha.make("a".repeat(40))
const baseSha = GitCommitSha.make("b".repeat(40))

const makeManifest = (root: string): HermeticFixtureManifestType => {
  const repository = GitRepositoryLocator.make(nodePath.join(root, "repository"))
  return HermeticFixtureManifest.make({
    invocationId: HermeticInvocationId.make("hermetic-contract-test"),
    sourceBaseSha,
    builtEntry: HermeticBuiltEntry.make(nodePath.join(root, "built.js")),
    builtEntryDigest: EvidenceDigest.make("c".repeat(64)),
    repository,
    commonDirectory: GitCommonDirectoryLocator.make(repository),
    integrationRef: IntegrationTargetRef.make("refs/heads/master"),
    baseSha,
    journalDatabase: JournalDatabaseLocator.make(nodePath.join(root, "journal.sqlite")),
    evidenceRoot: EvidenceStoreLocator.make(nodePath.join(root, "evidence")),
    attemptWorktreeRoot: ProductionPlannedAttemptWorktreeRoot.make(nodePath.join(root, "attempts")),
    codexStateDirectory: ProductionCodexStateDirectory.make(nodePath.join(root, "codex")),
    candidateRoot: IntegratorCandidateWorktreeRoot.make(nodePath.join(root, "candidates")),
    privateStore: IntegratorPrivateStoreLocator.make(nodePath.join(root, "private.json")),
    ownershipMarker: HermeticOwnershipMarker.make(nodePath.join(root, "ownership.json"))
  })
}

const rawConfiguration = (
  manifest: HermeticFixtureManifestType,
  overrides: Readonly<Record<string, unknown>> = {}
) => ({
  target: { _tag: "GithubIssue", owner: "hermetic", repository: "fixture", issueNumber: 339 },
  repository: manifest.repository,
  commonDirectory: manifest.commonDirectory,
  integrationRef: manifest.integrationRef,
  plannedAttemptBaseSha: manifest.baseSha,
  plannedAttemptExecutor: "codex:hermetic",
  claimOwner: "dalph:hermetic",
  taskWorkCapacity: 1,
  journalDatabase: manifest.journalDatabase,
  evidenceStoreRoot: manifest.evidenceRoot,
  plannedAttemptWorktreeRoot: manifest.attemptWorktreeRoot,
  codexStateDirectory: manifest.codexStateDirectory,
  integratorCandidateWorktreeRoot: manifest.candidateRoot,
  integratorPrivateStore: manifest.privateStore,
  activationInterval: "1 second",
  failureCooldown: "1 second",
  codexExecutable: "controlled-codex",
  codexClientName: "hermetic",
  codexClientVersion: "1",
  codexProvider: "hermetic",
  githubToken: "controlled-github-token",
  codexProviderCredential: "controlled-codex-credential",
  ...overrides
})

const gitLayer = Layer.succeed(
  GitCommand,
  GitCommand.of({
    run: (directory) => Effect.succeed({ exitCode: 0, stderr: "", stdout: directory }),
    runInWorktree: () => Effect.die("worktree command is outside this authorization test"),
    runBytesInWorktree: () => Effect.die("byte command is outside this authorization test")
  })
)

const setupFixture = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-hermetic-contract-" })
  const manifest = makeManifest(root)
  yield* fileSystem.writeFileString(
    manifest.ownershipMarker,
    yield* Schema.encodeEffect(Schema.fromJsonString(HermeticOwnershipMarkerContents))({
      invocationId: manifest.invocationId
    })
  )
  const configuration = yield* decodeProductionRepositoryHostConfiguration(rawConfiguration(manifest))
  return { fileSystem, manifest, configuration, root }
})

const withServices = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | GitCommand>) =>
  effect.pipe(Effect.provide(gitLayer), Effect.provide(NodeServices.layer))

describe("production hermetic contract", () => {
  it("keeps source provenance and disposable Git base distinct through JSON", () => {
    const encoded = Schema.encodeSync(HermeticFixtureManifest)(makeManifest("/tmp/hermetic-contract"))
    const decoded = Schema.decodeUnknownSync(HermeticFixtureManifest)(encoded)
    expect(decoded.sourceBaseSha).toBe(sourceBaseSha)
    expect(decoded.baseSha).toBe(baseSha)
    expect(decoded.sourceBaseSha).not.toBe(decoded.baseSha)
  })

  it("accepts only the three named boundary cuts", () => {
    const operationId = OperationId.make("hermetic-contract-operation")
    const cases = [
      BoundaryReached.cases.CompletionResponse.make({ operationId }),
      BoundaryReached.cases.PromotionCompareAndSet.make({
        candidateCommit: baseSha,
        expectedTargetHead: baseSha,
        integrationTarget: IntegrationTarget.make({
          repository: GitRepositoryLocator.make("/tmp/hermetic-target"),
          ref: IntegrationTargetRef.make("refs/heads/master")
        })
      }),
      BoundaryReached.cases.CompletionThrottle.make({ operationId })
    ]
    for (const value of cases) expect(Schema.is(BoundaryReached)(value)).toBe(true)
    expect(Schema.is(BoundaryReached)({ _tag: "CompletionResponse" })).toBe(false)
  })

  it.effect("authorizes exact Q paths only after fresh configuration, marker, and Git reads", () =>
    withServices(
      Effect.scoped(
        Effect.gen(function* () {
          const { configuration, manifest } = yield* setupFixture
          expect(yield* authorizeHermeticFixture(manifest, configuration)).toBeUndefined()
        })
      )
    )
  )

  it.effect("rejects a foreign marker invocation", () =>
    withServices(
      Effect.scoped(
        Effect.gen(function* () {
          const { configuration, fileSystem, manifest } = yield* setupFixture
          yield* fileSystem.writeFileString(
            manifest.ownershipMarker,
            yield* Schema.encodeEffect(Schema.fromJsonString(HermeticOwnershipMarkerContents))({
              invocationId: HermeticInvocationId.make("foreign-invocation")
            })
          )
          const failure = yield* authorizeHermeticFixture(manifest, configuration).pipe(Effect.flip)
          expect(failure.reason).toBe("InvocationMismatch")
        })
      )
    )
  )

  it.effect("rejects changed fresh configuration before it can authorize cleanup", () =>
    withServices(
      Effect.scoped(
        Effect.gen(function* () {
          const { manifest } = yield* setupFixture
          const changed = yield* decodeProductionRepositoryHostConfiguration(
            rawConfiguration(manifest, { integrationRef: "refs/heads/changed" })
          )
          const failure = yield* authorizeHermeticFixture(manifest, changed).pipe(Effect.flip)
          expect(failure.reason).toBe("ConfigurationMismatch")
        })
      )
    )
  )

  it.effect("rejects an unreadable ownership marker", () =>
    withServices(
      Effect.scoped(
        Effect.gen(function* () {
          const { configuration, fileSystem, manifest } = yield* setupFixture
          yield* fileSystem.remove(manifest.ownershipMarker)
          const failure = yield* authorizeHermeticFixture(manifest, configuration).pipe(Effect.flip)
          expect(failure.reason).toBe("MarkerUnreadable")
        })
      )
    )
  )

  it.effect("rejects overlapping worktree ownership before marker or Git access", () =>
    withServices(
      Effect.scoped(
        Effect.gen(function* () {
          const { configuration, manifest } = yield* setupFixture
          const overlapping = HermeticFixtureManifest.make({
            ...manifest,
            candidateRoot: IntegratorCandidateWorktreeRoot.make(
              nodePath.join(manifest.attemptWorktreeRoot, "candidate")
            )
          })
          const failure = yield* authorizeHermeticFixture(overlapping, configuration).pipe(Effect.flip)
          expect(failure.reason).toBe("ResourceOverlap")
        })
      )
    )
  )
})
