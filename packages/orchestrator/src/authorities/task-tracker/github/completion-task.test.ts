import { NodeCrypto } from "@effect/platform-node"
import { makeTaskWorkSpecification, PlannedTaskAttempt } from "@dalph/contracts"
import { expect, it } from "@effect/vitest"
import { Crypto, Effect, Layer, Ref } from "effect"
import { ActiveTaskClaim } from "../claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../claim.js"
import { TaskTrackerMutationThrottled } from "../mutation-throttling.js"
import { completionBoundaryContract } from "../../../../test/contracts/completion-boundary-contract.js"
import { OperationId } from "../../../workflow/identity.js"
import { IntegratorRunQualifiedCandidate } from "../../../workflow/protocols/integrator/events.js"
import { targetPromotionCorrelationFor } from "../../../workflow/protocols/target-promotion/events.js"
import {
  CompletionTaskBoundary,
  CompletionTaskClaim,
  CompletionTaskRequestFailure,
  FocusedTaskCompletionReadFailure,
  FocusedTaskCompletionReadRequest,
  completionTaskRequestFor
} from "../../../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture } from "../../../workflow/protocols/integration-finality/fixtures.js"
import { githubCompletionClaimBoundaryLayer, githubCompletionClaimFingerprintFor } from "./completion-claim.js"
import { githubCompletionTaskBoundaryLayer } from "./completion-task.js"
import {
  GithubGraphqlClient,
  type GithubGraphqlRequest,
  GithubGraphqlRequestError,
  type GithubGraphqlResponse,
  GithubGraphqlThrottled,
  GithubCursor,
  GithubIssueNodeId,
  GithubLabelNodeId,
  GithubRepositoryNodeId
} from "./graphql-client.js"
import { githubGraphqlTestClient } from "./graphql-client.test-fixture.js"
import { GithubGraphqlReadThrottled, GithubGraphqlThrottleEvidence } from "./graphql-read-throttle.js"
import { githubTaskIdFor } from "./task-identity.js"
import { GithubIssueNumber, GithubIssueTarget, GithubRepositoryName, GithubRepositoryOwner } from "./target.js"

const repositoryNodeId = GithubRepositoryNodeId.make("completion-task-repository")
const issueNodeId = GithubIssueNodeId.make("completion-task-issue")
const prerequisiteNodeId = GithubIssueNodeId.make("completion-task-prerequisite")
const secondPrerequisiteNodeId = GithubIssueNodeId.make("completion-task-second-prerequisite")
const rootNodeId = GithubIssueNodeId.make("completion-task-root")
const foreignRepositoryNodeId = GithubRepositoryNodeId.make("completion-task-foreign-repository")
const taskId = githubTaskIdFor(repositoryNodeId, issueNodeId)
const target = GithubIssueTarget.make({
  issueNumber: GithubIssueNumber.make(283),
  owner: GithubRepositoryOwner.make("dalph-test"),
  repository: GithubRepositoryName.make("completion-task")
})
const specification = makeTaskWorkSpecification({ body: "current completion body", taskId, title: "Completion task" })

const plannedAttempt = PlannedTaskAttempt.make({
  ...integrationFinalityFixture.plannedAttempt,
  taskId,
  taskRevision: specification.fingerprint
})
const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
  ...integrationFinalityFixture.qualifiedCandidate,
  run: {
    ...integrationFinalityFixture.qualifiedCandidate.run,
    session: { ...integrationFinalityFixture.qualifiedCandidate.run.session, plannedAttempt }
  }
})
const activeClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("completion-task-active-claim"),
  owner: ClaimOwner.make("dalph:completion-task"),
  taskId,
  token: ClaimToken.make("completion-task-token")
})
const claim = CompletionTaskClaim.make({
  originalClaim: activeClaim,
  plannedAttempt,
  promotionCorrelation: targetPromotionCorrelationFor(qualifiedCandidate)
})
const completionRequest = completionTaskRequestFor(claim)

const activeDescription = ["1", activeClaim.operationId, activeClaim.owner, activeClaim.token].join("|")

interface CompletionHarnessOptions {
  readonly applyCloseBeforeLosingResponse?: boolean
  readonly focusedReadFault?:
    | "ForeignTaskRepository"
    | "InaccessibleBlockedBy"
    | "MalformedBlockedBy"
    | "MismatchedTaskIdentity"
    | "MissingTask"
    | "PartialBlockedBy"
    | "UnsupportedTaskLifecycle"
  readonly initialClosed?: boolean
  readonly loseCloseResponse?: boolean
  readonly openPrerequisite?: boolean
  readonly paginatedPrerequisites?: boolean
  readonly taskAsChild?: boolean
  readonly throttleClose?: boolean
  readonly throttleFocusedRead?: boolean
  readonly targetRootNodeId?: GithubIssueNodeId
}

const connectionBody = (
  relation: "blockedBy" | "subIssues",
  nodeId: GithubIssueNodeId,
  nodeIds: ReadonlyArray<GithubIssueNodeId>,
  pageInfo: { readonly endCursor: GithubCursor | null; readonly hasNextPage: boolean } = {
    endCursor: null,
    hasNextPage: false
  }
): GithubGraphqlResponse => ({
  body: {
    data: { node: { __typename: "Issue", id: nodeId, [relation]: { nodes: nodeIds.map((id) => ({ id })), pageInfo } } }
  }
})

const makeHarness = (options: CompletionHarnessOptions = {}) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const completionFingerprint = yield* githubCompletionClaimFingerprintFor(crypto, claim)
    const closed = yield* Ref.make(options.initialClosed === true)
    const calls = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest>>([])
    const execute = Effect.fn("GithubGraphqlClient.CompletionTaskFixture.execute")(function* (
      request: GithubGraphqlRequest
    ) {
      yield* Ref.update(calls, (current) => [...current, request])
      if (request._tag === "ResolveIssue") {
        if (options.throttleFocusedRead === true) {
          return yield* new GithubGraphqlReadThrottled({
            detail: "GitHub request throttled",
            operation: request._tag,
            retry: GithubGraphqlThrottleEvidence.cases.Unavailable.make({})
          })
        }
        return {
          body: {
            data: { repository: { id: repositoryNodeId, issue: { id: options.targetRootNodeId ?? issueNodeId } } }
          }
        }
      }
      if (request._tag === "ReadTaskWorkSpecification") {
        return {
          body: {
            data: {
              node: {
                __typename: "Issue",
                body: specification.body,
                id: request.issueNodeId,
                repository: { id: repositoryNodeId },
                title: specification.title
              }
            }
          }
        }
      }
      if (request._tag === "ReadIssue") {
        if (options.focusedReadFault === "MissingTask" && request.issueNodeId === issueNodeId) {
          return { body: { data: { node: null } } }
        }
        const isPrerequisite =
          request.issueNodeId === prerequisiteNodeId || request.issueNodeId === secondPrerequisiteNodeId
        const isClosed = isPrerequisite ? options.openPrerequisite !== true : yield* Ref.get(closed)
        const unsupportedLifecycle =
          options.focusedReadFault === "UnsupportedTaskLifecycle" && request.issueNodeId === issueNodeId
        return {
          body: {
            data: {
              node: {
                __typename: "Issue",
                id:
                  options.focusedReadFault === "MismatchedTaskIdentity" && request.issueNodeId === issueNodeId
                    ? rootNodeId
                    : request.issueNodeId,
                parent:
                  request.issueNodeId === issueNodeId && options.taskAsChild === true
                    ? { id: options.targetRootNodeId ?? rootNodeId }
                    : null,
                repository: {
                  id:
                    options.focusedReadFault === "ForeignTaskRepository" && request.issueNodeId === issueNodeId
                      ? foreignRepositoryNodeId
                      : repositoryNodeId
                },
                state: isClosed ? "CLOSED" : "OPEN",
                stateReason: unsupportedLifecycle ? "COMPLETED" : isClosed ? "COMPLETED" : null
              }
            }
          }
        }
      }
      if (request._tag === "ReadBlockedBy") {
        if (options.focusedReadFault === "MalformedBlockedBy") {
          return { body: { data: { node: { id: request.issueNodeId } } } }
        }
        if (options.focusedReadFault === "InaccessibleBlockedBy" && request.issueNodeId === issueNodeId) {
          return { body: { data: { node: null } } }
        }
        if (options.focusedReadFault === "PartialBlockedBy" && request.issueNodeId === issueNodeId) {
          return {
            body: {
              data: {
                node: {
                  __typename: "Issue",
                  blockedBy: { nodes: [], pageInfo: { endCursor: null, hasNextPage: true } },
                  id: issueNodeId
                }
              }
            }
          }
        }
        if (options.paginatedPrerequisites === true && request.issueNodeId === issueNodeId) {
          return request.cursor === null
            ? connectionBody("blockedBy", request.issueNodeId, [secondPrerequisiteNodeId], {
                endCursor: GithubCursor.make("completion-task-prerequisite-page-2"),
                hasNextPage: true
              })
            : connectionBody("blockedBy", request.issueNodeId, [prerequisiteNodeId])
        }
        return connectionBody(
          "blockedBy",
          request.issueNodeId,
          request.issueNodeId === issueNodeId && options.openPrerequisite === true ? [prerequisiteNodeId] : []
        )
      }
      if (request._tag === "ReadSubIssues") {
        const childNodeIds =
          request.issueNodeId === (options.targetRootNodeId ?? rootNodeId) && options.taskAsChild === true
            ? [issueNodeId]
            : []
        return connectionBody("subIssues", request.issueNodeId, childNodeIds)
      }
      if (request._tag === "FindClaimLabel") {
        const completion = request.labelName.startsWith("dalph-completion-")
        return {
          body: {
            data: {
              node: {
                id: repositoryNodeId,
                label: {
                  description: completion ? `1|sha256|${completionFingerprint}` : activeDescription,
                  id: GithubLabelNodeId.make(completion ? "completion-label" : "active-label"),
                  name: request.labelName
                }
              }
            }
          }
        }
      }
      if (request._tag === "CloseIssue") {
        if (options.throttleClose === true) {
          return yield* new GithubGraphqlThrottled({
            detail: "GitHub secondary rate limit rejected the GraphQL request",
            kind: "Secondary",
            operation: request._tag,
            timingEvidence: null
          })
        }
        if (options.applyCloseBeforeLosingResponse === true || options.loseCloseResponse !== true) {
          yield* Ref.set(closed, true)
        }
        if (options.loseCloseResponse === true) {
          return yield* new GithubGraphqlRequestError({ detail: "close response lost", operation: "CloseIssue" })
        }
        return {
          body: {
            data: {
              closeIssue: {
                clientMutationId: request.operationId,
                // The mutation response is acknowledgement only; this deliberately stale
                // lifecycle must not substitute for the focused confirmation read.
                issue: { id: request.issueNodeId, state: "OPEN", stateReason: null }
              }
            }
          }
        }
      }
      return yield* Effect.die(`unexpected GitHub request ${request._tag}`)
    })
    const clientLayer = Layer.succeed(GithubGraphqlClient, githubGraphqlTestClient(execute))
    const claimLayer = githubCompletionClaimBoundaryLayer.pipe(
      Layer.provide(clientLayer),
      Layer.provide(NodeCrypto.layer)
    )
    const layer = githubCompletionTaskBoundaryLayer.pipe(Layer.provide(clientLayer), Layer.provide(claimLayer))
    return { calls, layer }
  }).pipe(Effect.provide(NodeCrypto.layer))

completionBoundaryContract({
  expectedOpenFacts: {
    currentClaim: claim,
    lifecycle: "Open",
    target,
    targetMembership: "Member",
    taskId,
    taskRevision: specification.fingerprint,
    unfinishedPrerequisiteTaskIds: []
  },
  expectedRequestLookup: "Unreadable",
  layer: Layer.unwrap(makeHarness().pipe(Effect.map(({ layer }) => layer))),
  name: "GitHub",
  request: completionRequest,
  target
})

const focusedRequest = (suffix: string) =>
  FocusedTaskCompletionReadRequest.make({
    expectedClaim: claim,
    operationId: OperationId.make(`completion-task-focused-${suffix}`),
    target,
    taskId
  })

it.effect("reads exact current completion facts, acknowledges one close, and proves success only by rereading", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness()
    yield* Effect.gen(function* () {
      const boundary = yield* CompletionTaskBoundary
      const initial = yield* boundary.readFocusedTaskCompletion(focusedRequest("initial"))
      expect(initial).toMatchObject({
        currentClaim: claim,
        lifecycle: "Open",
        targetMembership: "Member",
        taskId,
        taskRevision: specification.fingerprint,
        unfinishedPrerequisiteTaskIds: []
      })
      const sameFacts = yield* boundary.readFocusedTaskCompletion(focusedRequest("same-content"))
      expect(sameFacts.trackerRevision).toBe(initial.trackerRevision)

      expect(yield* boundary.completeTask(completionRequest)).toEqual({
        operationId: completionRequest.operationId,
        taskId
      })
      const confirmed = yield* boundary.readFocusedTaskCompletion(focusedRequest("confirmation"))
      expect(confirmed.lifecycle).toBe("CompletedSuccessfully")
      expect(confirmed.trackerRevision).not.toBe(initial.trackerRevision)
      expect(yield* boundary.readCompletionRequest(completionRequest)).toMatchObject({
        _tag: "Unreadable",
        request: completionRequest
      })
    }).pipe(Effect.provide(harness.layer))

    const closeCalls = (yield* Ref.get(harness.calls)).filter(({ _tag }) => _tag === "CloseIssue")
    expect(closeCalls).toEqual([{ _tag: "CloseIssue", issueNodeId, operationId: completionRequest.operationId }])
  })
)

it.effect("observes GitHub success after a lost close response without another close", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({ applyCloseBeforeLosingResponse: true, loseCloseResponse: true })
    yield* Effect.gen(function* () {
      const boundary = yield* CompletionTaskBoundary
      const failure = yield* boundary.completeTask(completionRequest).pipe(Effect.flip)
      expect(failure).toMatchObject({ outcome: "Unknown", request: completionRequest })
      expect(yield* boundary.readFocusedTaskCompletion(focusedRequest("lost-success"))).toMatchObject({
        currentClaim: claim,
        lifecycle: "CompletedSuccessfully"
      })
    }).pipe(Effect.provide(harness.layer))
    expect((yield* Ref.get(harness.calls)).filter(({ _tag }) => _tag === "CloseIssue")).toHaveLength(1)
  })
)

it.effect("fails closed when GitHub cannot identify an ambiguous completion request", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({ loseCloseResponse: true })
    yield* Effect.gen(function* () {
      const boundary = yield* CompletionTaskBoundary
      const failure = yield* boundary.completeTask(completionRequest).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(CompletionTaskRequestFailure)
      expect(yield* boundary.readFocusedTaskCompletion(focusedRequest("lost-open"))).toMatchObject({
        lifecycle: "Open"
      })
      expect(yield* boundary.readCompletionRequest(completionRequest)).toMatchObject({
        _tag: "Unreadable",
        request: completionRequest
      })
    }).pipe(Effect.provide(harness.layer))
    expect((yield* Ref.get(harness.calls)).filter(({ _tag }) => _tag === "CloseIssue")).toHaveLength(1)
  })
)

it.effect("returns one completion throttle without retrying or changing the exact operation", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({ throttleClose: true })
    const failure = yield* Effect.gen(function* () {
      return yield* (yield* CompletionTaskBoundary).completeTask(completionRequest).pipe(Effect.flip)
    }).pipe(Effect.provide(harness.layer))

    expect(failure).toEqual(
      new TaskTrackerMutationThrottled({
        detail: "GitHub secondary rate limit rejected the GraphQL request",
        operation: "CompleteTask",
        operationId: completionRequest.operationId,
        retry: null
      })
    )
    expect((yield* Ref.get(harness.calls)).filter(({ _tag }) => _tag === "CloseIssue")).toEqual([
      { _tag: "CloseIssue", issueNodeId, operationId: completionRequest.operationId }
    ])
  })
)

it.effect("keeps focused read throttling in the read failure channel and never closes", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({ throttleFocusedRead: true })
    const failure = yield* Effect.gen(function* () {
      return yield* (yield* CompletionTaskBoundary)
        .readFocusedTaskCompletion(focusedRequest("throttled"))
        .pipe(Effect.flip)
    }).pipe(Effect.provide(harness.layer))

    expect(failure).toBeInstanceOf(FocusedTaskCompletionReadFailure)
    expect((yield* Ref.get(harness.calls)).filter(({ _tag }) => _tag === "ResolveIssue")).toHaveLength(1)
    expect((yield* Ref.get(harness.calls)).some(({ _tag }) => _tag === "CloseIssue")).toBe(false)
  })
)

it.effect("returns all unfinished prerequisite identities or no focused facts at all", () =>
  Effect.gen(function* () {
    const completeHarness = yield* makeHarness({ openPrerequisite: true, paginatedPrerequisites: true })
    yield* Effect.gen(function* () {
      const boundary = yield* CompletionTaskBoundary
      expect(yield* boundary.readFocusedTaskCompletion(focusedRequest("blocked"))).toMatchObject({
        unfinishedPrerequisiteTaskIds: [
          githubTaskIdFor(repositoryNodeId, prerequisiteNodeId),
          githubTaskIdFor(repositoryNodeId, secondPrerequisiteNodeId)
        ]
      })
    }).pipe(Effect.provide(completeHarness.layer))

    const malformedHarness = yield* makeHarness({ focusedReadFault: "MalformedBlockedBy" })
    const failure = yield* Effect.gen(function* () {
      return yield* (yield* CompletionTaskBoundary)
        .readFocusedTaskCompletion(focusedRequest("malformed"))
        .pipe(Effect.flip)
    }).pipe(Effect.provide(malformedHarness.layer))
    expect(failure).toBeInstanceOf(FocusedTaskCompletionReadFailure)
    expect((yield* Ref.get(malformedHarness.calls)).some(({ _tag }) => _tag === "CloseIssue")).toBe(false)
  })
)

it.effect("proves focused target membership without publishing a complete Run graph", () =>
  Effect.gen(function* () {
    const memberHarness = yield* makeHarness({ taskAsChild: true, targetRootNodeId: rootNodeId })
    const member = yield* Effect.gen(function* () {
      return yield* (yield* CompletionTaskBoundary).readFocusedTaskCompletion(focusedRequest("child-member"))
    }).pipe(Effect.provide(memberHarness.layer))
    expect(member.targetMembership).toBe("Member")

    const nonmemberHarness = yield* makeHarness({ targetRootNodeId: rootNodeId })
    const nonmember = yield* Effect.gen(function* () {
      return yield* (yield* CompletionTaskBoundary).readFocusedTaskCompletion(focusedRequest("nonmember"))
    }).pipe(Effect.provide(nonmemberHarness.layer))
    expect(nonmember.targetMembership).toBe("NotMember")
  })
)

it.effect("fails every incomplete focused GitHub read without publishing facts or closing the task", () =>
  Effect.gen(function* () {
    const cases = [
      "ForeignTaskRepository",
      "InaccessibleBlockedBy",
      "MismatchedTaskIdentity",
      "MissingTask",
      "PartialBlockedBy",
      "UnsupportedTaskLifecycle"
    ] as const
    for (const focusedReadFault of cases) {
      const harness = yield* makeHarness({ focusedReadFault })
      const failure = yield* Effect.gen(function* () {
        return yield* (yield* CompletionTaskBoundary)
          .readFocusedTaskCompletion(focusedRequest(`failure-${focusedReadFault}`))
          .pipe(Effect.flip)
      }).pipe(Effect.provide(harness.layer))
      expect(failure).toBeInstanceOf(FocusedTaskCompletionReadFailure)
      expect((yield* Ref.get(harness.calls)).some(({ _tag }) => _tag === "CloseIssue")).toBe(false)
    }
  })
)

it.effect("rejects a non-GitHub task before sending CloseIssue", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness()
    const failure = yield* Effect.gen(function* () {
      return yield* (yield* CompletionTaskBoundary)
        .completeTask(integrationFinalityFixture.completionRequest)
        .pipe(Effect.flip)
    }).pipe(Effect.provide(harness.layer))
    expect(failure).toMatchObject({ outcome: "DefinitelyNotApplied" })
    expect((yield* Ref.get(harness.calls)).some(({ _tag }) => _tag === "CloseIssue")).toBe(false)
  })
)
