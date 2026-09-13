/* eslint-disable import/no-nodejs-modules -- Qualification cleanup validates exact local path relationships. */
/* eslint-disable import-x/no-unused-modules -- Shipped qualification and external test-support consume these boundary contracts outside the production lint graph. */
import nodePath from "node:path"
import { Effect, FileSystem, HashSet, MutableList, Option, Schema } from "effect"
import { LiveQualificationInvocationId } from "./live-qualification-evidence.js"

const canonicalAbsoluteLocator = Schema.NonEmptyString.check(
  Schema.makeFilter((value) =>
    nodePath.isAbsolute(value) && nodePath.normalize(value) === value
      ? undefined
      : "live qualification local resource locator must be normalized and absolute"
  )
)

/** Locates one exact canonical local object recorded as owned by Q. */
export const ProductionLiveLocalResourceLocator = canonicalAbsoluteLocator.pipe(
  Schema.brand("ProductionLiveLocalResourceLocator")
)
export type ProductionLiveLocalResourceLocator = typeof ProductionLiveLocalResourceLocator.Type

/** Locates the exact Q-owned live fixture container, not a shared temporary root. */
export const ProductionLiveLocalContainer = ProductionLiveLocalResourceLocator.pipe(
  Schema.brand("ProductionLiveLocalContainer")
)
export type ProductionLiveLocalContainer = typeof ProductionLiveLocalContainer.Type

const LocalDevice = Schema.Int.pipe(Schema.brand("ProductionLiveLocalDevice"))
const LocalInode = Schema.Int.pipe(Schema.brand("ProductionLiveLocalInode"))

/** Identifies the created local object independently of its reusable filesystem path. */
export const ProductionLiveLocalIdentity = Schema.Struct({
  device: LocalDevice,
  inode: LocalInode,
  kind: Schema.Literals([
    "File",
    "Directory",
    "SymbolicLink",
    "BlockDevice",
    "CharacterDevice",
    "FIFO",
    "Socket",
    "Unknown"
  ])
})
export type ProductionLiveLocalIdentity = typeof ProductionLiveLocalIdentity.Type

const localResourceFields = { locator: ProductionLiveLocalResourceLocator, identity: ProductionLiveLocalIdentity }
const OriginalRegularFileIdentity = ProductionLiveLocalIdentity.check(
  Schema.makeFilter((identity) =>
    identity.kind === "File" ? undefined : "original atomic-replacement resource was not a file"
  )
)

/** Each variant names one exact Q leaf; no variant grants authority over a parent or matching prefix. */
export const ProductionLiveLocalResource = Schema.TaggedUnion({
  Repository: localResourceFields,
  JournalDatabase: localResourceFields,
  EvidenceRoot: localResourceFields,
  AttemptWorktreeRoot: localResourceFields,
  CodexStateDirectory: localResourceFields,
  CandidateRoot: localResourceFields,
  /** The Integrator publishes this exact direct-child file by atomic rename, so its final inode is expected to differ. */
  ExpectedAtomicReplacement: { locator: ProductionLiveLocalResourceLocator, identity: OriginalRegularFileIdentity },
  ConfigurationDocument: localResourceFields,
  ManifestDocument: localResourceFields,
  OwnershipMarker: localResourceFields
})
export type ProductionLiveLocalResource = typeof ProductionLiveLocalResource.Type

const UniqueResources = Schema.Array(ProductionLiveLocalResource).check(
  Schema.makeFilter((resources) => {
    let locators = HashSet.empty<string>()
    for (const resource of resources) {
      if (HashSet.has(locators, resource.locator)) return "duplicate local resource locator"
      locators = HashSet.add(locators, resource.locator)
    }
    if (resources.filter((resource) => resource._tag === "ExpectedAtomicReplacement").length !== 1)
      return "manifest must contain exactly one expected atomic replacement"
    return undefined
  })
)

/** Original local creation receipts for one live invocation. */
export const ProductionLiveLocalFixtureManifest = Schema.Struct({
  invocationId: LiveQualificationInvocationId,
  container: Schema.Struct({ locator: ProductionLiveLocalContainer, identity: ProductionLiveLocalIdentity }),
  resources: UniqueResources
})
export type ProductionLiveLocalFixtureManifest = typeof ProductionLiveLocalFixtureManifest.Type

export interface ProductionLiveCleanupController {
  readonly invocationId: LiveQualificationInvocationId
  readonly ownedChildrenStopped: Effect.Effect<boolean, ProductionLiveCleanupStatusFailure>
  readonly selectedRunsCompleted: Effect.Effect<boolean, ProductionLiveCleanupStatusFailure>
}

/** A sanitized failure to read one prerequisite for fixture cleanup authority. */
export class ProductionLiveCleanupStatusFailure extends Schema.TaggedError<ProductionLiveCleanupStatusFailure>()(
  "ProductionLiveCleanupStatusFailure",
  { operation: Schema.Literals(["ObserveOwnedChildren", "ObserveSelectedRuns"]) }
) {}

const RetentionReason = Schema.Literals([
  "ForeignInvocation",
  "ChildrenRunning",
  "UnfinishedRun",
  "StatusUnreadable",
  "ChangedIdentity",
  "Unreadable",
  "DeletionUnproved",
  "ContainerNonempty",
  "UnexpectedContainerEntry",
  "UnexpectedReplacementKind",
  "BlockedByUnprovedResource"
])
type RetentionReason = typeof RetentionReason.Type

const RetainedLocator = Schema.Struct({
  locator: ProductionLiveLocalResourceLocator,
  reason: RetentionReason,
  manualCommand: Schema.NonEmptyString
})
type RetainedLocator = typeof RetainedLocator.Type

/** A result distinguishes proved absence from every exact locator that still needs inspection. */
export const ProductionLiveFixtureCleanup = Schema.TaggedUnion({
  Removed: { removed: Schema.Array(ProductionLiveLocalResource), retained: Schema.Array(RetainedLocator) },
  Retained: { removed: Schema.Array(ProductionLiveLocalResource), retained: Schema.Array(RetainedLocator) }
})
export type ProductionLiveFixtureCleanup = typeof ProductionLiveFixtureCleanup.Type

export class ProductionLiveCleanupManifestFailure extends Schema.TaggedError<ProductionLiveCleanupManifestFailure>()(
  "ProductionLiveCleanupManifestFailure",
  { reason: Schema.Literals(["InvalidManifest", "IdentityUnavailable"]) }
) {}

/** Captures the immutable device/inode/kind receipt immediately after creation. */
export const captureProductionLiveLocalIdentity = Effect.fn("ProductionLiveFixture.captureIdentity")(function* (
  input: unknown
) {
  const fs = yield* FileSystem.FileSystem
  const locator = yield* Schema.decodeUnknownEffect(ProductionLiveLocalResourceLocator)(input).pipe(
    Effect.mapError(() => new ProductionLiveCleanupManifestFailure({ reason: "InvalidManifest" }))
  )
  const stat = yield* fs.stat(locator)
  if (Option.isNone(stat.ino)) return yield* new ProductionLiveCleanupManifestFailure({ reason: "IdentityUnavailable" })
  return ProductionLiveLocalIdentity.make({
    device: LocalDevice.make(stat.dev),
    inode: LocalInode.make(stat.ino.value),
    kind: stat.type
  })
})

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const inspection = (locator: ProductionLiveLocalResourceLocator) => `stat -- ${shellQuote(locator)}`
const containerInspection = (locator: ProductionLiveLocalResourceLocator) =>
  `find ${shellQuote(locator)} -mindepth 1 -maxdepth 1 -print`
const retained = (
  locator: ProductionLiveLocalResourceLocator,
  reason: RetentionReason,
  container = false
): RetainedLocator => ({
  locator,
  reason,
  manualCommand: container ? containerInspection(locator) : inspection(locator)
})

const sameIdentity = (left: ProductionLiveLocalIdentity, right: ProductionLiveLocalIdentity) =>
  left.device === right.device && left.inode === right.inode && left.kind === right.kind

const observeIdentity = Effect.fn("ProductionLiveFixture.observeIdentity")(function* (
  locator: ProductionLiveLocalResourceLocator
) {
  return yield* captureProductionLiveLocalIdentity(locator).pipe(Effect.result)
})

const allLocators = (manifest: ProductionLiveLocalFixtureManifest, reason: RetentionReason) => [
  retained(manifest.container.locator, reason, true),
  ...manifest.resources.map((resource) => retained(resource.locator, reason))
]

/** Removes only recorded Q leaves, then only the proved-empty exact Q container, with absence rereads. */
export const cleanupProductionLiveFixture = Effect.fn("ProductionLiveFixture.cleanup")(function* (
  input: unknown,
  controller: ProductionLiveCleanupController
) {
  const manifest = yield* Schema.decodeUnknownEffect(ProductionLiveLocalFixtureManifest, {
    onExcessProperty: "error",
    reportInput: false
  })(input).pipe(Effect.mapError(() => new ProductionLiveCleanupManifestFailure({ reason: "InvalidManifest" })))
  if (controller.invocationId !== manifest.invocationId)
    return ProductionLiveFixtureCleanup.cases.Retained.make({
      removed: [],
      retained: allLocators(manifest, "ForeignInvocation")
    })
  const stopped = yield* controller.ownedChildrenStopped.pipe(Effect.result)
  if (stopped._tag === "Failure")
    return ProductionLiveFixtureCleanup.cases.Retained.make({
      removed: [],
      retained: allLocators(manifest, "StatusUnreadable")
    })
  if (!stopped.success)
    return ProductionLiveFixtureCleanup.cases.Retained.make({
      removed: [],
      retained: allLocators(manifest, "ChildrenRunning")
    })
  const completed = yield* controller.selectedRunsCompleted.pipe(Effect.result)
  if (completed._tag === "Failure")
    return ProductionLiveFixtureCleanup.cases.Retained.make({
      removed: [],
      retained: allLocators(manifest, "StatusUnreadable")
    })
  if (!completed.success)
    return ProductionLiveFixtureCleanup.cases.Retained.make({
      removed: [],
      retained: allLocators(manifest, "UnfinishedRun")
    })

  const containerPath = nodePath.resolve(manifest.container.locator)
  const invalid = manifest.resources.find(
    (resource) => nodePath.dirname(nodePath.resolve(resource.locator)) !== containerPath
  )
  if (invalid !== undefined)
    return ProductionLiveFixtureCleanup.cases.Retained.make({
      removed: [],
      retained: [
        retained(invalid.locator, "ChangedIdentity"),
        ...allLocators(manifest, "BlockedByUnprovedResource").filter(({ locator }) => locator !== invalid.locator)
      ]
    })

  const containerIdentity = yield* observeIdentity(manifest.container.locator)
  if (containerIdentity._tag === "Failure")
    return ProductionLiveFixtureCleanup.cases.Retained.make({
      removed: [],
      retained: allLocators(manifest, "Unreadable")
    })
  if (!sameIdentity(manifest.container.identity, containerIdentity.success))
    return ProductionLiveFixtureCleanup.cases.Retained.make({
      removed: [],
      retained: allLocators(manifest, "ChangedIdentity")
    })

  const fs = yield* FileSystem.FileSystem
  const entries = yield* fs.readDirectory(manifest.container.locator).pipe(Effect.result)
  if (entries._tag === "Failure")
    return ProductionLiveFixtureCleanup.cases.Retained.make({
      removed: [],
      retained: allLocators(manifest, "Unreadable")
    })
  const declaredNames = new Set(manifest.resources.map((resource) => nodePath.basename(resource.locator)))
  const unexpected = entries.success.filter((entry) => !declaredNames.has(entry))
  if (unexpected.length > 0)
    return ProductionLiveFixtureCleanup.cases.Retained.make({
      removed: [],
      retained: [
        ...unexpected.map((entry) =>
          retained(
            ProductionLiveLocalResourceLocator.make(nodePath.join(manifest.container.locator, entry)),
            "UnexpectedContainerEntry"
          )
        ),
        ...allLocators(manifest, "BlockedByUnprovedResource")
      ]
    })

  for (const receipt of manifest.resources) {
    const current = yield* observeIdentity(receipt.locator)
    if (current._tag === "Failure")
      return ProductionLiveFixtureCleanup.cases.Retained.make({
        removed: [],
        retained: [
          retained(receipt.locator, "Unreadable"),
          ...allLocators(manifest, "BlockedByUnprovedResource").filter(({ locator }) => locator !== receipt.locator)
        ]
      })
    if (receipt._tag === "ExpectedAtomicReplacement" && current.success.kind !== "File")
      return ProductionLiveFixtureCleanup.cases.Retained.make({
        removed: [],
        retained: [
          retained(receipt.locator, "UnexpectedReplacementKind"),
          ...allLocators(manifest, "BlockedByUnprovedResource").filter(({ locator }) => locator !== receipt.locator)
        ]
      })
    if (receipt._tag !== "ExpectedAtomicReplacement" && !sameIdentity(receipt.identity, current.success))
      return ProductionLiveFixtureCleanup.cases.Retained.make({
        removed: [],
        retained: [
          retained(receipt.locator, "ChangedIdentity"),
          ...allLocators(manifest, "BlockedByUnprovedResource").filter(({ locator }) => locator !== receipt.locator)
        ]
      })
  }
  const removed = MutableList.make<ProductionLiveLocalResource>()
  for (const resource of manifest.resources) {
    const deletion = yield* fs.remove(resource.locator, { recursive: true }).pipe(Effect.result)
    const absence = yield* fs.exists(resource.locator).pipe(Effect.result)
    if (deletion._tag === "Failure" || absence._tag === "Failure" || absence.success) {
      const removedValues = MutableList.toArray(removed)
      const remaining = manifest.resources.filter((candidate) => !removedValues.includes(candidate))
      return ProductionLiveFixtureCleanup.cases.Retained.make({
        removed: removedValues,
        retained: [
          retained(manifest.container.locator, "BlockedByUnprovedResource", true),
          ...remaining.map((candidate) =>
            retained(candidate.locator, candidate === resource ? "DeletionUnproved" : "BlockedByUnprovedResource")
          )
        ]
      })
    }
    MutableList.append(removed, resource)
  }
  const children = yield* fs.readDirectory(manifest.container.locator).pipe(Effect.result)
  if (children._tag === "Failure")
    return ProductionLiveFixtureCleanup.cases.Retained.make({
      removed: MutableList.toArray(removed),
      retained: [retained(manifest.container.locator, "Unreadable", true)]
    })
  if (children.success.length > 0)
    return ProductionLiveFixtureCleanup.cases.Retained.make({
      removed: MutableList.toArray(removed),
      retained: [retained(manifest.container.locator, "ContainerNonempty", true)]
    })
  const containerDeletion = yield* fs.remove(manifest.container.locator, { recursive: true }).pipe(Effect.result)
  const containerAbsence = yield* fs.exists(manifest.container.locator).pipe(Effect.result)
  if (containerDeletion._tag === "Failure" || containerAbsence._tag === "Failure" || containerAbsence.success)
    return ProductionLiveFixtureCleanup.cases.Retained.make({
      removed: MutableList.toArray(removed),
      retained: [retained(manifest.container.locator, "DeletionUnproved", true)]
    })
  return ProductionLiveFixtureCleanup.cases.Removed.make({ removed: MutableList.toArray(removed), retained: [] })
})
