/* eslint-disable functional/immutable-data -- Fixture construction tracks exact disposable resources locally. */
// @effect-diagnostics multipleEffectProvide:off
import { NodeCrypto, NodeHttpClient } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Config, Context, Crypto, Effect, Layer, Ref, Schema, Semaphore } from "effect"
import type { Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeTaskWorkSpecification, type TaskId } from "@dalph/contracts"
import { makeTrackerGraphObservationOperation } from "../../../workflow/registry/operation.js"
import { OperationId } from "../../../workflow/identity.js"
import { makeTaskTrackerFactsObservedFromRead } from "../../../workflow/protocols/task-tracker-read/protocol.js"
import { runTaskClaimAcquisitionProtocol } from "../../../workflow/protocols/task-claim-acquisition/protocol.js"
import {
  ClaimOwner,
  ClaimToken,
  TaskClaimAcquisition,
  TaskClaimConflict,
  TaskLifecycle,
  TrackerGraphReader,
  TrackerMutation
} from "../../../index.js"
import {
  GithubGraphqlClient,
  GithubGraphqlRequest,
  GithubGraphqlResponse,
  GithubGraphqlRequestError,
  githubGraphqlClientNodeLayer,
  GithubIssueNodeId,
  GithubLabelName,
  GithubLabelNodeId,
  GithubRepositoryNodeId
} from "./graphql-client.js"
import { githubTrackerGraphReaderLayer } from "./graph-reader.js"
import { githubTrackerMutationLayer } from "./claim-mutation.js"
import { githubTaskIdFor } from "./task-identity.js"
import { GithubIssueNumber, GithubIssueTarget, GithubRepositoryName, GithubRepositoryOwner } from "./target.js"

// oxlint-disable-next-line no-restricted-globals -- opt-in is evaluated before test registration.
const qualificationEnabled = globalThis.process.env["DALPH_GITHUB_QUALIFICATION"] === "1"
const qualificationTimeoutMilliseconds = 10 * 60 * 1_000
const defaultBlockerCount = 2

const GithubQualificationRepository = Schema.Struct({ owner: GithubRepositoryOwner, repository: GithubRepositoryName })
type GithubQualificationRepository = typeof GithubQualificationRepository.Type

const GithubFixtureIssueLocator = Schema.Struct({ nodeId: GithubIssueNodeId, target: GithubIssueTarget })
type GithubFixtureIssueLocator = typeof GithubFixtureIssueLocator.Type

const GithubFixtureRepositoryLocator = Schema.Struct({
  nodeId: GithubRepositoryNodeId,
  owner: GithubRepositoryOwner,
  repository: GithubRepositoryName
})
type GithubFixtureRepositoryLocator = typeof GithubFixtureRepositoryLocator.Type

/** Exact repository, issue, and label locators retained when fixture disposal fails. */
const GithubFixtureResources = Schema.Struct({
  issues: Schema.Array(GithubFixtureIssueLocator),
  labels: Schema.Array(GithubLabelName),
  repository: GithubFixtureRepositoryLocator
})
type GithubFixtureResources = typeof GithubFixtureResources.Type

class GithubFixtureBoundaryFailure extends Schema.TaggedError<GithubFixtureBoundaryFailure>()(
  "GithubQualification.BoundaryFailure",
  { detail: Schema.String, operation: Schema.String }
) {}

/** Cleanup failure is fail-closed and carries only exact unresolved locators. */
class GithubFixtureCleanupFailure extends Schema.TaggedError<GithubFixtureCleanupFailure>()(
  "GithubQualification.CleanupFailure",
  { detail: Schema.String, remaining: GithubFixtureResources }
) {}

class GithubQualificationConfigurationFailure extends Schema.TaggedError<GithubQualificationConfigurationFailure>()(
  "GithubQualification.ConfigurationFailure",
  { detail: Schema.String }
) {}

const graphqlEndpoint = "https://api.github.com/graphql"
const qualificationUserAgent = "dalph-github-qualification"

const graphqlEnvelope = Schema.Struct({
  data: Schema.optionalKey(Schema.Unknown),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String })))
})

const repositoryResponse = Schema.Struct({ repository: Schema.NullOr(Schema.Struct({ id: GithubRepositoryNodeId })) })
const mutationResult = Schema.Struct({ clientMutationId: Schema.NullOr(Schema.String) })
const createIssueResponse = Schema.Struct({
  createIssue: Schema.Struct({ issue: Schema.Struct({ id: GithubIssueNodeId, number: GithubIssueNumber }) })
})
const addBlockedByResponse = Schema.Struct({ addBlockedBy: mutationResult })
const addSubIssueResponse = Schema.Struct({ addSubIssue: mutationResult })
const closeIssueResponse = Schema.Struct({ closeIssue: mutationResult })
const deleteIssueResponse = Schema.Struct({ deleteIssue: mutationResult })
const removeSubIssueResponse = Schema.Struct({ removeSubIssue: mutationResult })
const labelResponse = Schema.Struct({
  node: Schema.NullOr(
    Schema.Struct({
      id: GithubRepositoryNodeId,
      label: Schema.NullOr(Schema.Struct({ id: GithubLabelNodeId, name: GithubLabelName }))
    })
  )
})
const deleteLabelResponse = Schema.Struct({
  deleteLabel: Schema.Struct({ clientMutationId: Schema.NullOr(Schema.String) })
})

const repositoryQuery = `query QualificationRepository($owner: String!, $repository: String!) {
  repository(owner: $owner, name: $repository) { id }
}`

const createIssueMutation = `mutation QualificationCreateIssue($repositoryId: ID!, $title: String!, $body: String!, $clientMutationId: String!) {
  createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body, clientMutationId: $clientMutationId }) {
    issue { id number }
  }
}`

const addSubIssueMutation = `mutation QualificationAddSubIssue($issueId: ID!, $subIssueId: ID!, $clientMutationId: String!) {
  addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId, clientMutationId: $clientMutationId }) {
    clientMutationId
  }
}`

const addBlockedByMutation = `mutation QualificationAddBlockedBy($issueId: ID!, $blockingIssueId: ID!, $clientMutationId: String!) {
  addBlockedBy(input: { issueId: $issueId, blockingIssueId: $blockingIssueId, clientMutationId: $clientMutationId }) {
    clientMutationId
  }
}`

const removeSubIssueMutation = `mutation QualificationRemoveSubIssue($issueId: ID!, $subIssueId: ID!, $clientMutationId: String!) {
  removeSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId, clientMutationId: $clientMutationId }) {
    clientMutationId
  }
}`

const deleteIssueMutation = `mutation QualificationDeleteIssue($issueId: ID!, $clientMutationId: String!) {
  deleteIssue(input: { issueId: $issueId, clientMutationId: $clientMutationId }) { clientMutationId }
}`

const findLabelQuery = `query QualificationFindLabel($repositoryId: ID!, $labelName: String!) {
  node(id: $repositoryId) {
    ... on Repository { id label(name: $labelName) { id name } }
  }
}`

const deleteLabelMutation = `mutation QualificationDeleteLabel($labelId: ID!, $clientMutationId: String!) {
  deleteLabel(input: { id: $labelId, clientMutationId: $clientMutationId }) { clientMutationId }
}`

interface GithubQualificationApi {
  readonly addBlockedBy: (
    issueId: GithubIssueNodeId,
    blockingIssueId: GithubIssueNodeId,
    mutationId: string
  ) => Effect.Effect<void, GithubFixtureBoundaryFailure>
  readonly addSubIssue: (
    issueId: GithubIssueNodeId,
    subIssueId: GithubIssueNodeId,
    mutationId: string
  ) => Effect.Effect<void, GithubFixtureBoundaryFailure>
  readonly closeIssue: (
    issueId: GithubIssueNodeId,
    mutationId: string
  ) => Effect.Effect<void, GithubFixtureBoundaryFailure>
  readonly createIssue: (
    repositoryId: GithubRepositoryNodeId,
    title: string,
    body: string,
    mutationId: string
  ) => Effect.Effect<
    { readonly id: GithubIssueNodeId; readonly number: GithubIssueNumber },
    GithubFixtureBoundaryFailure
  >
  readonly deleteIssue: (
    issueId: GithubIssueNodeId,
    mutationId: string
  ) => Effect.Effect<void, GithubFixtureBoundaryFailure>
  readonly deleteLabelByName: (
    repositoryId: GithubRepositoryNodeId,
    labelName: GithubLabelName,
    mutationId: string
  ) => Effect.Effect<void, GithubFixtureBoundaryFailure>
  readonly removeSubIssue: (
    issueId: GithubIssueNodeId,
    subIssueId: GithubIssueNodeId,
    mutationId: string
  ) => Effect.Effect<void, GithubFixtureBoundaryFailure>
  readonly repositoryNodeId: (
    repository: GithubQualificationRepository
  ) => Effect.Effect<GithubRepositoryNodeId, GithubFixtureBoundaryFailure>
}

const decodeGraphqlData = <A>(
  operation: string,
  schema: Schema.Codec<A, unknown, never, never>,
  body: unknown
): Effect.Effect<A, GithubFixtureBoundaryFailure> =>
  Schema.decodeUnknownEffect(graphqlEnvelope)(body).pipe(
    Effect.mapError(() => new GithubFixtureBoundaryFailure({ detail: "invalid GitHub fixture envelope", operation })),
    Effect.flatMap((envelope) =>
      envelope.errors !== undefined && envelope.errors.length > 0
        ? Effect.fail(
            new GithubFixtureBoundaryFailure({
              detail: envelope.errors.map(({ message }) => message).join("; "),
              operation
            })
          )
        : envelope.data === undefined
          ? Effect.fail(new GithubFixtureBoundaryFailure({ detail: "GitHub fixture response omitted data", operation }))
          : Schema.decodeUnknownEffect(schema)(envelope.data).pipe(
              Effect.mapError(
                (error) =>
                  new GithubFixtureBoundaryFailure({
                    detail: `invalid GitHub fixture response data: ${String(error)}`,
                    operation
                  })
              )
            )
    )
  )

const makeGithubQualificationApi = Effect.fn("GithubQualification.makeApi")(function* (
  token: Redacted.Redacted<string>
): Effect.fn.Return<GithubQualificationApi, GithubFixtureBoundaryFailure, HttpClient.HttpClient> {
  const http = yield* HttpClient.HttpClient
  const execute = Effect.fn("GithubQualification.execute")(function* (
    operation: string,
    query: string,
    variables: Readonly<Record<string, unknown>>
  ) {
    const request = HttpClientRequest.post(graphqlEndpoint).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.setHeader("user-agent", qualificationUserAgent),
      HttpClientRequest.setHeader("x-github-next-global-id", "1"),
      HttpClientRequest.bodyJsonUnsafe({ query, variables })
    )
    const response = yield* http.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.mapError(() => new GithubFixtureBoundaryFailure({ detail: "GitHub fixture transport failed", operation }))
    )
    return yield* response.json.pipe(
      Effect.mapError(
        () => new GithubFixtureBoundaryFailure({ detail: "GitHub fixture JSON decode failed", operation })
      )
    )
  })

  const repositoryNodeId = Effect.fn("GithubQualification.repositoryNodeId")(function* (
    repository: GithubQualificationRepository
  ) {
    const data = yield* execute("repository", repositoryQuery, repository)
    const result = yield* decodeGraphqlData("repository", repositoryResponse, data)
    if (result.repository === null) {
      return yield* new GithubFixtureBoundaryFailure({
        detail: "configured GitHub repository is inaccessible",
        operation: "repository"
      })
    }
    return result.repository.id
  })

  const createIssue = Effect.fn("GithubQualification.createIssue")(function* (
    repositoryId: GithubRepositoryNodeId,
    title: string,
    body: string,
    mutationId: string
  ) {
    const data = yield* execute("createIssue", createIssueMutation, {
      body,
      clientMutationId: mutationId,
      repositoryId,
      title
    })
    return (yield* decodeGraphqlData("createIssue", createIssueResponse, data)).createIssue.issue
  })

  const relation = Effect.fn("GithubQualification.relation")(function* (
    operation: "addBlockedBy" | "addSubIssue" | "removeSubIssue",
    query: string,
    variables: Readonly<Record<string, unknown>>,
    schema: Schema.Codec<unknown, unknown, never, never>
  ) {
    const data = yield* execute(operation, query, variables)
    yield* decodeGraphqlData(operation, schema, data)
  })

  const deleteIssue = Effect.fn("GithubQualification.deleteIssue")(function* (
    issueId: GithubIssueNodeId,
    mutationId: string
  ) {
    const data = yield* execute("deleteIssue", deleteIssueMutation, { clientMutationId: mutationId, issueId })
    yield* decodeGraphqlData("deleteIssue", deleteIssueResponse, data)
  })

  const deleteLabelByName = Effect.fn("GithubQualification.deleteLabelByName")(function* (
    repositoryId: GithubRepositoryNodeId,
    labelName: GithubLabelName,
    mutationId: string
  ) {
    const findData = yield* execute("findLabel", findLabelQuery, { labelName, repositoryId })
    const found = yield* decodeGraphqlData("findLabel", labelResponse, findData)
    const label = found.node?.label
    if (label === null || label === undefined) return
    const deleteData = yield* execute("deleteLabel", deleteLabelMutation, {
      clientMutationId: mutationId,
      labelId: label.id
    })
    yield* decodeGraphqlData("deleteLabel", deleteLabelResponse, deleteData)
  })

  const addSubIssue = (issueId: GithubIssueNodeId, subIssueId: GithubIssueNodeId, mutationId: string) =>
    relation(
      "addSubIssue",
      addSubIssueMutation,
      { clientMutationId: mutationId, issueId, subIssueId },
      addSubIssueResponse
    )
  const addBlockedBy = (issueId: GithubIssueNodeId, blockingIssueId: GithubIssueNodeId, mutationId: string) =>
    relation(
      "addBlockedBy",
      addBlockedByMutation,
      { blockingIssueId, clientMutationId: mutationId, issueId },
      addBlockedByResponse
    )
  const removeSubIssue = (issueId: GithubIssueNodeId, subIssueId: GithubIssueNodeId, mutationId: string) =>
    relation(
      "removeSubIssue",
      removeSubIssueMutation,
      { clientMutationId: mutationId, issueId, subIssueId },
      removeSubIssueResponse
    )

  // GitHub's closeIssue mutation is deliberately isolated from the read/claim
  // adapter. The qualification only needs a native lifecycle edit.
  const closeIssue = Effect.fn("GithubQualification.closeIssue")(function* (
    issueId: GithubIssueNodeId,
    mutationId: string
  ) {
    const data = yield* execute(
      "closeIssue",
      `mutation QualificationCloseIssue($issueId: ID!, $clientMutationId: String!) {
        closeIssue(input: { issueId: $issueId, clientMutationId: $clientMutationId }) { clientMutationId }
      }`,
      { clientMutationId: mutationId, issueId }
    )
    yield* decodeGraphqlData("closeIssue", closeIssueResponse, data)
  })

  return {
    addBlockedBy,
    addSubIssue,
    closeIssue,
    createIssue,
    deleteIssue,
    deleteLabelByName,
    removeSubIssue,
    repositoryNodeId
  }
})

const parseRepository = (
  value: string
): Effect.Effect<GithubQualificationRepository, GithubQualificationConfigurationFailure> => {
  const [owner, repository, extra] = value.split("/")
  return owner !== undefined && repository !== undefined && extra === undefined
    ? Schema.decodeUnknownEffect(GithubQualificationRepository)({ owner, repository }).pipe(
        Effect.mapError(
          () => new GithubQualificationConfigurationFailure({ detail: "invalid qualification repository" })
        )
      )
    : Effect.fail(
        new GithubQualificationConfigurationFailure({ detail: "qualification repository must be owner/name" })
      )
}

const blockerCount = (value: string | undefined): Effect.Effect<number, GithubQualificationConfigurationFailure> => {
  const parsed = Number(value ?? defaultBlockerCount)
  return parsed === defaultBlockerCount
    ? Effect.succeed(parsed)
    : Effect.fail(
        new GithubQualificationConfigurationFailure({ detail: `blocker count must equal ${defaultBlockerCount}` })
      )
}

const issueTargetFor = (repository: GithubQualificationRepository, number: GithubIssueNumber): GithubIssueTarget =>
  GithubIssueTarget.make({ issueNumber: number, owner: repository.owner, repository: repository.repository })

const appendIssue = (
  resources: GithubFixtureResources,
  repository: GithubQualificationRepository,
  issue: { readonly id: GithubIssueNodeId; readonly number: GithubIssueNumber }
): GithubFixtureResources => ({
  ...resources,
  issues: [...resources.issues, { nodeId: issue.id, target: issueTargetFor(repository, issue.number) }]
})

const fixturePrefix = (suffix: string): string => `dalph-issue-71-${suffix}`

const makeFixture = Effect.fn("GithubQualification.makeFixture")(function* (
  api: GithubQualificationApi,
  repository: GithubQualificationRepository,
  repositoryNodeId: GithubRepositoryNodeId,
  blockerTotal: number,
  resourcesRef: Ref.Ref<GithubFixtureResources>
): Effect.fn.Return<
  GithubFixtureResources & {
    readonly child: GithubFixtureIssueLocator
    readonly rootBody: string
    readonly root: GithubFixtureIssueLocator
    readonly rootTitle: string
    readonly taskId: TaskId
    readonly prerequisiteOnlyChild: GithubFixtureIssueLocator
  },
  GithubFixtureBoundaryFailure,
  Crypto.Crypto
> {
  const crypto = yield* Crypto.Crypto
  const randomBytes = yield* crypto
    .randomBytes(8)
    .pipe(
      Effect.mapError(
        () =>
          new GithubFixtureBoundaryFailure({ detail: "fixture suffix generation failed", operation: "createFixture" })
      )
    )
  const suffix = [...randomBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  const empty = GithubFixtureResources.make({
    issues: [],
    labels: [],
    repository: GithubFixtureRepositoryLocator.make({
      nodeId: repositoryNodeId,
      owner: repository.owner,
      repository: repository.repository
    })
  })
  yield* Ref.set(resourcesRef, empty)
  const rootTitle = fixturePrefix(`${suffix}-root`)
  const rootBody = "Disposable root issue for Dalph #71 qualification."
  const rootIssue = yield* api.createIssue(repositoryNodeId, rootTitle, rootBody, `issue-71-create-root-${suffix}`)
  let resources = appendIssue(empty, repository, rootIssue)
  yield* Ref.set(resourcesRef, resources)
  const childIssue = yield* api.createIssue(
    repositoryNodeId,
    fixturePrefix(`${suffix}-selected-child`),
    "Disposable selected child issue for Dalph #71 qualification.",
    `issue-71-create-child-${suffix}`
  )
  resources = appendIssue(resources, repository, childIssue)
  yield* Ref.set(resourcesRef, resources)
  yield* api.addSubIssue(rootIssue.id, childIssue.id, `issue-71-add-child-${suffix}`)

  const blockerIssues: Array<GithubFixtureIssueLocator> = []
  for (let index = 0; index < blockerTotal; index += 1) {
    const blocker = yield* api.createIssue(
      repositoryNodeId,
      fixturePrefix(`${suffix}-blocker-${index}`),
      "Disposable blocker issue for Dalph #71 qualification.",
      `issue-71-create-blocker-${suffix}-${index}`
    )
    resources = appendIssue(resources, repository, blocker)
    yield* Ref.set(resourcesRef, resources)
    const locator = resources.issues[resources.issues.length - 1]
    if (locator === undefined) {
      return yield* new GithubFixtureBoundaryFailure({
        detail: "created blocker locator was not retained",
        operation: "createIssue"
      })
    }
    blockerIssues.push(locator)
    yield* api.addBlockedBy(childIssue.id, blocker.id, `issue-71-add-blocker-${suffix}-${index}`)
  }

  const firstBlocker = blockerIssues[0]
  if (firstBlocker === undefined) {
    return yield* new GithubFixtureBoundaryFailure({
      detail: "fixture requires one blocker",
      operation: "createFixture"
    })
  }
  const prerequisiteOnlyChildIssue = yield* api.createIssue(
    repositoryNodeId,
    fixturePrefix(`${suffix}-prerequisite-only-child`),
    "This grouping descendant must remain outside the selected closure.",
    `issue-71-create-prerequisite-child-${suffix}`
  )
  resources = appendIssue(resources, repository, prerequisiteOnlyChildIssue)
  yield* Ref.set(resourcesRef, resources)
  yield* api.addSubIssue(
    firstBlocker.nodeId,
    prerequisiteOnlyChildIssue.id,
    `issue-71-add-prerequisite-child-${suffix}`
  )

  const root = resources.issues[0]
  const child = resources.issues[1]
  if (root === undefined || child === undefined) {
    return yield* new GithubFixtureBoundaryFailure({
      detail: "fixture root and child locators were not retained",
      operation: "createFixture"
    })
  }
  return {
    ...resources,
    child,
    prerequisiteOnlyChild: resources.issues[resources.issues.length - 1] ?? child,
    root,
    rootBody,
    rootTitle,
    taskId: githubTaskIdFor(repositoryNodeId, root.nodeId)
  }
})

const cleanFixture = Effect.fn("GithubQualification.cleanFixture")(function* (
  api: GithubQualificationApi,
  resources: GithubFixtureResources
): Effect.fn.Return<void, GithubFixtureCleanupFailure> {
  let remaining = resources
  for (const label of resources.labels) {
    const result = yield* api
      .deleteLabelByName(resources.repository.nodeId, label, `issue-71-delete-label-${label}`)
      .pipe(Effect.result)
    if (result._tag === "Failure") {
      return yield* new GithubFixtureCleanupFailure({ detail: result.failure.detail, remaining })
    }
    remaining = { ...remaining, labels: remaining.labels.filter((current) => current !== label) }
  }
  for (const issue of [...resources.issues].reverse()) {
    const result = yield* api
      .deleteIssue(issue.nodeId, `issue-71-delete-issue-${issue.target.issueNumber}`)
      .pipe(Effect.result)
    if (result._tag === "Failure") {
      return yield* new GithubFixtureCleanupFailure({ detail: result.failure.detail, remaining })
    }
    remaining = { ...remaining, issues: remaining.issues.filter(({ nodeId }) => nodeId !== issue.nodeId) }
  }
})

const readConfiguredQualification = Effect.fn("GithubQualification.readConfiguration")(function* () {
  const repository = yield* Config.string("DALPH_GITHUB_QUALIFICATION_REPOSITORY").pipe(Effect.flatMap(parseRepository))
  // oxlint-disable-next-line no-restricted-globals -- the opt-in lane reads its process configuration.
  const blockerTotal = yield* blockerCount(globalThis.process.env["DALPH_GITHUB_QUALIFICATION_BLOCKERS"])
  const token = yield* Config.redacted("GITHUB_TOKEN")
  return { blockerTotal, repository, token }
})

const claimLabelNameFor = Effect.fn("GithubQualification.claimLabelNameFor")(function* (
  taskId: TaskId
): Effect.fn.Return<GithubLabelName, GithubFixtureBoundaryFailure, Crypto.Crypto> {
  const crypto = yield* Crypto.Crypto
  const digest = yield* crypto
    .digest("SHA-256", new TextEncoder().encode(taskId))
    .pipe(
      Effect.mapError(
        () => new GithubFixtureBoundaryFailure({ detail: "claim label digest failed", operation: "claimLabelName" })
      )
    )
  const hash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  return GithubLabelName.make(`dalph-claim-${hash.slice(0, 32)}`)
})

/** One process-local lane prevents disposable repositories from overlapping. */
const qualificationGate = Effect.runSync(Semaphore.make(1))
const serializedQualification = <A, E, R>(effect: Effect.Effect<A, E, R>) => qualificationGate.withPermit(effect)

type GithubGraphqlRequestTag = GithubGraphqlRequest["_tag"]

const responseLossGithubGraphqlClient = (
  underlying: GithubGraphqlClient["Service"],
  createRequestCount: Ref.Ref<number>,
  lost: Ref.Ref<boolean>,
  requestLog: Ref.Ref<ReadonlyArray<GithubGraphqlRequestTag>>
): GithubGraphqlClient["Service"] =>
  GithubGraphqlClient.of({
    execute: Effect.fn("GithubQualification.ResponseLoss.execute")(function* (request: GithubGraphqlRequest) {
      yield* Ref.update(requestLog, (requests) => [...requests, request._tag])
      const response = yield* underlying.execute(request)
      if (request._tag !== "CreateClaimLabel") return response
      yield* Ref.update(createRequestCount, (count) => count + 1)
      const alreadyLost = yield* Ref.getAndSet(lost, true)
      if (!alreadyLost) {
        return yield* new GithubGraphqlRequestError({
          detail: "qualification response intentionally lost",
          operation: request._tag
        })
      }
      return response
    })
  })

const readGraphAndFacts = Effect.fn("GithubQualification.readGraphAndFacts")(function* (
  reader: TrackerGraphReader["Service"],
  target: GithubIssueTarget,
  operationId: string,
  records: ReadonlyArray<{ readonly event: unknown }>
) {
  const snapshot = yield* reader.read(target)
  const operation = makeTrackerGraphObservationOperation(OperationId.make(operationId), target)
  const event = makeTaskTrackerFactsObservedFromRead(records, operation, snapshot)
  return { event, snapshot }
})

const noOpCleanupApi = (failAt: GithubIssueNodeId): GithubQualificationApi => ({
  addBlockedBy: () => Effect.void,
  addSubIssue: () => Effect.void,
  closeIssue: () => Effect.void,
  createIssue: () => Effect.die("unused"),
  deleteIssue: (issueId) =>
    issueId === failAt
      ? Effect.fail(new GithubFixtureBoundaryFailure({ detail: "simulated cleanup failure", operation: "deleteIssue" }))
      : Effect.void,
  deleteLabelByName: () => Effect.void,
  removeSubIssue: () => Effect.void,
  repositoryNodeId: () => Effect.die("unused")
})

it.effect("decodes GitHub mutation results under their exact GraphQL operation fields", () =>
  Effect.gen(function* () {
    const issue = yield* decodeGraphqlData("createIssue", createIssueResponse, {
      data: { createIssue: { issue: { id: "fixture-issue-node", number: 1 } } }
    })
    expect(issue.createIssue.issue).toEqual({ id: "fixture-issue-node", number: 1 })

    yield* Effect.all([
      decodeGraphqlData("addBlockedBy", addBlockedByResponse, {
        data: { addBlockedBy: { clientMutationId: "fixture-add-blocker" } }
      }),
      decodeGraphqlData("addSubIssue", addSubIssueResponse, {
        data: { addSubIssue: { clientMutationId: "fixture-add-child" } }
      }),
      decodeGraphqlData("closeIssue", closeIssueResponse, {
        data: { closeIssue: { clientMutationId: "fixture-close" } }
      }),
      decodeGraphqlData("deleteIssue", deleteIssueResponse, {
        data: { deleteIssue: { clientMutationId: "fixture-delete" } }
      }),
      decodeGraphqlData("removeSubIssue", removeSubIssueResponse, {
        data: { removeSubIssue: { clientMutationId: "fixture-remove-child" } }
      })
    ])
  })
)

it.effect("loses exactly the first native claim-create response after GitHub applies it", () =>
  Effect.gen(function* () {
    const createRequestCount = yield* Ref.make(0)
    const lost = yield* Ref.make(false)
    const requestLog = yield* Ref.make<ReadonlyArray<GithubGraphqlRequestTag>>([])
    const underlying = GithubGraphqlClient.of({
      execute: () => Effect.succeed(GithubGraphqlResponse.make({ body: {} }))
    })
    const client = responseLossGithubGraphqlClient(underlying, createRequestCount, lost, requestLog)
    const request = GithubGraphqlRequest.cases.CreateClaimLabel.make({
      description: "fixture-description",
      labelName: GithubLabelName.make("fixture-label"),
      operationId: OperationId.make("fixture-create-claim"),
      repositoryNodeId: GithubRepositoryNodeId.make("fixture-repository")
    })

    const first = yield* client.execute(request).pipe(Effect.result)
    expect(first._tag).toBe("Failure")
    expect(yield* Ref.get(createRequestCount)).toBe(1)
    expect((yield* client.execute(request)).body).toEqual({})
    expect(yield* Ref.get(createRequestCount)).toBe(2)
  })
)

it.effect("retains exact GitHub fixture locators when cleanup cannot finish", () =>
  Effect.gen(function* () {
    const repository = GithubQualificationRepository.make({
      owner: GithubRepositoryOwner.make("fixture-owner"),
      repository: GithubRepositoryName.make("fixture-repository")
    })
    const repositoryNodeId = GithubRepositoryNodeId.make("fixture-repository-node")
    const first = GithubFixtureIssueLocator.make({
      nodeId: GithubIssueNodeId.make("fixture-first-node"),
      target: issueTargetFor(repository, GithubIssueNumber.make(1))
    })
    const second = GithubFixtureIssueLocator.make({
      nodeId: GithubIssueNodeId.make("fixture-second-node"),
      target: issueTargetFor(repository, GithubIssueNumber.make(2))
    })
    const third = GithubFixtureIssueLocator.make({
      nodeId: GithubIssueNodeId.make("fixture-third-node"),
      target: issueTargetFor(repository, GithubIssueNumber.make(3))
    })
    const resources = GithubFixtureResources.make({
      issues: [first, second, third],
      labels: [GithubLabelName.make("dalph-claim-fixture")],
      repository: GithubFixtureRepositoryLocator.make({
        nodeId: repositoryNodeId,
        owner: repository.owner,
        repository: repository.repository
      })
    })
    const failure = yield* cleanFixture(noOpCleanupApi(second.nodeId), resources).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(GithubFixtureCleanupFailure)
    expect(failure.remaining).toEqual({ issues: [first, second], labels: [], repository: resources.repository })
  })
)

it.effect.skipIf(!qualificationEnabled)(
  "qualifies exact GitHub instructions, a complete native closure, changed facts, and competing claims",
  () =>
    serializedQualification(
      Effect.scoped(
        Effect.gen(function* () {
          const configuration = yield* readConfiguredQualification()
          const api = yield* makeGithubQualificationApi(configuration.token)
          const repositoryNodeId = yield* api.repositoryNodeId(configuration.repository)
          const resourcesRef = yield* Ref.make<GithubFixtureResources>(
            GithubFixtureResources.make({
              issues: [],
              labels: [],
              repository: GithubFixtureRepositoryLocator.make({
                nodeId: repositoryNodeId,
                owner: configuration.repository.owner,
                repository: configuration.repository.repository
              })
            })
          )
          const fixtureResult = yield* Effect.exit(
            makeFixture(api, configuration.repository, repositoryNodeId, configuration.blockerTotal, resourcesRef)
          )
          const setupResources = yield* Ref.get(resourcesRef)
          if (fixtureResult._tag === "Failure") {
            const cleanupResult = yield* cleanFixture(api, setupResources).pipe(Effect.exit)
            if (cleanupResult._tag === "Failure") return yield* Effect.failCause(cleanupResult.cause)
            return yield* Effect.failCause(fixtureResult.cause)
          }
          const fixture = fixtureResult.value
          const observedRequests = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest["_tag"]>>([])
          const underlyingClient = Context.get(yield* Layer.build(githubGraphqlClientNodeLayer), GithubGraphqlClient)
          const observedClientLayer = Layer.succeed(
            GithubGraphqlClient,
            GithubGraphqlClient.of({
              execute: (request) =>
                Ref.update(observedRequests, (requests) => [...requests, request._tag]).pipe(
                  Effect.andThen(underlyingClient.execute(request))
                )
            })
          )

          const qualificationResult = yield* Effect.exit(
            Effect.gen(function* () {
              const reader = yield* TrackerGraphReader
              const first = yield* readGraphAndFacts(reader, fixture.root.target, "issue-71-first-read", [])
              const rootTaskId = fixture.taskId
              const childTaskId = githubTaskIdFor(repositoryNodeId, fixture.child.nodeId)
              const prerequisiteOnlyChildTaskId = githubTaskIdFor(
                repositoryNodeId,
                fixture.prerequisiteOnlyChild.nodeId
              )
              expect(first.snapshot.childrenOf(rootTaskId)).toEqual([childTaskId])
              expect(first.snapshot.prerequisitesOf(childTaskId)).toHaveLength(configuration.blockerTotal)
              expect(first.snapshot.taskIds()).toHaveLength(configuration.blockerTotal + 2)
              expect(first.snapshot.taskIds()).not.toContain(prerequisiteOnlyChildTaskId)
              const beforeFocusedRead = (yield* Ref.get(observedRequests)).length
              const focused = yield* reader.readTaskWorkSpecification(fixture.root.target, rootTaskId)
              expect(focused).toEqual(
                makeTaskWorkSpecification({ body: fixture.rootBody, taskId: rootTaskId, title: fixture.rootTitle })
              )
              expect((yield* Ref.get(observedRequests)).slice(beforeFocusedRead)).toEqual([
                "ResolveIssue",
                "ReadTaskWorkSpecification"
              ])
              expect(first.event.observation._tag).toBe("CompleteTaskTrackerFacts")
              if (first.event.observation._tag === "CompleteTaskTrackerFacts") {
                expect(first.event.observation.factFamilies.map(({ completeness }) => completeness)).toEqual([
                  "Complete",
                  "Complete",
                  "Complete",
                  "Complete",
                  "Complete"
                ])
                expect(first.event.observation.factFamilies.map(({ consistency }) => consistency)).toEqual([
                  "PotentiallyMixedTime",
                  "PotentiallyMixedTime",
                  "PotentiallyMixedTime",
                  "PotentiallyMixedTime",
                  "PotentiallyMixedTime"
                ])
                expect(
                  first.event.observation.factFamilies.every(
                    ({ freshness }) => freshness.operationId === OperationId.make("issue-71-first-read")
                  )
                ).toBe(true)
                expect(
                  first.event.observation.factFamilies.map(({ coverage }) => coverage.explicitlyCoveredTaskIds)
                ).toEqual([[], [], [], [], []])
                expect(first.event.observation.factFamilies.map(({ coverage }) => coverage.target)).toEqual([
                  fixture.root.target,
                  fixture.root.target,
                  fixture.root.target,
                  fixture.root.target,
                  fixture.root.target
                ])
                const [identities, lifecycles, prerequisites, groupings, membership] =
                  first.event.observation.factFamilies
                expect(lifecycles.subjectTaskIds).toEqual(identities.taskIds)
                expect(prerequisites.subjectTaskIds).toEqual(identities.taskIds)
                expect(groupings.subjectTaskIds).toEqual(identities.taskIds)
                expect(membership.memberTaskIds).toEqual(identities.taskIds)
              }
              const unchanged = yield* readGraphAndFacts(reader, fixture.root.target, "issue-71-unchanged-read", [
                { event: first.event }
              ])
              expect(unchanged.event.observation._tag).toBe("UnchangedTaskTrackerFactsReconfirmed")
              if (unchanged.event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed") {
                expect(unchanged.event.observation.priorFullObservationOperationId).toBe(first.event.operationId)
              }

              const ownerA = ClaimOwner.make("qualification-owner-a")
              const tokenA = ClaimToken.make("qualification-token-a")
              const ownerB = ClaimOwner.make("qualification-owner-b")
              const tokenB = ClaimToken.make("qualification-token-b")
              const labelForRoot = yield* claimLabelNameFor(rootTaskId)
              yield* Ref.update(resourcesRef, (current) => ({ ...current, labels: [labelForRoot] }))
              const acquisitionA = TaskClaimAcquisition.make({
                operationId: OperationId.make("issue-71-claim-a"),
                owner: ownerA,
                taskId: rootTaskId,
                token: tokenA
              })
              const acquisitionB = TaskClaimAcquisition.make({
                operationId: OperationId.make("issue-71-claim-b"),
                owner: ownerB,
                taskId: rootTaskId,
                token: tokenB
              })
              const mutation = yield* TrackerMutation
              const competing = yield* Effect.all(
                [acquisitionA, acquisitionB].map((acquisition) =>
                  runTaskClaimAcquisitionProtocol(mutation, acquisition).pipe(Effect.result)
                ),
                { concurrency: "unbounded" }
              )
              expect(competing.filter(({ _tag }) => _tag === "Success")).toHaveLength(1)
              const losingClaims = competing.filter(
                (result): result is Extract<(typeof competing)[number], { readonly _tag: "Failure" }> =>
                  result._tag === "Failure"
              )
              expect(losingClaims.every(({ failure }) => failure instanceof TaskClaimConflict)).toBe(true)
              const winner = competing.find(({ _tag }) => _tag === "Success")
              if (winner?._tag !== "Success") return yield* Effect.die("native claim race produced no winner")
              const currentClaim = yield* mutation.readTaskClaim(rootTaskId)
              expect(currentClaim).toEqual(winner.success)
              yield* mutation.releaseTaskClaim({
                claim: winner.success,
                operationId: OperationId.make("issue-71-release-a")
              })

              const labelForChild = yield* claimLabelNameFor(childTaskId)
              yield* Ref.update(resourcesRef, (current) => ({ ...current, labels: [...current.labels, labelForChild] }))
              const ambiguousAcquisition = TaskClaimAcquisition.make({
                operationId: OperationId.make("issue-71-claim-ambiguous"),
                owner: ClaimOwner.make("qualification-owner-ambiguous"),
                taskId: childTaskId,
                token: ClaimToken.make("qualification-token-ambiguous")
              })
              const createRequestCount = yield* Ref.make(0)
              const lost = yield* Ref.make(false)
              const requestLog = yield* Ref.make<ReadonlyArray<GithubGraphqlRequestTag>>([])
              const ambiguousMutation = Layer.fresh(githubTrackerMutationLayer).pipe(
                Layer.provide(
                  Layer.succeed(
                    GithubGraphqlClient,
                    responseLossGithubGraphqlClient(underlyingClient, createRequestCount, lost, requestLog)
                  )
                ),
                Layer.provide(NodeCrypto.layer)
              )
              const ambiguousTracker = Context.get(yield* Layer.build(ambiguousMutation), TrackerMutation)
              const ambiguous = yield* runTaskClaimAcquisitionProtocol(ambiguousTracker, ambiguousAcquisition)
              expect(yield* Ref.get(requestLog)).toEqual(["FindClaimLabel", "CreateClaimLabel", "FindClaimLabel"])
              expect(yield* ambiguousTracker.readTaskClaim(childTaskId)).toEqual(ambiguous)
              yield* ambiguousTracker.releaseTaskClaim({
                claim: ambiguous,
                operationId: OperationId.make("issue-71-release-ambiguous")
              })
              expect(ambiguous.taskId).toBe(childTaskId)
              expect(yield* Ref.get(createRequestCount)).toBe(1)

              yield* api.closeIssue(fixture.child.nodeId, "issue-71-close-child")
              const closed = yield* readGraphAndFacts(reader, fixture.root.target, "issue-71-closed-read", [
                { event: first.event },
                { event: unchanged.event }
              ])
              expect(closed.event.observation._tag).toBe("CompleteTaskTrackerFacts")
              expect(closed.snapshot.toWire().tasks.find(({ id }) => id === childTaskId)?.lifecycle).toEqual(
                TaskLifecycle.cases.CompletedSuccessfully.make({})
              )

              yield* api.removeSubIssue(fixture.root.nodeId, fixture.child.nodeId, "issue-71-remove-child")
              const changed = yield* readGraphAndFacts(reader, fixture.root.target, "issue-71-changed-read", [
                { event: first.event },
                { event: unchanged.event },
                { event: closed.event }
              ])
              expect(changed.event.observation._tag).toBe("CompleteTaskTrackerFacts")
              expect(changed.snapshot.taskIds()).not.toContain(childTaskId)
              expect(changed.snapshot.revision).not.toBe(first.snapshot.revision)
            }).pipe(
              Effect.provide(githubTrackerGraphReaderLayer.pipe(Layer.provide(observedClientLayer))),
              Effect.provide(
                githubTrackerMutationLayer.pipe(Layer.provide(observedClientLayer), Layer.provide(NodeCrypto.layer))
              )
            )
          )
          const currentResources = yield* Ref.get(resourcesRef)
          const cleanupResult = yield* cleanFixture(api, currentResources).pipe(Effect.exit)
          if (cleanupResult._tag === "Failure") return yield* Effect.failCause(cleanupResult.cause)
          if (qualificationResult._tag === "Failure") return yield* Effect.failCause(qualificationResult.cause)
          return qualificationResult.value
        })
      ).pipe(Effect.provide(NodeHttpClient.layerUndici), Effect.provide(NodeCrypto.layer))
    ),
  { timeout: qualificationTimeoutMilliseconds }
)
