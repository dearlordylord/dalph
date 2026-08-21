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
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "../integrator/events.js"
import {
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner,
  CleanupObservationOrdinal
} from "./disposition.js"
import {
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  IntegratorCandidateCleanupAuthorizedEvent,
  IntegratorCandidateCleanupContradictedEvent,
  IntegratorCandidateCleanupObservationIntendedEvent,
  integratorCandidateCleanupTestLayer,
  runIntegratorCandidateCleanup,
  TestIntegratorCandidateCleanupBoundary
} from "./integrator-candidate.js"
import { WorktreeCleanupMutationResult, WorktreeCleanupSettledEvent } from "./worktree.js"
import {
  attempt,
  authorization as worktreeAuthorization,
  baseSha,
  runId,
  successor as replacementSuccessor
} from "./fixtures.js"
import { appendCandidateProvenance, appendReplacementProvenance } from "./provenance-fixtures.js"
import { validateIntegratorCandidateCleanupProvenance } from "./provenance.js"
import { activateDispositionCleanup, selectCleanupResponsibilitySet } from "./loop.js"
import { deriveCleanupAuthorizations } from "./activation.js"
import {
  integratorCandidateCleanupAuthorizedRecordKey,
  integratorCandidateCleanupObservationIntendedRecordKey,
  integratorCandidateCleanupContradictedRecordKey,
  worktreeCleanupSettledRecordKey
} from "../../../workflow-journal/record-key.js"

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

it.effect("does not settle a candidate removal with a stale revision", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-stale-revision"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const result = yield* runIntegratorCandidateCleanup(authorization)
    const records = yield* journal.read(runId)
    expect(result._tag).toBe("Preserved")
    expect(records.map(({ event }) => event._tag)).toContain("IntegratorCandidateCleanupContradicted")
    expect(records.map(({ event }) => event._tag)).not.toContain("IntegratorCandidateCleanupSettled")
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
            revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
            sessionId: predecessor.sessionId
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("settles an already-absent candidate without issuing a mutation", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-initial-absence"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const result = yield* runIntegratorCandidateCleanup(authorization)
    const records = yield* journal.read(runId)
    expect(result._tag).toBe("Settled")
    expect(records.map(({ event }) => event._tag)).toContain("IntegratorCandidateCleanupAbsenceConfirmed")
    expect((yield* (yield* TestIntegratorCandidateCleanupBoundary).calls()).map((call) => call._tag)).toEqual([
      "Observe"
    ])
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [
          IntegratorCandidateCleanupObservation.cases.Absent.make({
            locator: predecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(1)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("preserves a post-mutation candidate observation that is not absent", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-post-mutation-contradiction"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const result = yield* runIntegratorCandidateCleanup(authorization)
    const calls = yield* (yield* TestIntegratorCandidateCleanupBoundary).calls()
    expect(result._tag).toBe("Preserved")
    expect(calls.map((call) => call._tag)).toEqual(["Observe", "Remove", "Observe"])
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [
          present,
          IntegratorCandidateCleanupObservation.cases.Foreign.make({
            locator: predecessor.candidateResource,
            observedSessionId: successor.sessionId,
            reason: "OtherSession",
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

it.effect("uses the explicit unreadable fallback when the candidate mutation script is exhausted", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-exhausted-mutation"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const result = yield* runIntegratorCandidateCleanup(authorization)
    const calls = yield* (yield* TestIntegratorCandidateCleanupBoundary).calls()
    expect(result).toMatchObject({ _tag: "Pending", reason: "script exhausted" })
    expect(calls.map((call) => call._tag)).toEqual(["Observe", "Remove"])
  }).pipe(
    Effect.provide(integratorCandidateCleanupTestLayer({ observations: [present] })),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("preserves a candidate when the observation script is exhausted", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-exhausted-observation"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const result = yield* runIntegratorCandidateCleanup(authorization)
    const calls = yield* (yield* TestIntegratorCandidateCleanupBoundary).calls()
    expect(result._tag).toBe("Preserved")
    expect(calls.map((call) => call._tag)).toEqual(["Observe"])
  }).pipe(
    Effect.provide(integratorCandidateCleanupTestLayer({ observations: [] })),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("replays a contradicted candidate without rereading or appending", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-contradiction-replay"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const first = yield* runIntegratorCandidateCleanup(authorization)
    const second = yield* runIntegratorCandidateCleanup(authorization)
    const calls = yield* (yield* TestIntegratorCandidateCleanupBoundary).calls()
    expect(first._tag).toBe("Preserved")
    expect(second._tag).toBe("Preserved")
    expect(calls.map((call) => call._tag)).toEqual(["Observe"])
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [
          IntegratorCandidateCleanupObservation.cases.Foreign.make({
            locator: predecessor.candidateResource,
            observedSessionId: successor.sessionId,
            reason: "OtherSession",
            revision: IntegratorCandidateCleanupEvidenceRevision.make(1)
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

it.effect("preserves a candidate when the mutation response names a foreign session", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-foreign-response"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const result = yield* runIntegratorCandidateCleanup(authorization)
    const boundary = yield* TestIntegratorCandidateCleanupBoundary
    const records = yield* journal.read(runId)
    expect(result._tag).toBe("Preserved")
    expect((yield* boundary.calls()).map((call) => call._tag)).toEqual(["Observe", "Remove"])
    expect(records.map(({ event }) => event._tag)).toContain("IntegratorCandidateCleanupContradicted")
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [present],
        mutations: [
          IntegratorCandidateCleanupMutationResult.cases.Removed.make({
            locator: predecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
            sessionId: IntegratorSessionId.make("session:issue-69-foreign")
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("stops candidate mutation retries at the exact three-request bound", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-retry-bound"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const results = [
      yield* runIntegratorCandidateCleanup(authorization),
      yield* runIntegratorCandidateCleanup(authorization),
      yield* runIntegratorCandidateCleanup(authorization),
      yield* runIntegratorCandidateCleanup(authorization)
    ]
    const boundary = yield* TestIntegratorCandidateCleanupBoundary
    expect(results.map((result) => result._tag)).toEqual(["Pending", "Pending", "Pending", "Pending"])
    expect(results.at(-1)).toMatchObject({ attempts: 3 })
    expect((yield* boundary.calls()).map((call) => call._tag)).toEqual([
      "Observe",
      "Remove",
      "Observe",
      "Remove",
      "Observe",
      "Remove",
      "Observe"
    ])
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [present, present, present, present],
        mutations: [
          IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
            detail: "response lost: 1",
            locator: predecessor.candidateResource,
            sessionId: predecessor.sessionId
          }),
          IntegratorCandidateCleanupMutationResult.cases.DefinitelyNotApplied.make({
            detail: "retry: 2",
            locator: predecessor.candidateResource,
            sessionId: predecessor.sessionId
          }),
          IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
            detail: "response lost: 3",
            locator: predecessor.candidateResource,
            sessionId: predecessor.sessionId
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("preserves a candidate when its cleanup history has no authorization prefix", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-missing-authorization"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const ordinal = CleanupObservationOrdinal.make(1)
    yield* journal.append(
      runId,
      integratorCandidateCleanupObservationIntendedRecordKey(authorization.operationId, ordinal),
      IntegratorCandidateCleanupObservationIntendedEvent.make({
        authorization,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operationId: OperationId.make(`${authorization.operationId}:observe:${ordinal}`),
        ordinal,
        version: workflowJournalEventVersion
      })
    )
    const result = yield* runIntegratorCandidateCleanup(authorization)
    expect(result._tag).toBe("Preserved")
    expect(yield* (yield* TestIntegratorCandidateCleanupBoundary).calls()).toEqual([])
  }).pipe(
    Effect.provide(integratorCandidateCleanupTestLayer({ observations: [present] })),
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

it.effect("rejects a FullRerun direction or target-lineage intent under a foreign key", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-foreign-full-rerun-key"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const records = yield* journal.read(runId)
    const foreignDirection = records.map((record) =>
      record.event._tag === "IntegrationQuarantineDirectionApplied"
        ? { ...record, key: JournalRecordKey.make("foreign-full-rerun-direction-key") }
        : record
    )
    expect(validateIntegratorCandidateCleanupProvenance(foreignDirection, authorization)._tag).toBe("Invalid")

    const foreignLineageIntent = records.map((record) =>
      record.event._tag === "GitReadIntentRecorded" &&
      record.event.operation._tag === "ReadTargetLineage" &&
      record.event.operation.operationId === authorization.observationOperationId
        ? { ...record, key: JournalRecordKey.make("foreign-target-lineage-intent-key") }
        : record
    )
    expect(validateIntegratorCandidateCleanupProvenance(foreignLineageIntent, authorization)._tag).toBe("Invalid")
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

it.effect("excludes a FullRerun successor when its successor target-lineage witness is absent", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-missing-successor-lineage"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const records = (yield* journal.read(runId)).filter(
      ({ event }) =>
        event._tag !== "TargetLineageObserved" || event.plannedAttempt.attemptId !== successor.plannedAttempt.attemptId
    )
    expect(deriveCleanupAuthorizations(records).candidate).toEqual([])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("excludes a FullRerun successor when its provider-absence authority is incomplete", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-missing-provider-absence"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const records = (yield* journal.read(runId)).filter(
      ({ event }) => event._tag !== "IntegrationProviderRunActivityAbsent"
    )
    expect(deriveCleanupAuthorizations(records).candidate).toEqual([])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("excludes a FullRerun successor when its direction application is absent", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-missing-full-rerun-direction"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const records = (yield* journal.read(runId)).filter(
      ({ event }) => event._tag !== "IntegrationQuarantineDirectionApplied"
    )
    expect(deriveCleanupAuthorizations(records).candidate).toEqual([])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects duplicate successor settlement evidence before candidate authorization", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-duplicate-successor-settlement"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const records = yield* journal.read(runId)
    const successorFixed = records.find(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")
    expect(successorFixed).toBeDefined()
    if (successorFixed === undefined) return
    const duplicate = {
      ...successorFixed,
      key: JournalRecordKey.make(`${successorFixed.key}:duplicate`),
      position: JournalPosition.make(Number(successorFixed.position) + 1)
    }
    expect(deriveCleanupAuthorizations([...records, duplicate]).candidate).toEqual([])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("keeps candidate responsibility selection independent of a worktree terminal event", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-independent-candidate-selection"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const activation = yield* activateDispositionCleanup(runId)
    const candidate = activation.candidate[0]
    expect(candidate).toBeDefined()
    if (candidate === undefined) return
    yield* journal.append(
      runId,
      worktreeCleanupSettledRecordKey(worktreeAuthorization.operationId),
      WorktreeCleanupSettledEvent.make({
        authorization: worktreeAuthorization,
        occurrenceClassification: "NonActionOccurrence",
        result: WorktreeCleanupMutationResult.cases.AlreadyAbsent.make({
          branch: attempt.branch,
          locator: attempt.worktree,
          revision: worktreeAuthorization.evidenceRevision
        }),
        version: workflowJournalEventVersion
      })
    )
    expect(selectCleanupResponsibilitySet(yield* journal.read(runId)).candidate[0]?.operationId).toBe(
      candidate.operationId
    )
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("does not let a candidate terminal fact suppress a worktree responsibility", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-independent-worktree-selection"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, replacementSuccessor)
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const activation = yield* activateDispositionCleanup(runId)
    const worktree = activation.worktree[0]
    expect(worktree).toBeDefined()
    if (worktree === undefined) return
    yield* journal.append(
      runId,
      integratorCandidateCleanupContradictedRecordKey(authorization.operationId),
      IntegratorCandidateCleanupContradictedEvent.make({
        authorization,
        detail: "candidate terminal fact is unrelated to worktree responsibility",
        observation: present,
        occurrenceClassification: "NonActionOccurrence",
        operationId: OperationId.make("issue-69-independent-worktree-selection:contradiction"),
        version: workflowJournalEventVersion
      })
    )
    expect(selectCleanupResponsibilitySet(yield* journal.read(runId)).worktree[0]?.operationId).toBe(
      worktree.operationId
    )
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("does not let a self-consistent forged candidate authorization suppress canonical derivation", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-forged-candidate-authorization"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendCandidateProvenance(predecessor, successor, "issue-69-full-rerun")
    const forged = IntegratorCandidateCleanupAuthorization.make({
      ...authorization,
      causalPredecessors: [OperationId.make("issue-69-foreign-candidate-causal")],
      operationId: OperationId.make("issue-69-forged-candidate-authorization")
    })
    yield* journal.append(
      runId,
      integratorCandidateCleanupAuthorizedRecordKey(forged.operationId),
      IntegratorCandidateCleanupAuthorizedEvent.make({
        authorization: forged,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    const activation = yield* activateDispositionCleanup(runId)
    expect(activation.candidate.map(({ operationId }) => operationId)).toEqual([
      "disposition-cleanup:integrator-candidate:session:issue-69-p1"
    ])
    expect(
      (yield* journal.read(runId)).filter(({ event }) => event._tag === "IntegratorCandidateCleanupAuthorized")
    ).toHaveLength(2)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
