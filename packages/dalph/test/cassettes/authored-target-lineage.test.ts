import { it } from "@effect/vitest"
import { Cause, Effect, Exit } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef
} from "@dalph/contracts"
import { GitTargetLineageReadFailure, TargetLineageObservation } from "@dalph/orchestrator"
import { makeAuthoredAttemptTargetLineage } from "../../src/cassettes/authored-target-lineage.js"

const baseA = GitCommitSha.make("1".repeat(40))
const baseB = GitCommitSha.make("2".repeat(40))
const headA = GitCommitSha.make("a".repeat(40))
const headB = GitCommitSha.make("b".repeat(40))
const attemptA = AttemptId.make("attempt:A:0")
const attemptB = AttemptId.make("attempt:B:replacement:1")
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/authored-lineage.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const observation = (plannedBaseSha: GitCommitSha, targetHeadSha: GitCommitSha) =>
  TargetLineageObservation.make({ plannedBaseIsAncestorOfTargetHead: true, plannedBaseSha, targetHeadSha })

for (const order of [
  [attemptA, attemptB],
  [attemptB, attemptA]
])
  it.effect(`binds independent lineage reads by exact attempt in ${order.join(" then ")} order`, () =>
    Effect.gen(function* () {
      const authored = yield* makeAuthoredAttemptTargetLineage([
        { attemptId: attemptA, observations: [observation(baseA, headA)] },
        { attemptId: attemptB, observations: [observation(baseB, headB)] }
      ])
      for (const attemptId of order) {
        const actual = yield* authored.forAttempt(attemptId).read(attemptId === attemptA ? baseA : baseB, target)
        expect(actual.targetHeadSha).toBe(attemptId === attemptA ? headA : headB)
      }
      const duplicate = yield* Effect.flip(authored.forAttempt(attemptA).read(baseA, target))
      expect(duplicate).toBeInstanceOf(GitTargetLineageReadFailure)
      expect(duplicate.detail).toContain("no authored target-lineage response remains")
    })
  )

it.effect("rejects a wrong Base without consuming the exact attempt response", () =>
  Effect.gen(function* () {
    const authored = yield* makeAuthoredAttemptTargetLineage([
      { attemptId: attemptA, observations: [observation(baseA, headA)] }
    ])
    const failure = yield* Effect.flip(authored.forAttempt(attemptA).read(baseB, target))
    expect(failure).toBeInstanceOf(GitTargetLineageReadFailure)
    const incomplete = yield* Effect.exit(authored.assertExhausted)
    expect(Exit.isFailure(incomplete)).toBe(true)
    if (Exit.isFailure(incomplete)) expect(Cause.pretty(incomplete.cause)).toContain(String(attemptA))
    expect((yield* authored.forAttempt(attemptA).read(baseA, target)).targetHeadSha).toBe(headA)
    yield* authored.assertExhausted
  })
)

it.effect("keeps same-Base reads with different heads owned by their exact attempts", () =>
  Effect.gen(function* () {
    const authored = yield* makeAuthoredAttemptTargetLineage([
      { attemptId: attemptA, observations: [observation(baseA, headA)] },
      { attemptId: attemptB, observations: [observation(baseA, headB)] }
    ])
    expect((yield* authored.forAttempt(attemptB).read(baseA, target)).targetHeadSha).toBe(headB)
    expect((yield* authored.forAttempt(attemptA).read(baseA, target)).targetHeadSha).toBe(headA)
    yield* authored.assertExhausted
  })
)
