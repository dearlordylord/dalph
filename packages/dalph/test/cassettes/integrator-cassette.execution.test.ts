import { it } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { TaskId } from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  JournalPosition,
  JournalRecord,
  JournalRecordKey,
  OperationId,
  TaskClaimAcquiredEvent,
  workflowJournalEventVersion,
  type WorkflowJournalEvent
} from "@dalph/orchestrator"
import {
  IntegratorCandidateGitObservedEvent,
  IntegratorCandidateGitReadIntendedEvent,
  IntegratorResultRecordedEvent
} from "../../../orchestrator/src/workflow/protocols/integrator/events.js"
import {
  givesOneExactSessionToTheIntegratorAndQualifiesItsReportedCandidate,
  AuthoredIntegratorGitResult,
  AuthoredIntegratorStoryItem,
  maintainedIntegratorCassetteCatalog,
  maintainedIntegratorFixture,
  recordedIntegratorCassetteFor,
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

  it.effect("automatically restores the same unfinished integration session after process loss", () =>
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

  it.effect("projects legacy Integrator records and omits unrelated journal events", () =>
    Effect.gen(function* () {
      const result = yield* run(givesOneExactSessionToTheIntegratorAndQualifiesItsReportedCandidate)
      const resultRecord = result.records.find(({ event }) => event._tag === "IntegratorRunResultRecorded")
      const observedRecord = result.records.find(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")
      if (
        resultRecord?.event._tag !== "IntegratorRunResultRecorded" ||
        observedRecord?.event._tag !== "IntegratorRunCandidateGitObserved"
      ) {
        return yield* Effect.die("the exact Integrator fixture lacks run-bound result and Git observation")
      }

      const correlation = resultRecord.event.result.correlation
      const legacyResult = IntegratorResultRecordedEvent.make({
        result: resultRecord.event.result,
        version: workflowJournalEventVersion
      })
      const legacyRead = IntegratorCandidateGitReadIntendedEvent.make({
        candidateText: observedRecord.event.candidateText,
        correlation,
        version: workflowJournalEventVersion
      })
      const legacyObservation = IntegratorCandidateGitObservedEvent.make({
        candidateText: observedRecord.event.candidateText,
        correlation,
        observation: observedRecord.event.observation,
        version: workflowJournalEventVersion
      })
      const unrelated = TaskClaimAcquiredEvent.make({
        claim: ActiveTaskClaim.make({
          operationId: OperationId.make("integrator-cassette-unrelated-operation"),
          owner: ClaimOwner.make("integrator-cassette-test"),
          taskId: TaskId.make("integrator-cassette-unrelated-task"),
          token: ClaimToken.make("integrator-cassette-unrelated-token")
        }),
        version: workflowJournalEventVersion
      })
      const recordFor = (event: WorkflowJournalEvent, position: number) =>
        JournalRecord.make({
          event,
          key: JournalRecordKey.make(`integrator-cassette-coverage:${position}`),
          position: JournalPosition.make(position),
          runId: result.cassette.startingFacts.responsibility.plannedAttempt.runId
        })

      const projected = recordedIntegratorCassetteFor("legacy Integrator projection", [
        recordFor(legacyResult, 20),
        recordFor(legacyRead, 21),
        recordFor(legacyObservation, 22),
        recordFor(unrelated, 23)
      ])
      expect(projected.entries.map(({ _tag }) => _tag)).toEqual([
        "IntegratorResultRecorded",
        "IntegratorCandidateGitReadIntended",
        "IntegratorCandidateGitObserved"
      ])
      expect(projected.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ _tag: "IntegratorResultRecorded", result: resultRecord.event.result }),
          expect.objectContaining({ _tag: "IntegratorCandidateGitReadIntended", correlation }),
          expect.objectContaining({ _tag: "IntegratorCandidateGitObserved", correlation })
        ])
      )
    })
  )

  it.effect("fails closed when scripted Integrator or Git observations are unavailable", () =>
    Effect.gen(function* () {
      const base = givesOneExactSessionToTheIntegratorAndQualifiesItsReportedCandidate
      const exhausted = yield* Effect.exit(
        run({ ...base, integratorResults: [], story: [AuthoredIntegratorStoryItem.cases.Invoke.make({})] })
      )
      expect(exhausted._tag).toBe("Failure")

      const readLost = yield* Effect.exit(
        run({
          ...base,
          gitResults: [AuthoredIntegratorGitResult.cases.ReadLost.make({ detail: "candidate read was lost" })]
        })
      )
      expect(readLost._tag).toBe("Failure")

      const missing = yield* Effect.exit(
        run({
          ...base,
          gitResults: [
            AuthoredIntegratorGitResult.cases.Missing.make({ candidateText: maintainedIntegratorFixture.candidateText })
          ]
        })
      )
      expect(missing._tag).toBe("Failure")
    })
  )

  it.effect("rejects a terminal assertion without a matching observation or assertion", () =>
    Effect.gen(function* () {
      const base = givesOneExactSessionToTheIntegratorAndQualifiesItsReportedCandidate
      const mismatched = yield* Effect.exit(
        run({
          ...base,
          story: base.story.map((item) =>
            item._tag === "Assert"
              ? AuthoredIntegratorStoryItem.cases.Assert.make({ expected: { ...item.expected, stateTag: "Absent" } })
              : item
          )
        })
      )
      expect(mismatched._tag).toBe("Failure")

      const withoutAssertion = yield* Effect.exit(
        run({ ...base, story: [AuthoredIntegratorStoryItem.cases.Invoke.make({})] })
      )
      expect(withoutAssertion._tag).toBe("Failure")
    })
  )
})
