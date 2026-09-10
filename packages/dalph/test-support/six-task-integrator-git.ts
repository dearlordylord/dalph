import { Effect, Ref } from "effect"
import { IntegratorGit, type IntegratorCandidateText, type IntegratorRunCorrelation } from "@dalph/orchestrator"
import type { IntegrationTarget } from "@dalph/contracts"
import type { makeSixTaskDeliveryFacts } from "./six-task-delivery-facts.js"

/** Actual object-read arguments; the isolated resource belongs to Integrator.prepare, not this Git API. */
export interface SixTaskCandidateRead {
  readonly target: IntegrationTarget
  readonly candidateText: IntegratorCandidateText
}

export const makeSixTaskIntegratorGit = Effect.fn("SixTaskDelivery.makeIntegratorGit")(function* (
  integrations: Ref.Ref<ReadonlyArray<IntegratorRunCorrelation>>,
  facts: ReturnType<typeof makeSixTaskDeliveryFacts>
) {
  const candidateReads = yield* Ref.make<ReadonlyArray<SixTaskCandidateRead>>([])
  const git = IntegratorGit.of({
    readCandidate: (target, candidateText) =>
      Effect.gen(function* () {
        yield* Ref.update(candidateReads, (all) => [...all, { target, candidateText }])
        const run = (yield* Ref.get(integrations)).find(
          (run) => candidateText === `candidate:${run.session.plannedAttempt.taskId}`
        )
        if (run === undefined) return yield* Effect.die("unknown exact candidate")
        const task = facts.taskFactsById.get(run.session.plannedAttempt.taskId)
        if (task === undefined) return yield* Effect.die("candidate has no controlled task")
        return {
          _tag: "Commit" as const,
          candidateText,
          commit: task.candidateCommit,
          directParents: [run.session.expectedTargetHead, run.session.acceptedResult.commit]
        }
      })
  })
  return { candidateReads, git }
})
