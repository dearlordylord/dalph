import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  AcceptedResult,
  EvidenceDigest,
  EvidenceReference,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  TaskId
} from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import { attempt, authorization, baseSha, disposition, runId, successor } from "./fixtures.js"
import {
  appendAbandonedProvenance,
  appendCandidateProvenance,
  appendReplacementProvenance
} from "./provenance-fixtures.js"
import {
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner,
  WorktreeCleanupAuthorization
} from "./disposition.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "../integrator/events.js"
import { validateIntegratorCandidateCleanupProvenance, validateWorktreeCleanupProvenance } from "./provenance.js"
import { deriveCleanupAuthorizations } from "./activation.js"

const begin = (target: string) =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make(target),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    return journal
  })

const without = (
  records: ReadonlyArray<Parameters<typeof validateWorktreeCleanupProvenance>[0][number]>,
  predicate: (record: Parameters<typeof validateWorktreeCleanupProvenance>[0][number]) => boolean
) => records.filter((record) => !predicate(record))

const withForeignKey = (
  records: ReadonlyArray<Parameters<typeof validateWorktreeCleanupProvenance>[0][number]>,
  predicate: (record: Parameters<typeof validateWorktreeCleanupProvenance>[0][number]) => boolean
) => records.map((record) => (predicate(record) ? { ...record, key: JournalRecordKey.make("foreign-key") } : record))

const candidateAcceptedResult = AcceptedResult.make({
  commit: baseSha,
  evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) })
})
const candidateTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("repo:issue-69-provenance-negative"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const candidatePredecessor = IntegratorSessionCorrelation.make({
  acceptedResult: candidateAcceptedResult,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-provenance-negative-p1"),
  expectedTargetHead: baseSha,
  integrationTarget: candidateTarget,
  plannedAttempt: attempt,
  queuedAt: JournalPosition.make(2),
  sessionId: IntegratorSessionId.make("session:issue-69-provenance-negative-p1"),
  startedAt: JournalPosition.make(6),
  targetLineageObservedAt: JournalPosition.make(4)
})
const candidateSuccessor = IntegratorSessionCorrelation.make({
  ...candidatePredecessor,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-provenance-negative-p2"),
  sessionId: IntegratorSessionId.make("session:issue-69-provenance-negative-p2"),
  targetLineageObservedAt: JournalPosition.make(12)
})
const candidateAuthorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("candidate-negative")],
  disposition: IntegratorCandidateCleanupDisposition.make({
    directionAppliedAt: JournalPosition.make(10),
    dispositionAt: JournalPosition.make(9),
    predecessor: candidatePredecessor,
    successor: candidateSuccessor
  }),
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: candidatePredecessor.candidateResource,
  observationAt: JournalPosition.make(4),
  observationOperationId: OperationId.make(`${candidatePredecessor.sessionId}:predecessor-lineage`),
  operationId: OperationId.make("candidate-cleanup"),
  owner: IntegratorCandidateCleanupOwner.make({ sessionId: candidatePredecessor.sessionId }),
  writerQuiescent: true
})

it.effect("preserves worktree cleanup when replacement provenance loses one upstream witness", () =>
  Effect.gen(function* () {
    const journal = yield* begin("issue-69-replacement-negative-matrix")
    yield* appendReplacementProvenance(attempt, successor)
    const records = yield* journal.read(runId)
    const eventCases: ReadonlyArray<readonly [string, (record: (typeof records)[number]) => boolean]> = [
      ["replacement", (record) => record.event._tag === "PlannedAttemptReplaced"],
      ["restart choice", (record) => record.event._tag === "AttemptChoiceApplied"],
      ["quiescence report", (record) => record.event._tag === "PlannedAttemptExecutorWorkReported"],
      ["claim outcome", (record) => record.event._tag === "TaskClaimAcquired"],
      [
        "graph outcome",
        (record) => record.event._tag === "TaskTrackerFactsObserved" && record.event.operationId.includes(":graph")
      ],
      [
        "specification outcome",
        (record) =>
          record.event._tag === "TaskTrackerFactsObserved" && record.event.operationId.includes(":specification")
      ],
      [
        "claim observation",
        (record) =>
          record.event._tag === "TaskTrackerFactsObserved" && record.event.operationId.includes(":claim-observation")
      ],
      ["worktree outcome", (record) => record.event._tag === "PlannedAttemptWorktreeObserved"],
      ["target-lineage outcome", (record) => record.event._tag === "TargetLineageObserved"]
    ]
    for (const [name, predicate] of eventCases) {
      expect(validateWorktreeCleanupProvenance(without(records, predicate), authorization)._tag, name).toBe("Invalid")
    }

    const replacement = records.find(({ event }) => event._tag === "PlannedAttemptReplaced")
    expect(replacement).toBeDefined()
    if (replacement !== undefined) {
      expect(
        validateWorktreeCleanupProvenance(
          records.concat({ ...replacement, position: JournalPosition.make(Number(replacement.position) + 100) }),
          authorization
        )._tag
      ).toBe("Invalid")
      expect(
        validateWorktreeCleanupProvenance(
          withForeignKey(records, (record) => record === replacement),
          authorization
        )._tag
      ).toBe("Invalid")
    }

    const foreignPredecessor = WorktreeCleanupAuthorization.make({
      ...authorization,
      disposition: { ...disposition, plannedAttempt: { ...attempt, taskId: TaskId.make("foreign-task") } }
    })
    expect(validateWorktreeCleanupProvenance(records, foreignPredecessor)._tag).toBe("Invalid")
    expect(
      validateWorktreeCleanupProvenance(
        records,
        WorktreeCleanupAuthorization.make({ ...authorization, causalPredecessors: [OperationId.make("foreign")] })
      )._tag
    ).toBe("Invalid")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("preserves abandoned cleanup when the stopped claim or quiescence witness changes", () =>
  Effect.gen(function* () {
    const journal = yield* begin("issue-69-abandoned-negative-matrix")
    const abandoned = yield* appendAbandonedProvenance(attempt)
    const records = yield* journal.read(runId)
    expect(deriveCleanupAuthorizations(records).worktree).toHaveLength(1)
    const cases: ReadonlyArray<readonly [string, ReadonlyArray<(record: (typeof records)[number]) => boolean>]> = [
      ["abandonment", [(record) => record.event._tag === "AttemptImplementationAbandoned"]],
      ["stop choice", [(record) => record.event._tag === "AttemptChoiceApplied"]],
      ["quiescence report", [(record) => record.event._tag === "PlannedAttemptExecutorWorkReported"]],
      ["claim outcome", [(record) => record.event._tag === "TaskClaimAcquired"]]
    ]
    for (const [name, predicates] of cases) {
      expect(validateWorktreeCleanupProvenance(predicates.reduce(without, records), abandoned)._tag, name).toBe(
        "Invalid"
      )
    }
    expect(
      validateWorktreeCleanupProvenance(
        records,
        WorktreeCleanupAuthorization.make({ ...abandoned, causalPredecessors: [OperationId.make("foreign-claim")] })
      )._tag
    ).toBe("Invalid")
    const abandonment = records.find(({ event }) => event._tag === "AttemptImplementationAbandoned")
    expect(abandonment).toBeDefined()
    if (abandonment !== undefined) {
      expect(
        validateWorktreeCleanupProvenance(
          withForeignKey(records, (record) => record === abandonment),
          abandoned
        )._tag
      ).toBe("Invalid")
    }
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("preserves candidate cleanup when FullRerun chronology loses an exact provider or successor witness", () =>
  Effect.gen(function* () {
    const journal = yield* begin("issue-69-candidate-negative-matrix")
    yield* appendCandidateProvenance(candidatePredecessor, candidateSuccessor, "candidate-negative")
    const records = yield* journal.read(runId)
    const candidate = candidateAuthorization
    const eventCases: ReadonlyArray<readonly [string, (record: (typeof records)[number]) => boolean]> = [
      ["provider absence", (record) => record.event._tag === "IntegrationProviderRunActivityAbsent"],
      ["quarantine", (record) => record.event._tag === "IntegrationQuarantined"],
      ["FullRerun direction", (record) => record.event._tag === "IntegrationQuarantineDirectionApplied"],
      ["successor relation", (record) => record.event._tag === "IntegratorSuccessorSessionFixed"],
      ["successor lineage", (record) => record.event._tag === "TargetLineageObserved"]
    ]
    for (const [name, predicate] of eventCases) {
      expect(validateIntegratorCandidateCleanupProvenance(without(records, predicate), candidate)._tag, name).toBe(
        "Invalid"
      )
    }
    const direction = records.find(({ event }) => event._tag === "IntegrationQuarantineDirectionApplied")
    expect(direction).toBeDefined()
    if (direction !== undefined) {
      expect(
        validateIntegratorCandidateCleanupProvenance(
          withForeignKey(records, (record) => record === direction),
          candidate
        )._tag
      ).toBe("Invalid")
    }
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
