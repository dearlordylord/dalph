import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { GitCommitSha } from "@dalph/contracts"
import { nodeGitCommandLayer } from "@dalph/orchestrator"
import { Effect, FileSystem, Layer, PlatformError } from "effect"
import { expect } from "vitest"
import { createHermeticFixture } from "./production-hermetic-fixture.js"
import {
  makeHermeticController,
  readHermeticFileIdentity,
  type HermeticControllerFixture
} from "./production-hermetic-controller.js"
import {
  disposeHermeticFixture,
  type HermeticFixtureDisposal as HermeticFixtureDisposalValue
} from "./production-hermetic-fixture-cleanup.js"

const builtEntry = new URL("../dist/bin/production-hermetic-qualification.js", import.meta.url).pathname
const sourceBaseSha = GitCommitSha.make("bf027ef1588d0ec0d0e749b812d6652343682c3b")
const fixtureLayer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))

const resourceKey = (resource: HermeticControllerFixture["creation"]["createdResources"][number]) =>
  `${resource._tag}\u0000${resource.locator}`

const sortedResourceKeys = (
  resources: ReadonlyArray<HermeticControllerFixture["creation"]["createdResources"][number]>
) => resources.map(resourceKey).sort()

const expectRetainedFixture = (disposal: HermeticFixtureDisposalValue, fixture: HermeticControllerFixture) => {
  expect(disposal._tag).toBe("RetainedFixture")
  if (disposal._tag !== "RetainedFixture") return
  expect(disposal.removed).toEqual([])
  expect(sortedResourceKeys(disposal.retained)).toEqual(sortedResourceKeys(fixture.creation.createdResources))
  expect(disposal.retainedContainer).toBe(fixture.container)
}

const expectResourcesExist = Effect.fn("HermeticFixtureCleanupTest.expectResourcesExist")(function* (
  fixture: HermeticControllerFixture,
  expected: boolean
) {
  const fs = yield* FileSystem.FileSystem
  for (const resource of fixture.creation.createdResources) {
    expect(yield* fs.exists(resource.locator)).toBe(expected)
  }
  expect(yield* fs.exists(fixture.container)).toBe(true)
})

const makeFixtureAndController = Effect.gen(function* () {
  const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
  const controller = yield* makeHermeticController(fixture, { _tag: "Unpaused" })
  return { fixture, controller }
})

it.effect(
  "removes exactly the original no-child resources and rereads their absence while retaining the container",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const { controller, fixture } = yield* makeFixtureAndController
        const createdResources = fixture.creation.createdResources

        const disposal = yield* disposeHermeticFixture(fixture, controller)

        expect(disposal._tag).toBe("RemovedResources")
        if (disposal._tag !== "RemovedResources") return
        expect(sortedResourceKeys(disposal.removed)).toEqual(sortedResourceKeys(createdResources))
        expect(disposal.retainedContainer).toBe(fixture.container)
        yield* expectResourcesExist(fixture, false)
        expect(yield* fs.exists(fixture.container)).toBe(true)
      })
    ).pipe(Effect.provide(fixtureLayer))
)

it.effect(
  "retains the exact original inventory and foreign sentinel when a different Q controller authorizes cleanup",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const first = yield* makeFixtureAndController
        const second = yield* makeFixtureAndController
        const sentinel = `${first.fixture.container}/foreign-sentinel.txt`
        yield* fs.writeFileString(sentinel, "foreign fixture sentinel\n")

        const disposal = yield* disposeHermeticFixture(first.fixture, second.controller)

        expectRetainedFixture(disposal, first.fixture)
        if (disposal._tag !== "RetainedFixture") return
        expect(disposal.cause).toEqual({ _tag: "AuthorizationRejected" })
        expect(yield* fs.readFileString(sentinel)).toBe("foreign fixture sentinel\n")
        yield* expectResourcesExist(first.fixture, true)
      })
    ).pipe(Effect.provide(fixtureLayer))
)

it.effect("retains the fixture after an atomic same-path private-store replacement with a different inode", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const { controller, fixture } = yield* makeFixtureAndController
      const originalJournal = yield* fs.readFileString(fixture.manifest.journalDatabase)
      const originalConfiguration = yield* fs.readFileString(fixture.configurationPath)
      const originalManifest = yield* fs.readFileString(fixture.manifestPath)
      const originalPrivate = fixture.identities.find(({ resource }) => resource._tag === "PrivateStore")
      if (originalPrivate === undefined) return expect.fail("fixture did not record its private store")
      const replacement = `${fixture.manifest.privateStore}.foreign-replacement`
      yield* fs.writeFileString(replacement, "foreign private-store sentinel\n")
      yield* fs.rename(replacement, fixture.manifest.privateStore)

      const replacedIdentity = yield* readHermeticFileIdentity(fixture.manifest.privateStore)
      expect(originalPrivate.identity._tag).toBe("Known")
      expect(replacedIdentity._tag).toBe("Known")
      if (originalPrivate.identity._tag !== "Known" || replacedIdentity._tag !== "Known") return
      expect([replacedIdentity.device, replacedIdentity.inode]).not.toEqual([
        originalPrivate.identity.device,
        originalPrivate.identity.inode
      ])

      const disposal = yield* disposeHermeticFixture(fixture, controller)

      expectRetainedFixture(disposal, fixture)
      if (disposal._tag !== "RetainedFixture") return
      expect(disposal.cause).toEqual({ _tag: "ChangedIdentity", resource: originalPrivate.resource })
      expect(yield* fs.readFileString(fixture.manifest.privateStore)).toBe("foreign private-store sentinel\n")
      expect(yield* fs.readFileString(fixture.manifest.journalDatabase)).toBe(originalJournal)
      expect(yield* fs.readFileString(fixture.configurationPath)).toBe(originalConfiguration)
      expect(yield* fs.readFileString(fixture.manifestPath)).toBe(originalManifest)
      yield* expectResourcesExist(fixture, true)
    })
  ).pipe(Effect.provide(fixtureLayer))
)

it.effect("retains only an exact unreadable ownership cause through a controlled filesystem boundary", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const { controller, fixture } = yield* makeFixtureAndController
      const unreadable = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "HermeticFixtureCleanupTest",
        method: "stat",
        pathOrDescriptor: fixture.manifest.ownershipMarker
      })
      const controlledFileSystem = Layer.succeed(
        FileSystem.FileSystem,
        FileSystem.FileSystem.of({
          ...fs,
          stat: (path) => (path === fixture.manifest.ownershipMarker ? Effect.fail(unreadable) : fs.stat(path))
        })
      )

      const disposal = yield* disposeHermeticFixture(fixture, controller).pipe(Effect.provide(controlledFileSystem))

      expect(disposal._tag).toBe("RetainedFixture")
      if (disposal._tag !== "RetainedFixture") return
      expect(disposal.removed).toEqual([])
      expect(disposal.retainedContainer).toBe(fixture.container)
      expect(disposal.cause).toEqual({
        _tag: "Unreadable",
        resource: fixture.creation.createdResources.find((resource) => resource._tag === "OwnershipMarker")
      })
      expect(disposal.retained).toEqual(fixture.creation.createdResources)
      yield* expectResourcesExist(fixture, true)
    })
  ).pipe(Effect.provide(fixtureLayer))
)
