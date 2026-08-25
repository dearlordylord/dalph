import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect } from "effect"
import { expect } from "vitest"
import { maintainedAuthoredCassetteCatalog, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"

const capstoneTimeout = 600_000
const cachedRun = Effect.runSync(
  Effect.cached(
    runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryInvariantStoryCapstone).pipe(
      Effect.provide(NodeCrypto.layer)
    )
  )
)

it.effect(
  "executes DS01 through DS13 in one maintained chronology",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedRun
      expect(run.cassette.story.at(-1)?._tag).toBe("ExpectedBehavior")

      const storyTags = run.cassette.story.map(({ _tag }) => _tag)
      expect(storyTags).toContain("InitialControlPolicy")
      expect(storyTags).toContain("SetTaskExecutionCapacity")
      expect(storyTags.filter((tag) => tag === "CoordinatorProcessDies").length).toBeGreaterThanOrEqual(2)
      expect(storyTags).toContain("OperatorContinuesAttempt")
      expect(storyTags).toContain("OperatorAppliesIntegrationQuarantineDirection")
      expect(storyTags).toContain("CompletionClaimDeletionApplied")
    }),
  capstoneTimeout
)

it.effect(
  "executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedRun
      const events = run.records.map(({ event }) => event)
      const at = (tag: string) => events.findIndex((event) => event._tag === tag)
      const all = (tag: string) => events.filter((event) => event._tag === tag)

      const stale = all("TargetPromotionStale")
      const quarantines = all("IntegrationQuarantined").filter(
        (event) => event._tag === "IntegrationQuarantined" && event.basis._tag === "PromotionStale"
      )
      const directions = all("IntegrationQuarantineDirectionApplied")
      const successors = all("IntegratorSuccessorSessionFixed")
      const candidateObservations = all("IntegratorRunCandidateGitObserved")
      const promotions = all("TargetPromotionObservedSuccess")

      expect(stale).toHaveLength(1)
      expect(quarantines).toHaveLength(1)
      expect(directions).toHaveLength(1)
      expect(successors).toHaveLength(1)
      expect(promotions).toHaveLength(1)
      expect(all("CompletionTaskAcknowledged")).toHaveLength(1)
      expect(all("CompletionClaimReplaced")).toHaveLength(1)
      expect(all("CompletionClaimDeleted")).toHaveLength(1)
      expect(all("IntegrationFinalitySettled")).toHaveLength(1)

      const successor = successors[0]
      const predecessor = successor?._tag === "IntegratorSuccessorSessionFixed" ? successor.predecessor : undefined
      const successorCorrelation =
        successor?._tag === "IntegratorSuccessorSessionFixed" ? successor.successor : undefined
      expect(predecessor?.sessionId).toBeDefined()
      expect(successorCorrelation?.sessionId).toBeDefined()
      expect(successorCorrelation?.sessionId).not.toBe(predecessor?.sessionId)
      expect(successorCorrelation?.expectedTargetHead).toBe("2222222222222222222222222222222222222222")

      const successorCandidate = candidateObservations.find(
        (event) =>
          event._tag === "IntegratorRunCandidateGitObserved" &&
          event.observation._tag === "Commit" &&
          event.observation.commit === "dddddddddddddddddddddddddddddddddddddddd"
      )
      expect(successorCandidate?._tag).toBe("IntegratorRunCandidateGitObserved")
      if (
        successorCandidate?._tag === "IntegratorRunCandidateGitObserved" &&
        successorCandidate.observation._tag === "Commit"
      ) {
        expect(successorCandidate.observation.directParents).toEqual([
          "2222222222222222222222222222222222222222",
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        ])
      }

      expect(at("TargetPromotionStale")).toBeLessThan(at("IntegrationQuarantined"))
      expect(at("IntegrationQuarantined")).toBeLessThan(at("IntegrationQuarantineDirectionApplied"))
      expect(at("IntegrationQuarantineDirectionApplied")).toBeLessThan(at("IntegratorSuccessorSessionFixed"))
      expect(at("IntegratorSuccessorSessionFixed")).toBeLessThan(at("TargetPromotionObservedSuccess"))
      expect(at("TargetPromotionObservedSuccess")).toBeLessThan(at("CompletionClaimReplaced"))
      expect(at("CompletionClaimReplaced")).toBeLessThan(at("CompletionTaskAcknowledged"))
      expect(at("CompletionTaskAcknowledged")).toBeLessThan(at("CompletionClaimDeleted"))
      expect(at("CompletionClaimDeleted")).toBeLessThan(at("IntegrationFinalitySettled"))
    }),
  capstoneTimeout
)
