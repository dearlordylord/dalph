/* eslint-disable functional/immutable-data -- The qualification records disposable fixture diagnostics in Refs. */
/* eslint-disable no-restricted-globals -- The explicit opt-in gate is read before constructing the live test. */
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Crypto, Effect, FileSystem, Layer, Ref, Schema } from "effect"
import type { EvidenceDigest, TaskId } from "@dalph/contracts"
import {
  ClaimOwner,
  ClaimToken,
  EvidenceStore,
  EvidenceStoreLocator,
  OperationId,
  TaskClaimAcquisition,
  TrackerGraphReader,
  TrackerMutation
} from "../../../index.js"
import {
  GithubGraphqlClient,
  GithubGraphqlRequest,
  type GithubGraphqlResponse,
  GithubIssueNodeId,
  GithubLabelName,
  GithubLabelNodeId,
  GithubRepositoryNodeId,
  githubGraphqlClientNodeLayer
} from "./graphql-client.js"
import { githubTrackerGraphReaderLayer } from "./graph-reader.js"
import { githubClaimLabelNameFor, githubTrackerMutationLayer } from "./claim-mutation.js"
import { githubTaskIdFor } from "./task-identity.js"
import { nodeEvidenceStoreLayer } from "../../../workflow/protocols/target-verification/evidence-store.js"
import { GithubIssueNumber, GithubIssueTarget, GithubRepositoryName, GithubRepositoryOwner } from "./target.js"

const GraphqlErrorsEnvelope = Schema.Struct({
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String })))
})

const GraphqlDataResponse = Schema.Struct({ data: Schema.Unknown })

const ResolveRepositoryResponse = Schema.Struct({
  data: Schema.Struct({ repository: Schema.NullOr(Schema.Struct({ id: GithubRepositoryNodeId })) })
})

const CreateIssueResponse = Schema.Struct({
  data: Schema.Struct({
    createIssue: Schema.Struct({ issue: Schema.Struct({ id: GithubIssueNodeId, number: GithubIssueNumber }) })
  })
})

const FindClaimLabelResponse = Schema.Struct({
  data: Schema.Struct({
    node: Schema.NullOr(
      Schema.Struct({ label: Schema.NullOr(Schema.Struct({ id: GithubLabelNodeId, name: GithubLabelName })) })
    )
  })
})

const IssueDetails = Schema.Struct({
  __typename: Schema.Literal("Issue"),
  body: Schema.NullOr(Schema.String),
  comments: Schema.Struct({ nodes: Schema.Array(Schema.Struct({ body: Schema.String, id: Schema.NonEmptyString })) }),
  id: GithubIssueNodeId,
  number: GithubIssueNumber,
  repository: Schema.Struct({ id: GithubRepositoryNodeId }),
  state: Schema.Literals(["CLOSED", "OPEN"]),
  stateReason: Schema.NullOr(Schema.Literals(["COMPLETED", "DUPLICATE", "NOT_PLANNED", "REOPENED"])),
  updatedAt: Schema.String,
  url: Schema.String
})

const ReadIssueDetailsResponse = Schema.Struct({ data: Schema.Struct({ node: Schema.NullOr(IssueDetails) }) })

class GithubQualificationFailure extends Schema.TaggedError<GithubQualificationFailure>()(
  "GithubIssue72.QualificationFailure",
  { detail: Schema.String }
) {}

const qualificationFailure = (detail: string): GithubQualificationFailure => new GithubQualificationFailure({ detail })

type FixtureLocators = {
  readonly claimLabelName: GithubLabelName | null
  readonly claimLabelNodeId: GithubLabelNodeId | null
  readonly claimTaskId: TaskId | null
  readonly evidenceDigest: EvidenceDigest | null
  readonly evidenceRoot: EvidenceStoreLocator
  readonly issueNodeIds: ReadonlyArray<GithubIssueNodeId>
  readonly issueNumbers: ReadonlyArray<GithubIssueNumber>
  readonly prefix: string
  readonly repository: string
}

const enabled = process.env["DALPH_RUN_GITHUB_QUALIFICATION"] === "1"

const repositoryFromEnvironment = Effect.gen(function* () {
  const value = process.env["DALPH_GITHUB_QUALIFICATION_REPOSITORY"]
  if (value === undefined) return yield* qualificationFailure("DALPH_GITHUB_QUALIFICATION_REPOSITORY is required")
  const [owner, repository, ...extra] = value.split("/")
  if (
    owner === undefined ||
    repository === undefined ||
    extra.length > 0 ||
    owner.length === 0 ||
    repository.length === 0
  ) {
    return yield* qualificationFailure("DALPH_GITHUB_QUALIFICATION_REPOSITORY must be owner/name")
  }
  return { owner: GithubRepositoryOwner.make(owner), repository: GithubRepositoryName.make(repository) }
})

const decodeResponse = <S extends Schema.Constraint>(schema: S, response: GithubGraphqlResponse) =>
  Effect.gen(function* () {
    const header = yield* Schema.decodeUnknownEffect(GraphqlErrorsEnvelope)(response.body)
    if (header.errors !== undefined && header.errors.length > 0) {
      return yield* qualificationFailure(header.errors.map(({ message }) => message).join("; "))
    }
    return yield* Schema.decodeUnknownEffect(schema)(response.body)
  })

const executeDecoded = <S extends Schema.Constraint>(request: GithubGraphqlRequest, schema: S) =>
  Effect.gen(function* () {
    const client = yield* GithubGraphqlClient
    return yield* client.execute(request).pipe(Effect.flatMap((response) => decodeResponse(schema, response)))
  })

const operationIdFor = (prefix: string, operation: string): OperationId => OperationId.make(`${prefix}-${operation}`)

const fixtureDescription = (locators: FixtureLocators): string => JSON.stringify(locators, null, 2)

const issueDetailsFor = (issueNodeId: GithubIssueNodeId) =>
  executeDecoded(GithubGraphqlRequest.cases.ReadIssueDetails.make({ issueNodeId }), ReadIssueDetailsResponse).pipe(
    Effect.flatMap((response) =>
      response.data.node === null
        ? Effect.fail(qualificationFailure(`issue ${issueNodeId} disappeared from GitHub`))
        : Effect.succeed(response.data.node)
    )
  )

const nativeAcknowledgement = (calls: Ref.Ref<ReadonlyArray<GithubGraphqlRequest>>, request: GithubGraphqlRequest) =>
  Effect.gen(function* () {
    yield* Ref.update(calls, (current) => [...current, request])
    return yield* executeDecoded(request, GraphqlDataResponse)
  })

const nativeLostResponse = (calls: Ref.Ref<ReadonlyArray<GithubGraphqlRequest>>, request: GithubGraphqlRequest) =>
  Effect.gen(function* () {
    yield* Ref.update(calls, (current) => [...current, request])
    const client = yield* GithubGraphqlClient
    yield* client.execute(request)
  })

const qualificationLayer = (evidenceRoot: EvidenceStoreLocator) =>
  Layer.mergeAll(
    githubTrackerMutationLayer.pipe(Layer.provide(NodeCrypto.layer)),
    githubTrackerGraphReaderLayer,
    nodeEvidenceStoreLayer(evidenceRoot)
  ).pipe(Layer.provide(NodeServices.layer))

const runQualification = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const crypto = yield* Crypto.Crypto
  const repository = yield* repositoryFromEnvironment
  const evidenceRoot = EvidenceStoreLocator.make(
    yield* fileSystem.makeTempDirectory({ prefix: "dalph-github-issue-72-" })
  )
  const prefix = `dalph-issue-72-${(yield* crypto.randomUUIDv4).slice(0, 12)}`
  const locators = yield* Ref.make<FixtureLocators>({
    claimLabelName: null,
    claimLabelNodeId: null,
    claimTaskId: null,
    evidenceDigest: null,
    evidenceRoot,
    issueNodeIds: [],
    issueNumbers: [],
    prefix,
    repository: `${repository.owner}/${repository.repository}`
  })
  const calls = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest>>([])
  const layer = qualificationLayer(evidenceRoot)

  const result = yield* Effect.gen(function* () {
    const tracker = yield* TrackerMutation
    const graphReader = yield* TrackerGraphReader
    const store = yield* EvidenceStore
    const repositoryResponse = yield* executeDecoded(
      GithubGraphqlRequest.cases.ResolveRepository.make(repository),
      ResolveRepositoryResponse
    )
    const repositoryNode = repositoryResponse.data.repository
    if (repositoryNode === null) return yield* qualificationFailure("qualification repository is unavailable")

    const createIssue = Effect.fn("GithubIssue72.createIssue")(function* (name: string, body: string) {
      const response = yield* executeDecoded(
        GithubGraphqlRequest.cases.CreateIssue.make({
          body,
          operationId: operationIdFor(prefix, `create-${name}`),
          repositoryNodeId: repositoryNode.id,
          title: `${prefix}-${name}`
        }),
        CreateIssueResponse
      )
      const issue = response.data.createIssue.issue
      yield* Ref.update(locators, (current) => ({
        ...current,
        issueNodeIds: [...current.issueNodeIds, issue.id],
        issueNumbers: [...current.issueNumbers, issue.number]
      }))
      return issue
    })

    const parent = yield* createIssue("parent", `Disposable issue-72 parent fixture ${prefix}`)
    const child = yield* createIssue("child", `Disposable issue-72 child fixture ${prefix}`)
    yield* nativeAcknowledgement(
      calls,
      GithubGraphqlRequest.cases.AddSubIssue.make({
        operationId: operationIdFor(prefix, "add-sub-issue"),
        parentIssueNodeId: parent.id,
        subIssueNodeId: child.id
      })
    )
    yield* nativeAcknowledgement(
      calls,
      GithubGraphqlRequest.cases.AddBlockedBy.make({
        blockingIssueNodeId: parent.id,
        issueNodeId: child.id,
        operationId: operationIdFor(prefix, "add-blocked-by")
      })
    )

    const evidenceBytes = new TextEncoder().encode(
      [
        `fixture=${prefix}`,
        "git.base=existing-real-git-qualification",
        "git.candidate=exact-ancestry-locator",
        "git.equivalent-content=forbidden-substitute"
      ].join("\n")
    )
    const evidence = yield* store.put(evidenceBytes)
    yield* Ref.update(locators, (current) => ({ ...current, evidenceDigest: evidence.digest }))
    const evidenceMarker = `dalph-issue-72 evidence digest=${evidence.digest} byteLength=${evidence.byteLength} ${prefix}`
    yield* nativeAcknowledgement(
      calls,
      GithubGraphqlRequest.cases.AddIssueComment.make({
        body: evidenceMarker,
        issueNodeId: parent.id,
        operationId: operationIdFor(prefix, "attach-evidence")
      })
    )

    const parentTaskId = githubTaskIdFor(repositoryNode.id, parent.id)
    const childTaskId = githubTaskIdFor(repositoryNode.id, child.id)
    const claim = yield* tracker.acquireTaskClaim(
      TaskClaimAcquisition.make({
        operationId: operationIdFor(prefix, "acquire-claim"),
        owner: ClaimOwner.make(prefix),
        taskId: parentTaskId,
        token: ClaimToken.make(`${prefix}-claim-token`)
      })
    )
    yield* Ref.update(locators, (current) => ({ ...current, claimTaskId: parentTaskId }))
    const claimLabelName = yield* githubClaimLabelNameFor(crypto, parentTaskId)
    const claimLabelResponse = yield* executeDecoded(
      GithubGraphqlRequest.cases.FindClaimLabel.make({
        labelName: claimLabelName,
        repositoryNodeId: repositoryNode.id
      }),
      FindClaimLabelResponse
    )
    const claimLabelRecord = claimLabelResponse.data.node?.label
    if (claimLabelRecord === null || claimLabelRecord === undefined) {
      return yield* qualificationFailure("claim label was not visible after acquisition")
    }
    yield* Ref.update(locators, (current) => ({ ...current, claimLabelName, claimLabelNodeId: claimLabelRecord.id }))
    expect(yield* tracker.readTaskClaim(parentTaskId)).toEqual(claim)
    const attached = yield* issueDetailsFor(parent.id)
    expect(attached.comments.nodes.some(({ body }) => body === evidenceMarker)).toBe(true)

    const parentTarget = GithubIssueTarget.make({
      issueNumber: parent.number,
      owner: repository.owner,
      repository: repository.repository
    })
    const initialGraph = yield* graphReader.read(parentTarget)
    expect(initialGraph.prerequisitesOf(childTaskId)).toEqual([parentTaskId])
    expect(initialGraph.eligibleTaskIds()).not.toContain(childTaskId)

    const closeCallsBefore = (yield* Ref.get(calls)).filter(({ _tag }) => _tag === "CloseIssue").length
    yield* nativeLostResponse(
      calls,
      GithubGraphqlRequest.cases.CloseIssue.make({
        issueNodeId: parent.id,
        operationId: operationIdFor(prefix, "complete-parent")
      })
    )
    const closed = yield* issueDetailsFor(parent.id)
    expect(closed.state).toBe("CLOSED")
    expect(closed.stateReason).toBe("COMPLETED")
    expect((yield* Ref.get(calls)).filter(({ _tag }) => _tag === "CloseIssue")).toHaveLength(closeCallsBefore + 1)
    expect(yield* tracker.readTaskClaim(parentTaskId)).toEqual(claim)
    expect((yield* store.read(evidence)).byteLength).toBe(evidence.byteLength)

    const releasedGraph = yield* graphReader.read(parentTarget)
    expect(releasedGraph.eligibleTaskIds()).toContain(childTaskId)

    yield* nativeAcknowledgement(
      calls,
      GithubGraphqlRequest.cases.ReopenIssue.make({
        issueNodeId: parent.id,
        operationId: operationIdFor(prefix, "human-reopen")
      })
    )
    const humanChanged = yield* issueDetailsFor(parent.id)
    expect(humanChanged.state).toBe("OPEN")
    expect(humanChanged.stateReason).toBe("REOPENED")
    expect((yield* Ref.get(calls)).filter(({ _tag }) => _tag === "CloseIssue")).toHaveLength(closeCallsBefore + 1)
    expect(yield* tracker.readTaskClaim(parentTaskId)).toEqual(claim)
    expect((yield* graphReader.read(parentTarget)).eligibleTaskIds()).not.toContain(childTaskId)

    return { evidence, parent, child, parentTaskId }
  }).pipe(Effect.provide(layer), Effect.exit)

  if (result._tag === "Failure") {
    const current = yield* Ref.get(locators)
    yield* Effect.logError(`GitHub issue #72 fixture retained after failure:\n${fixtureDescription(current)}`)
    return yield* Effect.failCause(result.cause)
  }

  const cleanup = yield* Effect.gen(function* () {
    const tracker = yield* TrackerMutation
    yield* tracker.releaseTaskClaim({
      claim: yield* tracker
        .readTaskClaim(result.value.parentTaskId)
        .pipe(
          Effect.flatMap((current) =>
            current._tag === "ActiveTaskClaim"
              ? Effect.succeed(current)
              : Effect.fail(qualificationFailure("claim disappeared before cleanup"))
          )
        ),
      operationId: operationIdFor(prefix, "release-claim")
    })
    for (const issueNodeId of [result.value.child.id, result.value.parent.id]) {
      yield* executeDecoded(
        GithubGraphqlRequest.cases.DeleteIssue.make({
          issueNodeId,
          operationId: operationIdFor(prefix, `delete-${issueNodeId}`)
        }),
        GraphqlDataResponse
      )
    }
    yield* fileSystem.remove(evidenceRoot, { force: true, recursive: true })
  }).pipe(Effect.provide(layer), Effect.exit)
  if (cleanup._tag === "Failure") {
    const current = yield* Ref.get(locators)
    yield* Effect.logError(`GitHub issue #72 fixture retained after cleanup failure:\n${fixtureDescription(current)}`)
    return yield* Effect.failCause(cleanup.cause)
  }
})

if (enabled) {
  it.effect("qualifies GitHub evidence-backed completion, ambiguity, conflicts, and graph refresh", () =>
    Effect.scoped(
      runQualification.pipe(Effect.provide(githubGraphqlClientNodeLayer), Effect.provide(NodeServices.layer))
    )
  )
} else {
  it.skip("qualifies GitHub evidence-backed completion, ambiguity, conflicts, and graph refresh", () => undefined)
}
