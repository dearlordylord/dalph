import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect"
import { it } from "@effect/vitest"
import { expect } from "vitest"
import { GitCommitSha, GitRepositoryLocator, IntegrationTarget, IntegrationTargetRef } from "@dalph/contracts"
import { TargetPromotionGitRequest } from "@dalph/orchestrator"
import { AuthoredCassetteStoryItem, AuthoredCausalWindow } from "../../src/cassettes/authored-domain.js"
import {
  AuthoredCassetteInteractionMismatch,
  AuthoredTargetPromotionCompareAndSetFailure,
  makeStoryCursor
} from "../../src/cassettes/authored-cursor.js"

const sha = (character: string): GitCommitSha => GitCommitSha.make(character.repeat(40))

const request = (
  candidate: string,
  expectedHead: string,
  repository: string,
  ref = "refs/heads/master"
): TargetPromotionGitRequest =>
  TargetPromotionGitRequest.make({
    candidateCommit: sha(candidate),
    expectedTargetHead: sha(expectedHead),
    integrationTarget: IntegrationTarget.make({
      ref: IntegrationTargetRef.make(ref),
      repository: GitRepositoryLocator.make(repository)
    })
  })

const applied = (promotionRequest: TargetPromotionGitRequest) =>
  AuthoredCassetteStoryItem.cases.TargetPromotionCompareAndSetReturned.make({
    request: promotionRequest,
    result: { _tag: "Applied" }
  })

const responseLost = (promotionRequest: TargetPromotionGitRequest) =>
  AuthoredCassetteStoryItem.cases.TargetPromotionCompareAndSetResponseLost.make({
    detail: "the exact Git response was lost",
    request: promotionRequest
  })

it.effect("consumes reverse-arriving CAS responses by exact request without imposing production order", () =>
  Effect.gen(function* () {
    const requestA = request("a", "1", "/repositories/a:b.git")
    const requestB = request("b", "1", "/repositories/a.git")
    const responseA = applied(requestA)
    const responseB = applied(requestB)
    const cursor = yield* makeStoryCursor([responseA, responseB], {
      causalWindows: [
        Schema.decodeUnknownSync(AuthoredCausalWindow)({
          startIndex: 0,
          endIndex: 2,
          occurrences: [
            { id: "cas-A", storyIndex: 0, predecessorIds: [] },
            { id: "cas-B", storyIndex: 1, predecessorIds: [] }
          ]
        })
      ]
    })

    expect(yield* cursor.consumeTargetPromotionCompareAndSet(requestB)).toEqual(responseB)
    expect(yield* cursor.consumeTargetPromotionCompareAndSet(requestA)).toEqual(responseA)
  })
)

it.effect("does not collapse separator-containing target requests into one CAS correlation", () =>
  Effect.gen(function* () {
    const recorded = request("a", "1", "/repositories/a:b.git")
    const foreign = request("a", "1", "/repositories/a.git")
    const cursor = yield* makeStoryCursor([applied(recorded)])
    const exit = yield* cursor.consumeTargetPromotionCompareAndSet(foreign).pipe(Effect.exit)

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain(AuthoredCassetteInteractionMismatch.name)
    }
  })
)

it.effect("returns the typed failure only for the exact lost CAS request", () =>
  Effect.gen(function* () {
    const recorded = request("a", "1", "/repositories/a:b.git")
    const foreign = request("a", "1", "/repositories/a.git")
    const cursor = yield* makeStoryCursor([responseLost(recorded)])

    const foreignExit = yield* cursor.consumeTargetPromotionCompareAndSet(foreign).pipe(Effect.exit)
    expect(Exit.isFailure(foreignExit)).toBe(true)
    if (Exit.isFailure(foreignExit)) {
      expect(Cause.pretty(foreignExit.cause)).toContain(AuthoredCassetteInteractionMismatch.name)
    }

    const exactExit = yield* cursor.consumeTargetPromotionCompareAndSet(recorded).pipe(Effect.exit)
    expect(Exit.isFailure(exactExit)).toBe(true)
    if (Exit.isFailure(exactExit)) {
      expect(Cause.pretty(exactExit.cause)).toContain(AuthoredTargetPromotionCompareAndSetFailure.name)
    }
  })
)

it.effect("allows sequential identical requests after the first response is consumed", () =>
  Effect.gen(function* () {
    const recorded = request("a", "1", "/repositories/a:b.git")
    const first = applied(recorded)
    const second = applied(recorded)
    const cursor = yield* makeStoryCursor([first, second])

    expect(yield* cursor.consumeTargetPromotionCompareAndSet(recorded)).toEqual(first)
    expect(yield* cursor.consumeTargetPromotionCompareAndSet(recorded)).toEqual(second)
  })
)

it.effect("fails closed when two consumers try the same CAS request concurrently", () =>
  Effect.gen(function* () {
    const recorded = request("a", "1", "/repositories/a:b.git")
    const response = applied(recorded)
    const firstClaimed = yield* Deferred.make<void>()
    const releaseFirst = yield* Deferred.make<void>()
    const cursor = yield* makeStoryCursor([response], {
      onOccurrence: () => Deferred.succeed(firstClaimed, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst)))
    })
    const first = yield* cursor.consumeTargetPromotionCompareAndSet(recorded).pipe(Effect.forkChild)
    yield* Deferred.await(firstClaimed)

    const duplicate = yield* cursor.consumeTargetPromotionCompareAndSet(recorded).pipe(Effect.exit)
    expect(Exit.isFailure(duplicate)).toBe(true)
    if (Exit.isFailure(duplicate)) {
      expect(Cause.pretty(duplicate.cause)).toContain("already in flight")
    }
    yield* Deferred.succeed(releaseFirst, undefined)
    expect(yield* Fiber.join(first)).toEqual(response)
  })
)
