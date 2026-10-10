import { IntegratorRunStartedEvent } from "../../../orchestrator/src/workflow/protocols/integrator/events.js"
import { liveJournalTestLayer } from "../../../orchestrator/src/coordination/delivery/live-journal-test-layer.js"
import { makeIntegrationQuarantineDirectionControl } from "../../../orchestrator/src/workflow/protocols/integration-quarantine/control.js"
import { appendInitialConclusiveIntegrationQuarantine } from "../../../orchestrator/src/workflow/protocols/integration-quarantine/initial-conclusive.js"
import { appendRetryConclusiveIntegrationQuarantine } from "../../../orchestrator/src/workflow/protocols/integration-quarantine/retry-conclusive.js"
import { integratorResponsibilityFactsFromCorrelation } from "../../../orchestrator/src/workflow/protocols/integrator/session-correlation.js"
import { NodeCrypto } from "@effect/platform-node"
import { Context, Effect, Layer, Schema } from "effect"
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
  IntegratorJournalEvent,
  StartedIntegrationResponsibility,
  Integrator,
  IntegratorGit,
  IntegratorResult,
  IntegratorNotPreparedDetail,
  IntegratorRunOrdinal,
  IntegratorRunCorrelation,
  InRunJournal,
  AcceptedJournalReader,
  prepareIntegrationCandidateRun,
  IntegratorSessionId,
  JournalPosition,
  JournalRecord,
  OperationId,
  TargetLineageObservedEvent,
  WorkflowActor,
  WorkflowOperation,
  integratorCompetingHeadSuccessorAuthorizationIdFor,
  exportWorkflowHistoryRecords,
  type WorkflowJournalEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { AttemptId, GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { integratorSuccessorCorrelationFor } from "../../../orchestrator/src/workflow/protocols/integrator/session.js"
import { prepareIntegratorAutomaticSuccessorSessionAppend } from "../../../orchestrator/src/workflow/protocols/integrator/automatic-successor-session.js"
import { makeSuccessorPrefix } from "../../../orchestrator/test/support/automatic-successor-history.js"
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

it("projects, folds, and non-trivially renames the current FullRerun successor with repeated native Operator Retry cycles", async () => {
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
      let baseRecords: ReadonlyArray<JournalRecord> = run.records.slice(0, predecessorRunRecord.position)
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

      // Retain the original run-one/run-two/FullRerun chronology before reopening S2.
      const originalAbsenceAt = JournalPosition.make(baseRecords.length + 1)
      baseRecords = append(
        baseRecords,
        IntegrationProviderRunActivityAbsentEvent.make({
          correlation: predecessor,
          detail: IntegrationQuarantineFailureDetail.make("original writer absent"),
          occurrenceClassification: "NonActionOccurrence",
          run: predecessorRun,
          version: workflowJournalEventVersion
        })
      )
      const originalQuarantineAt = JournalPosition.make(baseRecords.length + 1)
      baseRecords = append(
        baseRecords,
        IntegrationQuarantinedEvent.make({
          basis: IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
            detail: IntegrationQuarantineFailureDetail.make("original writer absent"),
            ownedActivityProvenAbsentAt: originalAbsenceAt
          }),
          correlation: predecessor,
          occurrenceClassification: "NonActionOccurrence",
          version: workflowJournalEventVersion
        })
      )
      baseRecords = append(
        baseRecords,
        IntegrationQuarantineDirectionAppliedEvent.make({
          fingerprint: IntegrationQuarantineDirectionFingerprint.make({
            direction: "Retry",
            quarantineAt: originalQuarantineAt,
            sessionId: predecessor.sessionId
          }),
          initiatedBy: WorkflowActor.cases.Operator.make({}),
          occurrenceClassification: "InitiatedAction",
          requestId: IntegrationQuarantineDirectionRequestId.make({
            nonce: "recorded-original-retry",
            runId: run.runId
          }),
          version: workflowJournalEventVersion
        })
      )
      const originalLineageOperation = WorkflowOperation.cases.ReadTargetLineage.make({
        integrationTarget: predecessor.integrationTarget,
        operationId: OperationId.make("recorded-original-retry-lineage"),
        plannedAttempt: predecessor.plannedAttempt,
        predecessorOperationIds: []
      })
      baseRecords = append(
        baseRecords,
        GitReadIntentRecordedEvent.make({
          initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
          occurrenceClassification: "InitiatedAction",
          operation: originalLineageOperation,
          version: workflowJournalEventVersion
        })
      )
      baseRecords = append(
        baseRecords,
        TargetLineageObservedEvent.make({
          observation: {
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: predecessor.plannedAttempt.baseSha,
            targetHeadSha: predecessor.expectedTargetHead
          },
          occurrenceClassification: "NonActionOccurrence",
          operationId: originalLineageOperation.operationId,
          plannedAttempt: predecessor.plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      const originalRetryRun = IntegratorRunCorrelation.make({
        ordinal: IntegratorRunOrdinal.make(2),
        session: predecessor
      })
      baseRecords = append(
        baseRecords,
        IntegratorRunStartedEvent.make({ run: originalRetryRun, version: workflowJournalEventVersion })
      )
      const absenceAt = JournalPosition.make(baseRecords.length + 1)
      const quarantineAt = JournalPosition.make(baseRecords.length + 2)
      const directionAppliedAt = JournalPosition.make(baseRecords.length + 3)
      const detail = IntegrationQuarantineFailureDetail.make("provider activity absent")
      const absence = IntegrationProviderRunActivityAbsentEvent.make({
        correlation: predecessor,
        detail,
        occurrenceClassification: "NonActionOccurrence",
        run: originalRetryRun,
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
      const began = records.find((record) => record.event._tag === "WorkflowRunBegan")
      if (began?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("missing Run beginning")
      const context = yield* Layer.build(
        liveJournalTestLayer({ records, runId: run.runId, target: began.event.target })
      )
      const journal = Context.get(context, InRunJournal)
      const accepted = Context.get(context, AcceptedJournalReader)
      const control = yield* makeIntegrationQuarantineDirectionControl(journal).pipe(
        Effect.provideService(AcceptedJournalReader, accepted)
      )
      let observedAt = freshLineageObservedAt
      const providerCalls: Array<number> = []
      const controlledProvider = Integrator.of({
        prepare: (request) => {
          providerCalls.push(request.correlation.ordinal)
          return Effect.succeed(
            IntegratorResult.cases.NotPrepared.make({
              correlation: request.correlation,
              detail: IntegratorNotPreparedDetail.make("controlled conclusive non-success")
            })
          )
        }
      })
      const fixed = successor.successor
      const withJournal = <A, E>(effect: Effect.Effect<A, E, InRunJournal | AcceptedJournalReader>) =>
        effect.pipe(
          Effect.provideService(InRunJournal, journal),
          Effect.provideService(AcceptedJournalReader, accepted)
        )
      for (let ordinal = 1; ordinal <= 8; ordinal += 1) {
        const request = {
          preparation: {
            responsibility: StartedIntegrationResponsibility.make(integratorResponsibilityFactsFromCorrelation(fixed)),
            targetLineage: lineageObserved.observation,
            targetLineageObservedAt: observedAt
          },
          run: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(ordinal), session: fixed })
        }
        const result = yield* withJournal(
          prepareIntegrationCandidateRun(request).pipe(
            Effect.provideService(Integrator, controlledProvider),
            Effect.provideService(
              IntegratorGit,
              IntegratorGit.of({ readCandidate: () => Effect.die("NotPrepared cannot query candidate Git") })
            )
          )
        )
        if (result._tag !== "NotPrepared") return yield* Effect.die("expected exact conclusive result")
        const q = yield* withJournal(
          ordinal === 1
            ? appendInitialConclusiveIntegrationQuarantine(result)
            : appendRetryConclusiveIntegrationQuarantine(result)
        )
        const forbidden = yield* control
          .apply({
            fingerprint: { direction: "FullRerun", quarantineAt: q.position, sessionId: fixed.sessionId },
            requestId: { nonce: `no-S3-${ordinal}`, runId: run.runId }
          })
          .pipe(Effect.flip)
        expect(forbidden._tag).toBe("IntegrationQuarantineDirectionNotAvailable")
        if (ordinal === 8) break
        const retry = {
          fingerprint: { direction: "Retry", quarantineAt: q.position, sessionId: fixed.sessionId },
          requestId: { nonce: `native-S2-retry-${ordinal}`, runId: run.runId }
        }
        const chosen = yield* control.apply(retry)
        expect(yield* control.apply(retry)).toEqual(chosen)
        const operation = WorkflowOperation.cases.ReadTargetLineage.make({
          integrationTarget: fixed.integrationTarget,
          operationId: OperationId.make(`native-S2-lineage-${ordinal}`),
          plannedAttempt: fixed.plannedAttempt,
          predecessorOperationIds: []
        })
        const intentEvent = GitReadIntentRecordedEvent.make({
          initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
          occurrenceClassification: "InitiatedAction",
          operation,
          version: workflowJournalEventVersion
        })
        yield* journal.append(run.runId, describeJournalEvent(intentEvent).expectedKey, intentEvent)
        const observedEvent = TargetLineageObservedEvent.make({
          ...lineageObserved,
          operationId: operation.operationId
        })
        const observed = yield* journal.append(
          run.runId,
          describeJournalEvent(observedEvent).expectedKey,
          observedEvent
        )
        observedAt = observed.position
      }
      expect(providerCalls).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      records = [...(yield* journal.read(run.runId))]
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
          exportWorkflowHistoryRecords(history.runState.workflowHistory),
          renamed,
          invertCassetteIdentityRenaming(renaming)
        )).every(
          ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
            operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
        )
      ).toBe(true)
      expect(renderRecordedCassetteLyrics(recorded)).toContain("FullRerun successor")
    }).pipe(Effect.provide(NodeCrypto.layer), Effect.scoped)
  )
})

it("records automatic successor authorization and fixation as distinct Dalph coordinator facts", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const fixture = makeSuccessorPrefix()
      const prepared = yield* prepareIntegratorAutomaticSuccessorSessionAppend(fixture.input, fixture.reduction.prefix)
      if (prepared._tag !== "Append") return yield* Effect.die("automatic successor fixture must produce one append")
      fixture.append(prepared.event)
      const records = fixture.records()
      const authorization = records.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
      const fixed = records.find(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
      if (
        authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
        fixed?.event._tag !== "IntegratorAutomaticSuccessorSessionFixed"
      ) {
        return yield* Effect.die("automatic successor projection requires both exact S2 events")
      }

      expect(authorization.event.initiatedBy._tag).toBe("DalphCoordinator")
      expect(authorization.event.occurrenceClassification).toBe("InitiatedAction")
      const cassette = yield* projectRecordedCassette(records)
      const authorizationEntry = cassette.entries.find(
        ({ _tag }) => _tag === "IntegratorCompetingHeadSuccessorAuthorized"
      )
      if (authorizationEntry?._tag !== "IntegratorCompetingHeadSuccessorAuthorized") {
        return yield* Effect.die("recorded cassette lost automatic authorization identity")
      }
      expect(authorizationEntry).toMatchObject({
        _tag: "IntegratorCompetingHeadSuccessorAuthorized",
        authorizationId: authorization.event.authorizationId,
        correlation: authorization.event.correlation,
        initiatedBy: { _tag: "DalphCoordinator" },
        mergeBase: authorization.event.mergeBase,
        occurrenceClassification: "InitiatedAction",
        remoteHead: authorization.event.remoteHead,
        remotePublicationRetainedAt: authorization.event.remotePublicationRetainedAt
      })

      const fixedEntry = cassette.entries.find(({ _tag }) => _tag === "IntegratorAutomaticSuccessorSessionFixed")
      if (fixedEntry?._tag !== "IntegratorAutomaticSuccessorSessionFixed") {
        return yield* Effect.die("recorded cassette lost automatic successor fixation")
      }
      expect(fixedEntry).toEqual({
        _tag: "IntegratorAutomaticSuccessorSessionFixed",
        authorizationAt: fixed.event.authorizationAt,
        predecessor: fixed.event.predecessor,
        successor: fixed.event.successor,
        successorGeneration: fixed.event.successorGeneration
      })
      expect(cassette.entries.map(({ _tag }) => _tag)).not.toContain("IntegratorSuccessorSessionFixed")
      expect(cassette.entries.map(({ _tag }) => _tag)).not.toContain("IntegrationQuarantineDirectionApplied")
      expect(
        verifyRecordedCassetteRoundTrip(records, cassette).every(
          ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
            operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
        )
      ).toBe(true)
      const lyrics = renderRecordedCassetteLyrics(cassette)
      expect(lyrics).toContain("Dalph coordinator authorized one automatic successor")
      expect(lyrics).toContain("fixed automatic successor session")
      expect(lyrics).toContain("no Operator direction was applied")
      expect(lyrics).not.toContain("Operator applied ")

      const renamed = yield* renameRecordedCassette(
        cassette,
        CassetteIdentityRenaming.make({
          attemptIds: [
            {
              from: fixed.event.predecessor.plannedAttempt.attemptId,
              to: AttemptId.make("automatic-successor-renamed-attempt")
            }
          ],
          claimTokens: [],
          integratorCandidateResourceLocators: [
            {
              from: fixed.event.predecessor.candidateResource,
              to: IntegratorCandidateResourceLocator.make("automatic-successor-renamed-predecessor-resource")
            },
            {
              from: fixed.event.successor.candidateResource,
              to: IntegratorCandidateResourceLocator.make("automatic-successor-renamed-successor-resource")
            }
          ],
          integratorSessionIds: [
            {
              from: fixed.event.predecessor.sessionId,
              to: IntegratorSessionId.make("automatic-successor-renamed-predecessor")
            },
            {
              from: fixed.event.successor.sessionId,
              to: IntegratorSessionId.make("automatic-successor-renamed-successor")
            }
          ],
          operationIds: [],
          runIds: [],
          taskBranchRefs: [
            {
              from: fixed.event.predecessor.plannedAttempt.branch,
              to: TaskBranchRef.make("refs/heads/dalph/automatic-successor-renamed")
            }
          ],
          worktreeLocators: [
            {
              from: fixed.event.predecessor.plannedAttempt.worktree,
              to: WorktreeLocator.make("/dalph/automatic-successor-renamed")
            }
          ]
        })
      )
      const renamedAuthorization = renamed.entries.find(
        ({ _tag }) => _tag === "IntegratorCompetingHeadSuccessorAuthorized"
      )
      if (renamedAuthorization?._tag !== "IntegratorCompetingHeadSuccessorAuthorized") {
        return yield* Effect.die("renaming lost automatic authorization")
      }
      expect(renamedAuthorization.authorizationId).toBe(
        integratorCompetingHeadSuccessorAuthorizationIdFor(
          renamedAuthorization.correlation.requestId,
          authorization.event.remotePublicationRetainedAt,
          authorization.event.mergeBase,
          authorization.event.remoteHead
        )
      )
      const renamedFixed = renamed.entries.find(({ _tag }) => _tag === "IntegratorAutomaticSuccessorSessionFixed")
      if (renamedFixed?._tag !== "IntegratorAutomaticSuccessorSessionFixed") {
        return yield* Effect.die("renaming lost automatic successor fixation")
      }
      expect(renamedFixed.predecessor.sessionId).toBe("automatic-successor-renamed-predecessor")
      expect(renamedFixed.successor.sessionId).toBe("automatic-successor-renamed-successor")
      expect(renamedFixed.authorizationAt).toBe(fixed.event.authorizationAt)
    })
  )
})
