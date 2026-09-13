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
import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import { HermeticInvocationId } from "../src/application/production-hermetic-contract.js"
import {
  cleanupDisposableGithubQualification,
  DisposableGithubCleanupBoundaryFailure,
  DisposableGithubCleanupManifestFailure,
  DisposableGithubQualificationManifest,
  DisposableGithubQualificationResource,
  DisposableGithubRepositoryObservation,
  DisposableGithubResourceObservation,
  type DisposableGithubCleanupAdapter
} from "./disposable-github-qualification-cleanup.js"

const repository = {
  owner: GithubRepositoryOwner.make("fixture-owner"),
  name: GithubRepositoryName.make("fixture-repository"),
  nodeId: GithubRepositoryNodeId.make("repository-node")
}
const invocationId = HermeticInvocationId.make("qualification-Q")
const issue = DisposableGithubQualificationResource.cases.Issue.make({
  number: GithubIssueNumber.make(7),
  nodeId: GithubIssueNodeId.make("issue-node"),
  fingerprint: EvidenceDigest.make("a".repeat(64))
})
const label = DisposableGithubQualificationResource.cases.Label.make({
  name: GithubLabelName.make("fixture-label"),
  nodeId: GithubLabelNodeId.make("label-node"),
  fingerprint: EvidenceDigest.make("b".repeat(64))
})
const manifest = DisposableGithubQualificationManifest.make({ invocationId, repository, resources: [label, issue] })
const expected = { invocationId, repository }
const unreadable = () => Effect.fail(new DisposableGithubCleanupBoundaryFailure({ reason: "Unreadable" }))
const makeThrottledAdapter = (record: (call: string) => Effect.Effect<void>): DisposableGithubCleanupAdapter => {
  const throttled = () => Effect.fail(new DisposableGithubCleanupBoundaryFailure({ reason: "Throttled" }))
  return {
    readRepository: (identity) => record(`repository:${identity.nodeId}`).pipe(Effect.andThen(throttled())),
    readResource: (_identity, resource) => record(`read:${resource.nodeId}`).pipe(Effect.andThen(throttled())),
    deleteResource: (_identity, resource) => record(`delete:${resource.nodeId}`).pipe(Effect.andThen(throttled()))
  }
}
const presentRepository = (value: typeof repository) =>
  DisposableGithubRepositoryObservation.cases.Present.make({ repository: value })
const presentResource = (resource: DisposableGithubQualificationResource) =>
  DisposableGithubResourceObservation.cases.Present.make({ resource })
const absentResource = DisposableGithubResourceObservation.cases.Absent.make({})
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const expectReadonlyInspection = (manualCommand: string | undefined, nodeId: string) => {
  if (manualCommand === undefined) throw new Error("expected a retained manual inspection command")
  expect(manualCommand).toContain("query($id: ID!) { node(id: $id) { id __typename } }")
  expect(manualCommand).toContain(`-f id=${shellQuote(nodeId)}`)
  expect(manualCommand).not.toContain("mutation")
  expect(manualCommand).not.toMatch(/delete(?:Issue|Label|Repository)/u)
}

const duplicateGlobalNodeId = "duplicate-global-node"
const duplicateLabel = DisposableGithubQualificationResource.cases.Label.make({
  name: GithubLabelName.make("duplicate-label"),
  nodeId: GithubLabelNodeId.make(duplicateGlobalNodeId),
  fingerprint: EvidenceDigest.make("d".repeat(64))
})
const duplicateLabelFingerprint = DisposableGithubQualificationResource.cases.Label.make({
  name: GithubLabelName.make("duplicate-label"),
  nodeId: GithubLabelNodeId.make(duplicateGlobalNodeId),
  fingerprint: EvidenceDigest.make("e".repeat(64))
})
const duplicateIssue = DisposableGithubQualificationResource.cases.Issue.make({
  number: GithubIssueNumber.make(8),
  nodeId: GithubIssueNodeId.make(duplicateGlobalNodeId),
  fingerprint: EvidenceDigest.make("f".repeat(64))
})

for (const duplicate of [
  { description: "an exact resource", resources: [duplicateLabel, duplicateLabel] },
  { description: "a resource with a changed fingerprint", resources: [duplicateLabel, duplicateLabelFingerprint] },
  { description: "an issue and label with the same node ID", resources: [duplicateLabel, duplicateIssue] }
] as const) {
  it.effect(`Alice rejects ${duplicate.description} before any throttled adapter call`, () =>
    Effect.gen(function* () {
      const boundary = yield* makeBoundary()
      const failure = yield* cleanupDisposableGithubQualification(
        { ...manifest, resources: duplicate.resources },
        expected,
        makeThrottledAdapter(boundary.record)
      ).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(DisposableGithubCleanupManifestFailure)
      expect(JSON.stringify(failure)).not.toContain(duplicateGlobalNodeId)
      expect(yield* Ref.get(boundary.calls)).toEqual([])
    })
  )
}

const makeBoundary = Effect.fn("CleanupTest.makeBoundary")(function* () {
  const calls = yield* Ref.make<ReadonlyArray<string>>([])
  const resources = yield* Ref.make<ReadonlyArray<DisposableGithubQualificationResource>>(manifest.resources)
  const record = (call: string) => Ref.update(calls, (values) => [...values, call])
  const adapter: DisposableGithubCleanupAdapter = {
    readRepository: (identity) =>
      record(`repository:${identity.nodeId}`).pipe(Effect.as(presentRepository(repository))),
    readResource: (_identity, resource) =>
      record(`read:${resource.nodeId}`).pipe(
        Effect.andThen(Ref.get(resources)),
        Effect.map((values) => {
          const found = values.find((value) => value.nodeId === resource.nodeId)
          return found === undefined ? absentResource : presentResource(found)
        })
      ),
    deleteResource: (_identity, resource) =>
      record(`delete:${resource.nodeId}`).pipe(
        Effect.andThen(Ref.update(resources, (values) => values.filter((value) => value.nodeId !== resource.nodeId)))
      )
  }
  return { adapter, calls, resources, record }
})

it.effect("Alice deletes only fresh matching nodes once and proves their absence", () =>
  Effect.gen(function* () {
    const boundary = yield* makeBoundary()
    const result = yield* cleanupDisposableGithubQualification(manifest, expected, boundary.adapter)
    expect(result).toEqual({ repository, removed: [label, issue], alreadyAbsent: [], retained: [] })
    expect(yield* Ref.get(boundary.calls)).toEqual([
      "repository:repository-node",
      "read:label-node",
      "delete:label-node",
      "read:label-node",
      "read:issue-node",
      "delete:issue-node",
      "read:issue-node"
    ])
  })
)

it.effect("Alice proves an already absent label without issuing Delete", () =>
  Effect.gen(function* () {
    const boundary = yield* makeBoundary()
    yield* Ref.set(boundary.resources, [issue])
    const result = yield* cleanupDisposableGithubQualification(manifest, expected, boundary.adapter)
    expect(result.removed).toEqual([issue])
    expect(result.alreadyAbsent).toEqual([label])
    expect(result.retained).toEqual([])
    expect(yield* Ref.get(boundary.calls)).not.toContain("delete:label-node")
  })
)

for (const mismatch of ["ForeignInvocation", "ForeignRepository"] as const) {
  it.effect(`Alice preserves every resource for ${mismatch} without boundary calls`, () =>
    Effect.gen(function* () {
      const boundary = yield* makeBoundary()
      const input = {
        ...manifest,
        ...(mismatch === "ForeignInvocation"
          ? { invocationId: HermeticInvocationId.make("other-Q") }
          : { repository: { ...repository, nodeId: GithubRepositoryNodeId.make("other-repository") } })
      }
      const result = yield* cleanupDisposableGithubQualification(input, expected, boundary.adapter)
      expect(result.removed).toEqual([])
      expect(result.retained.map((value) => value.reason)).toEqual([mismatch, mismatch])
      for (const retained of result.retained) expectReadonlyInspection(retained.manualCommand, retained.resource.nodeId)
      expect(yield* Ref.get(boundary.calls)).toEqual([])
    })
  )
}

for (const changed of ["node", "name", "fingerprint", "issue-number", "issue-node", "issue-fingerprint"] as const) {
  it.effect(`Alice preserves a fresh resource with changed ${changed}`, () =>
    Effect.gen(function* () {
      const boundary = yield* makeBoundary()
      const original = changed.startsWith("issue-") ? issue : label
      const replacement =
        original._tag === "Issue"
          ? {
              ...original,
              ...(changed === "issue-number" ? { number: GithubIssueNumber.make(8) } : {}),
              ...(changed === "issue-node" ? { nodeId: GithubIssueNodeId.make("replacement-issue") } : {}),
              ...(changed === "issue-fingerprint" ? { fingerprint: EvidenceDigest.make("c".repeat(64)) } : {})
            }
          : {
              ...original,
              ...(changed === "node" ? { nodeId: GithubLabelNodeId.make("replacement-node") } : {}),
              ...(changed === "name" ? { name: GithubLabelName.make("replacement-label") } : {}),
              ...(changed === "fingerprint" ? { fingerprint: EvidenceDigest.make("c".repeat(64)) } : {})
            }
      const adapter = {
        ...boundary.adapter,
        readResource: () => boundary.record("changed-read").pipe(Effect.as(presentResource(replacement)))
      }
      const result = yield* cleanupDisposableGithubQualification(
        { ...manifest, resources: [original] },
        expected,
        adapter
      )
      expect(result.removed).toEqual([])
      expect(result.retained[0]?.resource).toEqual(original)
      expect(result.retained[0]?.reason).toBe("ChangedIdentity")
      expectReadonlyInspection(result.retained[0]?.manualCommand, original.nodeId)
      expect(yield* Ref.get(boundary.calls)).toEqual(["repository:repository-node", "changed-read"])
    })
  )
}

it.effect("Alice receives a shell-quoted read-only inspection for a retained node", () =>
  Effect.gen(function* () {
    const boundary = yield* makeBoundary()
    const quotedIssue = { ...issue, nodeId: GithubIssueNodeId.make("issue'node") }
    const replacement = { ...quotedIssue, nodeId: GithubIssueNodeId.make("replacement-issue") }
    const result = yield* cleanupDisposableGithubQualification({ ...manifest, resources: [quotedIssue] }, expected, {
      ...boundary.adapter,
      readResource: () => boundary.record("quoted-read").pipe(Effect.as(presentResource(replacement)))
    })
    expect(result.retained[0]?.reason).toBe("ChangedIdentity")
    expectReadonlyInspection(result.retained[0]?.manualCommand, "issue'node")
    expect(result.retained[0]?.manualCommand).toContain("-f id='issue'\\''node'")
  })
)

it.effect("Alice preserves resources if the repository changed or cannot be read", () =>
  Effect.gen(function* () {
    const boundary = yield* makeBoundary()
    for (const fresh of [null, { ...repository, nodeId: GithubRepositoryNodeId.make("replacement") }]) {
      const result = yield* cleanupDisposableGithubQualification(manifest, expected, {
        ...boundary.adapter,
        readRepository: () =>
          Effect.succeed(
            fresh === null ? DisposableGithubRepositoryObservation.cases.Absent.make({}) : presentRepository(fresh)
          )
      })
      expect(result.retained.map((value) => value.reason)).toEqual(["ForeignRepository", "ForeignRepository"])
      for (const retained of result.retained) expectReadonlyInspection(retained.manualCommand, retained.resource.nodeId)
    }
    const result = yield* cleanupDisposableGithubQualification(manifest, expected, {
      ...boundary.adapter,
      readRepository: unreadable
    })
    expect(result.retained.map((value) => value.reason)).toEqual(["RepositoryUnreadable", "RepositoryUnreadable"])
    for (const retained of result.retained) expectReadonlyInspection(retained.manualCommand, retained.resource.nodeId)
    expect(yield* Ref.get(boundary.calls)).toEqual([])
  })
)

it.effect("Alice retains unreadable ownership without attempting deletion", () =>
  Effect.gen(function* () {
    const boundary = yield* makeBoundary()
    const result = yield* cleanupDisposableGithubQualification(manifest, expected, {
      ...boundary.adapter,
      readResource: unreadable
    })
    expect(result.retained.map((value) => value.reason)).toEqual(["Unreadable", "Unreadable"])
    for (const retained of result.retained) expectReadonlyInspection(retained.manualCommand, retained.resource.nodeId)
    expect(yield* Ref.get(boundary.calls)).toEqual(["repository:repository-node"])
  })
)

it.effect("Alice receives exact partial cleanup after one throttled mutation without retry", () =>
  Effect.gen(function* () {
    const boundary = yield* makeBoundary()
    const result = yield* cleanupDisposableGithubQualification(manifest, expected, {
      ...boundary.adapter,
      deleteResource: (identity, resource) =>
        resource._tag === "Issue"
          ? boundary
              .record(`delete:${resource.nodeId}`)
              .pipe(Effect.andThen(Effect.fail(new DisposableGithubCleanupBoundaryFailure({ reason: "Throttled" }))))
          : boundary.adapter.deleteResource(identity, resource)
    })
    expect(result.removed).toEqual([label])
    expect(result.retained.map((value) => value.resource)).toEqual([issue])
    expect(result.retained[0]?.reason).toBe("Throttled")
    expectReadonlyInspection(result.retained[0]?.manualCommand, "issue-node")
    expect((yield* Ref.get(boundary.calls)).filter((call) => call === "delete:issue-node")).toHaveLength(1)
  })
)

it.effect("Alice retains an unreadable Delete outcome after one attempt without retry", () =>
  Effect.gen(function* () {
    const boundary = yield* makeBoundary()
    const result = yield* cleanupDisposableGithubQualification({ ...manifest, resources: [issue] }, expected, {
      ...boundary.adapter,
      deleteResource: () => boundary.record("delete:issue-node").pipe(Effect.andThen(unreadable()))
    })
    expect(result.removed).toEqual([])
    expect(result.retained[0]?.reason).toBe("Unreadable")
    expectReadonlyInspection(result.retained[0]?.manualCommand, "issue-node")
    expect(yield* Ref.get(boundary.calls)).toEqual([
      "repository:repository-node",
      "read:issue-node",
      "delete:issue-node"
    ])
  })
)

it.effect("Alice does not claim removal when the post-Delete absence is unreadable or still present", () =>
  Effect.gen(function* () {
    for (const postRead of [Effect.succeed(presentResource(label)), unreadable()]) {
      const boundary = yield* makeBoundary()
      const deleted = yield* Ref.make(false)
      const result = yield* cleanupDisposableGithubQualification({ ...manifest, resources: [label] }, expected, {
        ...boundary.adapter,
        readResource: () =>
          Ref.get(deleted).pipe(Effect.flatMap((value) => (value ? postRead : Effect.succeed(presentResource(label))))),
        deleteResource: () => boundary.record("delete:label-node").pipe(Effect.andThen(Ref.set(deleted, true)))
      })
      expect(result.removed).toEqual([])
      expect(result.retained[0]?.reason).toBe("AbsenceUnproved")
      expectReadonlyInspection(result.retained[0]?.manualCommand, "label-node")
      expect(yield* Ref.get(boundary.calls)).toEqual(["repository:repository-node", "delete:label-node"])
    }
  })
)

it.effect("Alice rejects malformed or unknown manifest fields without exposing them or calling GitHub", () =>
  Effect.gen(function* () {
    const boundary = yield* makeBoundary()
    const failure = yield* cleanupDisposableGithubQualification(
      { ...manifest, privateToken: "sentinel-secret" },
      expected,
      boundary.adapter
    ).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(DisposableGithubCleanupManifestFailure)
    expect(JSON.stringify(failure)).not.toContain("sentinel-secret")
    expect(yield* Ref.get(boundary.calls)).toEqual([])
  })
)
