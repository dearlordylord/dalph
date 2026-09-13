/* eslint-disable import-x/no-unused-modules -- Shipped qualification and external test-support consume these boundary contracts outside the production lint graph. */
import { EvidenceDigest } from "@dalph/contracts"
import {
  GithubGraphqlClient,
  GithubGraphqlRequest,
  GithubIssueNodeId,
  GithubIssueNumber,
  GithubIssueTarget,
  GithubLabelName,
  GithubLabelNodeId,
  GithubRepositoryName,
  GithubRepositoryNodeId,
  GithubRepositoryOwner,
  OperationId
} from "@dalph/orchestrator"
import { Crypto, Effect, Schema } from "effect"
import {
  DisposableGithubCleanupBoundaryFailure,
  type DisposableGithubCleanupAdapter,
  cleanupDisposableGithubQualificationCore,
  DisposableGithubQualificationRepositoryIdentity,
  DisposableGithubQualificationResource,
  DisposableGithubRepositoryObservation,
  DisposableGithubResourceObservation,
  UniqueDisposableGithubQualificationResources
} from "./disposable-github-qualification-cleanup.js"
import { LiveQualificationInvocationId } from "./live-qualification-evidence.js"

export const ProductionLiveGithubRepository = Schema.Struct({
  owner: GithubRepositoryOwner,
  name: GithubRepositoryName
})
export type ProductionLiveGithubRepository = typeof ProductionLiveGithubRepository.Type

const ProductionLiveGithubResources = UniqueDisposableGithubQualificationResources.check(
  Schema.makeFilter(
    (resources) =>
      resources.filter((resource) => resource._tag === "Issue").length === 1
        ? undefined
        : "a live qualification manifest must contain exactly one issue",
    { message: "resources must contain exactly one live qualification issue" }
  )
)

export const ProductionLiveGithubQualificationManifest = Schema.Struct({
  invocationId: LiveQualificationInvocationId,
  repository: DisposableGithubQualificationRepositoryIdentity,
  resources: ProductionLiveGithubResources
})
export type ProductionLiveGithubQualificationManifest = typeof ProductionLiveGithubQualificationManifest.Type

export const ProductionLiveGithubFixtureRequest = Schema.Struct({
  invocationId: LiveQualificationInvocationId,
  repository: ProductionLiveGithubRepository,
  createIssueOperationId: OperationId
})
export type ProductionLiveGithubFixtureRequest = typeof ProductionLiveGithubFixtureRequest.Type

const Errors = Schema.Struct({ errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))) })
const hexadecimalRadix = 16
const hexadecimalByteWidth = 2
const ResolveRepositoryResponse = Schema.Struct({
  data: Schema.Struct({ repository: Schema.NullOr(Schema.Struct({ id: GithubRepositoryNodeId })) })
})
const CreateIssueResponse = Schema.Struct({
  data: Schema.Struct({
    createIssue: Schema.Struct({
      clientMutationId: OperationId,
      issue: Schema.Struct({ id: GithubIssueNodeId, number: GithubIssueNumber })
    })
  })
})
const ResolveIssueResponse = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(
      Schema.Struct({ id: GithubRepositoryNodeId, issue: Schema.NullOr(Schema.Struct({ id: GithubIssueNodeId })) })
    )
  })
})
const ReadIssueSpecificationResponse = Schema.Struct({
  data: Schema.Struct({
    node: Schema.NullOr(
      Schema.Struct({
        __typename: Schema.Literal("Issue"),
        id: GithubIssueNodeId,
        repository: Schema.Struct({ id: GithubRepositoryNodeId }),
        title: Schema.String,
        body: Schema.String
      })
    )
  })
})
const FindLabelResponse = Schema.Struct({
  data: Schema.Struct({
    node: Schema.NullOr(
      Schema.Struct({
        id: GithubRepositoryNodeId,
        label: Schema.NullOr(
          Schema.Struct({ id: GithubLabelNodeId, name: GithubLabelName, description: Schema.NullOr(Schema.String) })
        )
      })
    )
  })
})
const DeleteIssueResponse = Schema.Struct({
  data: Schema.Struct({ deleteIssue: Schema.Struct({ clientMutationId: OperationId }) })
})
const DeleteLabelResponse = Schema.Struct({
  data: Schema.Struct({ deleteLabel: Schema.Struct({ clientMutationId: OperationId }) })
})

/** A fixture boundary failed before a complete exact creation receipt was available. */
export class ProductionLiveGithubFixtureFailure extends Schema.TaggedError<ProductionLiveGithubFixtureFailure>()(
  "ProductionLiveGithubFixtureFailure",
  { operation: Schema.Literals(["ResolveRepository", "CreateIssue", "DecodeResponse", "UnexpectedAcknowledgement"]) }
) {}

const decode = <S extends Schema.Constraint>(schema: S, body: unknown) =>
  Effect.gen(function* () {
    const errors = yield* Schema.decodeUnknownEffect(Errors)(body)
    if (errors.errors !== undefined && errors.errors.length > 0)
      return yield* new ProductionLiveGithubFixtureFailure({ operation: "DecodeResponse" })
    return yield* Schema.decodeUnknownEffect(schema)(body)
  }).pipe(Effect.mapError(() => new ProductionLiveGithubFixtureFailure({ operation: "DecodeResponse" })))

const digestText = Effect.fn("ProductionLiveGithubFixture.digestText")(function* (crypto: Crypto.Crypto, text: string) {
  const bytes = yield* crypto.digest("SHA-256", new TextEncoder().encode(text))
  return EvidenceDigest.make(
    Array.from(bytes, (byte) => byte.toString(hexadecimalRadix).padStart(hexadecimalByteWidth, "0")).join("")
  )
})

export const productionLiveGithubIssueFingerprint = Effect.fn("ProductionLiveGithubFixture.issueFingerprint")(
  function* (invocationId: LiveQualificationInvocationId, title: string, body: string) {
    const crypto = yield* Crypto.Crypto
    return yield* digestText(crypto, JSON.stringify({ invocationId, specification: { title, body } }))
  }
)

const cleanupFailure = (failure: unknown) =>
  new DisposableGithubCleanupBoundaryFailure({
    reason:
      typeof failure === "object" && failure !== null && "_tag" in failure && String(failure._tag).includes("Throttled")
        ? "Throttled"
        : "Unreadable"
  })

const decodeCleanup = <S extends Schema.Constraint>(schema: S, body: unknown) =>
  Effect.gen(function* () {
    const errors = yield* Schema.decodeUnknownEffect(Errors)(body)
    if (errors.errors !== undefined && errors.errors.length > 0)
      return yield* new DisposableGithubCleanupBoundaryFailure({ reason: "Unreadable" })
    return yield* Schema.decodeUnknownEffect(schema)(body)
  }).pipe(Effect.mapError(cleanupFailure))

/** Uses the production GitHub client for exact reads and one-attempt deletions; it never retries. */
export const makeProductionLiveGithubCleanupAdapter = Effect.fn("ProductionLiveGithubFixture.makeCleanupAdapter")(
  function* (invocationId: LiveQualificationInvocationId) {
    const client = yield* GithubGraphqlClient
    const crypto = yield* Crypto.Crypto
    const execute = <S extends Schema.Constraint>(request: GithubGraphqlRequest, schema: S) =>
      client.execute(request).pipe(
        Effect.mapError(cleanupFailure),
        Effect.flatMap(({ body }) => decodeCleanup(schema, body))
      )
    const nextOperationId = Effect.map(crypto.randomUUIDv7, (value) => OperationId.make(value))
    const digestObserved = Effect.fn("ProductionLiveGithubFixture.digestObserved")(function* (text: string) {
      return yield* digestText(crypto, text).pipe(Effect.mapError(cleanupFailure))
    })
    const readRepository: DisposableGithubCleanupAdapter["readRepository"] = Effect.fn(
      "ProductionLiveGithubFixture.readRepository"
    )(function* (repository) {
      const response = yield* execute(
        GithubGraphqlRequest.cases.ResolveRepository.make({ owner: repository.owner, repository: repository.name }),
        ResolveRepositoryResponse
      )
      return response.data.repository === null
        ? DisposableGithubRepositoryObservation.cases.Absent.make({})
        : DisposableGithubRepositoryObservation.cases.Present.make({
            repository: { ...repository, nodeId: response.data.repository.id }
          })
    })
    const readResource: DisposableGithubCleanupAdapter["readResource"] = Effect.fn(
      "ProductionLiveGithubFixture.readResource"
    )(function* (repository, resource) {
      if (resource._tag === "Issue") {
        const resolved = yield* execute(
          GithubGraphqlRequest.cases.ResolveIssue.make({
            target: GithubIssueTarget.make({
              owner: repository.owner,
              repository: repository.name,
              issueNumber: resource.number
            })
          }),
          ResolveIssueResponse
        )
        const issue = resolved.data.repository?.issue
        if (issue === null || issue === undefined) return DisposableGithubResourceObservation.cases.Absent.make({})
        const response = yield* execute(
          GithubGraphqlRequest.cases.ReadTaskWorkSpecification.make({ issueNodeId: issue.id }),
          ReadIssueSpecificationResponse
        )
        const current = response.data.node
        if (current === null) return DisposableGithubResourceObservation.cases.Absent.make({})
        const fingerprint = yield* digestObserved(
          JSON.stringify({ invocationId, specification: { title: current.title, body: current.body } })
        )
        return DisposableGithubResourceObservation.cases.Present.make({
          resource: DisposableGithubQualificationResource.cases.Issue.make({
            number: resource.number,
            nodeId: current.id,
            fingerprint
          })
        })
      }
      const response = yield* execute(
        GithubGraphqlRequest.cases.FindClaimLabel.make({
          labelName: resource.name,
          repositoryNodeId: repository.nodeId
        }),
        FindLabelResponse
      )
      const label = response.data.node?.label
      if (label === null || label === undefined) return DisposableGithubResourceObservation.cases.Absent.make({})
      if (label.description === null) return yield* new DisposableGithubCleanupBoundaryFailure({ reason: "Unreadable" })
      const fingerprint = yield* digestObserved(label.description)
      return DisposableGithubResourceObservation.cases.Present.make({
        resource: DisposableGithubQualificationResource.cases.Label.make({
          nodeId: label.id,
          name: label.name,
          fingerprint
        })
      })
    })
    const deleteResource: DisposableGithubCleanupAdapter["deleteResource"] = Effect.fn(
      "ProductionLiveGithubFixture.deleteResource"
    )(function* (_repository, resource) {
      const operationId = yield* nextOperationId.pipe(Effect.mapError(cleanupFailure))
      const acknowledgement =
        resource._tag === "Issue"
          ? yield* execute(
              GithubGraphqlRequest.cases.DeleteIssue.make({ issueNodeId: resource.nodeId, operationId }),
              DeleteIssueResponse
            ).pipe(Effect.map((response) => response.data.deleteIssue.clientMutationId))
          : yield* execute(
              GithubGraphqlRequest.cases.DeleteClaimLabel.make({ labelNodeId: resource.nodeId, operationId }),
              DeleteLabelResponse
            ).pipe(Effect.map((response) => response.data.deleteLabel.clientMutationId))
      if (acknowledgement !== operationId)
        return yield* new DisposableGithubCleanupBoundaryFailure({ reason: "Unreadable" })
    })
    return { readRepository, readResource, deleteResource } satisfies DisposableGithubCleanupAdapter
  }
)

/** Decodes a live-branded manifest before entering the shared structural exact-cleanup core. */
export const cleanupProductionLiveGithubFixture = Effect.fn("ProductionLiveGithubFixture.cleanup")(function* (
  input: unknown,
  expected: {
    readonly invocationId: LiveQualificationInvocationId
    readonly repository: typeof DisposableGithubQualificationRepositoryIdentity.Type
  },
  adapter: DisposableGithubCleanupAdapter
) {
  const manifest = yield* Schema.decodeUnknownEffect(ProductionLiveGithubQualificationManifest, {
    onExcessProperty: "error",
    reportInput: false
  })(input).pipe(Effect.mapError(() => new ProductionLiveGithubFixtureFailure({ operation: "DecodeResponse" })))
  return yield* cleanupDisposableGithubQualificationCore(manifest, expected, adapter)
})

/** Creates exactly one open, dependency-free issue and returns only its original creation identity. */
export const createProductionLiveGithubFixture = Effect.fn("ProductionLiveGithubFixture.create")(function* (
  untrustedInput: unknown
) {
  const input = yield* Schema.decodeUnknownEffect(ProductionLiveGithubFixtureRequest, {
    onExcessProperty: "error",
    reportInput: false
  })(untrustedInput).pipe(
    Effect.mapError(() => new ProductionLiveGithubFixtureFailure({ operation: "DecodeResponse" }))
  )
  const client = yield* GithubGraphqlClient
  const repositoryResponse = yield* client
    .execute(
      GithubGraphqlRequest.cases.ResolveRepository.make({
        owner: input.repository.owner,
        repository: input.repository.name
      })
    )
    .pipe(
      Effect.mapError(() => new ProductionLiveGithubFixtureFailure({ operation: "ResolveRepository" })),
      Effect.flatMap(({ body }) => decode(ResolveRepositoryResponse, body))
    )
  if (repositoryResponse.data.repository === null)
    return yield* new ProductionLiveGithubFixtureFailure({ operation: "ResolveRepository" })
  const title = `${input.invocationId}: one disposable Dalph qualification task`
  const body = `${input.invocationId}: create LIVE-QUALIFICATION.md with one sentence and commit the change.`
  const creation = yield* client
    .execute(
      GithubGraphqlRequest.cases.CreateIssue.make({
        body,
        operationId: input.createIssueOperationId,
        repositoryNodeId: repositoryResponse.data.repository.id,
        title
      })
    )
    .pipe(
      Effect.mapError(() => new ProductionLiveGithubFixtureFailure({ operation: "CreateIssue" })),
      Effect.flatMap(({ body }) => decode(CreateIssueResponse, body))
    )
  if (creation.data.createIssue.clientMutationId !== input.createIssueOperationId)
    return yield* new ProductionLiveGithubFixtureFailure({ operation: "UnexpectedAcknowledgement" })
  const issue = creation.data.createIssue.issue
  const resource = DisposableGithubQualificationResource.cases.Issue.make({
    number: issue.number,
    nodeId: issue.id,
    fingerprint: yield* productionLiveGithubIssueFingerprint(input.invocationId, title, body)
  })
  return {
    issue: { title, body, number: issue.number, nodeId: issue.id },
    manifest: ProductionLiveGithubQualificationManifest.make({
      invocationId: input.invocationId,
      repository: { ...input.repository, nodeId: repositoryResponse.data.repository.id },
      resources: [resource]
    })
  }
})
