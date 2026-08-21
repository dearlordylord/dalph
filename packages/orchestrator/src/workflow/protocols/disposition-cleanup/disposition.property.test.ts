import fc from "fast-check"
import { Effect, Layer } from "effect"
import { expect, it } from "vitest"
import {
  AcceptedResult,
  EvidenceDigest,
  EvidenceReference,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  TaskBranchRef,
  WorktreeLocator
} from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { OperationId } from "../../identity.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "../integrator/events.js"
import {
  BranchCleanupAuthorization,
  BranchCleanupEvidenceRevision,
  BranchCleanupOwner,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner,
  PlannedAttemptCleanupDisposition,
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision
} from "./disposition.js"
import {
  BranchCleanupObservation,
  BranchCleanupMutationResult,
  branchCleanupTestLayer,
  runBranchCleanup,
  TestBranchCleanupBoundary
} from "./branch.js"
import {
  IntegratorCandidateCleanupObservation,
  IntegratorCandidateCleanupMutationResult,
  integratorCandidateCleanupTestLayer,
  runIntegratorCandidateCleanup,
  TestIntegratorCandidateCleanupBoundary
} from "./integrator-candidate.js"
import {
  runWorktreeCleanup,
  TestWorktreeCleanupBoundary,
  worktreeCleanupTestLayer,
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservation
} from "./worktree.js"
import { attempt, authorization, baseSha, runId, successor } from "./fixtures.js"
import {
  appendAbandonedProvenance,
  appendCandidateProvenance,
  appendReplacementProvenance
} from "./provenance-fixtures.js"
import { deriveCleanupAuthorizations } from "./activation.js"

type PropertyCase = {
  readonly disposition: "Abandoned" | "Settled" | "Superseded"
  readonly exact: boolean
  readonly locatorMatches: boolean
  readonly ownerMatches: boolean
  readonly revisionMatches: boolean
}

const candidateAcceptedResult = AcceptedResult.make({
  commit: baseSha,
  evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) })
})
const candidateTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("repo:issue-69-property")
})
const candidatePredecessor = IntegratorSessionCorrelation.make({
  acceptedResult: candidateAcceptedResult,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-property-p1"),
  expectedTargetHead: baseSha,
  integrationTarget: candidateTarget,
  plannedAttempt: attempt,
  queuedAt: JournalPosition.make(2),
  sessionId: IntegratorSessionId.make("session:issue-69-property-p1"),
  startedAt: JournalPosition.make(6),
  targetLineageObservedAt: JournalPosition.make(4)
})
const candidateSuccessor = IntegratorSessionCorrelation.make({
  ...candidatePredecessor,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-property-p2"),
  sessionId: IntegratorSessionId.make("session:issue-69-property-p2"),
  targetLineageObservedAt: JournalPosition.make(12)
})
const candidateDisposition = IntegratorCandidateCleanupDisposition.make({
  directionAppliedAt: JournalPosition.make(10),
  dispositionAt: JournalPosition.make(9),
  predecessor: candidatePredecessor,
  successor: candidateSuccessor
})
const candidateAuthorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("issue-69-property-full-rerun")],
  disposition: candidateDisposition,
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: candidatePredecessor.candidateResource,
  observationAt: JournalPosition.make(4),
  observationOperationId: OperationId.make("session:issue-69-property-p1:predecessor-lineage"),
  operationId: OperationId.make("issue-69-property-candidate-cleanup"),
  owner: IntegratorCandidateCleanupOwner.make({ sessionId: candidatePredecessor.sessionId }),
  writerQuiescent: true
})

const settledWorktreeAuthorization = WorktreeCleanupAuthorization.make({
  ...authorization,
  disposition: PlannedAttemptCleanupDisposition.cases.Settled.make({
    dispositionAt: JournalPosition.make(19),
    plannedAttempt: attempt,
    settlementOperationId: OperationId.make("issue-69-property-settlement")
  })
})

const branchAuthorizationFor = (worktree: WorktreeCleanupAuthorization) =>
  BranchCleanupAuthorization.make({
    causalPredecessors: [worktree.operationId, ...worktree.causalPredecessors],
    disposition: worktree.disposition,
    evidenceRevision: BranchCleanupEvidenceRevision.make(1),
    expectedHead: baseSha,
    locator: attempt.branch,
    observationAt: worktree.observationAt,
    observationOperationId: worktree.observationOperationId,
    operationId: OperationId.make("issue-69-property-branch-cleanup"),
    owner: BranchCleanupOwner.make({ attemptId: attempt.attemptId }),
    worktreeCleanupOperationId: worktree.operationId,
    writerQuiescent: true
  })

const worktreeObservationFor = (value: PropertyCase, exact: boolean): WorktreeCleanupObservation => {
  const revisionMatches = exact && value.revisionMatches && value.disposition === "Superseded"
  if (exact) {
    return WorktreeCleanupObservation.cases.Present.make({
      attemptId: attempt.attemptId,
      branch: attempt.branch,
      headSha: baseSha,
      locator: attempt.worktree,
      revision: WorktreeCleanupEvidenceRevision.make(1),
      writerQuiescent: true
    })
  }
  if (!value.locatorMatches || !value.ownerMatches) {
    return WorktreeCleanupObservation.cases.Foreign.make({
      locator: value.locatorMatches ? attempt.worktree : WorktreeLocator.make("/tmp/issue-69-property-foreign"),
      observedBranch: value.ownerMatches ? attempt.branch : TaskBranchRef.make("refs/heads/task/foreign"),
      observedHead: baseSha,
      reason: value.ownerMatches ? "MovedRegistration" : "OtherOwner",
      revision: WorktreeCleanupEvidenceRevision.make(revisionMatches ? 1 : 2)
    })
  }
  return WorktreeCleanupObservation.cases.Present.make({
    attemptId: attempt.attemptId,
    branch: attempt.branch,
    headSha: baseSha,
    locator: attempt.worktree,
    revision: WorktreeCleanupEvidenceRevision.make(revisionMatches ? 1 : 2),
    writerQuiescent: true
  })
}

const branchObservationFor = (value: PropertyCase, exact: boolean): BranchCleanupObservation => {
  const revisionMatches = exact && value.revisionMatches && value.disposition === "Superseded"
  if (exact) {
    return BranchCleanupObservation.cases.Present.make({
      branch: attempt.branch,
      headSha: baseSha,
      registeredWorktree: null,
      revision: BranchCleanupEvidenceRevision.make(1)
    })
  }
  if (!value.locatorMatches) {
    return BranchCleanupObservation.cases.Foreign.make({
      branch: TaskBranchRef.make("refs/heads/task/foreign"),
      observedHead: baseSha,
      observedWorktree: attempt.worktree,
      reason: "OtherOwner",
      revision: BranchCleanupEvidenceRevision.make(revisionMatches ? 1 : 2)
    })
  }
  return BranchCleanupObservation.cases.Present.make({
    branch: attempt.branch,
    headSha: baseSha,
    registeredWorktree: value.ownerMatches ? null : attempt.worktree,
    revision: BranchCleanupEvidenceRevision.make(revisionMatches ? 1 : 2)
  })
}

const candidateObservationFor = (value: PropertyCase, exact: boolean): IntegratorCandidateCleanupObservation => {
  const revisionMatches = exact && value.revisionMatches && value.disposition === "Superseded"
  if (exact) {
    return IntegratorCandidateCleanupObservation.cases.Present.make({
      locator: candidatePredecessor.candidateResource,
      revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
      sessionId: candidatePredecessor.sessionId,
      writerQuiescent: true
    })
  }
  if (!value.locatorMatches) {
    return IntegratorCandidateCleanupObservation.cases.Foreign.make({
      locator: IntegratorCandidateResourceLocator.make("candidate:issue-69-property-foreign"),
      observedSessionId: candidatePredecessor.sessionId,
      reason: "Transferred",
      revision: IntegratorCandidateCleanupEvidenceRevision.make(revisionMatches ? 1 : 2)
    })
  }
  return IntegratorCandidateCleanupObservation.cases.Present.make({
    locator: candidatePredecessor.candidateResource,
    revision: IntegratorCandidateCleanupEvidenceRevision.make(revisionMatches ? 1 : 2),
    sessionId: value.ownerMatches
      ? candidatePredecessor.sessionId
      : IntegratorSessionId.make("session:issue-69-property-foreign"),
    writerQuiescent: true
  })
}

const runPropertyCase = Effect.fn("DispositionCleanup.propertyCase")(function* (value: PropertyCase) {
  const journal = yield* JournalStore
  yield* journal.beginRun(
    runId,
    FixtureTarget.make("issue-69-disposition-property"),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  if (value.disposition === "Superseded") {
    yield* appendCandidateProvenance(candidatePredecessor, candidateSuccessor, "issue-69-property-full-rerun")
    yield* appendReplacementProvenance(attempt, successor)
  }
  const worktree =
    value.disposition === "Superseded"
      ? (deriveCleanupAuthorizations(yield* journal.read(runId)).worktree[0] ?? authorization)
      : value.disposition === "Abandoned"
        ? yield* appendAbandonedProvenance(attempt, OperationId.make("issue-69-property-abandoned-cleanup"))
        : settledWorktreeAuthorization
  const exactFacts =
    value.exact &&
    value.disposition !== "Settled" &&
    value.locatorMatches &&
    value.ownerMatches &&
    value.revisionMatches
  const candidateBase =
    value.disposition === "Superseded"
      ? (deriveCleanupAuthorizations(yield* journal.read(runId)).candidate[0] ?? candidateAuthorization)
      : candidateAuthorization
  const candidate =
    value.disposition === "Superseded"
      ? candidateBase
      : IntegratorCandidateCleanupAuthorization.make({
          ...candidateBase,
          causalPredecessors: [OperationId.make("issue-69-property-foreign-cause")]
        })
  const branch = branchAuthorizationFor(worktree)
  const outcomes = {
    worktree: yield* runWorktreeCleanup(worktree),
    branch: yield* runBranchCleanup(branch),
    candidate: yield* runIntegratorCandidateCleanup(candidate)
  }
  return {
    calls: {
      branch: yield* (yield* TestBranchCleanupBoundary).calls(),
      candidate: yield* (yield* TestIntegratorCandidateCleanupBoundary).calls(),
      worktree: yield* (yield* TestWorktreeCleanupBoundary).calls()
    },
    exactFacts,
    outcomes
  }
})

it("runs all three cleanup families for independently varied facts without a destructive call", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(
        fc.constantFrom<PropertyCase>(
          { disposition: "Abandoned", exact: true, locatorMatches: true, ownerMatches: true, revisionMatches: true },
          { disposition: "Superseded", exact: true, locatorMatches: true, ownerMatches: true, revisionMatches: true }
        ),
        fc.record({
          disposition: fc.constantFrom<PropertyCase["disposition"]>("Abandoned", "Settled", "Superseded"),
          exact: fc.boolean(),
          locatorMatches: fc.boolean(),
          ownerMatches: fc.boolean(),
          revisionMatches: fc.boolean()
        })
      ),
      async (value) => {
        const result = await Effect.runPromise(
          runPropertyCase(value).pipe(
            Effect.provide(
              Layer.mergeAll(
                branchCleanupTestLayer({
                  observations: [
                    branchObservationFor(
                      value,
                      value.exact && value.locatorMatches && value.ownerMatches && value.revisionMatches
                    ),
                    ...(value.exact && value.locatorMatches && value.ownerMatches && value.revisionMatches
                      ? [
                          BranchCleanupObservation.cases.Absent.make({
                            branch: attempt.branch,
                            revision: BranchCleanupEvidenceRevision.make(1)
                          })
                        ]
                      : [])
                  ],
                  mutations:
                    value.exact && value.locatorMatches && value.ownerMatches && value.revisionMatches
                      ? [
                          BranchCleanupMutationResult.cases.Removed.make({
                            branch: attempt.branch,
                            revision: BranchCleanupEvidenceRevision.make(1)
                          })
                        ]
                      : []
                }),
                integratorCandidateCleanupTestLayer({
                  observations: [
                    candidateObservationFor(
                      value,
                      value.exact &&
                        value.disposition === "Superseded" &&
                        value.locatorMatches &&
                        value.ownerMatches &&
                        value.revisionMatches
                    ),
                    ...(value.exact &&
                    value.disposition === "Superseded" &&
                    value.locatorMatches &&
                    value.ownerMatches &&
                    value.revisionMatches
                      ? [
                          IntegratorCandidateCleanupObservation.cases.Absent.make({
                            locator: candidatePredecessor.candidateResource,
                            revision: IntegratorCandidateCleanupEvidenceRevision.make(1)
                          })
                        ]
                      : [])
                  ],
                  mutations:
                    value.exact &&
                    value.disposition === "Superseded" &&
                    value.locatorMatches &&
                    value.ownerMatches &&
                    value.revisionMatches
                      ? [
                          IntegratorCandidateCleanupMutationResult.cases.Removed.make({
                            locator: candidatePredecessor.candidateResource,
                            revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
                            sessionId: candidatePredecessor.sessionId
                          })
                        ]
                      : []
                }),
                memoryJournalTestLayer,
                worktreeCleanupTestLayer({
                  observations: [
                    worktreeObservationFor(
                      value,
                      value.exact && value.locatorMatches && value.ownerMatches && value.revisionMatches
                    ),
                    ...(value.exact && value.locatorMatches && value.ownerMatches && value.revisionMatches
                      ? [
                          WorktreeCleanupObservation.cases.Absent.make({
                            locator: attempt.worktree,
                            revision: WorktreeCleanupEvidenceRevision.make(1)
                          })
                        ]
                      : [])
                  ],
                  mutations:
                    value.exact && value.locatorMatches && value.ownerMatches && value.revisionMatches
                      ? [
                          WorktreeCleanupMutationResult.cases.Removed.make({
                            branch: attempt.branch,
                            locator: attempt.worktree,
                            revision: WorktreeCleanupEvidenceRevision.make(1)
                          })
                        ]
                      : []
                })
              )
            )
          )
        )
        const exactFacts =
          value.exact &&
          value.disposition !== "Settled" &&
          value.locatorMatches &&
          value.ownerMatches &&
          value.revisionMatches
        const exactCandidate = exactFacts && value.disposition === "Superseded"
        expect(result.exactFacts).toBe(exactFacts)
        expect(result.outcomes.worktree._tag).toBe(exactFacts ? "Settled" : "Preserved")
        expect(result.outcomes.branch._tag).toBe(exactFacts ? "Settled" : "Preserved")
        expect(result.outcomes.candidate._tag).toBe(exactCandidate ? "Settled" : "Preserved")
        expect(result.calls.worktree.some(({ _tag }) => _tag === "Remove")).toBe(exactFacts)
        expect(result.calls.branch.some(({ _tag }) => _tag === "Remove")).toBe(exactFacts)
        expect(result.calls.candidate.some(({ _tag }) => _tag === "Remove")).toBe(exactCandidate)
      }
    ),
    { numRuns: 24 }
  )
})
