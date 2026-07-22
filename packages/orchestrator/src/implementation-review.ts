import { Context, Effect, Layer, Ref, Schema } from "effect"
import type { CoordinatorOwnershipError } from "./coordinator-lock.js"
import {
  OperationId,
  PlannedTaskAttempt,
  ReviewerSessionId,
  ReviewFindingId,
  SemanticReviewRound,
  TaskWorkSessionId
} from "./domain.js"
import {
  authorizeImplementationReview,
  EvidenceReference,
  EvidenceStore,
  type EvidenceStoreFailure,
  SealedImplementationEvidence
} from "./implementation-evidence.js"

const maximumFindingTextLength = 65_536
const FindingText = Schema.NonEmptyString.check(Schema.isMaxLength(maximumFindingTextLength))

/** One semantic reviewer finding retained across later review rounds. */
export const ReviewFinding = Schema.Struct({
  findingId: ReviewFindingId,
  text: FindingText
})
export type ReviewFinding = typeof ReviewFinding.Type

const uniqueFindingIds = Schema.makeFilter((findings: ReadonlyArray<ReviewFinding>) =>
  new Set(findings.map(({ findingId }) => findingId)).size === findings.length
    ? undefined
    : "review finding identities must be unique"
)
const ReviewFindingHistory = Schema.Array(ReviewFinding).check(uniqueFindingIds)
const NonEmptyReviewFindings = Schema.Array(ReviewFinding).check(
  Schema.isMinLength(1),
  uniqueFindingIds
)

/** Exact sealed implementation input and implementer invocation reviewed in one fresh session. */
export const AuthorizedImplementationReviewRequest = Schema.TaggedStruct("AuthorizedImplementationReview", {
  evidenceSealingOperationId: OperationId,
  findingHistory: ReviewFindingHistory,
  implementationEvidence: SealedImplementationEvidence,
  implementerInvocationId: OperationId,
  implementerSessionId: TaskWorkSessionId,
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt,
  predecessorEvidenceReference: EvidenceReference,
  reviewerSessionId: ReviewerSessionId,
  round: SemanticReviewRound
})
export type AuthorizedImplementationReviewRequest = typeof AuthorizedImplementationReviewRequest.Type

/** Live review authority or a pure projection that cannot fabricate sealed evidence. */
export const ImplementationReviewRequest = Schema.Union([
  AuthorizedImplementationReviewRequest,
  Schema.TaggedStruct("SimulatedImplementationReview", {
    evidenceSealingOperationId: OperationId,
    operationId: OperationId,
    round: SemanticReviewRound
  })
])
export type ImplementationReviewRequest = typeof ImplementationReviewRequest.Type

/** The fresh reviewer either accepts or reports at least one concrete finding. */
export const ImplementationReviewDisposition = Schema.TaggedUnion({
  Accepted: {},
  Findings: { findings: NonEmptyReviewFindings }
})
export type ImplementationReviewDisposition = typeof ImplementationReviewDisposition.Type

/** A reviewer invocation failed without producing a semantic disposition. */
export class ImplementationReviewInvocationFailure
  extends Schema.TaggedErrorClass<ImplementationReviewInvocationFailure>()(
    "ImplementationReviewInvocationFailure",
    { detail: Schema.String, operationId: OperationId, reviewerSessionId: ReviewerSessionId }
  )
{}

export interface ImplementationReviewerService {
  /** Provider-enforced create-or-resume keyed by operationId + reviewerSessionId; exact repeats never duplicate work. */
  readonly createOrResume: (
    request: AuthorizedImplementationReviewRequest
  ) => Effect.Effect<
    ImplementationReviewDisposition,
    ImplementationReviewInvocationFailure | CoordinatorOwnershipError
  >
}

/** Invokes one independent reviewer; durable workflow history owns session lineage. */
export class ImplementationReviewer extends Context.Service<ImplementationReviewer, ImplementationReviewerService>()(
  "@dalph/ImplementationReviewer"
) {}

/** Immutable review evidence extends the prior evidence object and retains finding history. */
export const ImplementationReviewManifest = Schema.Struct({
  disposition: ImplementationReviewDisposition,
  findingHistory: ReviewFindingHistory,
  implementationEvidenceReference: EvidenceReference,
  implementerInvocationId: OperationId,
  implementerSessionId: TaskWorkSessionId,
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt,
  predecessorEvidenceReference: EvidenceReference,
  reviewerSessionId: ReviewerSessionId,
  round: SemanticReviewRound,
  stage: Schema.Literal("ImplementationReview")
})
export type ImplementationReviewManifest = typeof ImplementationReviewManifest.Type

/** Complete immutable semantic-review evidence and its content address. */
export const SealedImplementationReview = Schema.TaggedStruct(
  "SealedImplementationReview",
  { manifest: ImplementationReviewManifest, manifestReference: EvidenceReference }
)
export type SealedImplementationReview = typeof SealedImplementationReview.Type

/** Dry/test projections retain ordering without fabricating reviewer sessions or findings. */
export const ImplementationReviewSimulated = Schema.TaggedStruct(
  "ImplementationReviewSimulated",
  { operationId: OperationId, predecessorOperationId: OperationId, round: SemanticReviewRound }
)

/** Findings return only to the exact implementer invocation and session that produced the reviewed bytes. */
export const ReviewFindingsHandbackRequest = Schema.Struct({
  implementerInvocationId: OperationId,
  implementerSessionId: TaskWorkSessionId,
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt,
  review: SealedImplementationReview,
  reviewOperationId: OperationId
})
export type ReviewFindingsHandbackRequest = typeof ReviewFindingsHandbackRequest.Type

/** The implementer provider durably accepted findings for the exact invocation. */
export const ReviewFindingsHandbackAcknowledged = Schema.TaggedStruct(
  "ReviewFindingsHandbackAcknowledged",
  { operationId: OperationId, reviewEvidenceReference: EvidenceReference }
)

/** A findings handback failed without changing semantic-round policy. */
export class ReviewFindingsHandbackFailure extends Schema.TaggedErrorClass<ReviewFindingsHandbackFailure>()(
  "ReviewFindingsHandbackFailure",
  { detail: Schema.String, operationId: OperationId }
) {}

export interface ReviewFindingsHandbackService {
  /** Provider-enforced delivery-or-resume keyed by operationId; exact repeats never duplicate delivery. */
  readonly deliverOrResume: (
    request: ReviewFindingsHandbackRequest
  ) => Effect.Effect<
    typeof ReviewFindingsHandbackAcknowledged.Type,
    ReviewFindingsHandbackFailure | CoordinatorOwnershipError
  >
}

/** Returns semantic findings to one exact established implementer session. */
export class ReviewFindingsHandback extends Context.Service<ReviewFindingsHandback, ReviewFindingsHandbackService>()(
  "@dalph/ReviewFindingsHandback"
) {}

/** Durable review history cannot prove the exact predecessor and implementer binding. */
export class ImplementationReviewHistoryContradiction
  extends Schema.TaggedErrorClass<ImplementationReviewHistoryContradiction>()(
    "ImplementationReviewHistoryContradiction",
    {
      operationId: OperationId,
      reason: Schema.Literals([
        "AttemptMismatch",
        "CrossAttemptContinuation",
        "EvidenceMismatch",
        "FindingHistoryMismatch",
        "HandbackWithoutFindings",
        "ImplementerInvocationIsNotLatest",
        "ImplementerSessionMismatch",
        "IntentMismatch",
        "MissingEvidence",
        "MissingImplementerInvocation",
        "MultipleIntents",
        "MultipleOutcomes",
        "OutcomeWithoutIntent",
        "ReviewMismatch",
        "ReviewerSessionReused",
        "RoundMismatch",
        "RunMismatch"
      ])
    }
  )
{}

/** A pure review projection cannot cross the live reviewer boundary. */
export class ImplementationReviewModeContradiction
  extends Schema.TaggedErrorClass<ImplementationReviewModeContradiction>()(
    "ImplementationReviewModeContradiction",
    { operationId: OperationId }
  )
{}

const encodeManifest = (manifest: ImplementationReviewManifest): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify(Schema.encodeUnknownSync(ImplementationReviewManifest)(manifest))
  )

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index])

/** Re-authorizes a sealed review from its content-addressed immutable manifest. */
export const authorizeImplementationReviewEvidence = Effect.fn(
  "ImplementationReview.authorizeEvidence"
)(function*(review: SealedImplementationReview) {
  const store = yield* EvidenceStore
  const encoded = encodeManifest(review.manifest)
  const persisted = yield* store.read(review.manifestReference)
  if (!sameBytes(encoded, persisted)) {
    return yield* new ImplementationReviewHistoryContradiction({
      operationId: review.manifest.operationId,
      reason: "ReviewMismatch"
    })
  }
  return review
})

/** Retains all prior findings and appends only the current semantic round's findings. */
export const extendReviewFindingHistory = (
  history: ReadonlyArray<ReviewFinding>,
  disposition: ImplementationReviewDisposition
): ReadonlyArray<ReviewFinding> =>
  disposition._tag === "Findings"
    ? [...history, ...disposition.findings]
    : [...history]

/** Seals one reviewer disposition after verifying the complete implementation authorization. */
export const sealImplementationReview = Effect.fn("ImplementationReview.seal")(function*(
  request: AuthorizedImplementationReviewRequest,
  disposition: ImplementationReviewDisposition
) {
  yield* authorizeImplementationReview(request.implementationEvidence)
  const store = yield* EvidenceStore
  const findingHistory = extendReviewFindingHistory(request.findingHistory, disposition)
  if (new Set(findingHistory.map(({ findingId }) => findingId)).size !== findingHistory.length) {
    return yield* new ImplementationReviewHistoryContradiction({
      operationId: request.operationId,
      reason: "FindingHistoryMismatch"
    })
  }
  const manifest = ImplementationReviewManifest.make({
    disposition,
    findingHistory,
    implementationEvidenceReference: request.implementationEvidence.manifestReference,
    implementerInvocationId: request.implementerInvocationId,
    implementerSessionId: request.implementerSessionId,
    operationId: request.operationId,
    plannedAttempt: request.plannedAttempt,
    predecessorEvidenceReference: request.predecessorEvidenceReference,
    reviewerSessionId: request.reviewerSessionId,
    round: request.round,
    stage: "ImplementationReview"
  })
  const manifestReference = yield* store.put(encodeManifest(manifest))
  return yield* authorizeImplementationReviewEvidence(
    SealedImplementationReview.make({ manifest, manifestReference })
  )
})

export interface TestImplementationReviewService extends ImplementationReviewerService, ReviewFindingsHandbackService {
  readonly handbacks: () => Effect.Effect<ReadonlyArray<ReviewFindingsHandbackRequest>>
  readonly requests: () => Effect.Effect<ReadonlyArray<AuthorizedImplementationReviewRequest>>
  readonly setDispositions: (
    dispositions: ReadonlyArray<ImplementationReviewDisposition | ImplementationReviewInvocationFailure>
  ) => Effect.Effect<void>
}

export class TestImplementationReview
  extends Context.Service<TestImplementationReview, TestImplementationReviewService>()(
    "@dalph/ImplementationReview/Test"
  )
{}

/** Controllable review boundary used by journal and workflow contract tests. */
export const implementationReviewTestLayer = Layer.effectContext(Effect.gen(function*() {
  const dispositions = yield* Ref.make<
    ReadonlyArray<ImplementationReviewDisposition | ImplementationReviewInvocationFailure>
  >([
    ImplementationReviewDisposition.cases.Accepted.make({})
  ])
  const requests = yield* Ref.make<ReadonlyArray<AuthorizedImplementationReviewRequest>>([])
  const handbacks = yield* Ref.make<ReadonlyArray<ReviewFindingsHandbackRequest>>([])
  const reviewResults = yield* Ref.make(
    new Map<OperationId, {
      readonly disposition: ImplementationReviewDisposition
      readonly request: AuthorizedImplementationReviewRequest
    }>()
  )
  const handbackResults = yield* Ref.make(
    new Map<OperationId, {
      readonly acknowledgement: typeof ReviewFindingsHandbackAcknowledged.Type
      readonly request: ReviewFindingsHandbackRequest
    }>()
  )
  const service = TestImplementationReview.of({
    deliverOrResume: Effect.fn("ImplementationReview.Test.handBack")(function*(request) {
      const existing = (yield* Ref.get(handbackResults)).get(request.operationId)
      if (existing !== undefined) {
        if (JSON.stringify(existing.request) !== JSON.stringify(request)) {
          return yield* new ReviewFindingsHandbackFailure({
            detail: "operation id was reused with a different findings handback request",
            operationId: request.operationId
          })
        }
        return existing.acknowledgement
      }
      yield* Ref.update(handbacks, (current) => [...current, request])
      const acknowledgement = ReviewFindingsHandbackAcknowledged.make({
        operationId: request.operationId,
        reviewEvidenceReference: request.review.manifestReference
      })
      yield* Ref.update(
        handbackResults,
        (current) => new Map(current).set(request.operationId, { acknowledgement, request })
      )
      return acknowledgement
    }),
    handbacks: () => Ref.get(handbacks),
    createOrResume: Effect.fn("ImplementationReview.Test.invoke")(function*(request) {
      const existing = (yield* Ref.get(reviewResults)).get(request.operationId)
      if (existing !== undefined) {
        if (JSON.stringify(existing.request) !== JSON.stringify(request)) {
          return yield* new ImplementationReviewInvocationFailure({
            detail: "operation id was reused with a different reviewer request",
            operationId: request.operationId,
            reviewerSessionId: request.reviewerSessionId
          })
        }
        return existing.disposition
      }
      yield* Ref.update(requests, (current) => [...current, request])
      const next = yield* Ref.modify(dispositions, (current) => [current[0], current.slice(1)] as const)
      if (next === undefined) {
        return yield* new ImplementationReviewInvocationFailure({
          detail: "no controlled review disposition remains",
          operationId: request.operationId,
          reviewerSessionId: request.reviewerSessionId
        })
      }
      if (next instanceof ImplementationReviewInvocationFailure) return yield* next
      yield* Ref.update(
        reviewResults,
        (current) => new Map(current).set(request.operationId, { disposition: next, request })
      )
      return next
    }),
    requests: () => Ref.get(requests),
    setDispositions: (next) => Ref.set(dispositions, next)
  })
  return Context.empty().pipe(
    Context.add(ImplementationReviewer, service),
    Context.add(ReviewFindingsHandback, service),
    Context.add(TestImplementationReview, service)
  )
}))

/** Production default fails explicitly until a reviewer/handback adapter is configured. */
export const unavailableImplementationReviewLayer = Layer.merge(
  Layer.succeed(
    ImplementationReviewer,
    ImplementationReviewer.of({
      createOrResume: (request) =>
        Effect.fail(
          new ImplementationReviewInvocationFailure({
            detail: "no implementation reviewer is configured",
            operationId: request.operationId,
            reviewerSessionId: request.reviewerSessionId
          })
        )
    })
  ),
  Layer.succeed(
    ReviewFindingsHandback,
    ReviewFindingsHandback.of({
      deliverOrResume: (request) =>
        Effect.fail(
          new ReviewFindingsHandbackFailure({
            detail: "no review findings handback adapter is configured",
            operationId: request.operationId
          })
        )
    })
  )
)

export type ImplementationReviewFailure =
  | EvidenceStoreFailure
  | ImplementationReviewHistoryContradiction
  | ImplementationReviewInvocationFailure
