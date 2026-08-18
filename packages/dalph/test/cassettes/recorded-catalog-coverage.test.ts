import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import {
  IntegrationCandidateCorrelation,
  IntegratorCorrelation,
  IntegratorRunCorrelation,
  TargetVerificationCorrelation
} from "@dalph/orchestrator"
import {
  CassetteIdentityRenaming,
  RecordedCassette,
  RecordedCassetteEntry,
  deliveryFinalitySpineAuthoredCassette,
  foldRecordedCassette,
  maintainedAuthoredCassetteCatalog,
  projectRecordedCassette,
  renameRecordedCassette,
  renderRecordedCassetteLyrics,
  runAuthoredScenarioCassette,
  verifyRecordedCassetteRoundTrip,
  verifyRecordedCassetteRoundTripWithRenaming
} from "../../src/cassettes/index.js"

const allMaintainedCassetteRoundTripTimeout = 600_000

it.effect(
  "projects, folds, and alpha-renames every maintained authored cassette",
  () =>
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

      for (const [name, cassette] of Object.entries(maintainedAuthoredCassetteCatalog)) {
        const run = yield* runAuthoredScenarioCassette(cassette)
        const recorded = yield* projectRecordedCassette(run.records)
        const folded = foldRecordedCassette(recorded)
        expect(folded._tag, `${name} must fold through its recorded inverse`).toBe("ValidWorkflowJournalHistory")
        expect(renderRecordedCassetteLyrics(recorded), `${name} must render its recorded chronology`).not.toBe("")

        expect(
          verifyRecordedCassetteRoundTrip(run.records, recorded).every(
            ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
              operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
          ),
          `${name} must preserve state, selection, and history through projection`
        ).toBe(true)

        const renamed = yield* renameRecordedCassette(recorded, emptyRenaming)
        expect(
          (yield* verifyRecordedCassetteRoundTripWithRenaming(run.records, renamed, emptyRenaming)).every(
            ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
              operationalStateEquivalent && pureSelectionEquivalent && workflowHistoryEquivalent
          ),
          `${name} must preserve state, selection, and history through empty alpha-renaming`
        ).toBe(true)
      }
    }).pipe(Effect.provide(NodeCrypto.layer)),
  allMaintainedCassetteRoundTripTimeout
)

it.effect("alpha-renames private candidate and target-verification entry variants", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(deliveryFinalitySpineAuthoredCassette)
    const recorded = yield* projectRecordedCassette(run.records)
    const plannedAttemptEntry = recorded.entries.find(
      (entry) => entry._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
    )
    if (plannedAttemptEntry?._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan") {
      return yield* Effect.die("the seed cassette has no planned-attempt responsibility")
    }

    const plannedAttempt = plannedAttemptEntry.plannedAttempt
    const acceptanceManifest = { byteLength: 1, digest: "f".repeat(64) }
    const candidateCorrelation = Schema.decodeUnknownSync(IntegrationCandidateCorrelation)({
      acceptanceManifest,
      acceptedResultCommit: plannedAttempt.baseSha,
      attemptId: plannedAttempt.attemptId,
      candidateId: "candidate:coverage",
      candidateResource: "/candidate-resources/coverage",
      expectedTargetHead: plannedAttempt.baseSha,
      integrationSessionId: "session:coverage",
      integrationTarget: { ref: "refs/heads/master", repository: "/coverage.git" },
      runId: plannedAttempt.runId
    })
    const verificationCorrelation = Schema.decodeUnknownSync(TargetVerificationCorrelation)({
      candidateCommit: "b".repeat(40),
      candidateConstructedAt: 1,
      candidateCorrelation,
      planId: "plan:coverage",
      requestId: "verification-request:coverage",
      reviewManifest: acceptanceManifest
    })
    const decodeEntry = Schema.decodeUnknownSync(RecordedCassetteEntry)
    const integrationTarget = { ref: "refs/heads/master", repository: "/coverage.git" }
    const acceptedResult = { commit: plannedAttempt.baseSha, evidenceManifest: acceptanceManifest }
    const integratorCorrelation = Schema.decodeUnknownSync(IntegratorCorrelation)({
      acceptedResult,
      candidateResource: "/integrator-resources/coverage",
      expectedTargetHead: plannedAttempt.baseSha,
      integrationTarget,
      plannedAttempt,
      queuedAt: 1,
      sessionId: "integrator-session:coverage",
      startedAt: 2,
      targetLineageObservedAt: 3
    })
    const integratorRun = Schema.decodeUnknownSync(IntegratorRunCorrelation)({
      ordinal: 1,
      session: integratorCorrelation
    })
    const baseIntegrationEntries = [
      decodeEntry({
        _tag: "IntegrationResponsibilityBegan",
        acceptedResult,
        initiatedBy: { _tag: "DalphCoordinator" },
        integrationTarget,
        occurrenceClassification: "InitiatedAction",
        plannedAttempt
      }),
      decodeEntry({
        _tag: "IntegrationStarted",
        acceptedResult,
        initiatedBy: { _tag: "DalphCoordinator" },
        integrationTarget,
        occurrenceClassification: "InitiatedAction",
        plannedAttempt
      })
    ]
    const privateEntries = [
      decodeEntry({
        _tag: "IntegrationCandidateConstructionIntended",
        continuationLimit: 2,
        correctionLimit: 2,
        correlation: candidateCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        plannedAttempt
      }),
      decodeEntry({
        _tag: "IntegrationCandidateSessionSuperseded",
        observedTargetHead: plannedAttempt.baseSha,
        occurrenceClassification: "NonActionOccurrence",
        priorCandidateCommit: plannedAttempt.baseSha,
        priorCorrelation: candidateCorrelation,
        successorCorrelation: {
          ...candidateCorrelation,
          candidateId: "candidate:coverage-successor",
          candidateResource: "/candidate-resources/coverage-successor",
          integrationSessionId: "session:coverage-successor"
        }
      }),
      ...(["Conflict", "ExitedWithoutCandidate", "Working", "Submitted"] as const).map((reportTag) =>
        decodeEntry({
          _tag: "IntegrationCandidateAgentReported",
          expectedCorrelation: candidateCorrelation,
          occurrenceClassification: "NonActionOccurrence",
          ordinal: 1,
          report:
            reportTag === "Submitted"
              ? {
                  _tag: reportTag,
                  candidateCommit: "b".repeat(40),
                  correlation: candidateCorrelation,
                  reviewManifest: acceptanceManifest
                }
              : { _tag: reportTag, correlation: candidateCorrelation }
        })
      ),
      decodeEntry({
        _tag: "IntegrationCandidateAgentReported",
        expectedCorrelation: { ...candidateCorrelation, candidateResource: "/candidate-resources/foreign" },
        occurrenceClassification: "NonActionOccurrence",
        ordinal: 2,
        report: { _tag: "Working", correlation: candidateCorrelation }
      }),
      decodeEntry({
        _tag: "IntegrationCandidateGitObserved",
        candidateCommit: "b".repeat(40),
        correlation: candidateCorrelation,
        occurrenceClassification: "NonActionOccurrence",
        observation: { _tag: "Commit", directParents: [plannedAttempt.baseSha, plannedAttempt.baseSha] }
      }),
      decodeEntry({
        _tag: "IntegrationCandidateConstructed",
        candidateCommit: "b".repeat(40),
        correlation: candidateCorrelation,
        occurrenceClassification: "NonActionOccurrence",
        reviewManifest: acceptanceManifest
      }),
      decodeEntry({
        _tag: "IntegrationCandidateGitValidationFailed",
        attemptOrdinal: 1,
        candidateCommit: "b".repeat(40),
        correlation: candidateCorrelation,
        detail: "candidate validation failed",
        occurrenceClassification: "NonActionOccurrence"
      }),
      decodeEntry({
        _tag: "IntegrationCandidateCorrectionLimitReached",
        continuationLimit: 2,
        correctionCount: 2,
        correctionLimit: 2,
        correlation: candidateCorrelation,
        occurrenceClassification: "NonActionOccurrence"
      }),
      decodeEntry({
        _tag: "IntegrationCandidateContinuationLimitReached",
        continuationCount: 2,
        continuationLimit: 2,
        correlation: candidateCorrelation,
        occurrenceClassification: "NonActionOccurrence"
      }),
      decodeEntry({
        _tag: "TargetVerificationIntended",
        correlation: verificationCorrelation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction"
      }),
      decodeEntry({
        _tag: "TargetVerificationEvidenceSealed",
        correlation: verificationCorrelation,
        manifest: acceptanceManifest,
        occurrenceClassification: "NonActionOccurrence",
        terminal: "Passed"
      }),
      decodeEntry({
        _tag: "TargetVerificationCorrelationContradicted",
        expected: verificationCorrelation,
        occurrenceClassification: "NonActionOccurrence",
        received: { ...verificationCorrelation, candidateCommit: "c".repeat(40) }
      })
    ]
    const outerEntries = [
      decodeEntry({
        _tag: "IntegratorResultRecorded",
        result: { _tag: "PreparedCandidate", candidateText: "refs/heads/coverage", correlation: integratorCorrelation }
      }),
      decodeEntry({
        _tag: "IntegratorResultRecorded",
        result: { _tag: "NotPrepared", correlation: integratorCorrelation, detail: "no candidate" }
      }),
      decodeEntry({
        _tag: "IntegratorCandidateGitReadIntended",
        candidateText: "refs/heads/coverage",
        correlation: integratorCorrelation
      }),
      decodeEntry({
        _tag: "IntegratorCandidateGitObserved",
        candidateText: "refs/heads/coverage",
        correlation: integratorCorrelation,
        observation: { _tag: "Commit", candidateText: "refs/heads/coverage", commit: "b".repeat(40), directParents: [] }
      }),
      decodeEntry({ _tag: "IntegratorRunStarted", run: integratorRun }),
      decodeEntry({
        _tag: "IntegratorRunResultRecorded",
        result: { _tag: "PreparedCandidate", candidateText: "refs/heads/coverage", correlation: integratorCorrelation },
        run: integratorRun
      }),
      decodeEntry({
        _tag: "IntegratorRunCandidateGitReadIntended",
        candidateText: "refs/heads/coverage",
        run: integratorRun
      }),
      decodeEntry({
        _tag: "IntegratorRunCandidateGitObserved",
        candidateText: "refs/heads/coverage",
        observation: { _tag: "Missing", candidateText: "refs/heads/coverage" },
        run: integratorRun
      }),
      decodeEntry({
        _tag: "IntegrationQuarantined",
        basis: {
          _tag: "RetryTargetHeadChanged",
          direction: "Retry",
          directionAppliedAt: 2,
          observedTargetHead: "c".repeat(40),
          priorQuarantineAt: 1,
          targetLineageObservedAt: 3
        },
        correlation: integratorCorrelation,
        occurrenceClassification: "NonActionOccurrence"
      })
    ]
    const completionRequestEntry = recorded.entries.find((entry) => entry._tag === "CompletionTaskIntended")
    const completionEntries =
      completionRequestEntry?._tag === "CompletionTaskIntended"
        ? [
            decodeEntry({
              _tag: "CompletionTaskRequestLookupIntended",
              attemptOrdinal: 1,
              initiatedBy: { _tag: "DalphCoordinator" },
              occurrenceClassification: "InitiatedAction",
              operationId: "completion-lookup:coverage",
              request: completionRequestEntry.request
            }),
            ...(["Applied", "NotApplied", "Unreadable"] as const).map((lookupTag) =>
              decodeEntry({
                _tag: "CompletionTaskRequestLookupObserved",
                attemptOrdinal: 1,
                lookup:
                  lookupTag === "Unreadable"
                    ? { _tag: lookupTag, detail: "lookup unreadable", request: completionRequestEntry.request }
                    : { _tag: lookupTag, request: completionRequestEntry.request },
                occurrenceClassification: "NonActionOccurrence",
                operationId: `completion-lookup:coverage:${lookupTag}`,
                request: completionRequestEntry.request
              })
            )
          ]
        : []
    const focusedCompletionEntry = recorded.entries.find(
      (entry) => entry._tag === "TaskTrackerFactsObserved" && entry.evidence._tag === "FocusedTaskCompletionFacts"
    )
    const activeClaimEntry = recorded.entries.find((entry) => entry._tag === "TaskClaimAcquired")
    const focusedCompletionClaimVariants =
      focusedCompletionEntry?._tag === "TaskTrackerFactsObserved" &&
      focusedCompletionEntry.evidence._tag === "FocusedTaskCompletionFacts"
        ? [
            decodeEntry({
              ...focusedCompletionEntry,
              evidence: {
                ...focusedCompletionEntry.evidence,
                facts: {
                  ...focusedCompletionEntry.evidence.facts,
                  currentClaim: { _tag: "UnclaimedTask", taskId: focusedCompletionEntry.evidence.facts.taskId }
                }
              }
            }),
            ...(activeClaimEntry?._tag === "TaskClaimAcquired"
              ? [
                  decodeEntry({
                    ...focusedCompletionEntry,
                    evidence: {
                      ...focusedCompletionEntry.evidence,
                      facts: { ...focusedCompletionEntry.evidence.facts, currentClaim: activeClaimEntry.claim }
                    }
                  })
                ]
              : [])
          ]
        : []
    const syntheticEntries = [
      ...baseIntegrationEntries,
      ...privateEntries,
      ...focusedCompletionClaimVariants,
      ...outerEntries,
      ...completionEntries
    ]
    const syntheticCassette = RecordedCassette.make({
      entries: [...recorded.entries, ...syntheticEntries],
      runId: recorded.runId,
      schemaVersion: recorded.schemaVersion
    })
    const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
      attemptIds: [{ from: plannedAttempt.attemptId, to: "attempt:renamed" }],
      claimTokens: [],
      integrationCandidateIds: [
        { from: "candidate:coverage", to: "candidate:renamed" },
        { from: "candidate:coverage-successor", to: "candidate:renamed-successor" }
      ],
      integrationCandidateResourceLocators: [
        { from: "/candidate-resources/coverage", to: "/candidate-resources/renamed" },
        { from: "/candidate-resources/coverage-successor", to: "/candidate-resources/renamed-successor" }
      ],
      integrationSessionIds: [
        { from: "session:coverage", to: "session:renamed" },
        { from: "session:coverage-successor", to: "session:renamed-successor" }
      ],
      operationIds: [],
      runIds: [{ from: plannedAttempt.runId, to: "run:renamed" }],
      taskBranchRefs: [],
      worktreeLocators: []
    })
    const renamed = yield* renameRecordedCassette(syntheticCassette, renaming)
    const renamedSyntheticEntries = renamed.entries.slice(-syntheticEntries.length)
    expect(renamedSyntheticEntries.map((entry) => entry._tag)).toEqual(syntheticEntries.map((entry) => entry._tag))
    const renamedIdentities = [
      [plannedAttempt.attemptId, "attempt:renamed"],
      [plannedAttempt.runId, "run:renamed"],
      ["candidate:coverage", "candidate:renamed"],
      ["candidate:coverage-successor", "candidate:renamed-successor"],
      ["/candidate-resources/coverage", "/candidate-resources/renamed"],
      ["/candidate-resources/coverage-successor", "/candidate-resources/renamed-successor"],
      ["session:coverage", "session:renamed"],
      ["session:coverage-successor", "session:renamed-successor"],
      ["verification-request:coverage", "target-verification:candidate:renamed"]
    ] as const
    const renamedJson = JSON.stringify(renamedSyntheticEntries)
    for (const [original, replacement] of renamedIdentities) {
      expect(renamedJson, `must remove every exact occurrence of ${original}`).not.toContain(JSON.stringify(original))
      expect(renamedJson, `must materialize the replacement ${replacement}`).toContain(JSON.stringify(replacement))
    }
    const renamedPrivateEntries = renamedSyntheticEntries.slice(
      baseIntegrationEntries.length,
      baseIntegrationEntries.length + privateEntries.length
    )
    expect(foldRecordedCassette(syntheticCassette)._tag).toBe("InvalidWorkflowJournalHistory")
    const lyricsCassette = RecordedCassette.make({
      entries: [...recorded.entries, ...syntheticEntries],
      runId: recorded.runId,
      schemaVersion: recorded.schemaVersion
    })
    const lyrics = renderRecordedCassetteLyrics(lyricsCassette)
    expect(lyrics).toContain("Dalph coordinator began candidate candidate:coverage")
    expect(lyrics).toContain("The target repository's public verification wrapper returned Passed")
    const renamedConstruction = renamedPrivateEntries[0]
    expect(renamedConstruction).toMatchObject({
      _tag: "IntegrationCandidateConstructionIntended",
      correlation: {
        attemptId: "attempt:renamed",
        candidateId: "candidate:renamed",
        candidateResource: "/candidate-resources/renamed",
        integrationSessionId: "session:renamed",
        runId: "run:renamed"
      }
    })
  }).pipe(Effect.provide(NodeCrypto.layer))
)
