import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  AcceptedResult,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  IntegrationTarget,
  IntegrationTargetRef,
  GitRepositoryLocator
} from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "../integrator/events.js"
import {
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner
} from "./disposition.js"
import {
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  integratorCandidateCleanupTestLayer,
  runIntegratorCandidateCleanup,
  TestIntegratorCandidateCleanupBoundary
} from "./integrator-candidate.js"
import { attempt, baseSha, runId } from "./fixtures.js"
import { appendCandidateProvenance } from "./provenance-fixtures.js"
import { validateIntegratorCandidateCleanupProvenance } from "./provenance.js"

const acceptedResult = AcceptedResult.make({
  commit: baseSha,
  evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) })
})
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("repo:issue-69"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const predecessor = IntegratorSessionCorrelation.make({
  acceptedResult,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-p1"),
  expectedTargetHead: baseSha,
  integrationTarget: target,
  plannedAttempt: attempt,
  queuedAt: JournalPosition.make(2),
  sessionId: IntegratorSessionId.make("session:issue-69-p1"),
  startedAt: JournalPosition.make(6),
  targetLineageObservedAt: JournalPosition.make(4)
})
const successor = IntegratorSessionCorrelation.make({
  ...predecessor,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-p2"),
  sessionId: IntegratorSessionId.make("session:issue-69-p2"),
  targetLineageObservedAt: JournalPosition.make(12)
})
const disposition = IntegratorCandidateCleanupDisposition.make({
  directionAppliedAt: JournalPosition.make(10),
  dispositionAt: JournalPosition.make(9),
  predecessor,
  successor
})
const authorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("issue-69-full-rerun")],
  disposition,
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: predecessor.candidateResource,
  observationAt: JournalPosition.make(4),
  observationOperationId: OperationId.make("session:issue-69-p1:predecessor-lineage"),
  operationId: OperationId.make("issue-69-candidate-cleanup"),
  owner: IntegratorCandidateCleanupOwner.make({ sessionId: predecessor.sessionId }),
  writerQuiescent: true
})

const present = IntegratorCandidateCleanupObservation.cases.Present.make({
  locator: predecessor.candidateResource,
  revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  sessionId: predecessor.sessionId,
  writerQuiescent: true
})

it.effect("table-reconciles changed candidate owner, locator, and revision without a mutation", () =>
  Effect.gen(function* () {
    const foreignSession = IntegratorSessionId.make("session:issue-69-foreign")
    const cases = [
      IntegratorCandidateCleanupObservation.cases.Foreign.make({
        locator: IntegratorCandidateResourceLocator.make("candidate:issue-69-foreign"),
        observedSessionId: foreignSession,
        reason: "OtherSession",
        revision: IntegratorCandidateCleanupEvidenceRevision.make(2)
      }),
      IntegratorCandidateCleanupObservation.cases.Present.make({
        locator: predecessor.candidateResource,
        revision: IntegratorCandidateCleanupEvidenceRevision.make(2),
        sessionId: foreignSession,
        writerQuiescent: true
      }),
      IntegratorCandidateCleanupObservation.cases.Unreadable.make({
        detail: "provider read failed",
        locator: predecessor.candidateResource
      })
    ]
    for (const observation of cases) {
      const result = yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.beginRun(
          runId,
          FixtureTarget.make("issue-69-candidate-property-protocol"),
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
        yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
        const outcome = yield* runIntegratorCandidateCleanup(authorization)
        const calls = yield* (yield* TestIntegratorCandidateCleanupBoundary).calls()
        return { calls, outcome }
      }).pipe(
        Effect.provide(integratorCandidateCleanupTestLayer({ observations: [observation] })),
        Effect.provide(memoryJournalTestLayer)
      )
      expect(result.outcome._tag).toBe("Preserved")
      expect(result.calls.map(({ _tag }) => _tag)).toEqual(["Observe"])
    }
  })
)

it.effect("removes only a quarantined predecessor candidate", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const result = yield* runIntegratorCandidateCleanup(authorization)
    const boundary = yield* TestIntegratorCandidateCleanupBoundary
    expect(result._tag).toBe("Settled")
    expect((yield* boundary.calls()).map((call) => call._tag)).toEqual(["Observe", "Remove", "Observe"])
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [
          present,
          IntegratorCandidateCleanupObservation.cases.Absent.make({
            locator: predecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          IntegratorCandidateCleanupMutationResult.cases.Removed.make({
            locator: predecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(2),
            sessionId: predecessor.sessionId
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("replays a settled predecessor candidate twice without a boundary call or journal write", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-settled-replay"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const first = yield* runIntegratorCandidateCleanup(authorization)
    const afterFirst = yield* journal.read(runId)
    const second = yield* runIntegratorCandidateCleanup(authorization)
    const afterSecond = yield* journal.read(runId)
    const third = yield* runIntegratorCandidateCleanup(authorization)
    const afterThird = yield* journal.read(runId)
    const calls = yield* (yield* TestIntegratorCandidateCleanupBoundary).calls()
    expect([first, second, third].map((result) => result._tag)).toEqual(["Settled", "Settled", "Settled"])
    expect(afterSecond).toEqual(afterFirst)
    expect(afterThird).toEqual(afterFirst)
    expect(calls.map((call) => call._tag)).toEqual(["Observe", "Remove", "Observe"])
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [
          present,
          IntegratorCandidateCleanupObservation.cases.Absent.make({
            locator: predecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          IntegratorCandidateCleanupMutationResult.cases.Removed.make({
            locator: predecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(2),
            sessionId: predecessor.sessionId
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("preserves a live predecessor candidate writer", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-live"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const result = yield* runIntegratorCandidateCleanup(authorization)
    const boundary = yield* TestIntegratorCandidateCleanupBoundary
    expect(result._tag).toBe("Preserved")
    expect(yield* boundary.calls()).toHaveLength(1)
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [
          IntegratorCandidateCleanupObservation.cases.Foreign.make({
            locator: predecessor.candidateResource,
            observedSessionId: successor.sessionId,
            reason: "LiveWriter",
            revision: IntegratorCandidateCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("preserves a candidate authorization with missing FullRerun provenance without reading", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-missing-provenance"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const result = yield* runIntegratorCandidateCleanup(authorization)
    const boundary = yield* TestIntegratorCandidateCleanupBoundary
    expect(result._tag).toBe("Preserved")
    expect(yield* boundary.calls()).toEqual([])
  }).pipe(
    Effect.provide(integratorCandidateCleanupTestLayer({ observations: [present] })),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("reconciles a lost predecessor-candidate response after restart without duplicate removal", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-restart"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const first = yield* runIntegratorCandidateCleanup(authorization)
    const second = yield* runIntegratorCandidateCleanup(authorization)
    const boundary = yield* TestIntegratorCandidateCleanupBoundary
    expect(first._tag).toBe("Pending")
    expect(second._tag).toBe("Settled")
    expect((yield* boundary.calls()).map((call) => call._tag)).toEqual(["Observe", "Remove", "Observe"])
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [
          present,
          IntegratorCandidateCleanupObservation.cases.Absent.make({
            locator: predecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
            detail: "response lost after apply",
            locator: predecessor.candidateResource,
            sessionId: predecessor.sessionId
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it("rejects a FullRerun successor that changes responsibility facts", () => {
  expect(() =>
    IntegratorCandidateCleanupDisposition.make({
      directionAppliedAt: JournalPosition.make(10),
      dispositionAt: JournalPosition.make(9),
      predecessor,
      successor: {
        ...successor,
        acceptedResult: AcceptedResult.make({ ...acceptedResult, commit: GitCommitSha.make("2".repeat(40)) })
      }
    })
  ).toThrow()
})

it.effect("rejects a FullRerun quarantine under a foreign key", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-foreign-quarantine-key"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const records = yield* journal.read(runId)
    const foreign = records.map((record) =>
      record.event._tag === "IntegrationQuarantined"
        ? { ...record, key: JournalRecordKey.make("foreign-quarantine-key") }
        : record
    )
    expect(validateIntegratorCandidateCleanupProvenance(foreign, authorization)._tag).toBe("Invalid")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a provider-failure quarantine without its activity-absence witness", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-incomplete-quarantine"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const records = yield* journal.read(runId)
    const incomplete = records.filter(({ event }) => event._tag !== "IntegrationProviderRunActivityAbsent")
    expect(validateIntegratorCandidateCleanupProvenance(incomplete, authorization)._tag).toBe("Invalid")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
