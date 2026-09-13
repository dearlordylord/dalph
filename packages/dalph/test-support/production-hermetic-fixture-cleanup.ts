import { Effect, FileSystem, MutableList, Schema } from "effect"
import { HermeticFixtureResource } from "../src/application/production-hermetic-contract.js"
import {
  authorizeHermeticControllerFixture,
  HermeticFixtureContainer,
  readHermeticFileIdentity,
  type HermeticController,
  type HermeticControllerFixture,
  type HermeticCreatedResourceIdentity
} from "./production-hermetic-controller.js"

/** The exact cause of retaining the entire fixture, including its explanatory journal and documents. */
const RetentionCause = Schema.TaggedUnion({
  ChangedIdentity: { resource: HermeticFixtureResource },
  Unreadable: { resource: HermeticFixtureResource },
  AuthorizationRejected: {},
  ChildrenRunning: {},
  UnfinishedRun: {},
  RemovalIncomplete: {}
})
type RetentionCause = typeof RetentionCause.Type

/** Cleanup reports original resources, never an inferred broad-root permission. */
export const HermeticFixtureDisposal = Schema.TaggedUnion({
  RemovedResources: { removed: Schema.Array(HermeticFixtureResource), retainedContainer: HermeticFixtureContainer },
  RetainedFixture: {
    cause: RetentionCause,
    retained: Schema.Array(HermeticFixtureResource),
    removed: Schema.Array(HermeticFixtureResource),
    retainedContainer: HermeticFixtureContainer
  }
})
export type HermeticFixtureDisposal = typeof HermeticFixtureDisposal.Type

const identityFailure = Effect.fn("HermeticFixture.identityFailure")(function* (
  receipt: HermeticCreatedResourceIdentity
) {
  const observed = yield* readHermeticFileIdentity(receipt.resource.locator).pipe(
    Effect.catch(() => Effect.succeed({ _tag: "Unavailable" as const }))
  )
  if (receipt.identity._tag === "Unavailable" || observed._tag === "Unavailable") {
    return yield* Effect.fail(RetentionCause.cases.Unreadable.make({ resource: receipt.resource }))
  }
  if (
    receipt.identity.device !== observed.device ||
    receipt.identity.inode !== observed.inode ||
    receipt.identity.kind !== observed.kind
  ) {
    return yield* Effect.fail(RetentionCause.cases.ChangedIdentity.make({ resource: receipt.resource }))
  }
})

const checkRemovalConditions = Effect.fn("HermeticFixture.checkRemovalConditions")(function* (
  fixture: HermeticControllerFixture,
  controller: HermeticController
) {
  if (controller.invocationId !== fixture.manifest.invocationId)
    return yield* Effect.fail(RetentionCause.cases.AuthorizationRejected.make({}))
  const stopped = yield* controller.ownedChildrenStopped.pipe(Effect.catch(() => Effect.succeed(false)))
  if (!stopped) return yield* Effect.fail(RetentionCause.cases.ChildrenRunning.make({}))
  yield* controller.stopTransport.pipe(Effect.orDie)
  if (!(yield* controller.selectedRunsCompleted)) return yield* Effect.fail(RetentionCause.cases.UnfinishedRun.make({}))
  yield* authorizeHermeticControllerFixture(fixture).pipe(
    Effect.mapError(() => RetentionCause.cases.AuthorizationRejected.make({}))
  )
  for (const receipt of fixture.identities) yield* identityFailure(receipt)
})

const isMetadataResource = (resource: HermeticFixtureResource) =>
  resource._tag === "ConfigurationDocument" ||
  resource._tag === "ManifestDocument" ||
  resource._tag === "OwnershipMarker"

const removeExactResource = Effect.fn("HermeticFixture.removeExactResource")(function* (
  fixture: HermeticControllerFixture,
  resource: HermeticFixtureResource
) {
  const fs = yield* FileSystem.FileSystem
  const receipt = fixture.identities.find(
    (identity) => identity.resource._tag === resource._tag && identity.resource.locator === resource.locator
  )
  if (receipt === undefined) return yield* Effect.fail(RetentionCause.cases.AuthorizationRejected.make({}))
  yield* identityFailure(receipt)
  if (resource._tag === "Repository") {
    const common = fixture.identities.find((identity) => identity.resource._tag === "CommonDirectory")
    if (common === undefined) return yield* Effect.fail(RetentionCause.cases.AuthorizationRejected.make({}))
    yield* identityFailure(common)
  }
  yield* fs
    .remove(resource.locator, { recursive: true })
    .pipe(Effect.mapError(() => RetentionCause.cases.RemovalIncomplete.make({})))
  const present = yield* fs.exists(resource.locator).pipe(Effect.catch(() => Effect.succeed(true)))
  if (present) return yield* Effect.fail(RetentionCause.cases.RemovalIncomplete.make({}))
})

const removeFixtureResources = Effect.fn("HermeticFixture.removeResources")(function* (
  fixture: HermeticControllerFixture,
  removed: MutableList.MutableList<HermeticFixtureResource>
) {
  const fs = yield* FileSystem.FileSystem
  const resources = fixture.creation.createdResources
  const metadata = resources.filter(isMetadataResource)
  const ordered = resources.filter(
    (resource) => resource._tag !== "Repository" && resource._tag !== "CommonDirectory" && !isMetadataResource(resource)
  )
  const repository = resources.find((resource) => resource._tag === "Repository")
  if (repository === undefined) return yield* Effect.fail(RetentionCause.cases.AuthorizationRejected.make({}))
  for (const resource of [...ordered, repository]) {
    yield* removeExactResource(fixture, resource)
    MutableList.append(removed, resource)
  }
  // The common directory disappears with its exact repository; it is never independently removed.
  const common = resources.find((resource) => resource._tag === "CommonDirectory")
  if (common === undefined) return yield* Effect.fail(RetentionCause.cases.RemovalIncomplete.make({}))
  const commonPresent = yield* fs.exists(common.locator).pipe(Effect.catch(() => Effect.succeed(true)))
  if (commonPresent) return yield* Effect.fail(RetentionCause.cases.RemovalIncomplete.make({}))
  MutableList.append(removed, common)
  for (const resource of metadata) {
    yield* removeExactResource(fixture, resource)
    MutableList.append(removed, resource)
  }
})

/** Stops the original request fibers only after original owned children have exited; never retries any provider mutation. */
export const disposeHermeticFixture = Effect.fn("HermeticFixture.dispose")(function* (
  fixture: HermeticControllerFixture,
  controller: HermeticController
) {
  const removed = MutableList.make<HermeticFixtureResource>()
  const retain = (cause: RetentionCause) =>
    HermeticFixtureDisposal.cases.RetainedFixture.make({
      cause,
      removed: MutableList.toArray(removed),
      retained: fixture.creation.createdResources.filter(
        (resource) => !MutableList.toArray(removed).includes(resource)
      ),
      retainedContainer: fixture.container
    })
  const permitted = yield* checkRemovalConditions(fixture, controller).pipe(Effect.result)
  if (permitted._tag === "Failure") return retain(permitted.failure)
  const removal = yield* removeFixtureResources(fixture, removed).pipe(Effect.result)
  if (removal._tag === "Failure") return retain(removal.failure)
  return HermeticFixtureDisposal.cases.RemovedResources.make({
    removed: MutableList.toArray(removed),
    retainedContainer: fixture.container
  })
})
