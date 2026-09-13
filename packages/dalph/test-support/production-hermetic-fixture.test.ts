import { GitCommitSha } from "@dalph/contracts"
import { nodeGitCommandLayer } from "@dalph/orchestrator"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Option, PlatformError, Ref, Result, Schema } from "effect"
import { expect } from "vitest"
import { readHermeticFileIdentity } from "./production-hermetic-controller.js"
import { createHermeticFixture, HermeticFixtureSetupFailure } from "./production-hermetic-fixture.js"

const builtEntry = new URL("../dist/bin/production-hermetic-qualification.js", import.meta.url).pathname
const sourceBaseSha = GitCommitSha.make("bf027ef1588d0ec0d0e749b812d6652343682c3b")
const fixtureLayer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))

const assertRetained = Effect.fn("HermeticSetupTest.assertRetained")(function* (failure: HermeticFixtureSetupFailure) {
  const fs = yield* FileSystem.FileSystem
  expect(yield* fs.exists(failure.container)).toBe(true)
  for (const { identity, resource } of failure.observed) {
    expect(yield* fs.exists(resource.locator)).toBe(true)
    expect(yield* readHermeticFileIdentity(resource.locator)).toEqual(identity)
  }
})

it.effect("a created object without an inode remains unresolved instead of entering the original identity ledger", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const controlled = FileSystem.FileSystem.of({
      ...fs,
      stat: (path) =>
        fs.stat(path).pipe(Effect.map((stat) => (path.endsWith("/evidence") ? { ...stat, ino: Option.none() } : stat)))
    })
    const result = yield* createHermeticFixture(builtEntry, sourceBaseSha).pipe(
      Effect.provideService(FileSystem.FileSystem, controlled),
      Effect.result
    )
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) return yield* Effect.die("unidentified fixture unexpectedly succeeded")
    if (!Schema.is(HermeticFixtureSetupFailure)(result.failure))
      return yield* Effect.die("missing retained setup evidence")
    const failure = result.failure
    expect(failure.observed.map(({ resource }) => resource._tag)).toEqual(["Repository", "CommonDirectory"])
    expect(failure.unresolved).toEqual([
      { locator: `${failure.container}/evidence`, operation: "observeCreatedIdentity" }
    ])
    expect(yield* fs.exists(`${failure.container}/evidence`)).toBe(true)
    expect(failure.observed.every(({ identity }) => identity._tag === "Known")).toBe(true)
    yield* assertRetained(failure)
  }).pipe(Effect.provide(fixtureLayer))
)

it.effect("a failed creation retains original observed identities and its exact unresolved locator without retry", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const allocations = yield* Ref.make(0)
    const failedCreations = yield* Ref.make(0)
    const controlled = FileSystem.FileSystem.of({
      ...fs,
      makeTempDirectory: (options) =>
        Ref.update(allocations, (count) => count + 1).pipe(Effect.andThen(fs.makeTempDirectory(options))),
      makeDirectory: (path, options) =>
        path.endsWith("/codex")
          ? Ref.update(failedCreations, (count) => count + 1).pipe(
              Effect.andThen(
                Effect.fail(
                  PlatformError.systemError({
                    _tag: "PermissionDenied",
                    module: "HermeticSetupTest",
                    method: "makeDirectory",
                    pathOrDescriptor: path
                  })
                )
              )
            )
          : fs.makeDirectory(path, options)
    })
    const result = yield* createHermeticFixture(builtEntry, sourceBaseSha).pipe(
      Effect.provideService(FileSystem.FileSystem, controlled),
      Effect.result
    )
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) return yield* Effect.die("setup unexpectedly succeeded")
    expect(Schema.is(HermeticFixtureSetupFailure)(result.failure)).toBe(true)
    if (!Schema.is(HermeticFixtureSetupFailure)(result.failure))
      return yield* Effect.die("missing retained setup evidence")
    const failure = result.failure
    expect(failure.observed.map(({ resource }) => resource._tag)).toEqual([
      "Repository",
      "CommonDirectory",
      "EvidenceRoot",
      "AttemptWorktreeRoot"
    ])
    expect(failure.unresolved).toEqual([{ locator: `${failure.container}/codex`, operation: "createResource" }])
    expect(failure.attempted.at(-1)).toEqual(failure.unresolved[0])
    expect(yield* Ref.get(allocations)).toBe(1)
    expect(yield* Ref.get(failedCreations)).toBe(1)
    expect(yield* fs.exists(`${failure.container}/journal.sqlite`)).toBe(false)
    yield* assertRetained(failure)
  }).pipe(Effect.provide(fixtureLayer))
)

it.effect("an unavailable built entry retains the actual partial fixture and reports a non-owned read attempt", () =>
  Effect.gen(function* () {
    const missing = `${builtEntry}.missing-hermetic-fixture`
    const result = yield* createHermeticFixture(missing, sourceBaseSha).pipe(Effect.result)
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) return yield* Effect.die("setup unexpectedly succeeded")
    if (!Schema.is(HermeticFixtureSetupFailure)(result.failure))
      return yield* Effect.die("missing retained setup evidence")
    const failure = result.failure
    expect(failure.observed.map(({ resource }) => resource._tag)).toEqual([
      "Repository",
      "CommonDirectory",
      "EvidenceRoot",
      "AttemptWorktreeRoot",
      "CodexStateDirectory",
      "CandidateRoot",
      "JournalDatabase",
      "PrivateStore"
    ])
    expect(failure.unresolved).toEqual([{ locator: missing, operation: "readBuiltEntryDigest" }])
    expect(failure.observed.some(({ resource }) => resource.locator === missing)).toBe(false)
    expect(failure.attempted.filter(({ operation }) => operation === "readBuiltEntryDigest")).toHaveLength(1)
    yield* assertRetained(failure)
  }).pipe(Effect.provide(fixtureLayer))
)
