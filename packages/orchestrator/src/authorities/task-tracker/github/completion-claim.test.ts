import { NodeCrypto } from "@effect/platform-node"
import { PlannedTaskAttempt, TaskId } from "@dalph/contracts"
import { expect, it } from "@effect/vitest"
import { Crypto, Effect, Layer, PlatformError, Ref, Schema } from "effect"
import { ActiveTaskClaim, isExactTaskClaim } from "../claim-mutation.js"
import { completionClaimBoundaryContract } from "../../../../test/contracts/completion-claim-boundary-contract.js"
import { ClaimOwner, ClaimToken } from "../claim.js"
import { TaskTrackerMutationThrottled } from "../mutation-throttling.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { InRunJournal, JournalRecord } from "../../../workflow-journal/store.js"
import { targetPromotionObservedSuccessRecordKey } from "../../../workflow-journal/record-key.js"
import { OperationId } from "../../../workflow/identity.js"
import { IntegratorRunQualifiedCandidate } from "../../../workflow/protocols/integrator/events.js"
import {
  TargetPromotionObservedSuccessEvent,
  targetPromotionCorrelationFor
} from "../../../workflow/protocols/target-promotion/events.js"
import {
  CompletionClaimBoundary,
  CompletionClaimDeletionFailure,
  CompletionClaimOwnershipConflict,
  CompletionClaimReadFailure,
  CompletionClaimReplacementFailure,
  CompletionTaskClaim,
  FocusedCompletedTaskObservation,
  completionClaimDeletionRequestFor,
  completionClaimReadRequestFor,
  completionClaimReplacementRequestFor
} from "../../../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture } from "../../../workflow/protocols/integration-finality/fixtures.js"
import { runCompletionClaimReplacementProtocol } from "../../../workflow/protocols/integration-finality/protocol.js"
import { githubTaskIdFor } from "./task-identity.js"
import {
  GithubGraphqlClient,
  type GithubGraphqlRequest,
  type GithubGraphqlResponse,
  GithubGraphqlRequestError,
  GithubGraphqlThrottled,
  GithubIssueNodeId,
  GithubLabelName,
  GithubLabelNodeId,
  GithubRepositoryNodeId
} from "./graphql-client.js"
import {
  githubCompletionClaimBoundaryLayer,
  githubCompletionClaimFingerprintFor,
  GithubCompletionClaimFingerprintFailure
} from "./completion-claim.js"
import { githubTaskClaimLabelDigestFor } from "./claim-label-identity.js"
import { githubGraphqlTestClient } from "./graphql-client.test-fixture.js"

const repositoryNodeId = GithubRepositoryNodeId.make("completion-repository-node")
const issueNodeId = GithubIssueNodeId.make("completion-issue-node")
const taskId = githubTaskIdFor(repositoryNodeId, issueNodeId)

const prepareForTaskId = (taskId: TaskId) => {
  const plannedAttempt = PlannedTaskAttempt.make({ ...integrationFinalityFixture.plannedAttempt, taskId })
  const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
    ...integrationFinalityFixture.qualifiedCandidate,
    run: {
      ...integrationFinalityFixture.qualifiedCandidate.run,
      session: { ...integrationFinalityFixture.qualifiedCandidate.run.session, plannedAttempt }
    }
  })
  const promotionCorrelation = targetPromotionCorrelationFor(qualifiedCandidate)
  const activeClaim = ActiveTaskClaim.make({
    operationId: OperationId.make("completion-active-claim"),
    owner: ClaimOwner.make("dalph:completion-owner"),
    taskId,
    token: ClaimToken.make("completion-active-token")
  })
  const claim = CompletionTaskClaim.make({ originalClaim: activeClaim, plannedAttempt, promotionCorrelation })
  const promotionSuccess = TargetPromotionObservedSuccessEvent.make({
    ...integrationFinalityFixture.promotionSuccess,
    correlation: promotionCorrelation
  })
  return { activeClaim, claim, plannedAttempt, promotionSuccess }
}

const prepared = prepareForTaskId(taskId)
const preparedSuccessObservation = FocusedCompletedTaskObservation.make({
  ...integrationFinalityFixture.successObservation,
  claim: prepared.claim,
  taskId,
  taskRevision: prepared.plannedAttempt.taskRevision
})
const preparedDeletionRequest = completionClaimDeletionRequestFor(prepared.claim, preparedSuccessObservation)

type StoredLabel = { readonly description: string; readonly id: GithubLabelNodeId; readonly name: GithubLabelName }

type HarnessOptions = {
  readonly activeDescription?: string
  readonly completionDescription?: string
  readonly includeActive?: boolean
  readonly loseFirstCreateResponse?: boolean
  readonly loseFirstDeleteResponse?: boolean
}

const activeDescriptionFor = (claim: ActiveTaskClaim): string =>
  ["1", claim.operationId, claim.owner, claim.token].join("|")

const exactActiveFindResponse = (
  request: Extract<GithubGraphqlRequest, { readonly _tag: "FindClaimLabel" }>
): GithubGraphqlResponse => ({
  body: {
    data: {
      node: {
        id: repositoryNodeId,
        label: {
          description: activeDescriptionFor(prepared.activeClaim),
          id: GithubLabelNodeId.make("active-label-node"),
          name: request.labelName
        }
      }
    }
  }
})

const completionFindResponse = (
  request: Extract<GithubGraphqlRequest, { readonly _tag: "FindClaimLabel" }>,
  description: string
): GithubGraphqlResponse => ({
  body: {
    data: {
      node: {
        id: repositoryNodeId,
        label: { description, id: GithubLabelNodeId.make("completion-label-node"), name: request.labelName }
      }
    }
  }
})

const adapterLayer = (
  execute: (
    request: GithubGraphqlRequest
  ) => Effect.Effect<GithubGraphqlResponse, GithubGraphqlRequestError | GithubGraphqlThrottled>,
  cryptoLayer: Layer.Layer<Crypto.Crypto> = NodeCrypto.layer
) =>
  githubCompletionClaimBoundaryLayer.pipe(
    Layer.provide(Layer.succeed(GithubGraphqlClient, githubGraphqlTestClient(execute))),
    Layer.provide(cryptoLayer)
  )

const cryptoFailingAt = (base: Crypto.Crypto, failingCall: number): Crypto.Crypto => {
  let calls = 0
  const failure = PlatformError.systemError({ _tag: "Unknown", method: "digest", module: "GithubCompletionClaimTest" })
  return Crypto.make({
    digest: (algorithm, bytes) => {
      calls += 1
      return calls === failingCall ? Effect.fail(failure) : base.digest(algorithm, bytes)
    },
    randomBytes: (size) => new Uint8Array(size)
  })
}

const makeHarness = Effect.fn("GithubCompletionClaimTest.makeHarness")(function* (options: HarnessOptions = {}) {
  const crypto = yield* Crypto.Crypto
  const digest = yield* githubTaskClaimLabelDigestFor(crypto, taskId)
  const labels = yield* Ref.make<ReadonlyMap<string, StoredLabel>>(new Map())
  const calls = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest>>([])
  const createResponsesLost = yield* Ref.make(0)
  const deleteResponsesLost = yield* Ref.make(0)

  const seed = (name: string, description: string, id: string) =>
    Ref.update(labels, (current) =>
      new Map(current).set(name, { description, id: GithubLabelNodeId.make(id), name: GithubLabelName.make(name) })
    )

  if (options.includeActive !== false) {
    yield* seed(
      `dalph-claim-${digest}`,
      options.activeDescription ?? activeDescriptionFor(prepared.activeClaim),
      "active-label-node"
    )
  }
  if (options.completionDescription !== undefined) {
    yield* seed(`dalph-completion-${digest}`, options.completionDescription, "completion-label-node")
  }

  const execute = Effect.fn("GithubGraphqlClient.CompletionFixture.execute")(function* (request: GithubGraphqlRequest) {
    yield* Ref.update(calls, (current) => [...current, request])
    if (request._tag === "FindClaimLabel") {
      const label = (yield* Ref.get(labels)).get(request.labelName) ?? null
      return { body: { data: { node: { id: repositoryNodeId, label } } } }
    }
    if (request._tag === "CreateClaimLabel") {
      const existing = (yield* Ref.get(labels)).get(request.labelName)
      if (existing !== undefined) return { body: { errors: [{ message: "label name already exists" }] } }
      const label: StoredLabel = {
        description: request.description,
        id: GithubLabelNodeId.make(`completion-label:${request.operationId}`),
        name: request.labelName
      }
      yield* Ref.update(labels, (current) => new Map(current).set(request.labelName, label))
      if (
        options.loseFirstCreateResponse === true &&
        (yield* Ref.getAndUpdate(createResponsesLost, (count) => count + 1)) === 0
      ) {
        return yield* new GithubGraphqlRequestError({ detail: "response lost after create", operation: request._tag })
      }
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
      if (
        options.loseFirstDeleteResponse === true &&
        (yield* Ref.getAndUpdate(deleteResponsesLost, (count) => count + 1)) === 0
      ) {
        return yield* new GithubGraphqlRequestError({ detail: "response lost after delete", operation: request._tag })
      }
      return { body: { data: { deleteLabel: { clientMutationId: request.operationId } } } }
    }
    return yield* Effect.die(`unexpected GitHub request ${request._tag}`)
  })
  const clientLayer = Layer.succeed(GithubGraphqlClient, GithubGraphqlClient.of({ execute }))
  const layer = githubCompletionClaimBoundaryLayer.pipe(Layer.provide(clientLayer), Layer.provide(NodeCrypto.layer))
  return { calls, labels, layer }
})

completionClaimBoundaryContract({
  claim: prepared.claim,
  layer: Layer.unwrap(
    makeHarness().pipe(
      Effect.provide(NodeCrypto.layer),
      Effect.map(({ layer }) => layer)
    )
  ),
  name: "GitHub",
  successObservation: preparedSuccessObservation
})

const journalForPromotion = Effect.fn("GithubCompletionClaimTest.journalForPromotion")(function* () {
  const initial = JournalRecord.make({
    event: prepared.promotionSuccess,
    key: targetPromotionObservedSuccessRecordKey(prepared.claim.promotionCorrelation.requestId),
    position: JournalPosition.make(1),
    runId: prepared.plannedAttempt.runId
  })
  const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([initial])
  const service = InRunJournal.of({
    append: (runId, key, event) =>
      Ref.modify(records, (current) => {
        const existing = current.find((record) => record.key === key)
        if (existing !== undefined) return [Effect.succeed(existing), current] as const
        const record = JournalRecord.make({ event, key, position: JournalPosition.make(current.length + 1), runId })
        return [Effect.succeed(record), [...current, record]] as const
      }).pipe(Effect.flatten),
    read: () => Ref.get(records)
  })
  return { records, service }
})

it.effect("creates one expected completion fingerprint beside the exact active claim", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness()
    const request = completionClaimReadRequestFor(prepared.claim)
    const replacement = completionClaimReplacementRequestFor(prepared.claim)
    yield* Effect.gen(function* () {
      const boundary = yield* CompletionClaimBoundary
      expect(yield* boundary.readTaskClaim(request)).toEqual(prepared.activeClaim)
      expect(yield* boundary.replaceTaskClaim(replacement)).toEqual(prepared.claim)
      expect(yield* boundary.readTaskClaim(request)).toEqual(prepared.claim)
    }).pipe(Effect.provide(harness.layer))

    const calls = yield* Ref.get(harness.calls)
    expect(calls.map((call) => call._tag)).toEqual([
      "FindClaimLabel",
      "FindClaimLabel",
      "CreateClaimLabel",
      "FindClaimLabel",
      "FindClaimLabel"
    ])
    expect(calls.filter((call) => call._tag === "CreateClaimLabel")).toHaveLength(1)
    expect(calls.filter((call) => call._tag === "DeleteClaimLabel")).toHaveLength(0)
    const labels = yield* Ref.get(harness.labels)
    expect([...labels.keys()].filter((name) => name.startsWith("dalph-claim-"))).toHaveLength(1)
    expect([...labels.keys()].filter((name) => name.startsWith("dalph-completion-"))).toHaveLength(1)
    const completion = calls.find((call) => call._tag === "CreateClaimLabel")
    expect(completion?._tag).toBe("CreateClaimLabel")
    if (completion?._tag !== "CreateClaimLabel") return
    expect(completion.description).toMatch(/^1\|sha256\|[0-9a-f]{64}$/)
    expect(completion.description.length).toBeLessThanOrEqual(100)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("deletes only the exact completion marker and preserves the active claim", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const fingerprint = yield* githubCompletionClaimFingerprintFor(crypto, prepared.claim)
    const harness = yield* makeHarness({ completionDescription: `1|sha256|${fingerprint}` })
    yield* Effect.gen(function* () {
      const boundary = yield* CompletionClaimBoundary
      yield* boundary.deleteTaskClaim(preparedDeletionRequest)
      expect(yield* boundary.readOriginalTaskClaim(taskId)).toEqual(prepared.activeClaim)
    }).pipe(Effect.provide(harness.layer))

    expect((yield* Ref.get(harness.calls)).filter((call) => call._tag === "DeleteClaimLabel")).toEqual([
      expect.objectContaining({
        labelNodeId: GithubLabelNodeId.make("completion-label-node"),
        operationId: preparedDeletionRequest.operationId
      })
    ])
    const remaining = yield* Ref.get(harness.labels)
    expect([...remaining.keys()].filter((name) => name.startsWith("dalph-claim-"))).toHaveLength(1)
    expect([...remaining.keys()].filter((name) => name.startsWith("dalph-completion-"))).toHaveLength(0)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("reads the exact completion marker before reporting a foreign recreated active claim", () =>
  Effect.gen(function* () {
    const foreignActive = ActiveTaskClaim.make({
      ...prepared.activeClaim,
      token: ClaimToken.make("recreated-foreign-active-token")
    })
    const crypto = yield* Crypto.Crypto
    const fingerprint = yield* githubCompletionClaimFingerprintFor(crypto, prepared.claim)
    const harness = yield* makeHarness({
      activeDescription: activeDescriptionFor(foreignActive),
      completionDescription: `1|sha256|${fingerprint}`
    })
    yield* Effect.gen(function* () {
      const boundary = yield* CompletionClaimBoundary
      expect(yield* boundary.readCompletionClaimMarker(completionClaimReadRequestFor(prepared.claim))).toEqual(
        prepared.claim
      )
      expect(yield* boundary.readOriginalTaskClaim(taskId)).toEqual(foreignActive)
    }).pipe(Effect.provide(harness.layer))
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rereads after a lost completion-marker response without sending a second delete", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const fingerprint = yield* githubCompletionClaimFingerprintFor(crypto, prepared.claim)
    const harness = yield* makeHarness({
      completionDescription: `1|sha256|${fingerprint}`,
      includeActive: false,
      loseFirstDeleteResponse: true
    })
    const first = yield* Effect.gen(function* () {
      return yield* (yield* CompletionClaimBoundary).deleteTaskClaim(preparedDeletionRequest).pipe(Effect.flip)
    }).pipe(Effect.provide(harness.layer))
    expect(first).toBeInstanceOf(CompletionClaimDeletionFailure)
    expect(first).toMatchObject({ outcome: "Unknown", request: preparedDeletionRequest })

    yield* Effect.gen(function* () {
      yield* (yield* CompletionClaimBoundary).deleteTaskClaim(preparedDeletionRequest)
    }).pipe(Effect.provide(harness.layer))
    expect((yield* Ref.get(harness.calls)).filter((call) => call._tag === "DeleteClaimLabel")).toHaveLength(1)
    expect((yield* Ref.get(harness.labels)).size).toBe(0)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("refuses a foreign completion marker without deleting either claim record", () =>
  Effect.gen(function* () {
    const foreign = CompletionTaskClaim.make({
      ...prepared.claim,
      originalClaim: ActiveTaskClaim.make({ ...prepared.activeClaim, token: ClaimToken.make("foreign-deletion-token") })
    })
    const crypto = yield* Crypto.Crypto
    const foreignFingerprint = yield* githubCompletionClaimFingerprintFor(crypto, foreign)
    const harness = yield* makeHarness({ completionDescription: `1|sha256|${foreignFingerprint}` })
    const failure = yield* Effect.gen(function* () {
      return yield* (yield* CompletionClaimBoundary).deleteTaskClaim(preparedDeletionRequest).pipe(Effect.flip)
    }).pipe(Effect.provide(harness.layer))

    expect(failure).toBeInstanceOf(CompletionClaimDeletionFailure)
    expect(failure).toMatchObject({ outcome: "DefinitelyNotApplied", request: preparedDeletionRequest })
    expect((yield* Ref.get(harness.calls)).filter((call) => call._tag === "DeleteClaimLabel")).toHaveLength(0)
    expect((yield* Ref.get(harness.labels)).size).toBe(2)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("derives a bounded fingerprint from the canonical exact completion claim", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const canonicalJson = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(CompletionTaskClaim))(prepared.claim)
    const decodedCopy = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(CompletionTaskClaim))(canonicalJson)
    const fingerprint = yield* githubCompletionClaimFingerprintFor(crypto, prepared.claim)
    const copiedFingerprint = yield* githubCompletionClaimFingerprintFor(crypto, decodedCopy)
    const changedClaim = CompletionTaskClaim.make({
      ...prepared.claim,
      originalClaim: ActiveTaskClaim.make({
        ...prepared.activeClaim,
        token: ClaimToken.make("completion-changed-active-token")
      })
    })
    const changedFingerprint = yield* githubCompletionClaimFingerprintFor(crypto, changedClaim)

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(copiedFingerprint).toBe(fingerprint)
    expect(changedFingerprint).not.toBe(fingerprint)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("maps unreadable GitHub completion evidence to typed read failures", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const fingerprint = yield* githubCompletionClaimFingerprintFor(crypto, prepared.claim)
    const cases: ReadonlyArray<{
      readonly body: (request: Extract<GithubGraphqlRequest, { readonly _tag: "FindClaimLabel" }>) => unknown
      readonly name: string
    }> = [
      { body: () => "not-an-envelope", name: "malformed GraphQL envelope" },
      { body: () => ({ errors: [{ message: "denied" }] }), name: "GraphQL errors" },
      { body: () => ({}), name: "missing lookup result" },
      { body: () => ({ data: { node: null } }), name: "inaccessible repository" },
      { body: () => ({ data: { node: { id: "different-repository", label: null } } }), name: "foreign repository" },
      {
        body: () => ({
          data: {
            node: {
              id: repositoryNodeId,
              label: {
                description: `1|sha256|${fingerprint}`,
                id: "completion-label-node",
                name: "unexpected-label-name"
              }
            }
          }
        }),
        name: "foreign label"
      },
      {
        body: (request) => completionFindResponse(request, "1|sha256|not-a-fingerprint").body,
        name: "malformed fingerprint"
      }
    ]

    for (const testCase of cases) {
      const layer = adapterLayer((request) => {
        if (request._tag !== "FindClaimLabel") return Effect.die("unexpected mutation")
        return Effect.succeed(
          request.labelName.startsWith("dalph-claim-")
            ? exactActiveFindResponse(request)
            : { body: testCase.body(request) }
        )
      })
      const failure = yield* Effect.gen(function* () {
        return yield* (yield* CompletionClaimBoundary)
          .readTaskClaim(completionClaimReadRequestFor(prepared.claim))
          .pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
      expect(failure, testCase.name).toBeInstanceOf(CompletionClaimReadFailure)
    }

    const completionTransportFailure = yield* Effect.gen(function* () {
      const boundary = yield* CompletionClaimBoundary
      return yield* boundary.readTaskClaim(completionClaimReadRequestFor(prepared.claim)).pipe(Effect.flip)
    }).pipe(
      Effect.provide(
        adapterLayer((request) =>
          request._tag === "FindClaimLabel" && request.labelName.startsWith("dalph-claim-")
            ? Effect.succeed(exactActiveFindResponse(request))
            : Effect.fail(
                new GithubGraphqlRequestError({ detail: "completion lookup unavailable", operation: request._tag })
              )
        )
      )
    )
    expect(completionTransportFailure).toBeInstanceOf(CompletionClaimReadFailure)

    const activeTransportFailure = yield* Effect.gen(function* () {
      const boundary = yield* CompletionClaimBoundary
      return yield* boundary.readTaskClaim(completionClaimReadRequestFor(prepared.claim)).pipe(Effect.flip)
    }).pipe(
      Effect.provide(
        adapterLayer((request) =>
          Effect.fail(new GithubGraphqlRequestError({ detail: "active lookup unavailable", operation: request._tag }))
        )
      )
    )
    expect(activeTransportFailure).toBeInstanceOf(CompletionClaimReadFailure)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("maps task-identity and digest failures before any unsafe completion mutation", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const invalid = prepareForTaskId(TaskId.make("not-a-github-task"))
    const inertClient = (_request: GithubGraphqlRequest) => Effect.die("invalid local evidence must not call GitHub")
    const invalidLayer = adapterLayer(inertClient)
    const [readIdentityFailure, markerIdentityFailure, replacementIdentityFailure] = yield* Effect.all([
      Effect.gen(function* () {
        return yield* (yield* CompletionClaimBoundary)
          .readTaskClaim(completionClaimReadRequestFor(invalid.claim))
          .pipe(Effect.flip)
      }).pipe(Effect.provide(invalidLayer)),
      Effect.gen(function* () {
        return yield* (yield* CompletionClaimBoundary)
          .readCompletionClaimMarker(completionClaimReadRequestFor(invalid.claim))
          .pipe(Effect.flip)
      }).pipe(Effect.provide(invalidLayer)),
      Effect.gen(function* () {
        return yield* (yield* CompletionClaimBoundary)
          .replaceTaskClaim(completionClaimReplacementRequestFor(invalid.claim))
          .pipe(Effect.flip)
      }).pipe(Effect.provide(invalidLayer))
    ])
    expect(readIdentityFailure).toBeInstanceOf(CompletionClaimReadFailure)
    expect(markerIdentityFailure).toBeInstanceOf(CompletionClaimReadFailure)
    expect(replacementIdentityFailure).toBeInstanceOf(CompletionClaimReplacementFailure)
    if (replacementIdentityFailure instanceof CompletionClaimReplacementFailure) {
      expect(replacementIdentityFailure.outcome).toBe("DefinitelyNotApplied")
    }

    const exactFingerprint = yield* githubCompletionClaimFingerprintFor(crypto, prepared.claim)
    const exactDescription = `1|sha256|${exactFingerprint}`
    const exactReadClient = (request: GithubGraphqlRequest) => {
      if (request._tag !== "FindClaimLabel") return Effect.die("unexpected mutation")
      return Effect.succeed(
        request.labelName.startsWith("dalph-claim-")
          ? exactActiveFindResponse(request)
          : completionFindResponse(request, exactDescription)
      )
    }
    for (const failingCall of [2, 3]) {
      const failure = yield* Effect.gen(function* () {
        return yield* (yield* CompletionClaimBoundary)
          .readTaskClaim(completionClaimReadRequestFor(prepared.claim))
          .pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          adapterLayer(exactReadClient, Layer.succeed(Crypto.Crypto, cryptoFailingAt(crypto, failingCall)))
        )
      )
      expect(failure).toBeInstanceOf(CompletionClaimReadFailure)
    }

    const fingerprintFailure = yield* githubCompletionClaimFingerprintFor(
      cryptoFailingAt(crypto, 1),
      prepared.claim
    ).pipe(Effect.flip)
    expect(fingerprintFailure).toBeInstanceOf(GithubCompletionClaimFingerprintFailure)

    const invalidDigestCrypto = Crypto.make({
      digest: () => Effect.succeed(new Uint8Array()),
      randomBytes: (size) => new Uint8Array(size)
    })
    const invalidFingerprint = yield* githubCompletionClaimFingerprintFor(invalidDigestCrypto, prepared.claim).pipe(
      Effect.flip
    )
    expect(invalidFingerprint).toBeInstanceOf(GithubCompletionClaimFingerprintFailure)

    for (const implementation of [cryptoFailingAt(crypto, 1), cryptoFailingAt(crypto, 2), invalidDigestCrypto]) {
      const failure = yield* Effect.gen(function* () {
        return yield* (yield* CompletionClaimBoundary)
          .replaceTaskClaim(completionClaimReplacementRequestFor(prepared.claim))
          .pipe(Effect.flip)
      }).pipe(Effect.provide(adapterLayer(inertClient, Layer.succeed(Crypto.Crypto, implementation))))
      expect(failure).toBeInstanceOf(CompletionClaimReplacementFailure)
      if (failure instanceof CompletionClaimReplacementFailure) {
        expect(failure.outcome).toBe("DefinitelyNotApplied")
      }
    }
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("classifies ambiguous create acknowledgements and refuses deletion when exact lookup is unreadable", () =>
  Effect.gen(function* () {
    const replacement = completionClaimReplacementRequestFor(prepared.claim)
    const responseCases: ReadonlyArray<{
      readonly name: string
      readonly response: (
        request: Extract<GithubGraphqlRequest, { readonly _tag: "CreateClaimLabel" }>
      ) => Effect.Effect<GithubGraphqlResponse, GithubGraphqlRequestError>
    }> = [
      {
        name: "transport failure",
        response: (request) =>
          Effect.fail(new GithubGraphqlRequestError({ detail: "response lost", operation: request._tag }))
      },
      { name: "malformed GraphQL envelope", response: () => Effect.succeed({ body: "not-an-envelope" }) },
      {
        name: "GraphQL errors",
        response: () => Effect.succeed({ body: { errors: [{ message: "create rejected" }] } })
      },
      { name: "missing create result", response: () => Effect.succeed({ body: {} }) },
      {
        name: "mismatched acknowledgement",
        response: (request) =>
          Effect.succeed({
            body: {
              data: {
                createLabel: {
                  label: {
                    description: request.description,
                    id: "completion-label-node",
                    name: "unexpected-label-name"
                  }
                }
              }
            }
          })
      }
    ]

    for (const testCase of responseCases) {
      const layer = adapterLayer((request) =>
        request._tag === "CreateClaimLabel" ? testCase.response(request) : Effect.die("unexpected read")
      )
      const failure = yield* Effect.gen(function* () {
        return yield* (yield* CompletionClaimBoundary).replaceTaskClaim(replacement).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
      expect(failure, testCase.name).toBeInstanceOf(CompletionClaimReplacementFailure)
      if (failure instanceof CompletionClaimReplacementFailure) expect(failure.outcome, testCase.name).toBe("Unknown")
    }

    const successObservation = FocusedCompletedTaskObservation.make({
      ...integrationFinalityFixture.successObservation,
      claim: prepared.claim,
      taskId,
      taskRevision: prepared.plannedAttempt.taskRevision
    })
    const deletion = completionClaimDeletionRequestFor(prepared.claim, successObservation)
    const deletionLayer = adapterLayer((request) =>
      request._tag === "FindClaimLabel"
        ? Effect.fail(
            new GithubGraphqlRequestError({ detail: "completion lookup unavailable", operation: request._tag })
          )
        : Effect.die("unreadable completion evidence must not delete a GitHub label")
    )
    const deletionFailure = yield* Effect.gen(function* () {
      return yield* (yield* CompletionClaimBoundary).deleteTaskClaim(deletion).pipe(Effect.flip)
    }).pipe(Effect.provide(deletionLayer))
    expect(deletionFailure).toBeInstanceOf(CompletionClaimDeletionFailure)
    if (deletionFailure instanceof CompletionClaimDeletionFailure) {
      expect(deletionFailure.outcome).toBe("DefinitelyNotApplied")
    }
  })
)

it.effect("deletes no completion marker when local identity or digest evidence cannot be proven", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const observationFor = (preparedClaim: CompletionTaskClaim) =>
      FocusedCompletedTaskObservation.make({
        ...integrationFinalityFixture.successObservation,
        claim: preparedClaim,
        taskId: preparedClaim.plannedAttempt.taskId,
        taskRevision: preparedClaim.plannedAttempt.taskRevision
      })
    const invalid = prepareForTaskId(TaskId.make("not-a-github-completion-task"))
    const invalidDeletion = completionClaimDeletionRequestFor(invalid.claim, observationFor(invalid.claim))
    const noBoundaryCalls = (_request: GithubGraphqlRequest) =>
      Effect.die("invalid local evidence must not call GitHub")
    const invalidIdentity = yield* Effect.gen(function* () {
      return yield* (yield* CompletionClaimBoundary).deleteTaskClaim(invalidDeletion).pipe(Effect.flip)
    }).pipe(Effect.provide(adapterLayer(noBoundaryCalls)))
    expect(invalidIdentity).toMatchObject({ outcome: "DefinitelyNotApplied", request: invalidDeletion })

    const observation = observationFor(prepared.claim)
    const deletion = completionClaimDeletionRequestFor(prepared.claim, observation)
    const fingerprint = yield* githubCompletionClaimFingerprintFor(crypto, prepared.claim)
    const digestFailure = yield* Effect.gen(function* () {
      return yield* (yield* CompletionClaimBoundary).deleteTaskClaim(deletion).pipe(Effect.flip)
    }).pipe(
      Effect.provide(
        adapterLayer(
          (request) =>
            request._tag === "FindClaimLabel"
              ? Effect.succeed(completionFindResponse(request, `1|sha256|${fingerprint}`))
              : Effect.die("digest failure must happen before completion deletion"),
          Layer.succeed(Crypto.Crypto, cryptoFailingAt(crypto, 1))
        )
      )
    )
    expect(digestFailure).toMatchObject({ outcome: "DefinitelyNotApplied", request: deletion })
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("reports Unknown after one delete request when GitHub acknowledgement is not exact", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const observation = FocusedCompletedTaskObservation.make({
      ...integrationFinalityFixture.successObservation,
      claim: prepared.claim,
      taskId: prepared.claim.plannedAttempt.taskId,
      taskRevision: prepared.claim.plannedAttempt.taskRevision
    })
    const deletion = completionClaimDeletionRequestFor(prepared.claim, observation)
    const fingerprint = yield* githubCompletionClaimFingerprintFor(crypto, prepared.claim)

    for (const [name, response] of [
      ["malformed", () => ({ body: "not-an-envelope" })],
      ["rejected", () => ({ body: { errors: [{ message: "delete denied" }] } })],
      ["mismatched", () => ({ body: { data: { deleteLabel: { clientMutationId: "another-completion-deletion" } } } })]
    ] as const) {
      const calls = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest>>([])
      const layer = adapterLayer((request) =>
        Ref.update(calls, (current) => [...current, request]).pipe(
          Effect.andThen(
            request._tag === "FindClaimLabel"
              ? Effect.succeed(completionFindResponse(request, `1|sha256|${fingerprint}`))
              : request._tag === "DeleteClaimLabel"
                ? Effect.succeed(response())
                : Effect.die("unexpected completion deletion request")
          )
        )
      )
      const failure = yield* Effect.gen(function* () {
        return yield* (yield* CompletionClaimBoundary).deleteTaskClaim(deletion).pipe(Effect.flip)
      }).pipe(Effect.provide(layer))
      expect(failure, name).toMatchObject({ outcome: "Unknown", request: deletion })
      expect(
        (yield* Ref.get(calls)).filter(
          (request): request is Extract<GithubGraphqlRequest, { readonly _tag: "DeleteClaimLabel" }> =>
            request._tag === "DeleteClaimLabel"
        ),
        name
      ).toEqual([expect.objectContaining({ _tag: "DeleteClaimLabel", operationId: deletion.operationId })])
    }
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("stops after one throttled completion-claim create and preserves its operation identity", () =>
  Effect.gen(function* () {
    const replacement = completionClaimReplacementRequestFor(prepared.claim)
    const calls = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest>>([])
    const layer = adapterLayer((request) =>
      Ref.update(calls, (current) => [...current, request]).pipe(
        Effect.andThen(
          request._tag === "CreateClaimLabel"
            ? Effect.fail(
                new GithubGraphqlThrottled({
                  detail: "GitHub secondary rate limit rejected the GraphQL request",
                  kind: "Secondary",
                  operation: request._tag,
                  timingEvidence: null
                })
              )
            : Effect.die("unexpected read")
        )
      )
    )
    const failure = yield* Effect.gen(function* () {
      return yield* (yield* CompletionClaimBoundary).replaceTaskClaim(replacement).pipe(Effect.flip)
    }).pipe(Effect.provide(layer))

    expect(failure).toBeInstanceOf(TaskTrackerMutationThrottled)
    expect(failure).toMatchObject({
      operation: "ReplaceCompletionClaim",
      operationId: replacement.operationId,
      retry: null
    })
    expect((yield* Ref.get(calls)).filter((request) => request._tag === "CreateClaimLabel")).toHaveLength(1)
  })
)

it.effect("reuses the exact GitHub completion claim after its create response is lost", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({ loseFirstCreateResponse: true })
    const journal = yield* journalForPromotion()
    const result = yield* Effect.gen(function* () {
      const boundary = yield* CompletionClaimBoundary
      return yield* runCompletionClaimReplacementProtocol(
        boundary,
        completionClaimReplacementRequestFor(prepared.claim)
      ).pipe(Effect.provideService(InRunJournal, journal.service))
    }).pipe(Effect.provide(harness.layer))

    expect(result.claim).toEqual(prepared.claim)
    const calls = yield* Ref.get(harness.calls)
    expect(calls.filter((call) => call._tag === "CreateClaimLabel")).toHaveLength(1)
    expect(calls.map((call) => call._tag)).toEqual([
      "FindClaimLabel",
      "FindClaimLabel",
      "CreateClaimLabel",
      "FindClaimLabel",
      "FindClaimLabel"
    ])
    expect((yield* Ref.get(journal.records)).map(({ event }) => event._tag)).toEqual([
      "TargetPromotionObservedSuccess",
      "CompletionClaimReplacementIntended",
      "CompletionClaimReplacementAttemptIntended",
      "CompletionClaimReplaced"
    ])
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("fails closed on foreign stale malformed or conflicting completion evidence without mutation", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const exactFingerprint = yield* githubCompletionClaimFingerprintFor(crypto, prepared.claim)
    const staleClaim = CompletionTaskClaim.make({
      ...prepared.claim,
      originalClaim: ActiveTaskClaim.make({
        ...prepared.activeClaim,
        token: ClaimToken.make("stale-completion-active-token")
      })
    })
    const foreignTask = prepareForTaskId(
      githubTaskIdFor(repositoryNodeId, GithubIssueNodeId.make("foreign-completion-issue-node"))
    )
    const staleFingerprint = yield* githubCompletionClaimFingerprintFor(crypto, staleClaim)
    const foreignFingerprint = yield* githubCompletionClaimFingerprintFor(crypto, foreignTask.claim)
    const descriptions = [
      ["foreign", `1|sha256|${foreignFingerprint}`],
      ["stale", `1|sha256|${staleFingerprint}`]
    ] as const
    for (const [name, completionDescription] of descriptions) {
      const harness = yield* makeHarness({ completionDescription })
      const journal = yield* journalForPromotion()
      const failure = yield* Effect.gen(function* () {
        const boundary = yield* CompletionClaimBoundary
        return yield* runCompletionClaimReplacementProtocol(
          boundary,
          completionClaimReplacementRequestFor(prepared.claim)
        ).pipe(Effect.provideService(InRunJournal, journal.service), Effect.flip)
      }).pipe(Effect.provide(harness.layer))
      expect(failure, name).toBeInstanceOf(CompletionClaimOwnershipConflict)
      expect(
        (yield* Ref.get(harness.calls)).filter((call) => call._tag === "CreateClaimLabel"),
        name
      ).toHaveLength(0)
    }

    const malformedHarness = yield* makeHarness({ completionDescription: "unsupported-completion-description" })
    const malformedJournal = yield* journalForPromotion()
    const malformed = yield* Effect.gen(function* () {
      const boundary = yield* CompletionClaimBoundary
      return yield* runCompletionClaimReplacementProtocol(
        boundary,
        completionClaimReplacementRequestFor(prepared.claim)
      ).pipe(Effect.provideService(InRunJournal, malformedJournal.service), Effect.flip)
    }).pipe(Effect.provide(malformedHarness.layer))
    expect(malformed).toBeInstanceOf(CompletionClaimReadFailure)
    expect((yield* Ref.get(malformedHarness.calls)).filter((call) => call._tag === "CreateClaimLabel")).toHaveLength(0)

    const foreignActive = ActiveTaskClaim.make({
      ...prepared.activeClaim,
      owner: ClaimOwner.make("foreign-completion-owner")
    })
    const foreignActiveHarness = yield* makeHarness({
      activeDescription: activeDescriptionFor(foreignActive),
      completionDescription: `1|sha256|${exactFingerprint}`
    })
    const foreignActiveJournal = yield* journalForPromotion()
    const foreignActiveFailure = yield* Effect.gen(function* () {
      const boundary = yield* CompletionClaimBoundary
      const observation = yield* boundary.readTaskClaim(completionClaimReadRequestFor(prepared.claim))
      expect(observation._tag).toBe("ActiveTaskClaim")
      if (observation._tag === "ActiveTaskClaim") {
        expect(isExactTaskClaim(observation, prepared.activeClaim)).toBe(false)
      }
      return yield* runCompletionClaimReplacementProtocol(
        boundary,
        completionClaimReplacementRequestFor(prepared.claim)
      ).pipe(Effect.provideService(InRunJournal, foreignActiveJournal.service), Effect.flip)
    }).pipe(Effect.provide(foreignActiveHarness.layer))
    expect(foreignActiveFailure).toBeInstanceOf(CompletionClaimOwnershipConflict)
    expect(
      (yield* Ref.get(foreignActiveHarness.calls)).filter((call) => call._tag === "CreateClaimLabel")
    ).toHaveLength(0)
  }).pipe(Effect.provide(NodeCrypto.layer))
)
