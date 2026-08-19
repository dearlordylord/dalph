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
  IntegratorJournalEvent,
  JournalPosition,
  JournalRecord,
  OperationId,
  TargetLineageObservedEvent,
  WorkflowActor,
  WorkflowOperation,
  type WorkflowJournalEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { GitCommitSha } from "@dalph/contracts"
import { integratorSuccessorCorrelationFor } from "../../../orchestrator/src/workflow/protocols/integrator/session.js"
import {
  CassetteIdentityRenaming,
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

it("projects, folds, and non-trivially renames the current FullRerun successor chronology", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
      const predecessorRecord = run.records.find(({ event }) => event._tag === "IntegratorSessionFixed")
      const predecessorRunRecord = run.records.find(({ event }) => event._tag === "IntegratorRunStarted")
      if (predecessorRecord?.event._tag !== "IntegratorSessionFixed") {
        return yield* Effect.die("FullRerun fixture requires a fixed predecessor session")
      }
      if (predecessorRunRecord?.event._tag !== "IntegratorRunStarted") {
        return yield* Effect.die("FullRerun fixture requires the predecessor's exact run")
      }
      const predecessor = predecessorRecord.event.correlation
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
        requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "recorded-full-rerun", runId: run.runId }),
        version: workflowJournalEventVersion
      })
      const freshHead = GitCommitSha.make("2222222222222222222222222222222222222222")
      const freshLineageObservedAt = JournalPosition.make(baseRecords.length + 5)
      const lineageOperation = WorkflowOperation.cases.ReadTargetLineage.make({
        integrationTarget: predecessor.integrationTarget,
        operationId: OperationId.make("recorded-full-rerun-lineage-read"),
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
      const successor = yield* Schema.decodeUnknownEffect(IntegratorJournalEvent)({
        _tag: "IntegratorSuccessorSessionFixed",
        direction: "FullRerun",
        directionAppliedAt,
        predecessor,
        quarantineAt,
        successor: integratorSuccessorCorrelationFor({
          directionAppliedAt,
          predecessor,
          quarantineAt,
          targetLineage: lineageObserved.observation,
          targetLineageObservedAt: freshLineageObservedAt
        }),
        successorGeneration: 2,
        version: workflowJournalEventVersion
      })
      if (successor._tag !== "IntegratorSuccessorSessionFixed") {
        return yield* Effect.die("FullRerun fixture lost its successor event")
      }

      let records = append(baseRecords, absence)
      records = append(records, quarantine)
      records = append(records, direction)
      records = append(records, lineageIntent)
      records = append(records, lineageObserved)
      records = append(records, successor)
      const recorded = yield* projectRecordedCassette(records)
      expect(recorded.entries.map(({ _tag }) => _tag)).toEqual(
        expect.arrayContaining([
          "IntegrationProviderRunActivityAbsent",
          "IntegrationQuarantined",
          "IntegrationQuarantineDirectionApplied",
          "IntegratorSuccessorSessionFixed"
        ])
      )
      expect(foldRecordedCassette(recorded)._tag).toBe("ValidWorkflowJournalHistory")
      expect(
        verifyRecordedCassetteRoundTrip(records, recorded).every(
          ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
            operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
        )
      ).toBe(true)

      const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [{ from: predecessor.plannedAttempt.attemptId, to: "renamed-full-rerun-attempt" }],
        claimTokens: [],
        integratorCandidateResourceLocators: [
          { from: predecessor.candidateResource, to: "renamed-full-rerun-predecessor-resource" },
          { from: successor.successor.candidateResource, to: "renamed-full-rerun-successor-resource" }
        ],
        integratorSessionIds: [
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
      const renamedSuccessor = renamed.entries.find(({ _tag }) => _tag === "IntegratorSuccessorSessionFixed")
      if (renamedAbsence?._tag !== "IntegrationProviderRunActivityAbsent") {
        return yield* Effect.die("FullRerun renaming lost its exact provider-run absence")
      }
      if (renamedSuccessor?._tag !== "IntegratorSuccessorSessionFixed") {
        return yield* Effect.die("FullRerun renaming lost its successor relation")
      }
      expect(renamedAbsence.run.ordinal).toBe(predecessorRun.ordinal)
      expect(renamedAbsence.run.session.sessionId).toBe("renamed-full-rerun-predecessor-session")
      expect(renamedSuccessor.predecessor.candidateResource).toBe("renamed-full-rerun-predecessor-resource")
      expect(renamedSuccessor.successor.sessionId).toBe("renamed-full-rerun-successor-session")
      expect(renamedSuccessor.successor.candidateResource).toBe("renamed-full-rerun-successor-resource")
      const history = foldRecordedCassette(recorded)
      if (history._tag !== "ValidWorkflowJournalHistory") {
        return yield* Effect.die("FullRerun cassette must fold before inverse renaming")
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
    }).pipe(Effect.provide(NodeCrypto.layer))
  )
})
