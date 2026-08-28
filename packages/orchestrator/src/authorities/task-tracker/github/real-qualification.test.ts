/* eslint-disable functional/immutable-data -- Fixture construction tracks exact disposable resources locally. */
// @effect-diagnostics multipleEffectProvide:off
import { NodeCrypto, NodeHttpClient } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Config, Context, Crypto, Effect, Layer, Option, Redacted, Ref, Schema, Semaphore } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import {
  AcceptedResult,
  AcceptedResultEvidenceManifest,
  makeTaskWorkSpecification,
  PlannedTaskAttempt,
  type TaskId
} from "@dalph/contracts"
import { makeTrackerGraphObservationOperation } from "../../../workflow/registry/operation.js"
import { OperationId } from "../../../workflow/identity.js"
import { makeTaskTrackerFactsObservedFromRead } from "../../../workflow/protocols/task-tracker-read/protocol.js"
import { runTaskClaimAcquisitionProtocol } from "../../../workflow/protocols/task-claim-acquisition/protocol.js"
import { EvidenceStore, memoryEvidenceStoreLayer } from "../../../workflow/protocols/evidence-store.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { InRunJournal, JournalRecord } from "../../../workflow-journal/store.js"
import { targetPromotionObservedSuccessRecordKey } from "../../../workflow-journal/record-key.js"
import {
  CompletionClaimBoundary,
  CompletionTaskBoundary,
  CompletionTaskClaim,
  CompletionTaskRequestOrdinal,
  completionClaimDeletionRequestFor,
  completionClaimReplacementRequestFor,
  completionTaskRequestFor
} from "../../../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture } from "../../../workflow/protocols/integration-finality/fixtures.js"
import {
  runCompletionClaimDeletionProtocol,
  runCompletionClaimReplacementProtocol
} from "../../../workflow/protocols/integration-finality/protocol.js"
import {
  authorizeCompletionTaskAttempt,
  readCurrentCompletionConfirmation,
  runCompletionTaskProtocol
} from "../../../workflow/protocols/integration-finality/completion-task-protocol.js"
import { IntegratorRunQualifiedCandidate } from "../../../workflow/protocols/integrator/events.js"
import {
  TargetPromotionGit,
  TargetPromotionGitReadObservation,
  TargetPromotionObservedSuccessEvent,
  targetPromotionCorrelationFor
} from "../../../workflow/protocols/target-promotion/events.js"
import {
  ClaimOwner,
  ClaimToken,
  TaskClaimAcquisition,
  TaskClaimConflict,
  TaskLifecycle,
  TaskTrackerMutationThrottled,
  TaskTrackerThrottleRetryAfterSeconds,
  TaskTrackerThrottleTimingEvidence,
  TrackerGraphReader,
  TrackerMutation
} from "../../../index.js"
import {
  GithubGraphqlClient,
  GithubGraphqlRequest,
  GithubGraphqlResponse,
  GithubGraphqlRequestError,
  githubGraphqlClientLayer,
  githubGraphqlClientNodeLayer,
  GithubIssueNodeId,
  GithubLabelName,
  GithubLabelNodeId,
  GithubRepositoryNodeId
} from "./graphql-client.js"
import { githubTrackerGraphReaderLayer } from "./graph-reader.js"
import { githubTrackerMutationLayer } from "./claim-mutation.js"
import { githubDeliveryAuthorityLayer } from "./delivery-authority.js"
import { githubTaskIdFor } from "./task-identity.js"
import { GithubIssueNumber, GithubIssueTarget, GithubRepositoryName, GithubRepositoryOwner } from "./target.js"
import { githubGraphqlTestClient } from "./graphql-client.test-fixture.js"
import { CreateClaimLabelResponse, FindClaimLabelResponse, GithubGraphqlErrors } from "./claim-label-response.js"

// oxlint-disable-next-line no-restricted-globals -- opt-in is evaluated before test registration.
const qualificationEnabled = globalThis.process.env["DALPH_GITHUB_QUALIFICATION"] === "1"
const qualificationTimeoutMilliseconds = 10 * 60 * 1_000
const defaultBlockerCount = 2

const EncodedHttpRequestBody = Schema.Struct({ body: Schema.String })
const ControlledGraphqlRequestBody = Schema.fromJsonString(Schema.Struct({ query: Schema.String }))
const controlledGraphqlQuery = (request: HttpClientRequest.HttpClientRequest): string => {
  const encoded = Schema.decodeUnknownSync(EncodedHttpRequestBody)(request.body.toJSON())
  return Schema.decodeUnknownSync(ControlledGraphqlRequestBody)(encoded.body).query
}

const GithubQualificationRepository = Schema.Struct({ owner: GithubRepositoryOwner, repository: GithubRepositoryName })
type GithubQualificationRepository = typeof GithubQualificationRepository.Type

const GithubFixtureIssueLocator = Schema.Struct({ nodeId: GithubIssueNodeId, target: GithubIssueTarget })
type GithubFixtureIssueLocator = typeof GithubFixtureIssueLocator.Type

/** Exact GitHub label node whose fixture fingerprint was proved by a create response or exact later observation. */
const GithubFixtureLabelLocator = Schema.Struct({
  description: Schema.NonEmptyString,
  name: GithubLabelName,
  nodeId: GithubLabelNodeId
})
type GithubFixtureLabelLocator = typeof GithubFixtureLabelLocator.Type

const GithubFixtureRepositoryLocator = Schema.Struct({
  nodeId: GithubRepositoryNodeId,
  owner: GithubRepositoryOwner,
  repository: GithubRepositoryName
})
type GithubFixtureRepositoryLocator = typeof GithubFixtureRepositoryLocator.Type

/** Exact repository, issue, and label locators retained when fixture disposal fails. */
const GithubFixtureResources = Schema.Struct({
  issues: Schema.Array(GithubFixtureIssueLocator),
  labels: Schema.Array(GithubFixtureLabelLocator),
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
      label: Schema.NullOr(
        Schema.Struct({ description: Schema.NonEmptyString, id: GithubLabelNodeId, name: GithubLabelName })
      )
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
    ... on Repository { id label(name: $labelName) { id name description } }
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
  readonly deleteOwnedLabel: (
    repositoryId: GithubRepositoryNodeId,
    label: GithubFixtureLabelLocator,
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

  const deleteOwnedLabel = Effect.fn("GithubQualification.deleteOwnedLabel")(function* (
    repositoryId: GithubRepositoryNodeId,
    expected: GithubFixtureLabelLocator,
    mutationId: string
  ) {
    const findData = yield* execute("findLabel", findLabelQuery, { labelName: expected.name, repositoryId })
    const found = yield* decodeGraphqlData("findLabel", labelResponse, findData)
    if (found.node === null || found.node.id !== repositoryId) {
      return yield* new GithubFixtureBoundaryFailure({
        detail: "the fixture repository could not be proved while cleaning its label",
        operation: "deleteOwnedLabel"
      })
    }
    const label = found.node.label
    if (label === null) return
    if (label.id !== expected.nodeId || label.name !== expected.name || label.description !== expected.description) {
      return yield* new GithubFixtureBoundaryFailure({
        detail: "the current label does not match the exact fixture-owned node and fingerprint",
        operation: "deleteOwnedLabel"
      })
    }
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
    deleteOwnedLabel,
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

/** Leaves the remote create interruptible, then retains its exact successful response before honoring interruption. */
const createAndRetainFixtureIssue = Effect.fn("GithubQualification.createAndRetainFixtureIssue")(
  (
    api: GithubQualificationApi,
    repository: GithubQualificationRepository,
    repositoryNodeId: GithubRepositoryNodeId,
    title: string,
    body: string,
    mutationId: string,
    resourcesRef: Ref.Ref<GithubFixtureResources>
  ) =>
    Effect.uninterruptibleMask((restore) =>
      restore(api.createIssue(repositoryNodeId, title, body, mutationId)).pipe(
        Effect.flatMap((issue) =>
          Ref.updateAndGet(resourcesRef, (current) => appendIssue(current, repository, issue)).pipe(
            Effect.map((resources) => ({ issue, resources }))
          )
        )
      )
    )
)

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
  const rootAllocation = yield* createAndRetainFixtureIssue(
    api,
    repository,
    repositoryNodeId,
    rootTitle,
    rootBody,
    `issue-71-create-root-${suffix}`,
    resourcesRef
  )
  const rootIssue = rootAllocation.issue
  let resources = rootAllocation.resources
  const childAllocation = yield* createAndRetainFixtureIssue(
    api,
    repository,
    repositoryNodeId,
    fixturePrefix(`${suffix}-selected-child`),
    "Disposable selected child issue for Dalph #71 qualification.",
    `issue-71-create-child-${suffix}`,
    resourcesRef
  )
  const childIssue = childAllocation.issue
  resources = childAllocation.resources
  yield* api.addSubIssue(rootIssue.id, childIssue.id, `issue-71-add-child-${suffix}`)

  const blockerIssues: Array<GithubFixtureIssueLocator> = []
  for (let index = 0; index < blockerTotal; index += 1) {
    const allocation = yield* createAndRetainFixtureIssue(
      api,
      repository,
      repositoryNodeId,
      fixturePrefix(`${suffix}-blocker-${index}`),
      "Disposable blocker issue for Dalph #71 qualification.",
      `issue-71-create-blocker-${suffix}-${index}`,
      resourcesRef
    )
    const blocker = allocation.issue
    resources = allocation.resources
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
  const prerequisiteAllocation = yield* createAndRetainFixtureIssue(
    api,
    repository,
    repositoryNodeId,
    fixturePrefix(`${suffix}-prerequisite-only-child`),
    "This grouping descendant must remain outside the selected closure.",
    `issue-71-create-prerequisite-child-${suffix}`,
    resourcesRef
  )
  const prerequisiteOnlyChildIssue = prerequisiteAllocation.issue
  resources = prerequisiteAllocation.resources
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

const deliveryQualificationRepository = GithubQualificationRepository.make({
  owner: GithubRepositoryOwner.make("dearlordylord"),
  repository: GithubRepositoryName.make("dalph-disposable-qualification")
})

const makeDeliveryAuthorityFixture = Effect.fn("GithubQualification.makeDeliveryAuthorityFixture")(function* (
  api: GithubQualificationApi,
  repositoryNodeId: GithubRepositoryNodeId,
  resourcesRef: Ref.Ref<GithubFixtureResources>
): Effect.fn.Return<
  GithubFixtureResources & {
    readonly body: string
    readonly issue: GithubFixtureIssueLocator
    readonly taskId: TaskId
    readonly title: string
  },
  GithubFixtureBoundaryFailure,
  Crypto.Crypto
> {
  const crypto = yield* Crypto.Crypto
  const suffix = yield* crypto.randomUUIDv4.pipe(
    Effect.mapError(
      () =>
        new GithubFixtureBoundaryFailure({
          detail: "delivery fixture suffix generation failed",
          operation: "createDeliveryAuthorityFixture"
        })
    )
  )
  const empty = GithubFixtureResources.make({
    issues: [],
    labels: [],
    repository: GithubFixtureRepositoryLocator.make({
      nodeId: repositoryNodeId,
      owner: deliveryQualificationRepository.owner,
      repository: deliveryQualificationRepository.repository
    })
  })
  yield* Ref.set(resourcesRef, empty)
  const title = `dalph-issue-285-${suffix.slice(0, 12)}`
  const body = "Disposable single-issue fixture for Dalph GitHub delivery-authority qualification."
  const allocation = yield* createAndRetainFixtureIssue(
    api,
    deliveryQualificationRepository,
    repositoryNodeId,
    title,
    body,
    `issue-285-create-${suffix}`,
    resourcesRef
  )
  const resources = allocation.resources
  const issue = resources.issues[0]
  if (issue === undefined) {
    return yield* new GithubFixtureBoundaryFailure({
      detail: "delivery fixture issue locator was not retained",
      operation: "createDeliveryAuthorityFixture"
    })
  }
  return { ...resources, body, issue, taskId: githubTaskIdFor(repositoryNodeId, issue.nodeId), title }
})

const cleanFixture = Effect.fn("GithubQualification.cleanFixture")(function* (
  api: GithubQualificationApi,
  resources: GithubFixtureResources
): Effect.fn.Return<void, GithubFixtureCleanupFailure> {
  let remaining = resources
  for (const label of resources.labels) {
    const result = yield* api
      .deleteOwnedLabel(resources.repository.nodeId, label, `qualification-delete-label-${label.nodeId}`)
      .pipe(Effect.result)
    if (result._tag === "Failure") {
      return yield* new GithubFixtureCleanupFailure({ detail: result.failure.detail, remaining })
    }
    remaining = { ...remaining, labels: remaining.labels.filter(({ nodeId }) => nodeId !== label.nodeId) }
  }
  for (const issue of [...resources.issues].reverse()) {
    const result = yield* api
      .deleteIssue(issue.nodeId, `qualification-delete-issue-${issue.target.issueNumber}`)
      .pipe(Effect.result)
    if (result._tag === "Failure") {
      return yield* new GithubFixtureCleanupFailure({ detail: result.failure.detail, remaining })
    }
    remaining = { ...remaining, issues: remaining.issues.filter(({ nodeId }) => nodeId !== issue.nodeId) }
  }
})

const scopedFixtureResources = Effect.fn("GithubQualification.scopedFixtureResources")(function* (
  api: GithubQualificationApi,
  initial: GithubFixtureResources
) {
  const resources = yield* Ref.make(initial)
  yield* Effect.addFinalizer(() =>
    Ref.get(resources).pipe(
      Effect.flatMap((current) => cleanFixture(api, current)),
      Effect.uninterruptible,
      Effect.orDie
    )
  )
  return resources
})

const readConfiguredQualification = Effect.fn("GithubQualification.readConfiguration")(function* () {
  const repository = yield* Config.string("DALPH_GITHUB_QUALIFICATION_REPOSITORY").pipe(Effect.flatMap(parseRepository))
  // oxlint-disable-next-line no-restricted-globals -- the opt-in lane reads its process configuration.
  const blockerTotal = yield* blockerCount(globalThis.process.env["DALPH_GITHUB_QUALIFICATION_BLOCKERS"])
  const token = yield* Config.redacted("GITHUB_TOKEN")
  return { blockerTotal, repository, token }
})

const readConfiguredDeliveryQualification = Effect.fn("GithubQualification.readDeliveryAuthorityConfiguration")(
  function* () {
    const repository = yield* Config.string("DALPH_GITHUB_QUALIFICATION_REPOSITORY").pipe(
      Effect.flatMap(parseRepository)
    )
    if (
      repository.owner !== deliveryQualificationRepository.owner ||
      repository.repository !== deliveryQualificationRepository.repository
    ) {
      return yield* new GithubQualificationConfigurationFailure({
        detail: "issue #285 qualification requires dearlordylord/dalph-disposable-qualification"
      })
    }
    const token = yield* Config.redacted("GITHUB_TOKEN")
    return { repository, token }
  }
)

/** One process-local lane prevents disposable repositories from overlapping. */
const qualificationGate = Effect.runSync(Semaphore.make(1))
const serializedQualification = <A, E, R>(effect: Effect.Effect<A, E, R>) => qualificationGate.withPermit(effect)

type GithubGraphqlRequestTag = GithubGraphqlRequest["_tag"]

const observedDeliveryAuthorityClient = (
  underlying: GithubGraphqlClient["Service"],
  requestLog: Ref.Ref<ReadonlyArray<GithubGraphqlRequestTag>>,
  resources: Ref.Ref<GithubFixtureResources>,
  /** Request predicates used to recognize a later exact response; never ownership or cleanup input. */
  requestedLabelDescriptions: Ref.Ref<ReadonlyMap<GithubLabelName, string>>
): GithubGraphqlClient["Service"] =>
  githubGraphqlTestClient(
    Effect.fn("GithubQualification.DeliveryAuthority.execute")((request: GithubGraphqlRequest) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          yield* Ref.update(requestLog, (requests) => [...requests, request._tag])
          if (request._tag === "CreateClaimLabel") {
            yield* Ref.update(
              requestedLabelDescriptions,
              (current) => new Map([...current, [request.labelName, request.description]])
            )
          }
          const response = yield* restore(underlying.execute(request))
          const header = Schema.decodeUnknownOption(GithubGraphqlErrors)(response.body)
          const responseProvesSuccess =
            Option.isSome(header) && (header.value.errors === undefined || header.value.errors.length === 0)
          const observed = !responseProvesSuccess
            ? Option.none()
            : request._tag === "CreateClaimLabel"
              ? Schema.decodeUnknownOption(CreateClaimLabelResponse)(response.body).pipe(
                  Option.map(({ data }) => data.createLabel.label),
                  Option.filter(
                    (label) => label.name === request.labelName && label.description === request.description
                  )
                )
              : request._tag === "FindClaimLabel"
                ? Schema.decodeUnknownOption(FindClaimLabelResponse)(response.body).pipe(
                    Option.flatMap(({ data }) =>
                      data.node?.id === request.repositoryNodeId ? Option.fromNullOr(data.node.label) : Option.none()
                    )
                  )
                : Option.none()
          if (Option.isSome(observed)) {
            const expectedDescription = (yield* Ref.get(requestedLabelDescriptions)).get(observed.value.name)
            if (expectedDescription === observed.value.description) {
              const locator = GithubFixtureLabelLocator.make({
                description: observed.value.description,
                name: observed.value.name,
                nodeId: observed.value.id
              })
              yield* Ref.update(resources, (current) =>
                // A later node at an already-owned name is a replacement, not another fixture allocation.
                current.labels.some(({ name }) => name === locator.name)
                  ? current
                  : { ...current, labels: [...current.labels, locator] }
              )
            }
          }
          return response
        })
      )
    )
  )

const responseLossGithubGraphqlClient = (
  underlying: GithubGraphqlClient["Service"],
  createRequestCount: Ref.Ref<number>,
  lost: Ref.Ref<boolean>,
  requestLog: Ref.Ref<ReadonlyArray<GithubGraphqlRequestTag>>
): GithubGraphqlClient["Service"] =>
  githubGraphqlTestClient(
    Effect.fn("GithubQualification.ResponseLoss.execute")(function* (request: GithubGraphqlRequest) {
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
  )

const qualificationJournalLayer = (records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  Layer.succeed(
    InRunJournal,
    InRunJournal.of({
      append: (runId, key, event) =>
        Ref.modify(records, (current) => {
          const existing = current.find((record) => record.key === key)
          if (existing !== undefined) return [Effect.succeed(existing), current] as const
          const record = JournalRecord.make({ event, key, position: JournalPosition.make(current.length + 1), runId })
          return [Effect.succeed(record), [...current, record]] as const
        }).pipe(Effect.flatten),
      read: (runId) =>
        Ref.get(records).pipe(Effect.map((current) => current.filter((record) => record.runId === runId)))
    })
  )

const qualificationTargetGit = TargetPromotionGit.of({
  compareAndSet: () => Effect.die("completion authorization must only read the already-promoted candidate"),
  read: (request) =>
    Effect.succeed(
      TargetPromotionGitReadObservation.cases.CandidateCurrent.make({ currentHeadSha: request.candidateCommit })
    )
})

const encodeEvidence = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

const deliveryAuthorityJournalChronology = [
  "TargetPromotionObservedSuccess",
  "CompletionClaimReplacementIntended",
  "CompletionClaimReplacementAttemptIntended",
  "CompletionClaimReplaced",
  "TaskTrackerReadIntentRecorded",
  "TaskTrackerFactsObserved",
  "CompletionTaskCandidateAncestryReadIntended",
  "CompletionTaskCandidateAncestryObserved",
  "CompletionTaskIntended",
  "CompletionTaskAttemptIntended",
  "CompletionTaskAcknowledged",
  "TaskTrackerReadIntentRecorded",
  "TaskTrackerFactsObserved",
  "CompletionClaimDeletionIntended",
  "CompletionClaimDeletionReadObserved",
  "TaskClaimReleaseIntended",
  "TaskClaimReleased",
  "CompletionClaimDeletionReadObserved",
  "CompletionClaimDeletionReadObserved",
  "CompletionClaimDeletionAttemptIntended",
  "CompletionClaimDeletionReadObserved",
  "CompletionClaimDeletionReadObserved",
  "CompletionClaimDeleted",
  "IntegrationFinalitySettled"
] as const satisfies ReadonlyArray<JournalRecord["event"]["_tag"]>

const deliveryAuthorityProviderChronology = [
  "ResolveIssue",
  "ReadTaskWorkSpecification",
  "FindClaimLabel",
  "CreateClaimLabel",
  "FindClaimLabel",
  "FindClaimLabel",
  "FindClaimLabel",
  "CreateClaimLabel",
  "ResolveIssue",
  "ReadIssue",
  "ReadTaskWorkSpecification",
  "ReadBlockedBy",
  "FindClaimLabel",
  "FindClaimLabel",
  "CloseIssue",
  "ResolveIssue",
  "ReadIssue",
  "ReadTaskWorkSpecification",
  "ReadBlockedBy",
  "FindClaimLabel",
  "FindClaimLabel",
  "FindClaimLabel",
  "FindClaimLabel",
  "FindClaimLabel",
  "DeleteClaimLabel",
  "FindClaimLabel",
  "FindClaimLabel",
  "FindClaimLabel",
  "FindClaimLabel",
  "DeleteClaimLabel",
  "FindClaimLabel",
  "FindClaimLabel"
] as const satisfies ReadonlyArray<GithubGraphqlRequestTag>

/** Executes the accepted provider-neutral protocols over the four services from one delivery-authority Layer. */
const runDeliveryAuthorityQualificationJourney = Effect.fn("GithubQualification.runDeliveryAuthorityJourney")(
  function* (
    reader: TrackerGraphReader["Service"],
    mutation: TrackerMutation["Service"],
    completionClaims: CompletionClaimBoundary["Service"],
    taskCompletion: CompletionTaskBoundary["Service"],
    fixture: {
      readonly body: string
      readonly issue: GithubFixtureIssueLocator
      readonly taskId: TaskId
      readonly title: string
    }
  ) {
    const specification = yield* reader.readTaskWorkSpecification(fixture.issue.target, fixture.taskId)
    const acquisition = TaskClaimAcquisition.make({
      operationId: OperationId.make("issue-285-acquire-active-claim"),
      owner: ClaimOwner.make("dalph:issue-285"),
      taskId: fixture.taskId,
      token: ClaimToken.make("issue-285-active-token")
    })
    const activeClaim = yield* runTaskClaimAcquisitionProtocol(mutation, acquisition)
    const plannedAttempt = PlannedTaskAttempt.make({
      ...integrationFinalityFixture.plannedAttempt,
      taskId: fixture.taskId,
      taskRevision: specification.fingerprint
    })
    const store = yield* EvidenceStore
    const acceptedCommit = integrationFinalityFixture.qualifiedCandidate.run.session.acceptedResult.commit
    const evidenceManifest = yield* store.put(
      encodeEvidence(
        AcceptedResultEvidenceManifest.make({
          commit: acceptedCommit,
          correlation: { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId },
          formatVersion: 1,
          outcome: "Accepted",
          predecessor: null
        })
      )
    )
    const acceptedResult = AcceptedResult.make({ commit: acceptedCommit, evidenceManifest })
    const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
      ...integrationFinalityFixture.qualifiedCandidate,
      directParents: [
        integrationFinalityFixture.qualifiedCandidate.run.session.expectedTargetHead,
        acceptedResult.commit
      ],
      run: {
        ...integrationFinalityFixture.qualifiedCandidate.run,
        session: { ...integrationFinalityFixture.qualifiedCandidate.run.session, acceptedResult, plannedAttempt }
      }
    })
    const claim = CompletionTaskClaim.make({
      originalClaim: activeClaim,
      plannedAttempt,
      promotionCorrelation: targetPromotionCorrelationFor(qualifiedCandidate)
    })
    const promotion = TargetPromotionObservedSuccessEvent.make({
      ...integrationFinalityFixture.promotionSuccess,
      correlation: claim.promotionCorrelation
    })
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      JournalRecord.make({
        event: promotion,
        key: targetPromotionObservedSuccessRecordKey(claim.promotionCorrelation.requestId),
        position: JournalPosition.make(1),
        runId: plannedAttempt.runId
      })
    ])
    const journal = qualificationJournalLayer(records)
    const replacement = yield* runCompletionClaimReplacementProtocol(
      completionClaims,
      completionClaimReplacementRequestFor(claim)
    ).pipe(Effect.provide(journal))
    const completionRequest = completionTaskRequestFor(claim)
    const completion = yield* runCompletionTaskProtocol(
      taskCompletion,
      completionRequest,
      fixture.issue.target,
      (ordinal) =>
        authorizeCompletionTaskAttempt(taskCompletion, completionRequest, fixture.issue.target, ordinal).pipe(
          Effect.provideService(TargetPromotionGit, qualificationTargetGit)
        )
    ).pipe(Effect.provide(journal))
    const successObservation =
      "_tag" in completion
        ? completion
        : (yield* readCurrentCompletionConfirmation(
            taskCompletion,
            completionRequest,
            CompletionTaskRequestOrdinal.make(1),
            fixture.issue.target
          ).pipe(Effect.provide(journal))).observation
    if (successObservation === undefined) {
      return yield* Effect.die("fresh focused completion confirmation did not observe exact success")
    }
    const finality = yield* runCompletionClaimDeletionProtocol(
      completionClaims,
      completionClaimDeletionRequestFor(claim, successObservation),
      replacement.operationId
    ).pipe(Effect.provide(journal))

    return { activeClaim, claim, finality, records: yield* Ref.get(records), specification, successObservation }
  }
)

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
  deleteOwnedLabel: () => Effect.void,
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
    const label = GithubFixtureLabelLocator.make({
      description: "fixture-owned-description",
      name: GithubLabelName.make("dalph-claim-fixture"),
      nodeId: GithubLabelNodeId.make("fixture-label-node")
    })
    const resources = GithubFixtureResources.make({
      issues: [first, second, third],
      labels: [label],
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

it.effect("records a claim label only after an exact create response or later exact observation", () =>
  Effect.gen(function* () {
    const repository = GithubFixtureRepositoryLocator.make({
      nodeId: GithubRepositoryNodeId.make("fixture-repository-node"),
      owner: GithubRepositoryOwner.make("fixture-owner"),
      repository: GithubRepositoryName.make("fixture-repository")
    })
    const resources = yield* Ref.make(GithubFixtureResources.make({ issues: [], labels: [], repository }))
    const requestedLabelDescriptions = yield* Ref.make<ReadonlyMap<GithubLabelName, string>>(new Map())
    const requests = yield* Ref.make<ReadonlyArray<GithubGraphqlRequestTag>>([])
    const labelName = GithubLabelName.make("dalph-claim-observed")
    const description = "fixture-owned-description"
    const nodeId = GithubLabelNodeId.make("fixture-owned-label-node")
    const create = GithubGraphqlRequest.cases.CreateClaimLabel.make({
      description,
      labelName,
      operationId: OperationId.make("fixture-create-label"),
      repositoryNodeId: repository.nodeId
    })
    const underlying = githubGraphqlTestClient((request) =>
      request._tag === "CreateClaimLabel"
        ? Effect.fail(new GithubGraphqlRequestError({ detail: "response lost after create", operation: request._tag }))
        : request._tag === "FindClaimLabel"
          ? Effect.succeed(
              GithubGraphqlResponse.make({
                body: { data: { node: { id: repository.nodeId, label: { description, id: nodeId, name: labelName } } } }
              })
            )
          : Effect.die(`unexpected exact-label observation request ${request._tag}`)
    )
    const client = observedDeliveryAuthorityClient(underlying, requests, resources, requestedLabelDescriptions)

    yield* client.execute(create).pipe(Effect.result)
    expect((yield* Ref.get(resources)).labels).toEqual([])
    yield* client.execute(
      GithubGraphqlRequest.cases.FindClaimLabel.make({ labelName, repositoryNodeId: repository.nodeId })
    )
    expect((yield* Ref.get(resources)).labels).toEqual([
      GithubFixtureLabelLocator.make({ description, name: labelName, nodeId })
    ])
  })
)

it.effect("never records a foreign winner and preserves foreign or malformed replacements during cleanup", () =>
  Effect.gen(function* () {
    const repositoryNodeId = GithubRepositoryNodeId.make("fixture-repository-node")
    const labelName = GithubLabelName.make("dalph-claim-owned")
    const owned = GithubFixtureLabelLocator.make({
      description: "fixture-owned-description",
      name: labelName,
      nodeId: GithubLabelNodeId.make("fixture-owned-label-node")
    })
    const deleteCalls = yield* Ref.make(0)
    const http = HttpClient.make((request) => {
      const query = controlledGraphqlQuery(request)
      if (query.includes("query QualificationFindLabel")) {
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(
              JSON.stringify({
                data: {
                  node: {
                    id: repositoryNodeId,
                    label: { description: "foreign-description", id: "foreign-label-node", name: labelName }
                  }
                }
              }),
              { status: 200 }
            )
          )
        )
      }
      if (query.includes("mutation QualificationDeleteLabel")) {
        return Ref.update(deleteCalls, (count) => count + 1).pipe(
          Effect.as(HttpClientResponse.fromWeb(request, new Response(JSON.stringify({ data: {} }), { status: 200 })))
        )
      }
      return Effect.die(`unexpected foreign replacement cleanup request ${query}`)
    })
    const api = yield* makeGithubQualificationApi(Redacted.make("controlled-token")).pipe(
      Effect.provideService(HttpClient.HttpClient, http)
    )
    const resources = GithubFixtureResources.make({
      issues: [],
      labels: [owned],
      repository: GithubFixtureRepositoryLocator.make({
        nodeId: repositoryNodeId,
        owner: GithubRepositoryOwner.make("fixture-owner"),
        repository: GithubRepositoryName.make("fixture-repository")
      })
    })

    const failure = yield* cleanFixture(api, resources).pipe(Effect.flip)
    expect(failure.remaining).toEqual(resources)
    expect(yield* Ref.get(deleteCalls)).toBe(0)

    const malformedHttp = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            JSON.stringify({ data: { node: { id: repositoryNodeId, label: { id: owned.nodeId, name: owned.name } } } }),
            { status: 200 }
          )
        )
      )
    )
    const malformedApi = yield* makeGithubQualificationApi(Redacted.make("controlled-token")).pipe(
      Effect.provideService(HttpClient.HttpClient, malformedHttp)
    )
    const malformedFailure = yield* cleanFixture(malformedApi, resources).pipe(Effect.flip)
    expect(malformedFailure.remaining).toEqual(resources)
    expect(yield* Ref.get(deleteCalls)).toBe(0)

    const observedResources = yield* Ref.make<GithubFixtureResources>({ ...resources, labels: [] })
    const requestedLabelDescriptions = yield* Ref.make<ReadonlyMap<GithubLabelName, string>>(new Map())
    const requestLog = yield* Ref.make<ReadonlyArray<GithubGraphqlRequestTag>>([])
    const foreignClient = observedDeliveryAuthorityClient(
      githubGraphqlTestClient((request) =>
        request._tag === "CreateClaimLabel"
          ? Effect.succeed(
              GithubGraphqlResponse.make({ body: { errors: [{ message: "a foreign label won the create race" }] } })
            )
          : Effect.succeed(
              GithubGraphqlResponse.make({
                body: {
                  data: {
                    node: {
                      id: repositoryNodeId,
                      label: { description: "foreign-description", id: "foreign-label-node", name: labelName }
                    }
                  }
                }
              })
            )
      ),
      requestLog,
      observedResources,
      requestedLabelDescriptions
    )
    yield* foreignClient.execute(
      GithubGraphqlRequest.cases.CreateClaimLabel.make({
        description: owned.description,
        labelName,
        operationId: OperationId.make("foreign-wins-create"),
        repositoryNodeId
      })
    )
    yield* foreignClient.execute(GithubGraphqlRequest.cases.FindClaimLabel.make({ labelName, repositoryNodeId }))
    expect((yield* Ref.get(observedResources)).labels).toEqual([])
  })
)

it.effect("runs exact cleanup when timeout interrupts after each fixture allocation", () =>
  Effect.gen(function* () {
    const repository = GithubQualificationRepository.make({
      owner: GithubRepositoryOwner.make("fixture-owner"),
      repository: GithubRepositoryName.make("fixture-repository")
    })
    const repositoryLocator = GithubFixtureRepositoryLocator.make({
      nodeId: GithubRepositoryNodeId.make("fixture-repository-node"),
      owner: repository.owner,
      repository: repository.repository
    })
    const issue = GithubFixtureIssueLocator.make({
      nodeId: GithubIssueNodeId.make("fixture-issue-node"),
      target: issueTargetFor(repository, GithubIssueNumber.make(1))
    })
    const label = GithubFixtureLabelLocator.make({
      description: "fixture-owned-description",
      name: GithubLabelName.make("dalph-claim-owned"),
      nodeId: GithubLabelNodeId.make("fixture-label-node")
    })

    for (const allocation of ["Issue", "Label"] as const) {
      const cleanupCalls = yield* Ref.make<ReadonlyArray<string>>([])
      const api: GithubQualificationApi = {
        addBlockedBy: () => Effect.die("unused"),
        addSubIssue: () => Effect.die("unused"),
        closeIssue: () => Effect.die("unused"),
        createIssue: () => Effect.succeed({ id: issue.nodeId, number: issue.target.issueNumber }),
        deleteIssue: (issueId) => Ref.update(cleanupCalls, (calls) => [...calls, `issue:${issueId}`]),
        deleteOwnedLabel: (_repositoryId, current) =>
          Ref.update(cleanupCalls, (calls) => [...calls, `label:${current.nodeId}`]),
        removeSubIssue: () => Effect.die("unused"),
        repositoryNodeId: () => Effect.die("unused")
      }
      yield* Effect.scoped(
        Effect.gen(function* () {
          const resources = yield* scopedFixtureResources(
            api,
            GithubFixtureResources.make({ issues: [], labels: [], repository: repositoryLocator })
          )
          const retainedIssue = yield* createAndRetainFixtureIssue(
            api,
            repository,
            repositoryLocator.nodeId,
            "controlled fixture issue",
            "controlled fixture body",
            `controlled-create-${allocation}`,
            resources
          )
          if (allocation === "Label") {
            const requests = yield* Ref.make<ReadonlyArray<GithubGraphqlRequestTag>>([])
            const requestedLabelDescriptions = yield* Ref.make<ReadonlyMap<GithubLabelName, string>>(new Map())
            const client = observedDeliveryAuthorityClient(
              githubGraphqlTestClient((request) =>
                request._tag === "CreateClaimLabel"
                  ? Effect.succeed(
                      GithubGraphqlResponse.make({
                        body: {
                          data: {
                            createLabel: {
                              label: { description: label.description, id: label.nodeId, name: label.name }
                            }
                          }
                        }
                      })
                    )
                  : Effect.die(`unexpected controlled allocation request ${request._tag}`)
              ),
              requests,
              resources,
              requestedLabelDescriptions
            )
            yield* client.execute(
              GithubGraphqlRequest.cases.CreateClaimLabel.make({
                description: label.description,
                labelName: label.name,
                operationId: OperationId.make("controlled-label-allocation"),
                repositoryNodeId: retainedIssue.resources.repository.nodeId
              })
            )
          }
          return yield* Effect.never
        })
      ).pipe(Effect.timeout(0), Effect.result)

      expect(yield* Ref.get(cleanupCalls)).toEqual(
        allocation === "Label" ? [`label:${label.nodeId}`, `issue:${issue.nodeId}`] : [`issue:${issue.nodeId}`]
      )
    }
  })
)

it.effect("runs the shared integration-finality protocols through the composed GitHub authority", () =>
  Effect.gen(function* () {
    const repositoryNodeId = GithubRepositoryNodeId.make("controlled-delivery-repository")
    const issueNodeId = GithubIssueNodeId.make("controlled-delivery-issue")
    const target = GithubIssueTarget.make({
      issueNumber: GithubIssueNumber.make(285),
      owner: GithubRepositoryOwner.make("controlled-owner"),
      repository: GithubRepositoryName.make("controlled-repository")
    })
    const taskId = githubTaskIdFor(repositoryNodeId, issueNodeId)
    const body = "Controlled delivery-authority body"
    const title = "Controlled delivery-authority issue"
    const closed = yield* Ref.make(false)
    const labels = yield* Ref.make<
      ReadonlyMap<
        GithubLabelName,
        { readonly description: string; readonly id: GithubLabelNodeId; readonly name: GithubLabelName }
      >
    >(new Map())
    const requests = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest>>([])
    const client = githubGraphqlTestClient(
      Effect.fn("GithubQualification.ControlledDeliveryAuthority.execute")(function* (request: GithubGraphqlRequest) {
        yield* Ref.update(requests, (current) => [...current, request])
        if (request._tag === "ResolveIssue") {
          return { body: { data: { repository: { id: repositoryNodeId, issue: { id: issueNodeId } } } } }
        }
        if (request._tag === "ReadTaskWorkSpecification") {
          return {
            body: {
              data: {
                node: { __typename: "Issue", body, id: issueNodeId, repository: { id: repositoryNodeId }, title }
              }
            }
          }
        }
        if (request._tag === "FindClaimLabel") {
          return {
            body: {
              data: { node: { id: repositoryNodeId, label: (yield* Ref.get(labels)).get(request.labelName) ?? null } }
            }
          }
        }
        if (request._tag === "CreateClaimLabel") {
          const label = {
            description: request.description,
            id: GithubLabelNodeId.make(`controlled-label:${request.operationId}`),
            name: request.labelName
          }
          yield* Ref.update(labels, (current) => new Map(current).set(request.labelName, label))
          return { body: { data: { createLabel: { label } } } }
        }
        if (request._tag === "DeleteClaimLabel") {
          yield* Ref.update(labels, (current) => {
            const next = new Map(current)
            for (const [name, label] of next) {
              if (label.id === request.labelNodeId) next.delete(name)
            }
            return next
          })
          return { body: { data: { deleteLabel: { clientMutationId: request.operationId } } } }
        }
        if (request._tag === "ReadIssue") {
          const isClosed = yield* Ref.get(closed)
          return {
            body: {
              data: {
                node: {
                  __typename: "Issue",
                  id: issueNodeId,
                  parent: null,
                  repository: { id: repositoryNodeId },
                  state: isClosed ? "CLOSED" : "OPEN",
                  stateReason: isClosed ? "COMPLETED" : null
                }
              }
            }
          }
        }
        if (request._tag === "ReadBlockedBy") {
          return {
            body: {
              data: {
                node: {
                  __typename: "Issue",
                  blockedBy: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
                  id: issueNodeId
                }
              }
            }
          }
        }
        if (request._tag === "CloseIssue") {
          yield* Ref.set(closed, true)
          return {
            body: {
              data: {
                closeIssue: {
                  clientMutationId: request.operationId,
                  issue: { id: issueNodeId, state: "OPEN", stateReason: null }
                }
              }
            }
          }
        }
        return yield* Effect.die(`unexpected controlled delivery-authority request ${request._tag}`)
      })
    )
    const context = yield* Layer.build(
      githubDeliveryAuthorityLayer.pipe(
        Layer.provide(Layer.succeed(GithubGraphqlClient, client)),
        Layer.provide(NodeCrypto.layer)
      )
    )
    const result = yield* runDeliveryAuthorityQualificationJourney(
      Context.get(context, TrackerGraphReader),
      Context.get(context, TrackerMutation),
      Context.get(context, CompletionClaimBoundary),
      Context.get(context, CompletionTaskBoundary),
      { body, issue: GithubFixtureIssueLocator.make({ nodeId: issueNodeId, target }), taskId, title }
    ).pipe(Effect.provide(memoryEvidenceStoreLayer))

    expect(result.successObservation.lifecycle).toBe("CompletedSuccessfully")
    expect(result.finality.successObservation).toEqual(result.successObservation)
    expect(yield* Ref.get(labels)).toEqual(new Map())
    expect(result.records.map(({ event }) => event._tag)).toEqual(deliveryAuthorityJournalChronology)
    expect((yield* Ref.get(requests)).map(({ _tag }) => _tag)).toEqual(deliveryAuthorityProviderChronology)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("stops the production GitHub claim composition after one controlled throttled mutation", () =>
  Effect.gen(function* () {
    const repositoryNodeId = GithubRepositoryNodeId.make("controlled-throttle-repository")
    const issueNodeId = GithubIssueNodeId.make("controlled-throttle-issue")
    const acquisition = TaskClaimAcquisition.make({
      operationId: OperationId.make("controlled-throttle-acquire"),
      owner: ClaimOwner.make("controlled-throttle-owner"),
      taskId: githubTaskIdFor(repositoryNodeId, issueNodeId),
      token: ClaimToken.make("controlled-throttle-token")
    })
    const requests = yield* Ref.make<ReadonlyArray<"FindClaimLabel" | "CreateClaimLabel">>([])
    const httpClient = HttpClient.make((request) =>
      Effect.gen(function* () {
        const query = controlledGraphqlQuery(request)
        if (query.includes("query FindClaimLabel")) {
          yield* Ref.update(requests, (current) => [...current, "FindClaimLabel" as const])
          return HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify({ data: { node: { id: repositoryNodeId, label: null } } }), { status: 200 })
          )
        }
        if (query.includes("mutation CreateClaimLabel")) {
          yield* Ref.update(requests, (current) => [...current, "CreateClaimLabel" as const])
          return HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify({ errors: [{ message: "You have exceeded a secondary rate limit" }] }), {
              headers: { "retry-after": "11" },
              status: 403
            })
          )
        }
        return yield* Effect.die(`unexpected controlled GitHub request after throttle: ${query}`)
      })
    )
    const clientLayer = githubGraphqlClientLayer({ token: Redacted.make("controlled-qualification-token") }).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    )
    const mutationLayer = githubTrackerMutationLayer.pipe(Layer.provide(clientLayer), Layer.provide(NodeCrypto.layer))
    const failure = yield* Effect.gen(function* () {
      const tracker = yield* TrackerMutation
      return yield* runTaskClaimAcquisitionProtocol(tracker, acquisition).pipe(Effect.flip)
    }).pipe(Effect.provide(mutationLayer))

    expect(failure).toEqual(
      new TaskTrackerMutationThrottled({
        detail: "GitHub secondary rate limit rejected the GraphQL request",
        operation: "AcquireTaskClaim",
        operationId: acquisition.operationId,
        retry: TaskTrackerThrottleTimingEvidence.cases.RetryAfter.make({
          seconds: TaskTrackerThrottleRetryAfterSeconds.make(11)
        })
      })
    )
    expect(yield* Ref.get(requests)).toEqual(["FindClaimLabel", "CreateClaimLabel"])
  })
)

it.effect.skipIf(!qualificationEnabled)(
  "qualifies one composed GitHub delivery authority journey with one disposable issue",
  () =>
    serializedQualification(
      Effect.scoped(
        Effect.gen(function* () {
          const configuration = yield* readConfiguredDeliveryQualification()
          const api = yield* makeGithubQualificationApi(configuration.token)
          const repositoryNodeId = yield* api.repositoryNodeId(configuration.repository)
          const resourcesRef = yield* scopedFixtureResources(
            api,
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
          const fixture = yield* makeDeliveryAuthorityFixture(api, repositoryNodeId, resourcesRef)
          expect(fixture.issues).toEqual([fixture.issue])
          const requestLog = yield* Ref.make<ReadonlyArray<GithubGraphqlRequestTag>>([])
          const requestedLabelDescriptions = yield* Ref.make<ReadonlyMap<GithubLabelName, string>>(new Map())
          const underlyingClient = Context.get(
            yield* Layer.build(
              githubGraphqlClientLayer({ token: configuration.token }).pipe(Layer.provide(NodeHttpClient.layerUndici))
            ),
            GithubGraphqlClient
          )
          const observedClientLayer = Layer.succeed(
            GithubGraphqlClient,
            observedDeliveryAuthorityClient(underlyingClient, requestLog, resourcesRef, requestedLabelDescriptions)
          )
          const deliveryContext = yield* Layer.build(
            githubDeliveryAuthorityLayer.pipe(Layer.provide(observedClientLayer), Layer.provide(NodeCrypto.layer))
          )
          const reader = Context.get(deliveryContext, TrackerGraphReader)
          const mutation = Context.get(deliveryContext, TrackerMutation)
          const completionClaims = Context.get(deliveryContext, CompletionClaimBoundary)
          const taskCompletion = Context.get(deliveryContext, CompletionTaskBoundary)

          const result = yield* runDeliveryAuthorityQualificationJourney(
            reader,
            mutation,
            completionClaims,
            taskCompletion,
            fixture
          ).pipe(Effect.provide(memoryEvidenceStoreLayer))
          expect(result.specification).toEqual(
            makeTaskWorkSpecification({ body: fixture.body, taskId: fixture.taskId, title: fixture.title })
          )
          expect(result.successObservation).toMatchObject({
            claim: result.claim,
            lifecycle: "CompletedSuccessfully",
            taskId: fixture.taskId,
            taskRevision: result.specification.fingerprint,
            target: fixture.issue.target
          })
          expect(result.finality).toMatchObject({
            claim: result.claim,
            replacementOperationId: completionClaimReplacementRequestFor(result.claim).operationId,
            successObservation: result.successObservation
          })
          expect(result.records.map(({ event }) => event._tag)).toEqual(deliveryAuthorityJournalChronology)
          const providerRequests = yield* Ref.get(requestLog)
          expect(providerRequests).toEqual(deliveryAuthorityProviderChronology)
          expect(providerRequests.filter((request) => request === "CreateClaimLabel")).toHaveLength(2)
          expect(providerRequests.filter((request) => request === "CloseIssue")).toHaveLength(1)
          expect(providerRequests.filter((request) => request === "DeleteClaimLabel")).toHaveLength(2)
          const currentResources = yield* Ref.get(resourcesRef)
          expect(currentResources.issues).toEqual([fixture.issue])
          expect(currentResources.labels).toHaveLength(2)
          return result
        })
      ).pipe(Effect.provide(NodeHttpClient.layerUndici), Effect.provide(NodeCrypto.layer))
    ),
  { timeout: qualificationTimeoutMilliseconds }
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
          const resourcesRef = yield* scopedFixtureResources(
            api,
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
          const fixture = yield* makeFixture(
            api,
            configuration.repository,
            repositoryNodeId,
            configuration.blockerTotal,
            resourcesRef
          )
          const observedRequests = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest["_tag"]>>([])
          const requestedLabelDescriptions = yield* Ref.make<ReadonlyMap<GithubLabelName, string>>(new Map())
          const underlyingClient = Context.get(yield* Layer.build(githubGraphqlClientNodeLayer), GithubGraphqlClient)
          const observedClient = observedDeliveryAuthorityClient(
            underlyingClient,
            observedRequests,
            resourcesRef,
            requestedLabelDescriptions
          )
          const observedClientLayer = Layer.succeed(GithubGraphqlClient, observedClient)

          return yield* Effect.gen(function* () {
            const reader = yield* TrackerGraphReader
            const first = yield* readGraphAndFacts(reader, fixture.root.target, "issue-71-first-read", [])
            const rootTaskId = fixture.taskId
            const childTaskId = githubTaskIdFor(repositoryNodeId, fixture.child.nodeId)
            const prerequisiteOnlyChildTaskId = githubTaskIdFor(repositoryNodeId, fixture.prerequisiteOnlyChild.nodeId)
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
                  responseLossGithubGraphqlClient(observedClient, createRequestCount, lost, requestLog)
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
        })
      ).pipe(Effect.provide(NodeHttpClient.layerUndici), Effect.provide(NodeCrypto.layer))
    ),
  { timeout: qualificationTimeoutMilliseconds }
)
