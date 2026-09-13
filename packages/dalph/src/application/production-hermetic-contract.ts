/* eslint-disable import/no-nodejs-modules -- this contract owns canonical local path values. */

import nodePath from "node:path"
import {
  EvidenceDigest,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef
} from "@dalph/contracts"
import {
  EvidenceStoreLocator,
  GitCommand,
  GitCommonDirectoryLocator,
  JournalDatabaseLocator,
  OperationId
} from "@dalph/orchestrator"
import { Effect, FileSystem, Schema } from "effect"
import { IntegratorCandidateWorktreeRoot, IntegratorPrivateStoreLocator } from "./codex-integrator-private-store.js"
import { ProductionCodexStateDirectory, ProductionPlannedAttemptWorktreeRoot } from "./production-configuration.js"
import type { ProductionRepositoryHostConfiguration } from "./production-configuration.js"
import { ProductionConfigurationLocator } from "./production-cli.js"

const canonicalAbsolutePath = (subject: string) =>
  Schema.makeFilter<string>((value) => {
    if (!nodePath.isAbsolute(value)) return `${subject} must be absolute`
    return nodePath.normalize(value) === value ? undefined : `${subject} must be normalized`
  })

/** Identifies one exact qualification invocation whose local fixture may be owned. */
export const HermeticInvocationId = Schema.NonEmptyString.pipe(Schema.brand("HermeticInvocationId"))
export type HermeticInvocationId = typeof HermeticInvocationId.Type

/** Locates the already-built production entrypoint; it is provenance, never fixture cleanup authority. */
export const HermeticBuiltEntry = Schema.NonEmptyString.check(canonicalAbsolutePath("hermetic built entry")).pipe(
  Schema.brand("HermeticBuiltEntry")
)
export type HermeticBuiltEntry = typeof HermeticBuiltEntry.Type

/** Locates the one exact qualification marker file whose contents bind the fixture to its invocation. */
export const HermeticOwnershipMarker = Schema.NonEmptyString.check(
  canonicalAbsolutePath("hermetic ownership marker")
).pipe(Schema.brand("HermeticOwnershipMarker"))
export type HermeticOwnershipMarker = typeof HermeticOwnershipMarker.Type

/** Locates the serialized Q manifest document, not an arbitrary fixture path. */
export const HermeticManifestDocument = Schema.NonEmptyString.check(
  canonicalAbsolutePath("hermetic manifest document")
).pipe(Schema.brand("HermeticManifestDocument"))
export type HermeticManifestDocument = typeof HermeticManifestDocument.Type

/**
 * The non-secret manifest passed to the built qualification command. Source
 * provenance and the disposable Git Base are deliberately different facts.
 */
export const HermeticFixtureManifest = Schema.Struct({
  invocationId: HermeticInvocationId,
  sourceBaseSha: GitCommitSha,
  builtEntry: HermeticBuiltEntry,
  builtEntryDigest: EvidenceDigest,
  repository: GitRepositoryLocator,
  commonDirectory: GitCommonDirectoryLocator,
  integrationRef: IntegrationTargetRef,
  baseSha: GitCommitSha,
  journalDatabase: JournalDatabaseLocator,
  evidenceRoot: EvidenceStoreLocator,
  attemptWorktreeRoot: ProductionPlannedAttemptWorktreeRoot,
  codexStateDirectory: ProductionCodexStateDirectory,
  candidateRoot: IntegratorCandidateWorktreeRoot,
  privateStore: IntegratorPrivateStoreLocator,
  ownershipMarker: HermeticOwnershipMarker
})
export type HermeticFixtureManifest = typeof HermeticFixtureManifest.Type

/** A concrete pause request observed at one named outer boundary. */
export const BoundaryReached = Schema.TaggedUnion({
  CompletionResponse: { operationId: OperationId },
  PromotionCompareAndSet: {
    candidateCommit: GitCommitSha,
    expectedTargetHead: GitCommitSha,
    integrationTarget: IntegrationTarget
  },
  CompletionThrottle: { operationId: OperationId }
})
export type BoundaryReached = typeof BoundaryReached.Type

/** One exact local resource created by the qualification fixture. */
export const HermeticFixtureResource = Schema.TaggedUnion({
  Repository: { locator: GitRepositoryLocator },
  CommonDirectory: { locator: GitCommonDirectoryLocator },
  ConfigurationDocument: { locator: ProductionConfigurationLocator },
  ManifestDocument: { locator: HermeticManifestDocument },
  JournalDatabase: { locator: JournalDatabaseLocator },
  EvidenceRoot: { locator: EvidenceStoreLocator },
  AttemptWorktreeRoot: { locator: ProductionPlannedAttemptWorktreeRoot },
  CodexStateDirectory: { locator: ProductionCodexStateDirectory },
  CandidateRoot: { locator: IntegratorCandidateWorktreeRoot },
  PrivateStore: { locator: IntegratorPrivateStoreLocator },
  OwnershipMarker: { locator: HermeticOwnershipMarker }
})
export type HermeticFixtureResource = typeof HermeticFixtureResource.Type

/** Marker bytes retain only the exact invocation identity; the manifest remains the Q input. */
export const HermeticOwnershipMarkerContents = Schema.Struct({ invocationId: HermeticInvocationId })
export type HermeticOwnershipMarkerContents = typeof HermeticOwnershipMarkerContents.Type

/** Facts recorded only after the controller has actually created the listed resources. */
export const HermeticFixtureCreationFacts = Schema.Struct({
  invocationId: HermeticInvocationId,
  repository: GitRepositoryLocator,
  commonDirectory: GitCommonDirectoryLocator,
  ownershipMarker: HermeticOwnershipMarker,
  createdResources: Schema.Array(HermeticFixtureResource)
})
export type HermeticFixtureCreationFacts = typeof HermeticFixtureCreationFacts.Type

/** Fresh decoded configuration facts compared with the exact Q manifest before cleanup. */
const hermeticAuthorizationReasons = [
  "InvocationMismatch",
  "RepositoryMismatch",
  "CommonDirectoryMismatch",
  "OwnershipMarkerMismatch",
  "MarkerContentsMismatch",
  "ConfigurationMismatch",
  "ResourceNotCreated",
  "ResourceForeign",
  "ResourceOverlap",
  "MarkerUnreadable"
] as const

/** A failed fresh authorization never supplies cleanup permission. */
export class HermeticFixtureAuthorizationFailure extends Schema.TaggedError<HermeticFixtureAuthorizationFailure>()(
  "HermeticFixtureAuthorizationFailure",
  { reason: Schema.Literals(hermeticAuthorizationReasons), detail: Schema.NonEmptyString }
) {}

const pathOverlaps = (left: string, right: string): boolean => {
  const relative = nodePath.relative(left, right)
  return (
    relative === "" ||
    (!relative.startsWith(`..${nodePath.sep}`) && relative !== ".." && !nodePath.isAbsolute(relative))
  )
}

const overlap = (left: string, right: string): boolean => pathOverlaps(left, right) || pathOverlaps(right, left)

const hasManifestResourceOverlap = (manifest: HermeticFixtureManifest): boolean => {
  const worktreeRoots = [manifest.attemptWorktreeRoot, manifest.candidateRoot]
  const firstWorktreeRoot = worktreeRoots[0]
  const secondWorktreeRoot = worktreeRoots[1]
  if (
    firstWorktreeRoot !== undefined &&
    secondWorktreeRoot !== undefined &&
    overlap(firstWorktreeRoot, secondWorktreeRoot)
  ) {
    return true
  }

  const statePaths = [
    manifest.repository,
    manifest.commonDirectory,
    manifest.journalDatabase,
    manifest.evidenceRoot,
    manifest.codexStateDirectory,
    manifest.privateStore
  ]
  if (worktreeRoots.some((worktree) => statePaths.some((state) => overlap(worktree, state)))) return true

  const privateStatePaths = [
    manifest.journalDatabase,
    manifest.evidenceRoot,
    manifest.codexStateDirectory,
    manifest.privateStore
  ]
  for (let left = 0; left < privateStatePaths.length; left += 1) {
    for (let right = left + 1; right < privateStatePaths.length; right += 1) {
      const leftPath = privateStatePaths[left]
      const rightPath = privateStatePaths[right]
      if (leftPath !== undefined && rightPath !== undefined && overlap(leftPath, rightPath)) return true
    }
  }
  return false
}

const authorizationFailure = (
  reason: (typeof hermeticAuthorizationReasons)[number],
  detail: string
): Effect.Effect<never, HermeticFixtureAuthorizationFailure> =>
  Effect.fail(new HermeticFixtureAuthorizationFailure({ reason, detail }))

/**
 * Compares fresh decoded configuration, canonical Git ownership, and the
 * marker reread before returning any cleanup-capable proof.
 */
const readMarkerContents = Effect.fn("HermeticFixture.readOwnershipMarker")(function* (
  fileSystem: FileSystem.FileSystem,
  marker: HermeticOwnershipMarker
) {
  const bytes = yield* fileSystem
    .readFileString(marker)
    .pipe(
      Effect.mapError(
        () =>
          new HermeticFixtureAuthorizationFailure({
            reason: "MarkerUnreadable",
            detail: "ownership marker could not be reread"
          })
      )
    )
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(HermeticOwnershipMarkerContents))(bytes).pipe(
    Effect.mapError(
      () =>
        new HermeticFixtureAuthorizationFailure({
          reason: "MarkerContentsMismatch",
          detail: "ownership marker contents are invalid"
        })
    )
  )
})

/**
 * Re-reads the exact marker and Git common directory after fresh production
 * configuration decoding. Configuration values alone never authorize cleanup.
 */
export const authorizeHermeticFixture = Effect.fn("HermeticFixture.authorize")(function* (
  manifest: HermeticFixtureManifest,
  configuration: ProductionRepositoryHostConfiguration
) {
  if (hasManifestResourceOverlap(manifest)) {
    return yield* authorizationFailure("ResourceOverlap", "manifest resource locators overlap")
  }
  if (configuration.repository !== manifest.repository) {
    return yield* authorizationFailure("RepositoryMismatch", "fresh repository identity does not match the manifest")
  }
  if (configuration.commonDirectory !== manifest.commonDirectory) {
    return yield* authorizationFailure(
      "CommonDirectoryMismatch",
      "fresh configured common directory does not match the manifest"
    )
  }
  if (
    configuration.integrationRef !== manifest.integrationRef ||
    configuration.plannedAttemptBaseSha !== manifest.baseSha ||
    configuration.journalDatabase !== manifest.journalDatabase ||
    configuration.evidenceStoreRoot !== manifest.evidenceRoot ||
    configuration.plannedAttemptWorktreeRoot !== manifest.attemptWorktreeRoot ||
    configuration.codexStateDirectory !== manifest.codexStateDirectory ||
    configuration.integratorCandidateWorktreeRoot !== manifest.candidateRoot ||
    configuration.integratorPrivateStore !== manifest.privateStore
  ) {
    return yield* authorizationFailure("ConfigurationMismatch", "fresh configuration does not match the manifest")
  }
  const fileSystem = yield* FileSystem.FileSystem
  const git = yield* GitCommand
  const marker = yield* readMarkerContents(fileSystem, manifest.ownershipMarker)
  if (marker.invocationId !== manifest.invocationId) {
    return yield* authorizationFailure("InvocationMismatch", "ownership marker belongs to another invocation")
  }
  const commonDirectory = yield* git
    .run(manifest.commonDirectory, ["rev-parse", "--git-common-dir"])
    .pipe(
      Effect.mapError(
        () =>
          new HermeticFixtureAuthorizationFailure({
            reason: "CommonDirectoryMismatch",
            detail: "Git common directory could not be reread"
          })
      )
    )
  if (commonDirectory.exitCode !== 0 || commonDirectory.stdout.trim() !== manifest.commonDirectory) {
    return yield* authorizationFailure(
      "CommonDirectoryMismatch",
      "fresh Git common directory does not match the manifest"
    )
  }
  return undefined
})
