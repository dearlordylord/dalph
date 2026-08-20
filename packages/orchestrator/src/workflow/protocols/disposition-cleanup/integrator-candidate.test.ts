import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  AcceptedResult,
  EvidenceDigest,
  EvidenceReference,
  IntegrationTarget,
  IntegrationTargetRef,
  GitRepositoryLocator
} from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
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
  queuedAt: JournalPosition.make(1),
  sessionId: IntegratorSessionId.make("session:issue-69-p1"),
  startedAt: JournalPosition.make(1),
  targetLineageObservedAt: JournalPosition.make(1)
})
const successor = IntegratorSessionCorrelation.make({
  ...predecessor,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-p2"),
  sessionId: IntegratorSessionId.make("session:issue-69-p2"),
  targetLineageObservedAt: JournalPosition.make(4)
})
const disposition = IntegratorCandidateCleanupDisposition.make({
  directionAppliedAt: JournalPosition.make(3),
  dispositionAt: JournalPosition.make(2),
  predecessor,
  successor
})
const authorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("issue-69-full-rerun")],
  disposition,
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: predecessor.candidateResource,
  observationAt: JournalPosition.make(5),
  observationOperationId: OperationId.make("issue-69-candidate-read"),
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

it.effect("removes only a quarantined predecessor candidate", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const result = yield* runIntegratorCandidateCleanup(authorization)
    const boundary = yield* TestIntegratorCandidateCleanupBoundary
    expect(result._tag).toBe("Settled")
    expect((yield* boundary.calls()).map((call) => call._tag)).toEqual(["Observe", "Remove"])
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [present],
        mutations: [
          IntegratorCandidateCleanupMutationResult.cases.Removed.make({
            locator: predecessor.candidateResource,
            revision: IntegratorCandidateCleanupEvidenceRevision.make(2)
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
