import { NodeCrypto } from "@effect/platform-node"
import { Effect, Schema } from "effect"
import { expect, it } from "vitest"
import {
  describeJournalEvent,
  GitReadIntentRecordedEvent,
  IntegrationProviderRunActivityAbsentEvent,
  IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineFailureDetail,
  IntegrationQuarantinedEvent,
  IntegratorCandidateResourceLocator,
  IntegratorCorrelation,
  IntegratorJournalEvent,
  IntegratorSessionId,
  JournalPosition,
  JournalRecord,
  OperationId,
  reduceWorkflowJournalHistory,
  TargetLineageObservedEvent,
  WorkflowActor,
  WorkflowOperation,
  type WorkflowJournalEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { GitCommitSha } from "@dalph/contracts"
import {
  CandidateContinuationLimit,
  CandidateCorrectionLimit,
  IntegrationCandidateAgentReportedEvent,
  IntegrationCandidateConstructionIntendedEvent,
  IntegrationCandidateConstructedEvent,
  IntegrationCandidateCorrelation,
  IntegrationCandidateGitObservedEvent,
  IntegrationCandidateGitValidationAttemptOrdinal,
  IntegrationCandidateGitValidationFailedEvent,
  IntegrationCandidateCorrectionLimitReachedEvent,
  IntegrationCandidateContinuationLimitReachedEvent,
  IntegrationCandidateSessionSupersededEvent,
  IntegrationCandidateId,
  IntegrationCandidateAgentReportOrdinal,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId
} from "../../../orchestrator/src/workflow/protocols/integration-candidate-construction/events.js"
import {
  TargetVerificationCorrelationContradictedEvent,
  TargetVerificationEvidenceSealedEvent,
  TargetVerificationIntendedEvent,
  TargetVerificationPlanId,
  targetVerificationCorrelationFor
} from "../../../orchestrator/src/workflow/protocols/target-verification/events.js"
import {
  IntegratorCandidateGitObservedEvent,
  IntegratorCandidateGitReadIntendedEvent,
  IntegratorResultRecordedEvent
} from "../../../orchestrator/src/workflow/protocols/integrator/events.js"
import { integratorSuccessorCorrelationFor } from "../../../orchestrator/src/workflow/protocols/integrator/session.js"
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
        "IntegratorRunStarted",
        "IntegratorRunResultRecorded",
        "IntegratorRunCandidateGitReadIntended",
        "IntegratorRunCandidateGitObserved"
      ])
      expect(outerEntries.map(({ _tag }) => _tag)).toEqual(outerRecords.map(({ event }) => event._tag))

      const fixed = outerRecords[0]?.event
      const started = outerRecords[1]?.event
      const result = outerRecords[2]?.event
      const readIntent = outerRecords[3]?.event
      const observed = outerRecords[4]?.event
      const recordedFixed = outerEntries[0]
      const recordedStarted = outerEntries[1]
      const recordedResult = outerEntries[2]
      const recordedReadIntent = outerEntries[3]
      const recordedObserved = outerEntries[4]
      if (
        fixed?._tag !== "IntegratorSessionFixed" ||
        started?._tag !== "IntegratorRunStarted" ||
        result?._tag !== "IntegratorRunResultRecorded" ||
        readIntent?._tag !== "IntegratorRunCandidateGitReadIntended" ||
        observed?._tag !== "IntegratorRunCandidateGitObserved" ||
        recordedFixed?._tag !== "IntegratorSessionFixed" ||
        recordedStarted?._tag !== "IntegratorRunStarted" ||
        recordedResult?._tag !== "IntegratorRunResultRecorded" ||
        recordedReadIntent?._tag !== "IntegratorRunCandidateGitReadIntended" ||
        recordedObserved?._tag !== "IntegratorRunCandidateGitObserved"
      ) {
        return yield* Effect.die("outer Integrator records and entries are incomplete")
      }

      expect(recordedFixed.correlation).toEqual(fixed.correlation)
      expect(recordedFixed.correlation.queuedAt).toBe(fixed.correlation.queuedAt)
      expect(recordedFixed.correlation.startedAt).toBe(fixed.correlation.startedAt)
      expect(recordedFixed.correlation.targetLineageObservedAt).toBe(fixed.correlation.targetLineageObservedAt)
      expect(recordedStarted.run).toEqual(started.run)
      expect(recordedResult.result).toEqual(result.result)
      expect(recordedResult.run).toEqual(result.run)
      expect(recordedReadIntent.candidateText).toBe(readIntent.candidateText)
      expect(recordedReadIntent.run).toEqual(readIntent.run)
      expect(recordedObserved.candidateText).toBe(observed.candidateText)
      expect(recordedObserved.observation).toEqual(observed.observation)
      expect(recordedObserved.run).toEqual(observed.run)

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
      const renamedRun = renamed.entries.find(({ _tag }) => _tag === "IntegratorRunStarted")
      if (renamedFixed?._tag !== "IntegratorSessionFixed") {
        return yield* Effect.die("renamed cassette lost IntegratorSessionFixed")
      }
      if (renamedRun?._tag !== "IntegratorRunStarted") {
        return yield* Effect.die("renamed cassette lost IntegratorRunStarted")
      }
      expect(renamedFixed.correlation.sessionId).toBe("renamed-integrator-session")
      expect(renamedFixed.correlation.candidateResource).toBe("renamed-integrator-resource")
      expect(renamedFixed.correlation.queuedAt).toBe(fixed.correlation.queuedAt)
      expect(renamedRun.run.session.sessionId).toBe("renamed-integrator-session")
      expect(renamedRun.run.session.candidateResource).toBe("renamed-integrator-resource")
      expect(renamedRun.run.ordinal).toBe(started.run.ordinal)

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
      expect(renderRecordedCassetteLyrics(recorded)).toContain("from Integrator run 1")
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
        const fixed = recorded.entries.find(({ _tag }) => _tag === "IntegratorSessionFixed")
        if (fixed?._tag !== "IntegratorSessionFixed") {
          return yield* Effect.die("conclusive Integrator projection lost its fixed session")
        }
        expect(recorded.entries.some(({ _tag }) => _tag === "IntegratorSessionFixed")).toBe(true)
        expect(recorded.entries.some(({ _tag }) => _tag === "IntegratorRunResultRecorded")).toBe(true)
        expect(
          verifyRecordedCassetteRoundTrip(run.records, recorded).every(
            ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
              operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
          )
        ).toBe(true)

        const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
          attemptIds: [{ from: fixed.correlation.plannedAttempt.attemptId, to: "renamed-quarantine-attempt" }],
          claimTokens: [],
          integrationCandidateIds: [],
          integrationCandidateResourceLocators: [
            { from: fixed.correlation.candidateResource, to: "renamed-quarantine-resource" }
          ],
          integrationSessionIds: [{ from: fixed.correlation.sessionId, to: "renamed-quarantine-session" }],
          operationIds: [],
          runIds: [{ from: run.runId, to: "renamed-quarantine-run" }],
          taskBranchRefs: [
            { from: fixed.correlation.plannedAttempt.branch, to: "refs/heads/dalph/renamed-quarantine-attempt" }
          ],
          worktreeLocators: [
            { from: fixed.correlation.plannedAttempt.worktree, to: "/dalph/renamed-quarantine-attempt" }
          ]
        })
        const renamed = yield* renameRecordedCassette(recorded, renaming)
        const quarantine = renamed.entries.find(({ _tag }) => _tag === "IntegrationQuarantined")
        if (quarantine?._tag !== "IntegrationQuarantined") {
          return yield* Effect.die("conclusive Integrator projection lost its quarantine occurrence")
        }
        expect(quarantine.correlation.sessionId).toBe("renamed-quarantine-session")
        expect(quarantine.correlation.candidateResource).toBe("renamed-quarantine-resource")
        const history = foldRecordedCassette(recorded)
        if (history._tag !== "ValidWorkflowJournalHistory") {
          return yield* Effect.die("conclusive Integrator cassette must fold before quarantine renaming")
        }
        expect(
          (yield* verifyRecordedCassetteRoundTripWithRenaming(
            history.records,
            renamed,
            invertCassetteIdentityRenaming(renaming)
          )).every(
            ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
              operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
          )
        ).toBe(true)
      }
    }).pipe(Effect.provide(NodeCrypto.layer))
  )
})

it("projects, inverses, and renames a FullRerun Integrator successor relation", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.candidateVerificationPassed)
      const predecessorRecord = run.records.find(({ event }) => event._tag === "IntegratorSessionFixed")
      if (predecessorRecord?.event._tag !== "IntegratorSessionFixed") {
        return yield* Effect.die("FullRerun fixture requires a fixed predecessor session")
      }
      const predecessor = predecessorRecord.event.correlation
      const predecessorRunRecord = run.records.find(({ event }) => event._tag === "IntegratorRunStarted")
      if (predecessorRunRecord?.event._tag !== "IntegratorRunStarted") {
        return yield* Effect.die("FullRerun fixture requires the predecessor's exact run")
      }
      const predecessorRun = predecessorRunRecord.event.run
      const baseRecords = run.records.slice(0, predecessorRunRecord.position)
      const append = (
        records: ReadonlyArray<JournalRecord>,
        event: WorkflowJournalEvent
      ): ReadonlyArray<JournalRecord> => [
        ...records,
        JournalRecord.make({
          event,
          key: describeJournalEvent(event).expectedKey,
          position: JournalPosition.make(records.length + 1),
          runId: run.runId
        })
      ]

      const absenceAt = JournalPosition.make(baseRecords.length + 1)
      const quarantineAt = JournalPosition.make(baseRecords.length + 2)
      const directionAppliedAt = JournalPosition.make(baseRecords.length + 3)
      const detail = IntegrationQuarantineFailureDetail.make("provider activity absent")
      const absence = IntegrationProviderRunActivityAbsentEvent.make({
        correlation: predecessor,
        detail,
        occurrenceClassification: "NonActionOccurrence",
        run: predecessorRun,
        version: workflowJournalEventVersion
      })
      const quarantine = IntegrationQuarantinedEvent.make({
        basis: IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
          detail,
          ownedActivityProvenAbsentAt: absenceAt
        }),
        correlation: predecessor,
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      })
      const direction = IntegrationQuarantineDirectionAppliedEvent.make({
        fingerprint: IntegrationQuarantineDirectionFingerprint.make({
          direction: "FullRerun",
          quarantineAt,
          sessionId: predecessor.sessionId
        }),
        initiatedBy: WorkflowActor.cases.Operator.make({}),
        occurrenceClassification: "InitiatedAction",
        requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "full-rerun-cassette", runId: run.runId }),
        version: workflowJournalEventVersion
      })
      const freshHead = GitCommitSha.make("2222222222222222222222222222222222222222")
      const freshLineageObservedAt = JournalPosition.make(baseRecords.length + 5)
      const lineageOperation = WorkflowOperation.cases.ReadTargetLineage.make({
        integrationTarget: predecessor.integrationTarget,
        operationId: OperationId.make("full-rerun-cassette-lineage-read"),
        plannedAttempt: predecessor.plannedAttempt,
        predecessorOperationIds: []
      })
      const lineageIntent = GitReadIntentRecordedEvent.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation: lineageOperation,
        version: workflowJournalEventVersion
      })
      const lineageObserved = TargetLineageObservedEvent.make({
        observation: {
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: predecessor.plannedAttempt.baseSha,
          targetHeadSha: freshHead
        },
        occurrenceClassification: "NonActionOccurrence",
        operationId: lineageOperation.operationId,
        plannedAttempt: predecessor.plannedAttempt,
        version: workflowJournalEventVersion
      })
      const successorMaterial = [
        "full-rerun-successor",
        predecessor.sessionId,
        predecessor.candidateResource,
        predecessor.plannedAttempt.runId,
        predecessor.plannedAttempt.attemptId,
        predecessor.startedAt,
        quarantineAt,
        directionAppliedAt,
        freshLineageObservedAt,
        freshHead,
        predecessor.acceptedResult.commit,
        predecessor.integrationTarget.repository,
        predecessor.integrationTarget.ref
      ].join(":")
      const successor = Schema.decodeUnknownSync(IntegratorJournalEvent)({
        _tag: "IntegratorSuccessorSessionFixed",
        direction: "FullRerun",
        directionAppliedAt,
        predecessor,
        quarantineAt,
        successor: IntegratorCorrelation.make({
          ...predecessor,
          candidateResource: IntegratorCandidateResourceLocator.make(`integrator-resource:${successorMaterial}`),
          expectedTargetHead: freshHead,
          sessionId: IntegratorSessionId.make(`integrator-session:${successorMaterial}`),
          targetLineageObservedAt: freshLineageObservedAt
        }),
        successorGeneration: 2,
        version: workflowJournalEventVersion
      })

      let records = append(baseRecords, absence)
      records = append(records, quarantine)
      records = append(records, direction)
      records = append(records, lineageIntent)
      records = append(records, lineageObserved)
      records = append(records, successor)
      const recorded = yield* projectRecordedCassette(records)
      const recordedAbsence = recorded.entries.find(({ _tag }) => _tag === "IntegrationProviderRunActivityAbsent")
      if (recordedAbsence?._tag !== "IntegrationProviderRunActivityAbsent") {
        return yield* Effect.die("FullRerun projection lost its provider-run absence")
      }
      expect(recordedAbsence.run).toEqual(predecessorRun)
      const recordedSuccessor = recorded.entries.at(-1)
      if (recordedSuccessor?._tag !== "IntegratorSuccessorSessionFixed") {
        return yield* Effect.die("FullRerun projection lost its successor relation")
      }
      if (successor._tag !== "IntegratorSuccessorSessionFixed") {
        return yield* Effect.die("FullRerun fixture lost its successor event")
      }
      expect(recordedSuccessor.predecessor).toEqual(successor.predecessor)
      expect(recordedSuccessor.successor).toEqual(successor.successor)
      expect(recordedSuccessor.quarantineAt).toBe(successor.quarantineAt)
      expect(recordedSuccessor.directionAppliedAt).toBe(successor.directionAppliedAt)
      expect(recordedSuccessor.successorGeneration).toBe(successor.successorGeneration)
      expect(
        verifyRecordedCassetteRoundTrip(records, recorded).every(
          ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
            operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
        )
      ).toBe(true)

      const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [{ from: predecessor.plannedAttempt.attemptId, to: "renamed-full-rerun-attempt" }],
        claimTokens: [],
        integrationCandidateIds: [],
        integrationCandidateResourceLocators: [
          { from: predecessor.candidateResource, to: "renamed-full-rerun-predecessor-resource" },
          { from: successor.successor.candidateResource, to: "renamed-full-rerun-successor-resource" }
        ],
        integrationSessionIds: [
          { from: predecessor.sessionId, to: "renamed-full-rerun-predecessor-session" },
          { from: successor.successor.sessionId, to: "renamed-full-rerun-successor-session" }
        ],
        operationIds: [],
        runIds: [{ from: run.runId, to: "renamed-full-rerun-run" }],
        taskBranchRefs: [
          { from: predecessor.plannedAttempt.branch, to: "refs/heads/dalph/renamed-full-rerun-attempt" }
        ],
        worktreeLocators: [{ from: predecessor.plannedAttempt.worktree, to: "/dalph/renamed-full-rerun-attempt" }]
      })
      const renamed = yield* renameRecordedCassette(recorded, renaming)
      const renamedAbsence = renamed.entries.find(({ _tag }) => _tag === "IntegrationProviderRunActivityAbsent")
      if (renamedAbsence?._tag !== "IntegrationProviderRunActivityAbsent") {
        return yield* Effect.die("FullRerun renaming lost its provider-run absence identity")
      }
      expect(renamedAbsence.run.ordinal).toBe(predecessorRun.ordinal)
      expect(renamedAbsence.run.session.plannedAttempt.runId).toBe("renamed-full-rerun-run")
      const renamedSuccessor = renamed.entries.at(-1)
      if (renamedSuccessor?._tag !== "IntegratorSuccessorSessionFixed") {
        return yield* Effect.die("FullRerun renaming lost its successor relation")
      }
      expect(renamedSuccessor.predecessor.sessionId).toBe("renamed-full-rerun-predecessor-session")
      expect(renamedSuccessor.predecessor.candidateResource).toBe("renamed-full-rerun-predecessor-resource")
      expect(renamedSuccessor.successor.sessionId).toBe("renamed-full-rerun-successor-session")
      expect(renamedSuccessor.successor.candidateResource).toBe("renamed-full-rerun-successor-resource")
      expect(renamedSuccessor.quarantineAt).toBe(recordedSuccessor.quarantineAt)
      expect(renamedSuccessor.directionAppliedAt).toBe(recordedSuccessor.directionAppliedAt)
      expect(renamedSuccessor.successorGeneration).toBe(2)

      const history = foldRecordedCassette(recorded)
      if (history._tag !== "ValidWorkflowJournalHistory") {
        return yield* Effect.die("FullRerun cassette must fold to valid history")
      }
      expect(
        (yield* verifyRecordedCassetteRoundTripWithRenaming(
          history.records,
          renamed,
          invertCassetteIdentityRenaming(renaming)
        )).every(
          ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
            operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
        )
      ).toBe(true)
      expect(renderRecordedCassetteLyrics(recorded)).toContain("FullRerun successor")

      const malformedDirectionAppliedAt = JournalPosition.make(Number(directionAppliedAt) + 1)
      const malformedSuccessorCorrelation = integratorSuccessorCorrelationFor({
        directionAppliedAt: malformedDirectionAppliedAt,
        predecessor,
        quarantineAt,
        targetLineage: lineageObserved.observation,
        targetLineageObservedAt: freshLineageObservedAt
      })
      const malformedSuccessor = Schema.decodeUnknownSync(IntegratorJournalEvent)({
        _tag: "IntegratorSuccessorSessionFixed",
        direction: "FullRerun",
        directionAppliedAt: malformedDirectionAppliedAt,
        predecessor,
        quarantineAt,
        successor: malformedSuccessorCorrelation,
        successorGeneration: 2,
        version: workflowJournalEventVersion
      })
      let malformedRecords = append(baseRecords, absence)
      malformedRecords = append(malformedRecords, quarantine)
      malformedRecords = append(malformedRecords, lineageIntent)
      malformedRecords = append(malformedRecords, direction)
      malformedRecords = append(malformedRecords, lineageObserved)
      malformedRecords = append(malformedRecords, malformedSuccessor)
      const malformedHistory = reduceWorkflowJournalHistory(run.runId, malformedRecords)
      expect(malformedHistory._tag).toBe("InvalidWorkflowJournalHistory")
      if (malformedHistory._tag !== "InvalidWorkflowJournalHistory") {
        return yield* Effect.die("FullRerun replay accepted a Git intent recorded before its direction")
      }
      expect(malformedHistory.issues).toEqual([
        expect.objectContaining({ detail: expect.stringContaining("fresh target-lineage observation") })
      ])
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
          entry._tag === "IntegratorRunCandidateGitObserved"
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

it("projects the retired session-level Integrator records when they follow a valid run", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.candidateVerificationPassed)
      const runResult = run.records.find(({ event }) => event._tag === "IntegratorRunResultRecorded")
      const runObservation = run.records.find(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")
      if (
        runResult?.event._tag !== "IntegratorRunResultRecorded" ||
        runObservation?.event._tag !== "IntegratorRunCandidateGitObserved"
      ) {
        return yield* Effect.die("the maintained run lacks the run-bound Integrator facts needed for legacy replay")
      }
      const correlation = runResult.event.result.correlation
      const legacyEvents: ReadonlyArray<WorkflowJournalEvent> = [
        IntegratorResultRecordedEvent.make({ result: runResult.event.result, version: workflowJournalEventVersion }),
        IntegratorCandidateGitReadIntendedEvent.make({
          candidateText: runObservation.event.candidateText,
          correlation,
          version: workflowJournalEventVersion
        }),
        IntegratorCandidateGitObservedEvent.make({
          candidateText: runObservation.event.candidateText,
          correlation,
          observation: runObservation.event.observation,
          version: workflowJournalEventVersion
        })
      ]
      const append = (
        records: ReadonlyArray<JournalRecord>,
        event: WorkflowJournalEvent
      ): ReadonlyArray<JournalRecord> => [
        ...records,
        JournalRecord.make({
          event,
          key: describeJournalEvent(event).expectedKey,
          position: JournalPosition.make(records.length + 1),
          runId: run.runId
        })
      ]
      let records = run.records
      for (const event of legacyEvents) records = append(records, event)
      const recorded = yield* projectRecordedCassette(records)
      expect(recorded.entries.filter(({ _tag }) => _tag.startsWith("Integrator")).map(({ _tag }) => _tag)).toEqual([
        "IntegratorSessionFixed",
        "IntegratorRunStarted",
        "IntegratorRunResultRecorded",
        "IntegratorRunCandidateGitReadIntended",
        "IntegratorRunCandidateGitObserved",
        "IntegratorResultRecorded",
        "IntegratorCandidateGitReadIntended",
        "IntegratorCandidateGitObserved"
      ])
      expect(foldRecordedCassette(recorded)._tag).toBe("ValidWorkflowJournalHistory")
    }).pipe(Effect.provide(NodeCrypto.layer))
  )
})

it("projects a valid candidate-construction intent, submission, Git proof, and construction", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.candidateVerificationPassed)
      const began = run.records.find(({ event }) => event._tag === "IntegrationResponsibilityBegan")
      const started = run.records.find(({ event }) => event._tag === "IntegrationStarted")
      const lineage = run.records.find(({ event }) => event._tag === "TargetLineageObserved")
      if (
        began?.event._tag !== "IntegrationResponsibilityBegan" ||
        started?.event._tag !== "IntegrationStarted" ||
        lineage?.event._tag !== "TargetLineageObserved"
      ) {
        return yield* Effect.die("candidate projection fixture lacks integration admission")
      }
      const correlation = Schema.decodeUnknownSync(IntegrationCandidateCorrelation)({
        acceptanceManifest: began.event.acceptedResult.evidenceManifest,
        acceptedResultCommit: began.event.acceptedResult.commit,
        attemptId: began.event.plannedAttempt.attemptId,
        candidateId: IntegrationCandidateId.make("recorded-candidate-coverage"),
        candidateResource: IntegrationCandidateResourceLocator.make("/recorded-candidate-coverage"),
        expectedTargetHead: lineage.event.observation.targetHeadSha,
        integrationSessionId: IntegrationSessionId.make("recorded-session-coverage"),
        integrationTarget: began.event.integrationTarget,
        runId: run.runId
      })
      const candidateCommit = GitCommitSha.make("f".repeat(40))
      const intended = IntegrationCandidateConstructionIntendedEvent.make({
        continuationLimit: CandidateContinuationLimit.make(2),
        correctionLimit: CandidateCorrectionLimit.make(1),
        correlation,
        plannedAttempt: began.event.plannedAttempt,
        responsibilityBeganAt: began.position,
        startedAt: started.position,
        version: workflowJournalEventVersion
      })
      const submitted = IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: correlation,
        ordinal: IntegrationCandidateAgentReportOrdinal.make(1),
        report: {
          _tag: "Submitted",
          candidateCommit,
          correlation,
          reviewManifest: began.event.acceptedResult.evidenceManifest
        },
        version: workflowJournalEventVersion
      })
      const gitObserved = IntegrationCandidateGitObservedEvent.make({
        candidateCommit,
        correlation,
        observation: {
          _tag: "Commit",
          directParents: [correlation.expectedTargetHead, correlation.acceptedResultCommit]
        },
        submissionAt: JournalPosition.make(run.records.length + 2),
        version: workflowJournalEventVersion
      })
      const constructed = IntegrationCandidateConstructedEvent.make({
        candidateCommit,
        correlation,
        gitObservationAt: JournalPosition.make(run.records.length + 3),
        reviewManifest: began.event.acceptedResult.evidenceManifest,
        version: workflowJournalEventVersion
      })
      const changedTargetHead = GitCommitSha.make("e".repeat(40))
      const acceptanceManifest = began.event.acceptedResult.evidenceManifest
      const successorCorrelation = Schema.decodeUnknownSync(IntegrationCandidateCorrelation)({
        ...correlation,
        candidateId: IntegrationCandidateId.make("recorded-candidate-coverage-successor"),
        candidateResource: IntegrationCandidateResourceLocator.make("/recorded-candidate-coverage-successor"),
        expectedTargetHead: changedTargetHead,
        integrationSessionId: IntegrationSessionId.make("recorded-session-coverage-successor")
      })
      const superseded = IntegrationCandidateSessionSupersededEvent.make({
        observedTargetHead: changedTargetHead,
        priorCandidateCommit: candidateCommit,
        priorCorrelation: correlation,
        responsibilityBeganAt: began.position,
        startedAt: started.position,
        successorCorrelation,
        version: workflowJournalEventVersion
      })
      const submittedAgain = (ordinal: number) =>
        IntegrationCandidateAgentReportedEvent.make({
          expectedCorrelation: correlation,
          ordinal: IntegrationCandidateAgentReportOrdinal.make(ordinal),
          report: { _tag: "Submitted", candidateCommit, correlation, reviewManifest: acceptanceManifest },
          version: workflowJournalEventVersion
        })
      const invalidGitObservation = (submissionAt: number, observation: "Missing" | "NonCommit") =>
        IntegrationCandidateGitObservedEvent.make({
          candidateCommit,
          correlation,
          observation: observation === "Missing" ? { _tag: "Missing" } : { _tag: "NonCommit", objectType: "tree" },
          submissionAt: JournalPosition.make(submissionAt),
          version: workflowJournalEventVersion
        })
      const submittedSecond = submittedAgain(2)
      const invalidSecond = invalidGitObservation(run.records.length + 6, "NonCommit")
      const validationFailed = IntegrationCandidateGitValidationFailedEvent.make({
        attemptOrdinal: IntegrationCandidateGitValidationAttemptOrdinal.make(1),
        candidateCommit,
        correlation,
        detail: "coverage candidate was not a commit",
        submissionAt: JournalPosition.make(run.records.length + 6),
        version: workflowJournalEventVersion
      })
      const submittedThird = submittedAgain(3)
      const invalidThird = invalidGitObservation(run.records.length + 9, "Missing")
      const correctionLimit = IntegrationCandidateCorrectionLimitReachedEvent.make({
        correctionCount: 1,
        correctionLimit: CandidateCorrectionLimit.make(1),
        correlation,
        invalidObservationAt: JournalPosition.make(run.records.length + 10),
        version: workflowJournalEventVersion
      })
      const conflict = IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: correlation,
        ordinal: IntegrationCandidateAgentReportOrdinal.make(4),
        report: { _tag: "Conflict", correlation },
        version: workflowJournalEventVersion
      })
      const working = IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: correlation,
        ordinal: IntegrationCandidateAgentReportOrdinal.make(5),
        report: { _tag: "Working", correlation },
        version: workflowJournalEventVersion
      })
      const successorCandidateCommit = GitCommitSha.make("a".repeat(40))
      const successorSubmitted = IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: successorCorrelation,
        ordinal: IntegrationCandidateAgentReportOrdinal.make(1),
        report: {
          _tag: "Submitted",
          candidateCommit: successorCandidateCommit,
          correlation: successorCorrelation,
          reviewManifest: began.event.acceptedResult.evidenceManifest
        },
        version: workflowJournalEventVersion
      })
      const successorGitObserved = IntegrationCandidateGitObservedEvent.make({
        candidateCommit: successorCandidateCommit,
        correlation: successorCorrelation,
        observation: {
          _tag: "Commit",
          directParents: [successorCorrelation.expectedTargetHead, successorCorrelation.acceptedResultCommit]
        },
        submissionAt: JournalPosition.make(run.records.length + 16),
        version: workflowJournalEventVersion
      })
      const successorConstructed = IntegrationCandidateConstructedEvent.make({
        candidateCommit: successorCandidateCommit,
        correlation: successorCorrelation,
        gitObservationAt: JournalPosition.make(run.records.length + 17),
        reviewManifest: began.event.acceptedResult.evidenceManifest,
        version: workflowJournalEventVersion
      })
      const firstVerification = targetVerificationCorrelationFor(
        {
          candidateCommit,
          constructedAt: JournalPosition.make(run.records.length + 4),
          correlation,
          reviewManifest: began.event.acceptedResult.evidenceManifest
        },
        TargetVerificationPlanId.make("recorded-verification-plan-1")
      )
      const secondVerification = targetVerificationCorrelationFor(
        {
          candidateCommit: successorCandidateCommit,
          constructedAt: JournalPosition.make(run.records.length + 18),
          correlation: successorCorrelation,
          reviewManifest: began.event.acceptedResult.evidenceManifest
        },
        TargetVerificationPlanId.make("recorded-verification-plan-2")
      )
      const firstVerificationIntended = TargetVerificationIntendedEvent.make({
        correlation: firstVerification,
        version: workflowJournalEventVersion
      })
      const firstVerificationSealed = TargetVerificationEvidenceSealedEvent.make({
        correlation: firstVerification,
        manifest: began.event.acceptedResult.evidenceManifest,
        terminal: "Passed",
        version: workflowJournalEventVersion
      })
      const secondVerificationIntended = TargetVerificationIntendedEvent.make({
        correlation: secondVerification,
        version: workflowJournalEventVersion
      })
      const secondVerificationContradicted = TargetVerificationCorrelationContradictedEvent.make({
        expected: secondVerification,
        received: { ...secondVerification, candidateCommit: GitCommitSha.make("b".repeat(40)) },
        version: workflowJournalEventVersion
      })
      const append = (
        records: ReadonlyArray<JournalRecord>,
        event: WorkflowJournalEvent
      ): ReadonlyArray<JournalRecord> => [
        ...records,
        JournalRecord.make({
          event,
          key: describeJournalEvent(event).expectedKey,
          position: JournalPosition.make(records.length + 1),
          runId: run.runId
        })
      ]
      let records = append(run.records, intended)
      records = append(records, submitted)
      records = append(records, gitObserved)
      records = append(records, constructed)
      records = append(records, superseded)
      records = append(records, submittedSecond)
      records = append(records, invalidSecond)
      records = append(records, validationFailed)
      records = append(records, submittedThird)
      records = append(records, invalidThird)
      records = append(records, correctionLimit)
      records = append(records, conflict)
      records = append(records, working)
      records = append(
        records,
        IntegrationCandidateContinuationLimitReachedEvent.make({
          continuationCount: 2,
          continuationLimit: CandidateContinuationLimit.make(2),
          correlation,
          lastReportAt: JournalPosition.make(run.records.length + 13),
          version: workflowJournalEventVersion
        })
      )
      records = append(
        records,
        IntegrationCandidateConstructionIntendedEvent.make({
          continuationLimit: CandidateContinuationLimit.make(1),
          correctionLimit: CandidateCorrectionLimit.make(1),
          correlation: successorCorrelation,
          plannedAttempt: began.event.plannedAttempt,
          responsibilityBeganAt: began.position,
          startedAt: started.position,
          version: workflowJournalEventVersion
        })
      )
      records = append(records, successorSubmitted)
      records = append(records, successorGitObserved)
      records = append(records, successorConstructed)
      records = append(records, firstVerificationIntended)
      records = append(records, firstVerificationSealed)
      records = append(records, secondVerificationIntended)
      records = append(records, secondVerificationContradicted)
      const recorded = yield* projectRecordedCassette(records)
      expect(recorded.entries.slice(-22).map(({ _tag }) => _tag)).toEqual([
        "IntegrationCandidateConstructionIntended",
        "IntegrationCandidateAgentReported",
        "IntegrationCandidateGitObserved",
        "IntegrationCandidateConstructed",
        "IntegrationCandidateSessionSuperseded",
        "IntegrationCandidateAgentReported",
        "IntegrationCandidateGitObserved",
        "IntegrationCandidateGitValidationFailed",
        "IntegrationCandidateAgentReported",
        "IntegrationCandidateGitObserved",
        "IntegrationCandidateCorrectionLimitReached",
        "IntegrationCandidateAgentReported",
        "IntegrationCandidateAgentReported",
        "IntegrationCandidateContinuationLimitReached",
        "IntegrationCandidateConstructionIntended",
        "IntegrationCandidateAgentReported",
        "IntegrationCandidateGitObserved",
        "IntegrationCandidateConstructed",
        "TargetVerificationIntended",
        "TargetVerificationEvidenceSealed",
        "TargetVerificationIntended",
        "TargetVerificationCorrelationContradicted"
      ])
      expect(foldRecordedCassette(recorded)._tag).toBe("ValidWorkflowJournalHistory")
    }).pipe(Effect.provide(NodeCrypto.layer))
  )
})
