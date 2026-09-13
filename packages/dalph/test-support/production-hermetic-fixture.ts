import { EvidenceDigest, GitCommitSha } from "@dalph/contracts"
import { GitCommand } from "@dalph/orchestrator"
import { Crypto, Effect, FileSystem, MutableList, Ref, Schema } from "effect"
import {
  HermeticFixtureCreationFacts,
  HermeticFixtureManifest,
  HermeticFixtureResource,
  HermeticInvocationId,
  HermeticOwnershipMarkerContents
} from "../src/application/production-hermetic-contract.js"
import { decodeProductionRepositoryHostConfiguration } from "../src/application/production-configuration.js"
import {
  HermeticFixtureContainer,
  HermeticFileIdentity,
  readHermeticFileIdentity,
  type HermeticControllerFixture
} from "./production-hermetic-controller.js"

const HermeticSetupAttempt = Schema.Struct({ locator: Schema.NonEmptyString, operation: Schema.NonEmptyString })

/** Retained setup observations never claim ownership of an unresolved attempt. */
export class HermeticFixtureSetupFailure extends Schema.TaggedError<HermeticFixtureSetupFailure>()(
  "HermeticFixtureSetupFailure",
  {
    container: HermeticFixtureContainer,
    attempted: Schema.Array(HermeticSetupAttempt),
    observed: Schema.Array(Schema.Struct({ resource: HermeticFixtureResource, identity: HermeticFileIdentity })),
    unresolved: Schema.Array(HermeticSetupAttempt)
  }
) {}

class HermeticSetupGitFailure extends Schema.TaggedError<HermeticSetupGitFailure>()("HermeticSetupGitFailure", {}) {}
class HermeticSetupIdentityUnavailable extends Schema.TaggedError<HermeticSetupIdentityUnavailable>()(
  "HermeticSetupIdentityUnavailable",
  {}
) {}

const privateDirectoryMode = 0o700
const hexadecimalRadix = 16
const hexadecimalByteWidth = 2

/** Creates only one disposable local repository; setup failures deliberately retain exact paths. */
export const createHermeticFixture = Effect.fn("HermeticFixture.create")(function* (
  builtEntry: string,
  sourceBaseSha: GitCommitSha
) {
  const fs = yield* FileSystem.FileSystem
  const git = yield* GitCommand
  const crypto = yield* Crypto.Crypto
  const root = yield* fs.makeTempDirectory({ prefix: "dalph-hermetic-" })
  const container = HermeticFixtureContainer.make(root)
  const attempted = MutableList.make<typeof HermeticSetupAttempt.Type>()
  const observed = MutableList.make<HermeticControllerFixture["identities"][number]>()
  const unresolved = yield* Ref.make<ReadonlyArray<typeof HermeticSetupAttempt.Type>>([])
  const cross = <A, E, R>(locator: string, operation: string, effect: Effect.Effect<A, E, R>) =>
    Effect.sync(() => MutableList.append(attempted, { locator, operation })).pipe(
      Effect.andThen(Ref.set(unresolved, [{ locator, operation }])),
      Effect.andThen(effect),
      Effect.tap(() => Ref.set(unresolved, []))
    )
  const observeCreated = (resource: HermeticFixtureResource) =>
    cross(
      resource.locator,
      "observeCreatedIdentity",
      readHermeticFileIdentity(resource.locator).pipe(
        Effect.flatMap((identity) =>
          identity._tag === "Known" ? Effect.succeed(identity) : new HermeticSetupIdentityUnavailable({})
        )
      )
    ).pipe(Effect.tap((identity) => Effect.sync(() => MutableList.append(observed, { resource, identity }))))
  const createResource = <A, E, R>(resource: HermeticFixtureResource, effect: Effect.Effect<A, E, R>) =>
    cross(resource.locator, "createResource", effect).pipe(Effect.andThen(observeCreated(resource)))
  const resourceAt = (tag: HermeticFixtureResource["_tag"], locator: string) =>
    Schema.decodeUnknownEffect(HermeticFixtureResource)({ _tag: tag, locator })
  return yield* Effect.gen(function* () {
    const repository = `${root}/repository`
    yield* createResource(yield* resourceAt("Repository", repository), fs.makeDirectory(repository))
    const runGit = Effect.fn("HermeticFixture.git")(function* (args: ReadonlyArray<string>) {
      return yield* cross(
        repository,
        `git.${args[0] ?? "unknown"}`,
        git
          .runInWorktree(repository, args)
          .pipe(
            Effect.flatMap((result) =>
              result.exitCode === 0 ? Effect.succeed(result.stdout.trim()) : new HermeticSetupGitFailure({})
            )
          )
      )
    })
    yield* runGit(["init", "--initial-branch=master"])
    yield* observeCreated(yield* resourceAt("CommonDirectory", `${repository}/.git`))
    yield* runGit(["config", "user.name", "Dalph Hermetic"])
    yield* runGit(["config", "user.email", "hermetic@example.invalid"])
    yield* cross(
      `${repository}/base.txt`,
      "writeRepositorySeed",
      fs.writeFileString(`${repository}/base.txt`, "base\n")
    )
    yield* runGit(["add", "base.txt"])
    yield* runGit(["commit", "-m", "base"])
    const baseSha = yield* Schema.decodeUnknownEffect(GitCommitSha)(yield* runGit(["rev-parse", "HEAD"]))
    const invocation = HermeticInvocationId.make(root)
    const document = {
      repository,
      commonDirectory: `${repository}/.git`,
      integrationRef: "refs/heads/master",
      plannedAttemptBaseSha: baseSha,
      plannedAttemptExecutor: "codex:hermetic",
      claimOwner: "dalph:hermetic",
      taskWorkCapacity: 1,
      journalDatabase: `${root}/journal.sqlite`,
      evidenceStoreRoot: `${root}/evidence`,
      plannedAttemptWorktreeRoot: `${root}/tasks`,
      codexStateDirectory: `${root}/codex`,
      integratorCandidateWorktreeRoot: `${root}/candidates`,
      integratorPrivateStore: `${root}/private.json`,
      activationInterval: "1 second",
      failureCooldown: "1 second",
      codexExecutable: "controlled-codex",
      codexClientName: "hermetic",
      codexClientVersion: "1",
      codexProvider: "hermetic"
    }
    const configuration = yield* decodeProductionRepositoryHostConfiguration({
      ...document,
      target: { _tag: "GithubIssue", owner: "hermetic", repository: "fixture", issueNumber: 1 },
      githubToken: "controlled-hermetic-github-token",
      codexProviderCredential: "controlled-hermetic-codex-credential"
    })
    const directories = [
      yield* resourceAt("EvidenceRoot", configuration.evidenceStoreRoot),
      yield* resourceAt("AttemptWorktreeRoot", configuration.plannedAttemptWorktreeRoot),
      yield* resourceAt("CodexStateDirectory", configuration.codexStateDirectory),
      yield* resourceAt("CandidateRoot", configuration.integratorCandidateWorktreeRoot)
    ]
    yield* Effect.forEach(directories, (resource) => createResource(resource, fs.makeDirectory(resource.locator)))
    yield* cross(
      configuration.codexStateDirectory,
      "chmodPrivateDirectory",
      fs.chmod(configuration.codexStateDirectory, privateDirectoryMode)
    )
    yield* createResource(
      yield* resourceAt("JournalDatabase", configuration.journalDatabase),
      fs.writeFileString(configuration.journalDatabase, "")
    )
    yield* createResource(
      yield* resourceAt("PrivateStore", configuration.integratorPrivateStore),
      fs.writeFileString(configuration.integratorPrivateStore, "[]\n")
    )
    const digest = yield* cross(
      builtEntry,
      "readBuiltEntryDigest",
      fs.readFile(builtEntry).pipe(Effect.flatMap((bytes) => crypto.digest("SHA-256", bytes)))
    )
    const manifest = yield* Schema.decodeUnknownEffect(HermeticFixtureManifest)({
      invocationId: invocation,
      sourceBaseSha,
      builtEntry,
      builtEntryDigest: EvidenceDigest.make(
        Array.from(digest, (byte) => byte.toString(hexadecimalRadix).padStart(hexadecimalByteWidth, "0")).join("")
      ),
      repository,
      commonDirectory: configuration.commonDirectory,
      integrationRef: configuration.integrationRef,
      baseSha,
      journalDatabase: configuration.journalDatabase,
      evidenceRoot: configuration.evidenceStoreRoot,
      attemptWorktreeRoot: configuration.plannedAttemptWorktreeRoot,
      codexStateDirectory: configuration.codexStateDirectory,
      candidateRoot: configuration.integratorCandidateWorktreeRoot,
      privateStore: configuration.integratorPrivateStore,
      ownershipMarker: `${root}/ownership.json`
    })
    const configurationPath = `${root}/production.json`
    const manifestPath = `${root}/manifest.json`
    yield* createResource(
      yield* resourceAt("ConfigurationDocument", configurationPath),
      fs.writeFileString(configurationPath, JSON.stringify(document))
    )
    yield* createResource(
      yield* resourceAt("ManifestDocument", manifestPath),
      fs.writeFileString(
        manifestPath,
        yield* Schema.encodeEffect(Schema.fromJsonString(HermeticFixtureManifest))(manifest)
      )
    )
    yield* createResource(
      yield* resourceAt("OwnershipMarker", manifest.ownershipMarker),
      fs.writeFileString(
        manifest.ownershipMarker,
        yield* Schema.encodeEffect(Schema.fromJsonString(HermeticOwnershipMarkerContents))({ invocationId: invocation })
      )
    )
    const creation = HermeticFixtureCreationFacts.make({
      invocationId: invocation,
      repository: manifest.repository,
      commonDirectory: manifest.commonDirectory,
      ownershipMarker: manifest.ownershipMarker,
      createdResources: MutableList.toArray(observed).map(({ resource }) => resource)
    })
    const identities = MutableList.toArray(observed)
    return {
      container,
      manifest,
      creation,
      identities,
      configuration,
      configurationPath,
      manifestPath
    } satisfies HermeticControllerFixture
  }).pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        return yield* new HermeticFixtureSetupFailure({
          container,
          attempted: MutableList.toArray(attempted),
          observed: MutableList.toArray(observed),
          unresolved: yield* Ref.get(unresolved)
        })
      })
    )
  )
})
