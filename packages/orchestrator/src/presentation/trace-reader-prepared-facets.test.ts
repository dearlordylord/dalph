import { expect, it } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Result } from "effect"
import {
  RunId,
  TaskId,
  TaskRevision,
  AcceptedResult,
  EvidenceReference,
  EvidenceDigest,
  IntegrationTarget,
  IntegrationTargetRef,
  GitRepositoryLocator
} from "@dalph/contracts"
import { JournalPosition } from "../workflow-journal/identity.js"
import { ControlDirectionApplicationOrdinal } from "../workflow/protocols/control-direction-application/events.js"
import { AppliedControlDirection } from "../workflow/registry/occurrence-projection.js"
import {
  TraceBranchCleanupStep,
  TraceBranchCleanupProgress,
  TraceIntegratorCandidateCleanupStep,
  TraceIntegratorCandidateCleanupProgress,
  TraceWorktreeCleanupStep,
  TraceWorktreeCleanupProgress,
  TraceCleanupStatus,
  TraceControlDispositionFacet,
  TraceControlFact,
  TraceDispositionFact,
  TraceObservationGap,
  TracePreservationDisposition,
  TraceRetainedResponsibility,
  TraceIntegrationFact,
  TraceHistoricalFacets,
  TraceHistoryItem,
  makeTraceReader,
  TraceCursor
} from "./trace-reader.js"
import { InRunJournal, type JournalRecord } from "../workflow-journal/store.js"
import { dispositionCleanupLiveJournalTestLayer } from "../workflow/protocols/disposition-cleanup/live-journal-test.js"
import {
  appendReplacementProvenance,
  appendCandidateProvenance
} from "../workflow/protocols/disposition-cleanup/provenance-fixtures.js"
import {
  attempt,
  successor,
  authorization,
  runId as cleanupRunId
} from "../workflow/protocols/disposition-cleanup/fixtures.js"
import { deriveCleanupAuthorizations } from "../workflow/protocols/disposition-cleanup/activation.js"
import { PlannedAttemptReplacedEvent } from "../workflow/protocols/attempt-choice/replacement-events.js"
import {
  WorktreeCleanupEvidenceRevision,
  BranchCleanupEvidenceRevision,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner
} from "../workflow/protocols/disposition-cleanup/disposition.js"
import {
  runWorktreeCleanup,
  worktreeCleanupTestLayer,
  WorktreeCleanupObservation,
  WorktreeCleanupMutationResult
} from "../workflow/protocols/disposition-cleanup/worktree.js"
import {
  runBranchCleanup,
  branchCleanupTestLayer,
  BranchCleanupObservation,
  BranchCleanupMutationResult
} from "../workflow/protocols/disposition-cleanup/branch.js"
import { OperationId } from "../workflow/identity.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "../workflow/protocols/integrator/events.js"
import {
  IntegratorSuccessorPreparationInput,
  integratorSuccessorCorrelationFor
} from "../workflow/protocols/integrator/session.js"
import {
  runIntegratorCandidateCleanup,
  integratorCandidateCleanupTestLayer,
  IntegratorCandidateCleanupObservation,
  IntegratorCandidateCleanupMutationResult
} from "../workflow/protocols/disposition-cleanup/integrator-candidate.js"
import {
  prepareTraceHistoricalFacets,
  traceHistoricalFacetsAt,
  type HistoricalFacetFactories
} from "./trace-reader-historical-facets.js"

const factories: HistoricalFacetFactories = {
  branchCleanupStep: TraceBranchCleanupStep,
  cleanupProgress: {
    Branch: TraceBranchCleanupProgress,
    IntegratorCandidate: TraceIntegratorCandidateCleanupProgress,
    Worktree: TraceWorktreeCleanupProgress
  },
  cleanupStatus: TraceCleanupStatus.cases,
  controlDisposition: TraceControlDispositionFacet,
  controlFact: TraceControlFact.cases,
  dispositionFact: TraceDispositionFact.cases,
  integratorCandidateCleanupStep: TraceIntegratorCandidateCleanupStep,
  observationGap: TraceObservationGap.cases,
  preservationDisposition: TracePreservationDisposition.cases,
  retainedResponsibility: TraceRetainedResponsibility.cases,
  integrationFact: TraceIntegrationFact.cases,
  worktreeCleanupStep: TraceWorktreeCleanupStep,
  facets: TraceHistoricalFacets
}
const runId = RunId.make("prepared-facet-controls")
const taskId = TaskId.make("A")
const controls = (size: number): ReadonlyArray<TraceHistoryItem> =>
  Array.from({ length: size }, (_, index) => {
    const position = JournalPosition.make(index + 1)
    return TraceHistoryItem.make({
      identity: TraceCursor.make({ position, runId }),
      operationIds: [],
      taskIds: [taskId],
      occurrence: AppliedControlDirection.make({
        direction: index % 2 === 0 ? "Pause" : "Unpause",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: ControlDirectionApplicationOrdinal.make(index + 1),
        recordedAt: position,
        subject: { _tag: "Task", runId, taskId }
      })
    })
  })

it("prepared controls equal the independent cold fold at every cursor and keep earlier views immutable", () => {
  const items = controls(16)
  const prepared = prepareTraceHistoricalFacets(items, factories)
  const first = prepared.at(JournalPosition.make(1))
  for (let position = 1; position <= items.length; position += 1) {
    expect(prepared.at(JournalPosition.make(position))).toEqual(
      traceHistoricalFacetsAt(items.slice(0, position), factories)
    )
  }
  expect(first).toEqual(traceHistoricalFacetsAt(items.slice(0, 1), factories))
  expect(prepareTraceHistoricalFacets([], factories).at(JournalPosition.make(1))).toEqual(
    traceHistoricalFacetsAt([], factories)
  )
})

it("N and 2N control preparation visits each source twice; selecting zero-output prefixes uses binary ledger cuts", () => {
  for (const size of [64, 128]) {
    const prepared = prepareTraceHistoricalFacets(controls(size), factories)
    expect(prepared.counts().sourceVisits).toBe(size * 2)
    expect(prepared.counts().lookupVisits).toBe(size)
    expect(prepared.at(JournalPosition.make(1)).controlDisposition.controls).toHaveLength(1)
    expect(prepared.counts().selectionVisits).toBeLessThanOrEqual(Math.ceil(Math.log2(size)) + 1)
    expect(prepared.counts().cleanupHeads).toBe(0)
  }
})

const exactFacetPrefixes = Effect.fn("PreparedFacetTest.exactPrefixes")(function* (
  records: ReadonlyArray<JournalRecord>
) {
  const last = records.at(-1)
  if (last === undefined) return yield* Effect.die("prepared facet fixture has no records")
  const reader = makeTraceReader({ read: () => Effect.succeed(records) })
  const warm = yield* reader.prepare(last.runId)
  const full = Result.getOrThrow(warm.select(TraceCursor.make({ position: last.position, runId: last.runId })))
  const facets = prepareTraceHistoricalFacets(full.items, factories)
  let gaps = 0
  let pending = 0
  for (const item of full.items) {
    const position = item.identity.position
    const expected = traceHistoricalFacetsAt(
      full.items.filter((candidate) => candidate.identity.position <= position),
      factories
    )
    const selected = facets.at(position)
    expect(selected).toEqual(expected)
    expect(Result.getOrThrow(warm.select(TraceCursor.make({ position, runId: last.runId }))).facets).toEqual(expected)
    gaps += selected.recovery.observationGaps.length
    pending += selected.recovery.preservationDispositions.filter(({ _tag }) => _tag === "ReplacementPending").length
  }
  return { facets, full, gaps, pending }
})

effectIt.effect(
  "warm replacement gaps, source-version responsibility order, and complete worktree/branch chains equal every cold prefix",
  () =>
    Effect.gen(function* () {
      const journal = yield* InRunJournal
      yield* appendReplacementProvenance(attempt, successor, "StartupValid")
      const worktree = yield* runWorktreeCleanup(authorization)
      expect(worktree._tag).toBe("Settled")
      const branchAuthorization = deriveCleanupAuthorizations(yield* journal.read(cleanupRunId)).branch[0]
      if (branchAuthorization === undefined) return yield* Effect.die("fixture lacks derived branch authorization")
      expect((yield* runBranchCleanup(branchAuthorization))._tag).toBe("Settled")
      const records = yield* journal.read(cleanupRunId)
      const { facets, full, gaps, pending } = yield* exactFacetPrefixes(records)
      const rewritten = records.map(
        (record): JournalRecord =>
          record.event._tag === "PlannedAttemptReplaced"
            ? {
                ...record,
                event: PlannedAttemptReplacedEvent.make({
                  ...record.event,
                  subject: {
                    ...record.event.subject,
                    observedTaskRevision: TaskRevision.make("foreign-authored-fingerprint")
                  },
                  successorPlan: {
                    ...record.event.successorPlan,
                    plannedAttempt: {
                      ...record.event.successorPlan.plannedAttempt,
                      taskRevision: TaskRevision.make("foreign-authored-fingerprint")
                    }
                  }
                })
              }
            : record
      )
      const malformed = yield* makeTraceReader({ read: () => Effect.succeed(rewritten) }).prepare(cleanupRunId)
      const invalid = malformed.select(full.cursor)
      const coldInvalid = yield* Effect.result(
        makeTraceReader({ read: () => Effect.succeed(rewritten) }).read(cleanupRunId)
      )
      expect(invalid).toEqual(coldInvalid)
      expect(Result.isFailure(invalid)).toBe(true)
      if (Result.isFailure(invalid)) {
        expect(invalid.failure._tag).toBe("TraceProjectionInvalid")
        if (invalid.failure._tag === "TraceProjectionInvalid")
          expect(invalid.failure.detail).toBe(
            "Worktree cleanup provenance: replacement provenance names a foreign successor attempt"
          )
      }
      const choice = full.items.find(({ occurrence }) => occurrence._tag === "AppliedAttemptChoice")
      if (choice === undefined) return yield* Effect.die("fixture lacks applied replacement choice")
      const early = Result.getOrThrow(
        malformed.select(TraceCursor.make({ position: choice.identity.position, runId: cleanupRunId }))
      )
      expect(early.facets).toEqual(facets.at(choice.identity.position))
      expect(early.facets.recovery.preservationDispositions.some(({ _tag }) => _tag === "ReplacementPending")).toBe(
        true
      )
      expect(gaps).toBeGreaterThan(0)
      expect(pending).toBeGreaterThan(0)
      const firstCleanup = full.items.find(({ occurrence }) => occurrence._tag === "WorktreeCleanupOccurred")
      if (firstCleanup === undefined) return yield* Effect.die("fixture lacks first worktree cleanup occurrence")
      const old = facets.at(firstCleanup.identity.position)
      const final = facets.at(full.cursor.position)
      expect(final.controlDisposition.cleanup.map(({ _tag }) => _tag)).toEqual(["Worktree", "Branch"])
      for (const progress of final.controlDisposition.cleanup) {
        expect(progress.status._tag).toBe("Settled")
        expect(progress.steps).toHaveLength(9)
        expect(progress.steps[0]?.event.authorization).toEqual(progress.authorization)
        expect(progress.steps.map(({ source }) => source.position)).toEqual(
          progress.steps.map(({ source }) => source.position).toSorted((left, right) => left - right)
        )
      }
      expect(final.recovery.preservationDispositions.some(({ _tag }) => _tag === "ReplacementPending")).toBe(false)
      expect(final.recovery.retainedResponsibilities.map(({ source }) => source.position)).toEqual(
        final.recovery.retainedResponsibilities
          .map(({ source }) => source.position)
          .toSorted((left, right) => left - right)
      )
      expect(old).toEqual(
        traceHistoricalFacetsAt(
          full.items.filter(({ identity }) => identity.position <= firstCleanup.identity.position),
          factories
        )
      )
      expect(facets.counts().cleanupHeads).toBe(18)
      expect(facets.counts().cleanupStepReferences).toBe(18)
    }).pipe(
      Effect.provide(
        branchCleanupTestLayer({
          observations: [
            BranchCleanupObservation.cases.Present.make({
              branch: attempt.branch,
              headSha: attempt.baseSha,
              registeredWorktree: null,
              revision: BranchCleanupEvidenceRevision.make(1)
            }),
            BranchCleanupObservation.cases.Absent.make({
              branch: attempt.branch,
              revision: BranchCleanupEvidenceRevision.make(2)
            })
          ],
          mutations: [
            BranchCleanupMutationResult.cases.Removed.make({
              branch: attempt.branch,
              revision: BranchCleanupEvidenceRevision.make(2)
            })
          ]
        })
      ),
      Effect.provide(
        worktreeCleanupTestLayer({
          observations: [
            WorktreeCleanupObservation.cases.Present.make({
              attemptId: attempt.attemptId,
              branch: attempt.branch,
              headSha: attempt.baseSha,
              locator: attempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(1),
              writerQuiescent: true
            }),
            WorktreeCleanupObservation.cases.Absent.make({
              locator: attempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(2)
            })
          ],
          mutations: [
            WorktreeCleanupMutationResult.cases.Removed.make({
              branch: attempt.branch,
              locator: attempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(2)
            })
          ]
        })
      ),
      Effect.provide(dispositionCleanupLiveJournalTestLayer())
    )
)

const candidatePredecessor = IntegratorSessionCorrelation.make({
  acceptedResult: AcceptedResult.make({
    commit: attempt.baseSha,
    evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) })
  }),
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-83-predecessor"),
  expectedTargetHead: attempt.baseSha,
  integrationTarget: IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("repo:issue-83-candidate")
  }),
  plannedAttempt: attempt,
  queuedAt: JournalPosition.make(17),
  sessionId: IntegratorSessionId.make("session:issue-83-predecessor"),
  startedAt: JournalPosition.make(18),
  targetLineageObservedAt: JournalPosition.make(20)
})
const candidateSuccessor = integratorSuccessorCorrelationFor(
  IntegratorSuccessorPreparationInput.make({
    directionAppliedAt: JournalPosition.make(25),
    predecessor: candidatePredecessor,
    quarantineAt: JournalPosition.make(24),
    targetLineage: {
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: attempt.baseSha,
      targetHeadSha: attempt.baseSha
    },
    targetLineageObservedAt: JournalPosition.make(27)
  })
)
const candidateAuthorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("issue-83-candidate-full-rerun")],
  disposition: IntegratorCandidateCleanupDisposition.make({
    directionAppliedAt: JournalPosition.make(25),
    dispositionAt: JournalPosition.make(24),
    predecessor: candidatePredecessor,
    successor: candidateSuccessor
  }),
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: candidatePredecessor.candidateResource,
  observationAt: candidatePredecessor.targetLineageObservedAt,
  observationOperationId: OperationId.make(`${candidatePredecessor.sessionId}:predecessor-lineage`),
  operationId: OperationId.make("issue-83-candidate-cleanup"),
  owner: IntegratorCandidateCleanupOwner.make({ sessionId: candidatePredecessor.sessionId }),
  writerQuiescent: true
})

effectIt.effect(
  "warm Integrator-candidate cleanup retains first authorization and every ordered status/step at each cold prefix",
  () =>
    Effect.gen(function* () {
      const journal = yield* InRunJournal
      yield* appendCandidateProvenance(
        candidatePredecessor,
        candidateSuccessor,
        "issue-83-candidate-full-rerun",
        "StartupValid"
      )
      expect((yield* runIntegratorCandidateCleanup(candidateAuthorization))._tag).toBe("Settled")
      const { facets, full, gaps } = yield* exactFacetPrefixes(yield* journal.read(cleanupRunId))
      expect(gaps).toBeGreaterThan(0)
      const first = full.items.find(({ occurrence }) => occurrence._tag === "IntegratorCandidateCleanupOccurred")
      if (first === undefined) return yield* Effect.die("fixture lacks candidate cleanup")
      const old = facets.at(first.identity.position)
      const final = facets.at(full.cursor.position)
      expect(final.controlDisposition.cleanup).toHaveLength(1)
      const cleanup = final.controlDisposition.cleanup[0]
      expect(cleanup?._tag).toBe("IntegratorCandidate")
      expect(cleanup?.authorization).toEqual(candidateAuthorization)
      expect(cleanup?.status._tag).toBe("Settled")
      expect(cleanup?.steps).toHaveLength(9)
      expect(cleanup?.steps.map(({ source }) => source.position)).toEqual(
        cleanup?.steps.map(({ source }) => source.position).toSorted((left, right) => left - right)
      )
      expect(old).toEqual(
        traceHistoricalFacetsAt(
          full.items.filter(({ identity }) => identity.position <= first.identity.position),
          factories
        )
      )
      expect(facets.counts().cleanupHeads).toBe(9)
      expect(facets.counts().cleanupStepReferences).toBe(9)
    }).pipe(
      Effect.provide(
        integratorCandidateCleanupTestLayer({
          observations: [
            IntegratorCandidateCleanupObservation.cases.Present.make({
              locator: candidatePredecessor.candidateResource,
              revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
              sessionId: candidatePredecessor.sessionId,
              writerQuiescent: true
            }),
            IntegratorCandidateCleanupObservation.cases.Absent.make({
              locator: candidatePredecessor.candidateResource,
              revision: IntegratorCandidateCleanupEvidenceRevision.make(2)
            })
          ],
          mutations: [
            IntegratorCandidateCleanupMutationResult.cases.Removed.make({
              locator: candidatePredecessor.candidateResource,
              revision: IntegratorCandidateCleanupEvidenceRevision.make(2),
              sessionId: candidatePredecessor.sessionId
            })
          ]
        })
      ),
      Effect.provide(dispositionCleanupLiveJournalTestLayer())
    )
)
