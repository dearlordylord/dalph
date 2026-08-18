import { NodeCrypto } from "@effect/platform-node"
import { Effect, Schema } from "effect"
import { expect, it } from "vitest"
import {
  CassetteIdentityRenaming,
  RecordedCassette,
  foldRecordedCassette,
  invertCassetteIdentityRenaming,
  maintainedAuthoredCassetteCatalog,
  projectRecordedCassette,
  renameRecordedCassette,
  renderRecordedCassetteLyrics,
  runAuthoredScenarioCassette,
  verifyRecordedCassetteRoundTrip,
  verifyRecordedCassetteRoundTripWithRenaming
} from "../../src/cassettes/index.js"

it("records and round-trips every outer Integrator occurrence with causal correlation and renaming", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.candidateVerificationPassed)
      const recorded = yield* projectRecordedCassette(run.records)
      const outerRecords = run.records.filter(({ event }) => event._tag.startsWith("Integrator"))
      const outerEntries = recorded.entries.filter(({ _tag }) => _tag.startsWith("Integrator"))

      expect(outerRecords.map(({ event }) => event._tag)).toEqual([
        "IntegratorSessionFixed",
        "IntegratorResultRecorded",
        "IntegratorCandidateGitReadIntended",
        "IntegratorCandidateGitObserved"
      ])
      expect(outerEntries.map(({ _tag }) => _tag)).toEqual(outerRecords.map(({ event }) => event._tag))

      const fixed = outerRecords[0]?.event
      const result = outerRecords[1]?.event
      const readIntent = outerRecords[2]?.event
      const observed = outerRecords[3]?.event
      const recordedFixed = outerEntries[0]
      const recordedResult = outerEntries[1]
      const recordedReadIntent = outerEntries[2]
      const recordedObserved = outerEntries[3]
      if (
        fixed?._tag !== "IntegratorSessionFixed" ||
        result?._tag !== "IntegratorResultRecorded" ||
        readIntent?._tag !== "IntegratorCandidateGitReadIntended" ||
        observed?._tag !== "IntegratorCandidateGitObserved" ||
        recordedFixed?._tag !== "IntegratorSessionFixed" ||
        recordedResult?._tag !== "IntegratorResultRecorded" ||
        recordedReadIntent?._tag !== "IntegratorCandidateGitReadIntended" ||
        recordedObserved?._tag !== "IntegratorCandidateGitObserved"
      ) {
        return yield* Effect.die("outer Integrator records and entries are incomplete")
      }

      expect(recordedFixed.correlation).toEqual(fixed.correlation)
      expect(recordedFixed.correlation.queuedAt).toBe(fixed.correlation.queuedAt)
      expect(recordedFixed.correlation.startedAt).toBe(fixed.correlation.startedAt)
      expect(recordedFixed.correlation.targetLineageObservedAt).toBe(fixed.correlation.targetLineageObservedAt)
      expect(recordedResult.result).toEqual(result.result)
      expect(recordedReadIntent.candidateText).toBe(readIntent.candidateText)
      expect(recordedReadIntent.correlation).toEqual(readIntent.correlation)
      expect(recordedObserved.candidateText).toBe(observed.candidateText)
      expect(recordedObserved.correlation).toEqual(observed.correlation)
      expect(recordedObserved.observation).toEqual(observed.observation)

      expect(
        verifyRecordedCassetteRoundTrip(run.records, recorded).every(
          ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
            operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
        )
      ).toBe(true)
      expect(foldRecordedCassette(recorded)._tag).toBe("ValidWorkflowJournalHistory")

      const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [{ from: "attempt:A:0", to: "renamed-integrator-attempt" }],
        claimTokens: [],
        integrationCandidateIds: [],
        integrationCandidateResourceLocators: [
          { from: fixed.correlation.candidateResource, to: "renamed-integrator-resource" }
        ],
        integrationSessionIds: [{ from: fixed.correlation.sessionId, to: "renamed-integrator-session" }],
        operationIds: [],
        runIds: [{ from: run.runId, to: "renamed-integrator-run" }],
        taskBranchRefs: [{ from: "refs/heads/dalph/attempt-A-0", to: "refs/heads/dalph/renamed-integrator-attempt" }],
        worktreeLocators: [{ from: "/dalph/cassettes/attempt-A-0", to: "/dalph/cassettes/renamed-integrator-attempt" }]
      })
      const renamed = yield* renameRecordedCassette(recorded, renaming)
      const renamedFixed = renamed.entries.find(({ _tag }) => _tag === "IntegratorSessionFixed")
      if (renamedFixed?._tag !== "IntegratorSessionFixed") {
        return yield* Effect.die("renamed cassette lost IntegratorSessionFixed")
      }
      expect(renamedFixed.correlation.sessionId).toBe("renamed-integrator-session")
      expect(renamedFixed.correlation.candidateResource).toBe("renamed-integrator-resource")
      expect(renamedFixed.correlation.queuedAt).toBe(fixed.correlation.queuedAt)

      const originalHistory = foldRecordedCassette(recorded)
      if (originalHistory._tag !== "ValidWorkflowJournalHistory") {
        return yield* Effect.die("outer Integrator cassette must fold to valid history")
      }
      expect(
        (yield* verifyRecordedCassetteRoundTripWithRenaming(
          originalHistory.records,
          renamed,
          invertCassetteIdentityRenaming(renaming)
        )).every(
          ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
            operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
        )
      ).toBe(true)
      expect(renderRecordedCassetteLyrics(recorded)).toContain("Integrator")
      expect(renderRecordedCassetteLyrics(recorded)).toContain("explicitly reported candidate")
    }).pipe(Effect.provide(NodeCrypto.layer))
  )
})

it("records conclusive Integrator and Git rejection outcomes without a focused cassette", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      for (const cassette of [
        maintainedAuthoredCassetteCatalog.candidateVerificationFailure,
        maintainedAuthoredCassetteCatalog.candidateCorrectionExhaustion
      ]) {
        const run = yield* runAuthoredScenarioCassette(cassette)
        const recorded = yield* projectRecordedCassette(run.records)
        expect(recorded.entries.some(({ _tag }) => _tag === "IntegratorSessionFixed")).toBe(true)
        expect(recorded.entries.some(({ _tag }) => _tag === "IntegratorResultRecorded")).toBe(true)
        expect(
          verifyRecordedCassetteRoundTrip(run.records, recorded).every(
            ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
              operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
          )
        ).toBe(true)
      }
    }).pipe(Effect.provide(NodeCrypto.layer))
  )
})

it("preserves every Integrator, promotion, and finality projection under identity laws", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const emptyRenaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [],
        claimTokens: [],
        integrationCandidateIds: [],
        integrationCandidateResourceLocators: [],
        integrationSessionIds: [],
        operationIds: [],
        runIds: [],
        taskBranchRefs: [],
        worktreeLocators: []
      })
      const cases = [
        { cassette: maintainedAuthoredCassetteCatalog.candidateVerificationPassed, roundTrip: true },
        { cassette: maintainedAuthoredCassetteCatalog.candidateVerificationFailure, roundTrip: true },
        { cassette: maintainedAuthoredCassetteCatalog.candidateCorrectionExhaustion, roundTrip: true },
        { cassette: maintainedAuthoredCassetteCatalog.targetPromotionSuccess, roundTrip: false },
        { cassette: maintainedAuthoredCassetteCatalog.targetPromotionStaleBeforeCompareAndSet, roundTrip: false },
        { cassette: maintainedAuthoredCassetteCatalog.targetPromotionAmbiguityExhaustion, roundTrip: false }
      ]

      let preparedRecorded: ReturnType<typeof RecordedCassette.make> | undefined
      for (const { cassette, roundTrip } of cases) {
        const run = yield* runAuthoredScenarioCassette(cassette)
        const recorded = yield* projectRecordedCassette(run.records)
        const renamed = yield* renameRecordedCassette(recorded, emptyRenaming)

        if (cassette === maintainedAuthoredCassetteCatalog.candidateVerificationPassed) preparedRecorded = recorded

        expect(renamed).toEqual(recorded)
        if (roundTrip) {
          expect(
            verifyRecordedCassetteRoundTrip(run.records, recorded).every(
              ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
                operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
            )
          ).toBe(true)
        }
        expect(renderRecordedCassetteLyrics(recorded).length).toBeGreaterThan(0)
      }

      if (preparedRecorded === undefined) return yield* Effect.die("prepared Integrator projection was not recorded")
      const nonCommit = RecordedCassette.make({
        ...preparedRecorded,
        entries: preparedRecorded.entries.map((entry) =>
          entry._tag === "IntegratorCandidateGitObserved"
            ? {
                ...entry,
                observation: { _tag: "NonCommit" as const, candidateText: entry.candidateText, objectType: "tree" }
              }
            : entry
        )
      })
      const renamedNonCommit = yield* renameRecordedCassette(nonCommit, emptyRenaming)
      expect(renamedNonCommit).toEqual(nonCommit)
      expect(renderRecordedCassetteLyrics(nonCommit)).toContain("NonCommit")

    }).pipe(Effect.provide(NodeCrypto.layer))
  )
})
