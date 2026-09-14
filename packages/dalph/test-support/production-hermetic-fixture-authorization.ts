import { Effect, FileSystem, HashSet, Match, Redacted, Schema } from "effect"
import {
  authorizeHermeticFixture,
  HermeticFixtureManifest,
  HermeticFixtureResource
} from "../src/application/production-hermetic-contract.js"
import { decodeProductionRepositoryHostConfiguration } from "../src/application/production-configuration.js"
import type { HermeticControllerFixture } from "./production-hermetic-controller.js"
import { HermeticControllerFailure } from "./production-hermetic-child-lifetime.js"

const resourceBelongsToFixture = (fixture: HermeticControllerFixture, resource: HermeticFixtureResource) =>
  Match.valueTags(resource, {
    Repository: ({ locator }) => locator === fixture.manifest.repository,
    CommonDirectory: ({ locator }) => locator === fixture.manifest.commonDirectory,
    ConfigurationDocument: ({ locator }) => locator === fixture.configurationPath,
    ManifestDocument: ({ locator }) => locator === fixture.manifestPath,
    JournalDatabase: ({ locator }) => locator === fixture.manifest.journalDatabase,
    EvidenceRoot: ({ locator }) => locator === fixture.manifest.evidenceRoot,
    AttemptWorktreeRoot: ({ locator }) => locator === fixture.manifest.attemptWorktreeRoot,
    CodexExecutorPrivateStateDirectory: ({ locator }) =>
      locator === fixture.manifest.codexExecutorPrivateStateDirectory,
    CandidateRoot: ({ locator }) => locator === fixture.manifest.candidateRoot,
    PrivateStore: ({ locator }) => locator === fixture.manifest.privateStore,
    OwnershipMarker: ({ locator }) => locator === fixture.manifest.ownershipMarker
  })

const resourceKey = (resource: HermeticFixtureResource) => `${resource._tag}:${resource.locator}`

const creationMatchesManifest = ({ creation, manifest }: HermeticControllerFixture) =>
  creation.invocationId === manifest.invocationId &&
  creation.repository === manifest.repository &&
  creation.commonDirectory === manifest.commonDirectory &&
  creation.ownershipMarker === manifest.ownershipMarker

/** A matching configuration never substitutes for the successful creation ledger. */
const validateCreationLedger = Effect.fn("HermeticController.validateCreation")(function* (
  fixture: HermeticControllerFixture
) {
  const creation = fixture.creation
  const resources = creation.createdResources
  const resourceKeys = HashSet.fromIterable(resources.map(resourceKey))
  const identityKeys = HashSet.fromIterable(fixture.identities.map(({ resource }) => resourceKey(resource)))
  if (!creationMatchesManifest(fixture) || resources.some((resource) => !resourceBelongsToFixture(fixture, resource))) {
    return yield* new HermeticControllerFailure({ operation: "fixture.foreignCreation" })
  }
  if (
    HashSet.size(resourceKeys) !== Object.keys(HermeticFixtureResource.cases).length ||
    HashSet.size(resourceKeys) !== resources.length ||
    HashSet.size(identityKeys) !== fixture.identities.length ||
    !HashSet.isSubset(resourceKeys, identityKeys) ||
    !HashSet.isSubset(identityKeys, resourceKeys)
  ) {
    return yield* new HermeticControllerFailure({ operation: "fixture.invalidCreationLedger" })
  }
})

/** Reads owning boundaries now; cached configuration and marker bytes cannot authorize a child. */
export const authorizeHermeticControllerFixture = Effect.fn("HermeticController.authorize")(function* (
  fixture: HermeticControllerFixture
) {
  yield* validateCreationLedger(fixture)
  const fs = yield* FileSystem.FileSystem
  const manifestDocument = yield* fs
    .readFileString(fixture.manifestPath)
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(HermeticFixtureManifest))))
  if (!Schema.toEquivalence(HermeticFixtureManifest)(fixture.manifest, manifestDocument))
    return yield* new HermeticControllerFailure({ operation: "fixture.changedManifest" })
  const document = yield* fs
    .readFileString(fixture.configurationPath)
    .pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))))
    )
  const c = yield* decodeProductionRepositoryHostConfiguration({
    ...document,
    target: fixture.configuration.target,
    githubToken: Redacted.value(fixture.configuration.githubToken)
  })
  return yield* authorizeHermeticFixture(fixture.manifest, c)
})
