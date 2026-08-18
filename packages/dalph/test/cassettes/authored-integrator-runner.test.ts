import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Cause, Effect, Exit, Schema } from "effect"
import { expect } from "vitest"
import {
  AuthoredScenarioCassette,
  maintainedAuthoredCassetteCatalog,
  runAuthoredScenarioCassette
} from "../../src/cassettes/index.js"

const targetHead = "1111111111111111111111111111111111111111"
const graph = maintainedAuthoredCassetteCatalog.candidateVerificationPassed.startingFacts.trackerGraph

const recoveryReads = [
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" } },
  { _tag: "TrackerGraphReadReturned" as const, graph },
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskClaim" as const, taskId: "A" } },
  { _tag: "TaskClaimCurrentReadReturned" as const, taskId: "A" }
]
const postIntegratorRecoveryRead = [
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" } },
  { _tag: "TrackerGraphReadReturned" as const, graph }
]

const interruptedCandidateCassette = (seam: "AfterResult" | "AfterGitIntent") => {
  const base = maintainedAuthoredCassetteCatalog.candidateVerificationPassed
  return Schema.decodeUnknownSync(AuthoredScenarioCassette)({
    ...base,
    name: `outer Integrator recovery ${seam}`,
    startingFacts: {
      ...base.startingFacts,
      targetLineageObservations: [
        { plannedBaseIsAncestorOfTargetHead: true, plannedBaseSha: targetHead, targetHeadSha: targetHead },
        { plannedBaseIsAncestorOfTargetHead: true, plannedBaseSha: targetHead, targetHeadSha: targetHead }
      ]
    },
    story: base.story.flatMap((item): ReadonlyArray<unknown> => {
      if (seam === "AfterResult" && item._tag === "IntegratorResultReturned") {
        return [item, { _tag: "CoordinatorProcessDies" as const }, ...recoveryReads]
      }
      if (seam === "AfterGitIntent" && item._tag === "IntegratorGitObservationReturned") {
        return [{ _tag: "CoordinatorProcessDies" as const }, ...recoveryReads, item, ...postIntegratorRecoveryRead]
      }
      if (item._tag === "IntegratorGitObservationReturned") return [item, ...postIntegratorRecoveryRead]
      return [item]
    })
  })
}

for (const seam of ["AfterResult", "AfterGitIntent"] as const) {
  it.effect(`reconstructs the same outer Integrator session after process loss at ${seam}`, () =>
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(interruptedCandidateCassette(seam)).pipe(
        Effect.provide(NodeCrypto.layer)
      )
      const tags = run.records.map(({ event }) => event._tag)

      expect(tags.filter((tag) => tag === "IntegratorSessionFixed")).toHaveLength(1)
      expect(tags.filter((tag) => tag === "IntegratorResultRecorded")).toHaveLength(1)
      expect(tags.filter((tag) => tag === "IntegratorCandidateGitReadIntended")).toHaveLength(1)
      expect(tags.filter((tag) => tag === "IntegratorCandidateGitObserved")).toHaveLength(1)
      expect(tags.filter((tag) => tag === "TargetLineageObserved")).toHaveLength(1)
    })
  )
}

it.effect("fails closed when authored Git returns a different candidate", () =>
  Effect.gen(function* () {
    const base = maintainedAuthoredCassetteCatalog.candidateVerificationPassed
    const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
      ...base,
      story: base.story.map((item) =>
        item._tag === "IntegratorGitObservationReturned"
          ? {
              ...item,
              candidateText: "refs/heads/different-candidate",
              observation: { ...item.observation, candidateText: "refs/heads/different-candidate" }
            }
          : item
      )
    })
    const exit = yield* Effect.exit(runAuthoredScenarioCassette(cassette).pipe(Effect.provide(NodeCrypto.layer)))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const rendered = Cause.pretty(exit.cause)
      expect(rendered).toContain("AuthoredCassetteInteractionMismatch")
      expect(rendered).not.toContain("IntegratorGitReadFailure")
    }
  })
)
