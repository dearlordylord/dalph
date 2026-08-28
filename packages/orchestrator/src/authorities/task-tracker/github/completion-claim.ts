import { Crypto, Effect, Layer, Schema } from "effect"
import {
  CompletionClaimBoundary,
  CompletionClaimDeletionFailure,
  CompletionClaimMarkerAbsent,
  CompletionClaimFingerprint,
  completionClaimReadRequestFor,
  CompletionClaimReadFailure,
  type CompletionClaimReadRequest,
  type CompletionClaimDeletionRequest,
  type CompletionClaimReplacementRequest,
  CompletionClaimReplacementFailure,
  CompletionTaskClaim,
  ForeignCompletionClaim
} from "../../../workflow/protocols/integration-finality/completion-claim.js"
import { isExactTaskClaim, TrackerMutation } from "../claim-mutation.js"
import { githubTrackerMutationLayer } from "./claim-mutation.js"
import { githubTaskClaimLabelDigestFor } from "./claim-label-identity.js"
import {
  CreateClaimLabelResponse,
  DeleteClaimLabelResponse,
  FindClaimLabelResponse,
  GithubGraphqlErrors
} from "./claim-label-response.js"
import { mapGithubMutationFailure } from "./mutation-throttling.js"
import {
  GithubGraphqlClient,
  GithubGraphqlRequest,
  type GithubLabelNodeId,
  GithubLabelName,
  type GithubRepositoryNodeId
} from "./graphql-client.js"
import { githubTaskCoordinatesFor } from "./task-identity.js"

const completionClaimDescriptionVersion = "1"
const completionClaimDescriptionAlgorithm = "sha256"
const completionClaimDescriptionSeparator = "|"
const hexadecimalRadix = 16
const hexadecimalByteLength = 2

const CanonicalCompletionTaskClaim = Schema.fromJsonString(Schema.toCodecJson(CompletionTaskClaim))

/** Canonical completion-claim encoding or hashing could not produce exact GitHub evidence. */
export class GithubCompletionClaimFingerprintFailure extends Schema.TaggedError<GithubCompletionClaimFingerprintFailure>()(
  "GithubCompletionClaim.FingerprintFailure",
  { detail: Schema.String }
) {}

/** Computes the exact SHA-256 fingerprint GitHub stores for one promoted task claim. */
export const githubCompletionClaimFingerprintFor = Effect.fn("GithubCompletionClaim.fingerprintFor")(
  function* (crypto: Crypto.Crypto, claim: CompletionTaskClaim) {
    const canonical = yield* Schema.encodeUnknownEffect(CanonicalCompletionTaskClaim)(claim)
    const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode(canonical))
    return yield* Schema.decodeUnknownEffect(CompletionClaimFingerprint)(
      [...digest].map((byte) => byte.toString(hexadecimalRadix).padStart(hexadecimalByteLength, "0")).join("")
    )
  },
  Effect.mapError((cause) => new GithubCompletionClaimFingerprintFailure({ detail: String(cause) }))
)

const descriptionFor = (fingerprint: CompletionClaimFingerprint): string =>
  [completionClaimDescriptionVersion, completionClaimDescriptionAlgorithm, fingerprint].join(
    completionClaimDescriptionSeparator
  )

const fingerprintFromDescription = (request: CompletionClaimReadRequest, description: string) => {
  const [version, algorithm, fingerprint, overflow] = description.split(completionClaimDescriptionSeparator)
  if (
    version !== completionClaimDescriptionVersion ||
    algorithm !== completionClaimDescriptionAlgorithm ||
    fingerprint === undefined ||
    overflow !== undefined
  ) {
    return Effect.fail(
      new CompletionClaimReadFailure({
        detail: "GitHub completion claim label has an unsupported description encoding",
        taskId: request.taskId
      })
    )
  }
  return Schema.decodeUnknownEffect(CompletionClaimFingerprint)(fingerprint).pipe(
    Effect.mapError((cause) => new CompletionClaimReadFailure({ detail: String(cause), taskId: request.taskId }))
  )
}

const completionClaimLabelNameFor = Effect.fn("GithubCompletionClaim.labelNameFor")(function* (
  crypto: Crypto.Crypto,
  request: CompletionClaimReadRequest
) {
  const digest = yield* githubTaskClaimLabelDigestFor(crypto, request.taskId).pipe(
    Effect.mapError((cause) => new CompletionClaimReadFailure({ detail: String(cause), taskId: request.taskId }))
  )
  return GithubLabelName.make(`dalph-completion-${digest}`)
})

/** GitHub boundary that creates one completion record beside the still-present active record. */
const githubCompletionClaimBoundaryWithTrackerLayer = Layer.effect(
  CompletionClaimBoundary,
  Effect.gen(function* () {
    const client = yield* GithubGraphqlClient
    const crypto = yield* Crypto.Crypto
    const activeClaims = yield* TrackerMutation

    const readCompletionFingerprint = Effect.fn("GithubCompletionClaim.readCompletionFingerprint")(function* (
      request: CompletionClaimReadRequest,
      repositoryNodeId: GithubRepositoryNodeId
    ) {
      const labelName = yield* completionClaimLabelNameFor(crypto, request)
      const response = yield* client
        .execute(GithubGraphqlRequest.cases.FindClaimLabel.make({ labelName, repositoryNodeId }))
        .pipe(
          Effect.mapError((cause) => new CompletionClaimReadFailure({ detail: cause.detail, taskId: request.taskId }))
        )
      const header = yield* Schema.decodeUnknownEffect(GithubGraphqlErrors)(response.body).pipe(
        Effect.mapError((cause) => new CompletionClaimReadFailure({ detail: String(cause), taskId: request.taskId }))
      )
      if (header.errors !== undefined && header.errors.length > 0) {
        return yield* new CompletionClaimReadFailure({
          detail: header.errors.map(({ message }) => message).join("; "),
          taskId: request.taskId
        })
      }
      const decoded = yield* Schema.decodeUnknownEffect(FindClaimLabelResponse)(response.body).pipe(
        Effect.mapError((cause) => new CompletionClaimReadFailure({ detail: String(cause), taskId: request.taskId }))
      )
      const repository = decoded.data.node
      if (repository === null) {
        return yield* new CompletionClaimReadFailure({
          detail: "GitHub repository node is inaccessible or no longer exists",
          taskId: request.taskId
        })
      }
      if (repository.id !== repositoryNodeId) {
        return yield* new CompletionClaimReadFailure({
          detail: `GitHub returned repository ${repository.id} while reading ${repositoryNodeId}`,
          taskId: request.taskId
        })
      }
      const label = repository.label
      if (label === null) return undefined
      if (label.name !== labelName) {
        return yield* new CompletionClaimReadFailure({
          detail: `GitHub returned completion claim label ${label.name} while reading ${labelName}`,
          taskId: request.taskId
        })
      }
      return { fingerprint: yield* fingerprintFromDescription(request, label.description), labelId: label.id }
    })

    const classifyCompletionRecord = Effect.fn("GithubCompletionClaim.classifyCompletionRecord")(function* (
      request: CompletionClaimReadRequest,
      record: { readonly fingerprint: CompletionClaimFingerprint; readonly labelId: GithubLabelNodeId } | undefined
    ) {
      if (record === undefined) return CompletionClaimMarkerAbsent.make({ taskId: request.taskId })
      const expectedFingerprint = yield* githubCompletionClaimFingerprintFor(crypto, request.expectedClaim).pipe(
        Effect.mapError((cause) => new CompletionClaimReadFailure({ detail: cause.detail, taskId: request.taskId }))
      )
      return record.fingerprint === expectedFingerprint
        ? request.expectedClaim
        : ForeignCompletionClaim.make({ fingerprint: record.fingerprint, taskId: request.taskId })
    })

    const readTaskClaim = Effect.fn("GithubCompletionClaim.readTaskClaim")(function* (
      request: CompletionClaimReadRequest
    ) {
      const [repositoryNodeId] = yield* githubTaskCoordinatesFor(request.taskId).pipe(
        Effect.mapError((cause) => new CompletionClaimReadFailure({ detail: cause.detail, taskId: request.taskId }))
      )
      const active = yield* activeClaims
        .readTaskClaim(request.taskId)
        .pipe(
          Effect.mapError((cause) => new CompletionClaimReadFailure({ detail: cause.detail, taskId: request.taskId }))
        )
      const completionRecord = yield* readCompletionFingerprint(request, repositoryNodeId)
      if (active._tag === "ActiveTaskClaim" && !isExactTaskClaim(active, request.expectedClaim.originalClaim)) {
        return active
      }
      const marker = yield* classifyCompletionRecord(request, completionRecord)
      return marker._tag === "CompletionClaimMarkerAbsent" ? active : marker
    })

    const readCompletionClaimMarker = Effect.fn("GithubCompletionClaim.readCompletionClaimMarker")(function* (
      request: CompletionClaimReadRequest
    ) {
      const [repositoryNodeId] = yield* githubTaskCoordinatesFor(request.taskId).pipe(
        Effect.mapError((cause) => new CompletionClaimReadFailure({ detail: cause.detail, taskId: request.taskId }))
      )
      return yield* classifyCompletionRecord(request, yield* readCompletionFingerprint(request, repositoryNodeId))
    })

    const replaceTaskClaim = Effect.fn("GithubCompletionClaim.replaceTaskClaim")(function* (
      request: CompletionClaimReplacementRequest
    ) {
      const readRequest = completionClaimReadRequestFor(request.claim)
      const [repositoryNodeId] = yield* githubTaskCoordinatesFor(readRequest.taskId).pipe(
        Effect.mapError(
          (cause) =>
            new CompletionClaimReplacementFailure({ detail: cause.detail, outcome: "DefinitelyNotApplied", request })
        )
      )
      const labelName = yield* completionClaimLabelNameFor(crypto, readRequest).pipe(
        Effect.mapError(
          (cause) =>
            new CompletionClaimReplacementFailure({ detail: cause.detail, outcome: "DefinitelyNotApplied", request })
        )
      )
      const fingerprint = yield* githubCompletionClaimFingerprintFor(crypto, request.claim).pipe(
        Effect.mapError(
          (cause) =>
            new CompletionClaimReplacementFailure({ detail: cause.detail, outcome: "DefinitelyNotApplied", request })
        )
      )
      const description = descriptionFor(fingerprint)
      const response = yield* client
        .execute(
          GithubGraphqlRequest.cases.CreateClaimLabel.make({
            description,
            labelName,
            operationId: request.operationId,
            repositoryNodeId
          })
        )
        .pipe(
          Effect.mapError(
            mapGithubMutationFailure(
              "ReplaceCompletionClaim",
              request.operationId,
              (cause) => new CompletionClaimReplacementFailure({ detail: cause.detail, outcome: "Unknown", request })
            )
          )
        )
      const header = yield* Schema.decodeUnknownEffect(GithubGraphqlErrors)(response.body).pipe(
        Effect.mapError(
          (cause) => new CompletionClaimReplacementFailure({ detail: String(cause), outcome: "Unknown", request })
        )
      )
      if (header.errors !== undefined && header.errors.length > 0) {
        return yield* new CompletionClaimReplacementFailure({
          detail: header.errors.map(({ message }) => message).join("; "),
          outcome: "Unknown",
          request
        })
      }
      const decoded = yield* Schema.decodeUnknownEffect(CreateClaimLabelResponse)(response.body).pipe(
        Effect.mapError(
          (cause) => new CompletionClaimReplacementFailure({ detail: String(cause), outcome: "Unknown", request })
        )
      )
      const created = decoded.data.createLabel.label
      if (created.name !== labelName || created.description !== description) {
        return yield* new CompletionClaimReplacementFailure({
          detail: "GitHub did not acknowledge the exact completion claim label",
          outcome: "Unknown",
          request
        })
      }
      return request.claim
    })

    const deleteTaskClaim = Effect.fn("GithubCompletionClaim.deleteTaskClaim")(function* (
      request: CompletionClaimDeletionRequest
    ) {
      const readRequest = completionClaimReadRequestFor(request.claim)
      const [repositoryNodeId] = yield* githubTaskCoordinatesFor(readRequest.taskId).pipe(
        Effect.mapError(
          (cause) =>
            new CompletionClaimDeletionFailure({ detail: cause.detail, outcome: "DefinitelyNotApplied", request })
        )
      )
      const record = yield* readCompletionFingerprint(readRequest, repositoryNodeId).pipe(
        Effect.mapError(
          (cause) =>
            new CompletionClaimDeletionFailure({ detail: cause.detail, outcome: "DefinitelyNotApplied", request })
        )
      )
      if (record === undefined) return
      const expectedFingerprint = yield* githubCompletionClaimFingerprintFor(crypto, request.claim).pipe(
        Effect.mapError(
          (cause) =>
            new CompletionClaimDeletionFailure({ detail: cause.detail, outcome: "DefinitelyNotApplied", request })
        )
      )
      if (record.fingerprint !== expectedFingerprint) {
        return yield* new CompletionClaimDeletionFailure({
          detail: "GitHub completion claim label no longer names the exact expected claim",
          outcome: "DefinitelyNotApplied",
          request
        })
      }
      const response = yield* client
        .execute(
          GithubGraphqlRequest.cases.DeleteClaimLabel.make({
            labelNodeId: record.labelId,
            operationId: request.operationId
          })
        )
        .pipe(
          Effect.mapError(
            mapGithubMutationFailure(
              "DeleteCompletionClaim",
              request.operationId,
              (cause) => new CompletionClaimDeletionFailure({ detail: cause.detail, outcome: "Unknown", request })
            )
          )
        )
      const header = yield* Schema.decodeUnknownEffect(GithubGraphqlErrors)(response.body).pipe(
        Effect.mapError(
          (cause) => new CompletionClaimDeletionFailure({ detail: String(cause), outcome: "Unknown", request })
        )
      )
      if (header.errors !== undefined && header.errors.length > 0) {
        return yield* new CompletionClaimDeletionFailure({
          detail: header.errors.map(({ message }) => message).join("; "),
          outcome: "Unknown",
          request
        })
      }
      const acknowledgement = yield* Schema.decodeUnknownEffect(DeleteClaimLabelResponse)(response.body).pipe(
        Effect.mapError(
          (cause) => new CompletionClaimDeletionFailure({ detail: String(cause), outcome: "Unknown", request })
        )
      )
      if (acknowledgement.data.deleteLabel.clientMutationId !== request.operationId) {
        return yield* new CompletionClaimDeletionFailure({
          detail: "GitHub did not acknowledge the exact completion claim deletion operation",
          outcome: "Unknown",
          request
        })
      }
    })

    return CompletionClaimBoundary.of({
      deleteTaskClaim,
      readCompletionClaimMarker,
      readOriginalTaskClaim: activeClaims.readTaskClaim,
      readTaskClaim,
      releaseOriginalTaskClaim: activeClaims.releaseTaskClaim,
      replaceTaskClaim
    })
  })
)

/** Production completion-claim Layer backed by one shared configured GitHub client and Crypto service. */
export const githubCompletionClaimBoundaryLayer: Layer.Layer<
  CompletionClaimBoundary,
  never,
  GithubGraphqlClient | Crypto.Crypto
> = githubCompletionClaimBoundaryWithTrackerLayer.pipe(Layer.provide(githubTrackerMutationLayer))
