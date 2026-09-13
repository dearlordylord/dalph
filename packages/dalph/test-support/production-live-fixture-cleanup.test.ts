import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, PlatformError } from "effect"
import { expect } from "vitest"
import { LiveQualificationInvocationId } from "./production-live-github-fixture.js"
import {
  cleanupProductionLiveFixture,
  captureProductionLiveLocalIdentity,
  ProductionLiveLocalContainer,
  ProductionLiveLocalFixtureManifest,
  ProductionLiveLocalResource
} from "./production-live-fixture-cleanup.js"

const makeFixture = Effect.fn("ProductionLiveCleanupTest.makeFixture")(function* () {
  const fs = yield* FileSystem.FileSystem
  const root = ProductionLiveLocalContainer.make(yield* fs.makeTempDirectory({ prefix: "dalph-live-cleanup-" }))
  const repository = `${root}/repository`
  const journal = `${root}/journal.sqlite`
  yield* fs.makeDirectory(repository)
  yield* fs.writeFileString(`${repository}/owned.txt`, "owned\n")
  yield* fs.writeFileString(journal, "journal\n")
  const resources = [
    ProductionLiveLocalResource.cases.Repository.make({
      locator: repository,
      identity: yield* captureProductionLiveLocalIdentity(repository)
    }),
    ProductionLiveLocalResource.cases.JournalDatabase.make({
      locator: journal,
      identity: yield* captureProductionLiveLocalIdentity(journal)
    })
  ]
  return ProductionLiveLocalFixtureManifest.make({
    invocationId: LiveQualificationInvocationId.make("Q-local-cleanup"),
    container: { locator: root, identity: yield* captureProductionLiveLocalIdentity(root) },
    resources
  })
})

const completedController = (invocationId: LiveQualificationInvocationId) => ({
  invocationId,
  ownedChildrenStopped: Effect.succeed(true),
  selectedRunsCompleted: Effect.succeed(true)
})

it.effect("Alice removes exact Q leaves, then the exact empty container, and rereads absence", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const manifest = yield* makeFixture()
      const result = yield* cleanupProductionLiveFixture(manifest, completedController(manifest.invocationId))
      expect(result).toEqual({ _tag: "Removed", removed: manifest.resources, retained: [] })
      expect(yield* fs.exists(manifest.container.locator)).toBe(false)
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

it.effect("Alice retains the exact container when an unrecorded child makes it nonempty", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const manifest = yield* makeFixture()
      yield* fs.writeFileString(`${manifest.container.locator}/foreign.txt`, "foreign\n")
      const result = yield* cleanupProductionLiveFixture(manifest, completedController(manifest.invocationId))
      expect(result._tag).toBe("Retained")
      expect(result.removed).toEqual(manifest.resources)
      expect(result.retained).toEqual([
        expect.objectContaining({ locator: manifest.container.locator, reason: "ContainerNonempty" })
      ])
      expect(result.retained[0]?.manualCommand).toContain("-maxdepth 1")
      expect(result.retained[0]?.manualCommand).not.toMatch(/\brm\b/u)
      expect(yield* fs.readFileString(`${manifest.container.locator}/foreign.txt`)).toBe("foreign\n")
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

for (const blocked of ["ChildrenRunning", "UnfinishedRun"] as const) {
  it.effect(`Alice retains every exact local locator for ${blocked} without deleting a leaf`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const manifest = yield* makeFixture()
        const controller = {
          invocationId: manifest.invocationId,
          ownedChildrenStopped: Effect.succeed(blocked !== "ChildrenRunning"),
          selectedRunsCompleted: Effect.succeed(blocked !== "UnfinishedRun")
        }
        const result = yield* cleanupProductionLiveFixture(manifest, controller)
        expect(result._tag).toBe("Retained")
        expect(result.removed).toEqual([])
        expect(result.retained.map(({ reason }) => reason)).toEqual([blocked, ...manifest.resources.map(() => blocked)])
        expect(result.retained.every(({ manualCommand }) => !/\brm\b/u.test(manualCommand))).toBe(true)
        for (const resource of manifest.resources) expect(yield* fs.exists(resource.locator)).toBe(true)
      })
    ).pipe(Effect.provide(NodeServices.layer))
  )
}

it.effect("Alice retains every exact locator when the invocation is foreign", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const manifest = yield* makeFixture()
      const result = yield* cleanupProductionLiveFixture(
        manifest,
        completedController(LiveQualificationInvocationId.make("Q-foreign"))
      )
      expect(result._tag).toBe("Retained")
      expect(result.removed).toEqual([])
      expect(result.retained.every(({ reason }) => reason === "ForeignInvocation")).toBe(true)
      for (const resource of manifest.resources) expect(yield* fs.exists(resource.locator)).toBe(true)
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

it.effect("Alice preserves all leaves after one same-path resource identity changes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const manifest = yield* makeFixture()
      const journal = manifest.resources.find(({ _tag }) => _tag === "JournalDatabase")
      const repository = manifest.resources.find(({ _tag }) => _tag === "Repository")
      if (journal === undefined) return yield* Effect.die("missing journal fixture")
      if (repository === undefined) return yield* Effect.die("missing repository fixture")
      const replacement = `${journal.locator}.replacement`
      yield* fs.writeFileString(replacement, "replacement\n")
      yield* fs.rename(replacement, journal.locator)
      const result = yield* cleanupProductionLiveFixture(manifest, completedController(manifest.invocationId))
      expect(result._tag).toBe("Retained")
      expect(result.removed).toEqual([])
      expect(result.retained).toContainEqual(
        expect.objectContaining({ locator: journal.locator, reason: "ChangedIdentity" })
      )
      expect(yield* fs.readFileString(journal.locator)).toBe("replacement\n")
      expect(yield* fs.exists(repository.locator)).toBe(true)
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

it.effect("Alice reports an unreadable exact identity without attempting removal", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const manifest = yield* makeFixture()
      const target = manifest.resources.find(({ _tag }) => _tag === "Repository")
      if (target === undefined) return yield* Effect.die("missing repository fixture")
      const controlled = FileSystem.FileSystem.of({
        ...fs,
        stat: (locator) =>
          locator === target.locator
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "ProductionLiveCleanupTest",
                  method: "stat",
                  pathOrDescriptor: locator
                })
              )
            : fs.stat(locator)
      })
      const result = yield* cleanupProductionLiveFixture(manifest, completedController(manifest.invocationId)).pipe(
        Effect.provideService(FileSystem.FileSystem, controlled)
      )
      expect(result._tag).toBe("Retained")
      expect(result.removed).toEqual([])
      expect(result.retained).toContainEqual(expect.objectContaining({ locator: target.locator, reason: "Unreadable" }))
      for (const resource of manifest.resources) expect(yield* fs.exists(resource.locator)).toBe(true)
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

it.effect("Alice retains the exact failed leaf and container after one ambiguous deletion attempt", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const manifest = yield* makeFixture()
      const target = manifest.resources.find(({ _tag }) => _tag === "Repository")
      if (target === undefined) return yield* Effect.die("missing repository fixture")
      let attempts = 0
      const controlled = FileSystem.FileSystem.of({
        ...fs,
        remove: (locator, options) => {
          if (locator !== target.locator) return fs.remove(locator, options)
          attempts += 1
          return Effect.fail(
            PlatformError.systemError({
              _tag: "Unknown",
              module: "ProductionLiveCleanupTest",
              method: "remove",
              pathOrDescriptor: locator
            })
          )
        }
      })
      const result = yield* cleanupProductionLiveFixture(manifest, completedController(manifest.invocationId)).pipe(
        Effect.provideService(FileSystem.FileSystem, controlled)
      )
      expect(attempts).toBe(1)
      expect(result._tag).toBe("Retained")
      expect(result.removed).toEqual([])
      expect(result.retained).toContainEqual(
        expect.objectContaining({ locator: target.locator, reason: "DeletionUnproved" })
      )
      expect(result.retained.every(({ manualCommand }) => !/\brm\b/u.test(manualCommand))).toBe(true)
    })
  ).pipe(Effect.provide(NodeServices.layer))
)
