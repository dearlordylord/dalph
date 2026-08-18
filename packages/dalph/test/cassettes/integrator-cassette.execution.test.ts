import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import {
  givesOneExactSessionToTheIntegratorAndQualifiesItsReportedCandidate,
  maintainedIntegratorCassetteCatalog,
  maintainedIntegratorFixture,
  rejectsAnInvalidReportedGitObject,
  retainsConclusiveNotPreparedWithoutInferringAResourceHead,
  restoresTheSameUnfinishedIntegratorSessionAfterProcessLoss,
  runMaintainedIntegratorCassette,
  stopsBeforeTheIntegratorWhenGitCannotProveCompatibleTargetLineage
} from "../../src/cassettes/index.js"

const catalogEntries = Object.entries(maintainedIntegratorCassetteCatalog)

const run = runMaintainedIntegratorCassette

describe("maintained outer Integrator cassettes", () => {
  for (const [key, cassette] of catalogEntries) {
    it.effect(`runs maintained Integrator cassette ${key} through the production protocol`, () => run(cassette))
  }

  it.effect("gives one exact session to the Integrator and qualifies its reported candidate", () =>
    run(givesOneExactSessionToTheIntegratorAndQualifiesItsReportedCandidate).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          const outcome = result.outcomes[0]
          expect(outcome?._tag).toBe("PreparedCandidate")
          if (outcome?._tag === "PreparedCandidate") {
            expect(outcome.candidateText).toBe(maintainedIntegratorFixture.candidateText)
            expect(outcome.candidateCommit).toBe(maintainedIntegratorFixture.candidateCommit)
            expect(outcome.directParents).toEqual([
              maintainedIntegratorFixture.targetHead,
              maintainedIntegratorFixture.acceptedCommit
            ])
          }
          const fixed = result.records.find(({ event }) => event._tag === "IntegratorSessionFixed")
          expect(fixed?.event._tag).toBe("IntegratorSessionFixed")
          if (fixed?.event._tag === "IntegratorSessionFixed") {
            expect(fixed.event.correlation.plannedAttempt.runId).toBe(maintainedIntegratorFixture.runId)
            expect(fixed.event.correlation.plannedAttempt.worktree).toBe(maintainedIntegratorFixture.worktree)
            expect(fixed.event.correlation.expectedTargetHead).toBe(maintainedIntegratorFixture.targetHead)
            expect(fixed.event.correlation.acceptedResult.commit).toBe(maintainedIntegratorFixture.acceptedCommit)
            expect(fixed.event.correlation.integrationTarget).toEqual(maintainedIntegratorFixture.integrationTarget)
          }
          expect(result.integratorCalls).toBe(1)
          expect(result.gitCalls).toBe(1)
          expect(result.records.map(({ event }) => event._tag)).toEqual([
            "IntegrationResponsibilityBegan",
            "IntegrationStarted",
            "GitReadIntentRecorded",
            "TargetLineageObserved",
            "IntegratorSessionFixed",
            "IntegratorRunStarted",
            "IntegratorRunResultRecorded",
            "IntegratorRunCandidateGitReadIntended",
            "IntegratorRunCandidateGitObserved"
          ])
        })
      )
    )
  )

  it.effect("restores the same unfinished Integrator session after process loss", () =>
    run(restoresTheSameUnfinishedIntegratorSessionAfterProcessLoss).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.outcomes.map(({ _tag }) => _tag)).toEqual(["Failure", "PreparedCandidate"])
          expect(result.integratorCalls).toBe(2)
          expect(result.gitCalls).toBe(1)
          expect(new Set(result.sessionIds)).toHaveLength(1)
          expect(new Set(result.candidateResources)).toHaveLength(1)
          expect(result.records.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
          expect(result.state._tag).toBe("GitQualifiedPrepared")
        })
      )
    )
  )

  it.effect("stops before the Integrator when Git cannot prove compatible target lineage", () =>
    run(stopsBeforeTheIntegratorWhenGitCannotProveCompatibleTargetLineage).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.integratorCalls).toBe(0)
          expect(result.gitCalls).toBe(0)
          expect(result.outcomes.map(({ _tag }) => _tag)).toEqual(["Failure"])
          expect(result.outcomes[0]).toEqual({ _tag: "Failure", tag: "IntegratorTargetLineageIncompatible" })
          expect(result.records.some(({ event }) => event._tag.startsWith("Integrator"))).toBe(false)
          expect(result.state._tag).toBe("Absent")
        })
      )
    )
  )

  it.effect("does not infer a candidate from resource head or process success", () =>
    run(retainsConclusiveNotPreparedWithoutInferringAResourceHead).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.outcomes).toEqual([
            { _tag: "NotPrepared", detail: maintainedIntegratorFixture.notPreparedDetail }
          ])
          expect(result.integratorCalls).toBe(1)
          expect(result.gitCalls).toBe(0)
          expect(result.gitCandidates).toEqual([])
          expect(result.records.map(({ event }) => event._tag)).toEqual([
            "IntegrationResponsibilityBegan",
            "IntegrationStarted",
            "GitReadIntentRecorded",
            "TargetLineageObserved",
            "IntegratorSessionFixed",
            "IntegratorRunStarted",
            "IntegratorRunResultRecorded"
          ])
        })
      )
    )
  )

  it.effect("rejects a reported candidate unless Git proves ordered parents H then C", () =>
    run(rejectsAnInvalidReportedGitObject).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          const outcome = result.outcomes[0]
          expect(outcome?._tag).toBe("CandidateRejected")
          if (outcome?._tag === "CandidateRejected") {
            expect(outcome.observation).toEqual({
              _tag: "NonCommit",
              candidateText: maintainedIntegratorFixture.candidateText,
              objectType: "tree"
            })
          }
          expect(result.state._tag).toBe("CandidateRejected")
          expect(result.gitCalls).toBe(1)
        })
      )
    )
  )

  it.effect("never exposes Integrator-private work as separate Dalph stages", () =>
    Effect.sync(() => {
      const publicStoryTags = new Set(["Invoke", "Restart", "Assert"])
      const forbiddenTerms = [
        "IntegrationCandidate",
        "TargetVerification",
        "CandidateAgent",
        "Correction",
        "Continuation"
      ]
      for (const cassette of catalogEntries.map(([, value]) => value)) {
        expect(cassette.story.every(({ _tag }) => publicStoryTags.has(_tag))).toBe(true)
        expect(JSON.stringify(cassette)).not.toMatch(
          /IntegrationCandidate|TargetVerification|CandidateAgent|Correction|Continuation/
        )
      }
      const recordedTags: ReadonlyArray<string> = catalogEntries.flatMap(([, cassette]) =>
        cassette.story.flatMap(({ _tag }) => _tag)
      )
      expect(forbiddenTerms.some((term) => recordedTags.includes(term))).toBe(false)
    })
  )
})
