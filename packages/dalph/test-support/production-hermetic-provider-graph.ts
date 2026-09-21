import { GithubIssueNodeId, type GithubGraphqlRequest, type GithubRepositoryNodeId } from "@dalph/orchestrator"
import type { TaskWorkSpecification } from "@dalph/contracts"
import { Effect, MutableList, Ref, Schema } from "effect"

/** One provider graph relation read, retaining the root lifecycle at its boundary. */
export const HermeticProviderGraphObservation = Schema.Struct({
  issueNodeId: GithubIssueNodeId,
  relation: Schema.Literals(["ReadBlockedBy", "ReadSubIssues"]),
  rootLifecycle: Schema.Literals(["Open", "Completed"])
})
export type HermeticProviderGraphObservation = typeof HermeticProviderGraphObservation.Type

export interface HermeticProviderGraphState {
  readonly observations: MutableList.MutableList<HermeticProviderGraphObservation>
  readonly completeObservationCount: Ref.Ref<number>
  readonly observeRelation: (
    relation: HermeticProviderGraphObservation["relation"],
    issueNodeId: GithubIssueNodeId
  ) => Effect.Effect<void>
}

/**
 * Parent-resident graph state for the public fixture. The dependant is
 * eligible only after the complete relation traversal observes the root as
 * completed; this state never mutates the tracker or starts a second task.
 */
export const makeHermeticProviderGraph = Effect.fn("HermeticProviderGraph.make")(function* (
  rootIssueId: GithubIssueNodeId,
  dependantIssueId: GithubIssueNodeId,
  rootLifecycle: Ref.Ref<"Open" | "Completed">
) {
  const observations = MutableList.make<HermeticProviderGraphObservation>()
  const pending = yield* Ref.make<ReadonlyArray<HermeticProviderGraphObservation>>([])
  const completeObservationCount = yield* Ref.make(0)
  const expectedOrder = [
    { issueNodeId: rootIssueId, relation: "ReadBlockedBy" as const },
    { issueNodeId: rootIssueId, relation: "ReadSubIssues" as const },
    { issueNodeId: dependantIssueId, relation: "ReadBlockedBy" as const },
    { issueNodeId: dependantIssueId, relation: "ReadSubIssues" as const }
  ] as const
  const observeRelation = Effect.fn("HermeticProviderGraph.observeRelation")(function* (
    relation: HermeticProviderGraphObservation["relation"],
    issueNodeId: GithubIssueNodeId
  ) {
    const observation = HermeticProviderGraphObservation.make({
      issueNodeId,
      relation,
      rootLifecycle: yield* Ref.get(rootLifecycle)
    })
    MutableList.append(observations, observation)
    if (observation.rootLifecycle !== "Completed") return
    const current = yield* Ref.get(pending)
    const expected = expectedOrder[current.length]
    if (expected === undefined || expected.issueNodeId !== issueNodeId || expected.relation !== relation) {
      yield* Ref.set(pending, [])
      return
    }
    const next = [...current, observation]
    if (next.length === expectedOrder.length) {
      yield* Ref.update(completeObservationCount, (count) => count + 1)
      yield* Ref.set(pending, [])
    } else {
      yield* Ref.set(pending, next)
    }
  })
  return { observations, completeObservationCount, observeRelation } satisfies HermeticProviderGraphState
})

/** Graph-specific GraphQL responses remain separate from claims and lifecycle mutations. */
export const makeHermeticProviderGraphHandlers = (input: {
  readonly graph: HermeticProviderGraphState
  readonly rootIssueId: GithubIssueNodeId
  readonly dependantIssueId: GithubIssueNodeId
  readonly repositoryId: GithubRepositoryNodeId
  readonly lifecycle: Ref.Ref<"Open" | "Completed">
  readonly dependantLifecycle: Ref.Ref<"Open" | "Completed">
  readonly taskSpecification: Ref.Ref<TaskWorkSpecification>
  readonly dependantSpecification: TaskWorkSpecification
  readonly badRequest: (detail: string) => Effect.Effect<never, unknown>
}) => ({
  ReadIssue: (read: Extract<GithubGraphqlRequest, { readonly _tag: "ReadIssue" }>) =>
    Effect.gen(function* () {
      const state =
        read.issueNodeId === input.rootIssueId
          ? yield* Ref.get(input.lifecycle)
          : yield* Ref.get(input.dependantLifecycle)
      return {
        node: {
          __typename: "Issue" as const,
          id: read.issueNodeId,
          repository: { id: input.repositoryId },
          parent: read.issueNodeId === input.dependantIssueId ? { id: input.rootIssueId } : null,
          state: state === "Open" ? ("OPEN" as const) : ("CLOSED" as const),
          stateReason: state === "Open" ? null : ("COMPLETED" as const)
        }
      }
    }),
  ReadTaskWorkSpecification: (read: Extract<GithubGraphqlRequest, { readonly _tag: "ReadTaskWorkSpecification" }>) =>
    Effect.gen(function* () {
      const specification =
        read.issueNodeId === input.rootIssueId
          ? yield* Ref.get(input.taskSpecification)
          : read.issueNodeId === input.dependantIssueId
            ? input.dependantSpecification
            : yield* input.badRequest("foreign issue node")
      return {
        node: {
          __typename: "Issue" as const,
          id: read.issueNodeId,
          repository: { id: input.repositoryId },
          title: specification.title,
          body: specification.body
        }
      }
    }),
  ReadBlockedBy: (read: Extract<GithubGraphqlRequest, { readonly _tag: "ReadBlockedBy" }>) =>
    Effect.gen(function* () {
      yield* input.graph.observeRelation("ReadBlockedBy", read.issueNodeId)
      return {
        node: {
          __typename: "Issue" as const,
          id: read.issueNodeId,
          blockedBy: {
            nodes: read.issueNodeId === input.dependantIssueId ? [{ id: input.rootIssueId }] : [],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      }
    }),
  ReadSubIssues: (read: Extract<GithubGraphqlRequest, { readonly _tag: "ReadSubIssues" }>) =>
    Effect.gen(function* () {
      yield* input.graph.observeRelation("ReadSubIssues", read.issueNodeId)
      return {
        node: {
          __typename: "Issue" as const,
          id: read.issueNodeId,
          subIssues: {
            nodes: read.issueNodeId === input.rootIssueId ? [{ id: input.dependantIssueId }] : [],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      }
    })
})
