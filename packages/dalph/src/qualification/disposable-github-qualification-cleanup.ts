import { EvidenceDigest } from "@dalph/contracts"
import {
  GithubIssueNodeId,
  GithubIssueNumber,
  GithubLabelName,
  GithubLabelNodeId,
  GithubRepositoryName,
  GithubRepositoryNodeId,
  GithubRepositoryOwner
} from "@dalph/orchestrator"
import { Data, Effect, HashSet, MutableList, Schema } from "effect"
import { HermeticInvocationId } from "../application/production-hermetic-contract.js"

export const DisposableGithubQualificationRepositoryIdentity = Schema.Struct({
  owner: GithubRepositoryOwner,
  name: GithubRepositoryName,
  nodeId: GithubRepositoryNodeId
})
type RepositoryIdentity = typeof DisposableGithubQualificationRepositoryIdentity.Type

/** Original fixture-created issue or label identity and its measured ownership fingerprint. */
export const DisposableGithubQualificationResource = Schema.TaggedUnion({
  Issue: { number: GithubIssueNumber, nodeId: GithubIssueNodeId, fingerprint: EvidenceDigest },
  Label: { nodeId: GithubLabelNodeId, name: GithubLabelName, fingerprint: EvidenceDigest }
})
export type DisposableGithubQualificationResource = typeof DisposableGithubQualificationResource.Type

/** The issue and label variants share one GitHub node-id namespace in a manifest. */
export const UniqueDisposableGithubQualificationResources = Schema.Array(DisposableGithubQualificationResource).check(
  Schema.makeFilter(
    (resources) => {
      let nodeIds = HashSet.empty<string>()
      for (const resource of resources) {
        if (HashSet.has(nodeIds, resource.nodeId)) return "duplicate GitHub node ID"
        nodeIds = HashSet.add(nodeIds, resource.nodeId)
      }
      return undefined
    },
    { message: "resources must not contain duplicate GitHub node IDs" }
  )
)

/** Creation receipts for one hermetic invocation, never reconstructed from cleanup-time provider state. */
export const DisposableGithubQualificationManifest = Schema.Struct({
  invocationId: HermeticInvocationId,
  repository: DisposableGithubQualificationRepositoryIdentity,
  resources: UniqueDisposableGithubQualificationResources
})
export type DisposableGithubQualificationManifest = typeof DisposableGithubQualificationManifest.Type

/** A fresh exact repository read proves either its identity or its absence. */
export const DisposableGithubRepositoryObservation = Schema.TaggedUnion({
  Absent: {},
  Present: { repository: DisposableGithubQualificationRepositoryIdentity }
})
/** A fresh exact issue/label read proves either its current identity or its absence. */
export const DisposableGithubResourceObservation = Schema.TaggedUnion({
  Absent: {},
  Present: { resource: DisposableGithubQualificationResource }
})

/** An exact controlled cleanup read or mutation could not supply a usable result. */
export class DisposableGithubCleanupBoundaryFailure extends Schema.TaggedError<DisposableGithubCleanupBoundaryFailure>()(
  "DisposableGithubCleanupBoundaryFailure",
  { reason: Schema.Literals(["Unreadable", "Throttled"]) }
) {}

export interface DisposableGithubCleanupAdapter {
  readonly readRepository: (
    repository: RepositoryIdentity
  ) => Effect.Effect<typeof DisposableGithubRepositoryObservation.Type, DisposableGithubCleanupBoundaryFailure>
  readonly readResource: (
    repository: RepositoryIdentity,
    resource: DisposableGithubQualificationResource
  ) => Effect.Effect<typeof DisposableGithubResourceObservation.Type, DisposableGithubCleanupBoundaryFailure>
  readonly deleteResource: (
    repository: RepositoryIdentity,
    resource: DisposableGithubQualificationResource
  ) => Effect.Effect<void, DisposableGithubCleanupBoundaryFailure>
}

const RetainedResource = Schema.Struct({
  resource: DisposableGithubQualificationResource,
  reason: Schema.Literals([
    "ForeignInvocation",
    "ForeignRepository",
    "RepositoryUnreadable",
    "ChangedIdentity",
    "Unreadable",
    "Throttled",
    "AbsenceUnproved"
  ]),
  manualCommand: Schema.NonEmptyString
})
type RetainedResource = typeof RetainedResource.Type

/** Reports only proven deletion or absence; unresolved resources keep their original exact receipts. */
export const DisposableGithubQualificationCleanup = Schema.Struct({
  repository: DisposableGithubQualificationRepositoryIdentity,
  removed: Schema.Array(DisposableGithubQualificationResource),
  alreadyAbsent: Schema.Array(DisposableGithubQualificationResource),
  retained: Schema.Array(RetainedResource)
})
export type DisposableGithubQualificationCleanup = typeof DisposableGithubQualificationCleanup.Type

/** Malformed creation evidence grants no controlled cleanup calls. */
export class DisposableGithubCleanupManifestFailure extends Schema.TaggedError<DisposableGithubCleanupManifestFailure>()(
  "DisposableGithubCleanupManifestFailure",
  {}
) {}

const sameRepository = (left: RepositoryIdentity, right: RepositoryIdentity) =>
  left.owner === right.owner && left.name === right.name && left.nodeId === right.nodeId

const sameResource = (left: DisposableGithubQualificationResource, right: DisposableGithubQualificationResource) =>
  left._tag === right._tag &&
  left.nodeId === right.nodeId &&
  left.fingerprint === right.fingerprint &&
  (left._tag === "Issue"
    ? right._tag === "Issue" && left.number === right.number
    : right._tag === "Label" && left.name === right.name)

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const manualCommand = (resource: DisposableGithubQualificationResource) => {
  const query = "query($id: ID!) { node(id: $id) { id __typename } }"
  return `gh api graphql -f query=${shellQuote(query)} -f id=${shellQuote(resource.nodeId)}`
}

type RemovalOutcome = Data.TaggedEnum<{
  Removed: { readonly resource: DisposableGithubQualificationResource }
  AlreadyAbsent: { readonly resource: DisposableGithubQualificationResource }
  Retained: { readonly entry: RetainedResource }
}>
const RemovalOutcome = Data.taggedEnum<RemovalOutcome>()
const retention = (resource: DisposableGithubQualificationResource, reason: RetainedResource["reason"]) => ({
  resource,
  reason,
  manualCommand: manualCommand(resource)
})

const removeResource = Effect.fn("DisposableGithubQualification.removeResource")(function* (
  repository: RepositoryIdentity,
  resource: DisposableGithubQualificationResource,
  adapter: DisposableGithubCleanupAdapter
) {
  const observation = yield* adapter.readResource(repository, resource).pipe(Effect.result)
  if (observation._tag === "Failure") {
    return RemovalOutcome.Retained({ entry: retention(resource, observation.failure.reason) })
  }
  if (observation.success._tag === "Absent") return RemovalOutcome.AlreadyAbsent({ resource })
  if (!sameResource(observation.success.resource, resource)) {
    return RemovalOutcome.Retained({ entry: retention(resource, "ChangedIdentity") })
  }
  const deletion = yield* adapter.deleteResource(repository, resource).pipe(Effect.result)
  if (deletion._tag === "Failure") {
    return RemovalOutcome.Retained({ entry: retention(resource, deletion.failure.reason) })
  }
  const absence = yield* adapter.readResource(repository, resource).pipe(Effect.result)
  return absence._tag === "Success" && absence.success._tag === "Absent"
    ? RemovalOutcome.Removed({ resource })
    : RemovalOutcome.Retained({ entry: retention(resource, "AbsenceUnproved") })
})

const repositoryRetentionReason = Effect.fn("DisposableGithubQualification.readRepository")(function* (
  repository: RepositoryIdentity,
  adapter: DisposableGithubCleanupAdapter
) {
  const observation = yield* adapter.readRepository(repository).pipe(Effect.result)
  if (observation._tag === "Failure") return "RepositoryUnreadable" as const
  return observation.success._tag === "Absent" || !sameRepository(observation.success.repository, repository)
    ? ("ForeignRepository" as const)
    : null
})

/** Runs the exact cleanup protocol while preserving the caller's invocation-id brand. */
export const cleanupDisposableGithubQualificationCore = Effect.fn("DisposableGithubQualification.cleanupCore")(
  function* <InvocationId>(
    manifest: {
      readonly invocationId: InvocationId
      readonly repository: RepositoryIdentity
      readonly resources: ReadonlyArray<DisposableGithubQualificationResource>
    },
    expected: { readonly invocationId: InvocationId; readonly repository: RepositoryIdentity },
    adapter: DisposableGithubCleanupAdapter
  ) {
    const removed = MutableList.make<DisposableGithubQualificationResource>()
    const alreadyAbsent = MutableList.make<DisposableGithubQualificationResource>()
    const retained = MutableList.make<RetainedResource>()
    const retain = (resource: DisposableGithubQualificationResource, reason: RetainedResource["reason"]) =>
      MutableList.append(retained, retention(resource, reason))
    const authorization =
      manifest.invocationId !== expected.invocationId
        ? "ForeignInvocation"
        : !sameRepository(manifest.repository, expected.repository)
          ? "ForeignRepository"
          : null
    if (authorization !== null) {
      for (const resource of manifest.resources) retain(resource, authorization)
    } else {
      const repositoryReason = yield* repositoryRetentionReason(manifest.repository, adapter)
      if (repositoryReason !== null) {
        for (const resource of manifest.resources) retain(resource, repositoryReason)
      } else {
        for (const resource of manifest.resources) {
          const outcome = yield* removeResource(manifest.repository, resource, adapter)
          RemovalOutcome.$match(outcome, {
            Removed: ({ resource }) => MutableList.append(removed, resource),
            AlreadyAbsent: ({ resource }) => MutableList.append(alreadyAbsent, resource),
            Retained: ({ entry }) => MutableList.append(retained, entry)
          })
        }
      }
    }
    return DisposableGithubQualificationCleanup.make({
      repository: manifest.repository,
      removed: MutableList.toArray(removed),
      alreadyAbsent: MutableList.toArray(alreadyAbsent),
      retained: MutableList.toArray(retained)
    })
  }
)

export const cleanupDisposableGithubQualification = Effect.fn("DisposableGithubQualification.cleanup")(function* (
  input: unknown,
  expected: { readonly invocationId: HermeticInvocationId; readonly repository: RepositoryIdentity },
  adapter: DisposableGithubCleanupAdapter
) {
  const manifest = yield* Schema.decodeUnknownEffect(DisposableGithubQualificationManifest, {
    onExcessProperty: "error",
    reportInput: false
  })(input).pipe(Effect.mapError(() => new DisposableGithubCleanupManifestFailure()))
  return yield* cleanupDisposableGithubQualificationCore(manifest, expected, adapter)
})
