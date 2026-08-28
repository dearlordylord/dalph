import { NodeCrypto } from "@effect/platform-node"
import { PlannedAttemptExecutor, PlannedTaskAttempt } from "@dalph/contracts"
import { expect, it } from "@effect/vitest"
import { Context, Crypto, Effect, Layer, Option, Ref } from "effect"
import { expectTypeOf } from "vitest"
import { GitCommand } from "../../git/command.js"
import { ActiveTaskClaim, TaskClaimAcquisition, TrackerMutation } from "../claim-mutation.js"
import { TrackerGraphReader, TestTrackerGraphReader } from "../graph-reader.js"
import { TaskWorkCapacityControl } from "../../../control/task-work-capacity.js"
import { TraceReader } from "../../../presentation/trace-reader.js"
import { EvidenceStore } from "../../../workflow/protocols/evidence-store.js"
import { CompletionClaimBoundary } from "../../../workflow/protocols/integration-finality/completion-claim.js"
import {
  CompletionTaskBoundary,
  CompletionTaskClaim,
  completionClaimReadRequestFor,
  completionTaskRequestFor,
  focusedTaskCompletionReadRequestFor
} from "../../../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture } from "../../../workflow/protocols/integration-finality/fixtures.js"
import { Integrator } from "../../../workflow/protocols/integrator/protocol.js"
import { IntegratorRunQualifiedCandidate } from "../../../workflow/protocols/integrator/events.js"
import { targetPromotionCorrelationFor } from "../../../workflow/protocols/target-promotion/events.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { OperationId } from "../../../workflow/identity.js"
import { runTaskClaimAcquisitionProtocol } from "../../../workflow/protocols/task-claim-acquisition/protocol.js"
import { ClaimOwner, ClaimToken } from "../claim.js"
import { githubTrackerMutationLayer } from "./claim-mutation.js"
import { githubCompletionClaimBoundaryLayer } from "./completion-claim.js"
import { githubCompletionTaskBoundaryLayer } from "./completion-task.js"
import { githubDeliveryAuthorityLayer } from "./delivery-authority.js"
import { githubTrackerGraphReaderLayer } from "./graph-reader.js"
import {
  GithubGraphqlClient,
  type GithubGraphqlRequest,
  GithubGraphqlRequestError,
  GithubIssueNodeId,
  type GithubLabelName,
  GithubLabelNodeId,
  GithubRepositoryNodeId
} from "./graphql-client.js"
import { githubGraphqlTestClient } from "./graphql-client.test-fixture.js"
import { githubTaskIdFor } from "./task-identity.js"
import { GithubIssueNumber, GithubIssueTarget, GithubRepositoryName, GithubRepositoryOwner } from "./target.js"

const repositoryNodeId = GithubRepositoryNodeId.make("delivery-authority-repository")
const issueNodeId = GithubIssueNodeId.make("delivery-authority-issue")
const taskId = githubTaskIdFor(repositoryNodeId, issueNodeId)
const target = GithubIssueTarget.make({
  issueNumber: GithubIssueNumber.make(285),
  owner: GithubRepositoryOwner.make("dalph-test"),
  repository: GithubRepositoryName.make("delivery-authority")
})
const plannedAttempt = PlannedTaskAttempt.make({ ...integrationFinalityFixture.plannedAttempt, taskId })
const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
  ...integrationFinalityFixture.qualifiedCandidate,
  run: {
    ...integrationFinalityFixture.qualifiedCandidate.run,
    session: { ...integrationFinalityFixture.qualifiedCandidate.run.session, plannedAttempt }
  }
})
const originalClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("delivery-authority-active-claim"),
  owner: ClaimOwner.make("delivery-authority-owner"),
  taskId,
  token: ClaimToken.make("delivery-authority-token")
})
const completionClaim = CompletionTaskClaim.make({
  originalClaim,
  plannedAttempt,
  promotionCorrelation: targetPromotionCorrelationFor(qualifiedCandidate)
})

const failingClientLayer = (requests: Ref.Ref<ReadonlyArray<GithubGraphqlRequest["_tag"]>>) =>
  Layer.succeed(
    GithubGraphqlClient,
    githubGraphqlTestClient(
      Effect.fn("GithubDeliveryAuthorityTest.SharedClient.execute")(function* (request: GithubGraphqlRequest) {
        yield* Ref.update(requests, (current) => [...current, request._tag])
        return yield* new GithubGraphqlRequestError({ detail: "one injected GitHub client", operation: request._tag })
      })
    )
  )

const withDependencies = <A, E, R>(layer: Layer.Layer<A, E, R>, clientLayer: Layer.Layer<GithubGraphqlClient>) =>
  layer.pipe(Layer.provide(clientLayer), Layer.provide(NodeCrypto.layer))

it("declares exact outputs and requirements for every GitHub delivery authority Layer", () => {
  expectTypeOf<Layer.Success<typeof githubTrackerGraphReaderLayer>>().toEqualTypeOf<TrackerGraphReader>()
  expectTypeOf<Layer.Error<typeof githubTrackerGraphReaderLayer>>().toEqualTypeOf<never>()
  expectTypeOf<Layer.Services<typeof githubTrackerGraphReaderLayer>>().toEqualTypeOf<GithubGraphqlClient>()

  expectTypeOf<Layer.Success<typeof githubTrackerMutationLayer>>().toEqualTypeOf<TrackerMutation>()
  expectTypeOf<Layer.Error<typeof githubTrackerMutationLayer>>().toEqualTypeOf<never>()
  expectTypeOf<Layer.Services<typeof githubTrackerMutationLayer>>().toEqualTypeOf<GithubGraphqlClient | Crypto.Crypto>()

  expectTypeOf<Layer.Success<typeof githubCompletionClaimBoundaryLayer>>().toEqualTypeOf<CompletionClaimBoundary>()
  expectTypeOf<Layer.Error<typeof githubCompletionClaimBoundaryLayer>>().toEqualTypeOf<never>()
  expectTypeOf<Layer.Services<typeof githubCompletionClaimBoundaryLayer>>().toEqualTypeOf<
    GithubGraphqlClient | Crypto.Crypto
  >()

  expectTypeOf<Layer.Success<typeof githubCompletionTaskBoundaryLayer>>().toEqualTypeOf<CompletionTaskBoundary>()
  expectTypeOf<Layer.Error<typeof githubCompletionTaskBoundaryLayer>>().toEqualTypeOf<never>()
  expectTypeOf<Layer.Services<typeof githubCompletionTaskBoundaryLayer>>().toEqualTypeOf<
    GithubGraphqlClient | CompletionClaimBoundary
  >()

  expectTypeOf<Layer.Success<typeof githubDeliveryAuthorityLayer>>().toEqualTypeOf<
    TrackerGraphReader | TrackerMutation | CompletionClaimBoundary | CompletionTaskBoundary
  >()
  expectTypeOf<Layer.Error<typeof githubDeliveryAuthorityLayer>>().toEqualTypeOf<never>()
  expectTypeOf<Layer.Services<typeof githubDeliveryAuthorityLayer>>().toEqualTypeOf<
    GithubGraphqlClient | Crypto.Crypto
  >()
})

const expectForbiddenCapabilitiesAbsent = <A>(context: Context.Context<A>) => {
  expect(Context.getOption(context, GithubGraphqlClient)).toSatisfy(Option.isNone)
  expect(Context.getOption(context, Crypto.Crypto)).toSatisfy(Option.isNone)
  expect(Context.getOption(context, TestTrackerGraphReader)).toSatisfy(Option.isNone)
  expect(Context.getOption(context, JournalStore)).toSatisfy(Option.isNone)
  expect(Context.getOption(context, GitCommand)).toSatisfy(Option.isNone)
  expect(Context.getOption(context, PlannedAttemptExecutor)).toSatisfy(Option.isNone)
  expect(Context.getOption(context, Integrator)).toSatisfy(Option.isNone)
  expect(Context.getOption(context, EvidenceStore)).toSatisfy(Option.isNone)
  expect(Context.getOption(context, TraceReader)).toSatisfy(Option.isNone)
  expect(Context.getOption(context, TaskWorkCapacityControl)).toSatisfy(Option.isNone)
}

it.effect("exposes only each individual GitHub tracker capability at runtime", () =>
  Effect.gen(function* () {
    const requests = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest["_tag"]>>([])
    const clientLayer = failingClientLayer(requests)
    const graph = yield* Layer.build(withDependencies(githubTrackerGraphReaderLayer, clientLayer))
    const mutation = yield* Layer.build(withDependencies(githubTrackerMutationLayer, clientLayer))
    const claims = yield* Layer.build(withDependencies(githubCompletionClaimBoundaryLayer, clientLayer))
    const completion = yield* Layer.build(
      withDependencies(
        githubCompletionTaskBoundaryLayer.pipe(Layer.provide(githubCompletionClaimBoundaryLayer)),
        clientLayer
      )
    )

    expect(Context.getOption(graph, TrackerGraphReader)).toSatisfy(Option.isSome)
    expect(Context.getOption(graph, TrackerMutation)).toSatisfy(Option.isNone)
    expect(Context.getOption(graph, CompletionClaimBoundary)).toSatisfy(Option.isNone)
    expect(Context.getOption(graph, CompletionTaskBoundary)).toSatisfy(Option.isNone)
    expectForbiddenCapabilitiesAbsent(graph)

    expect(Context.getOption(mutation, TrackerGraphReader)).toSatisfy(Option.isNone)
    expect(Context.getOption(mutation, TrackerMutation)).toSatisfy(Option.isSome)
    expect(Context.getOption(mutation, CompletionClaimBoundary)).toSatisfy(Option.isNone)
    expect(Context.getOption(mutation, CompletionTaskBoundary)).toSatisfy(Option.isNone)
    expectForbiddenCapabilitiesAbsent(mutation)

    expect(Context.getOption(claims, TrackerGraphReader)).toSatisfy(Option.isNone)
    expect(Context.getOption(claims, TrackerMutation)).toSatisfy(Option.isNone)
    expect(Context.getOption(claims, CompletionClaimBoundary)).toSatisfy(Option.isSome)
    expect(Context.getOption(claims, CompletionTaskBoundary)).toSatisfy(Option.isNone)
    expectForbiddenCapabilitiesAbsent(claims)

    expect(Context.getOption(completion, TrackerGraphReader)).toSatisfy(Option.isNone)
    expect(Context.getOption(completion, TrackerMutation)).toSatisfy(Option.isNone)
    expect(Context.getOption(completion, CompletionClaimBoundary)).toSatisfy(Option.isNone)
    expect(Context.getOption(completion, CompletionTaskBoundary)).toSatisfy(Option.isSome)
    expectForbiddenCapabilitiesAbsent(completion)
    expect(yield* Ref.get(requests)).toEqual([])
  })
)

it.effect(
  "routes all four composed services through exactly one injected GitHub client without a controlled fallback",
  () =>
    Effect.gen(function* () {
      const requests = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest["_tag"]>>([])
      const context = yield* Layer.build(withDependencies(githubDeliveryAuthorityLayer, failingClientLayer(requests)))
      const graph = Context.get(context, TrackerGraphReader)
      const mutation = Context.get(context, TrackerMutation)
      const claims = Context.get(context, CompletionClaimBoundary)
      const completion = Context.get(context, CompletionTaskBoundary)

      yield* Effect.all(
        [
          graph.readTaskWorkSpecification(target, taskId).pipe(Effect.flip),
          mutation.readTaskClaim(taskId).pipe(Effect.flip),
          claims.readCompletionClaimMarker(completionClaimReadRequestFor(completionClaim)).pipe(Effect.flip),
          completion
            .readFocusedTaskCompletion(
              focusedTaskCompletionReadRequestFor(
                completionTaskRequestFor(completionClaim),
                target,
                OperationId.make("delivery-authority-focused-read")
              )
            )
            .pipe(Effect.flip)
        ],
        { concurrency: 1 }
      )

      expect(yield* Ref.get(requests)).toEqual(["ResolveIssue", "FindClaimLabel", "FindClaimLabel", "ResolveIssue"])
      expect(Context.getOption(context, TrackerGraphReader)).toSatisfy(Option.isSome)
      expect(Context.getOption(context, TrackerMutation)).toSatisfy(Option.isSome)
      expect(Context.getOption(context, CompletionClaimBoundary)).toSatisfy(Option.isSome)
      expect(Context.getOption(context, CompletionTaskBoundary)).toSatisfy(Option.isSome)
      expectForbiddenCapabilitiesAbsent(context)
    })
)

it.effect("uses the mandatory final read after the third ambiguous claim create and never sends a fourth create", () =>
  Effect.gen(function* () {
    const requests = yield* Ref.make<ReadonlyArray<GithubGraphqlRequest["_tag"]>>([])
    const created = yield* Ref.make<null | {
      readonly description: string
      readonly id: GithubLabelNodeId
      readonly name: GithubLabelName
    }>(null)
    const createCount = yield* Ref.make(0)
    const client = githubGraphqlTestClient(
      Effect.fn("GithubDeliveryAuthorityTest.ThirdAmbiguousCreate.execute")(function* (request: GithubGraphqlRequest) {
        yield* Ref.update(requests, (current) => [...current, request._tag])
        if (request._tag === "FindClaimLabel") {
          return { body: { data: { node: { id: repositoryNodeId, label: yield* Ref.get(created) } } } }
        }
        if (request._tag === "CreateClaimLabel") {
          const ordinal = yield* Ref.updateAndGet(createCount, (count) => count + 1)
          if (ordinal === 3) {
            yield* Ref.set(created, {
              description: request.description,
              id: GithubLabelNodeId.make("delivery-authority-third-create-label"),
              name: request.labelName
            })
          }
          return yield* new GithubGraphqlRequestError({
            detail: `ambiguous controlled create ${ordinal}`,
            operation: request._tag
          })
        }
        return yield* Effect.die(`unexpected final-read protocol request ${request._tag}`)
      })
    )
    const context = yield* Layer.build(
      withDependencies(githubDeliveryAuthorityLayer, Layer.succeed(GithubGraphqlClient, client))
    )
    const mutation = Context.get(context, TrackerMutation)
    const acquisition = TaskClaimAcquisition.make({
      operationId: OperationId.make("third-create"),
      owner: ClaimOwner.make("third-owner"),
      taskId,
      token: ClaimToken.make("third-token")
    })

    const result = yield* runTaskClaimAcquisitionProtocol(mutation, acquisition).pipe(Effect.result)
    expect(yield* Ref.get(requests)).toEqual([
      "FindClaimLabel",
      "CreateClaimLabel",
      "FindClaimLabel",
      "CreateClaimLabel",
      "FindClaimLabel",
      "CreateClaimLabel",
      "FindClaimLabel"
    ])
    expect(yield* Ref.get(createCount)).toBe(3)
    expect(result._tag).toBe("Success")
    if (result._tag === "Success") expect(result.success).toEqual(ActiveTaskClaim.make({ ...acquisition }))
  })
)
