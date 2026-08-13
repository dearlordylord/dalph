import { it } from "@effect/vitest"
import {
  AcceptedResultEvidenceManifest,
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect } from "effect"
import fc from "fast-check"
import { expect } from "vitest"
import { EvidenceStore } from "../target-verification/evidence-store.js"
import { AcceptedResultEvidenceConflict, qualifyAcceptedResultEvidence } from "./protocol.js"

const runId = RunId.make("accepted-result-evidence-property-run")
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("accepted-result-evidence-property-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/accepted-result-evidence-property"),
  executor: TaskExecutorLocator.make("executor:accepted-result-evidence-property"),
  runId,
  taskId: TaskId.make("accepted-result-evidence-property-task"),
  taskRevision: TaskRevision.make("accepted-result-evidence-property-revision"),
  worktree: WorktreeLocator.make("/worktrees/accepted-result-evidence-property")
})
const reference = EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) })
const acceptedResult = { commit: GitCommitSha.make("b".repeat(40)), evidenceManifest: reference }
const validManifest = AcceptedResultEvidenceManifest.make({
  commit: acceptedResult.commit,
  correlation: { attemptId: attempt.attemptId, runId },
  formatVersion: 1,
  outcome: "Accepted",
  predecessor: null
})
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

const corruptedManifest = fc.oneof(
  fc.constant({ ...validManifest, commit: "c".repeat(40) }),
  fc.constant({ ...validManifest, correlation: { ...validManifest.correlation, runId: "foreign-run" } }),
  fc.constant({ ...validManifest, correlation: { ...validManifest.correlation, attemptId: "foreign-attempt" } }),
  fc.constant({ ...validManifest, formatVersion: 2 }),
  fc.constant({ ...validManifest, outcome: "Completed" }),
  fc.constant({ commit: validManifest.commit, correlation: validManifest.correlation })
)
const corruptedEvidence = fc.oneof(corruptedManifest.map(encode), fc.constant(new TextEncoder().encode("{")))

it.effect("rejects every generated corrupted acceptance envelope before integration admission", () =>
  Effect.promise(async () => {
    await fc.assert(
      fc.asyncProperty(corruptedEvidence, async (bytes) => {
        const failure = await Effect.runPromise(
          qualifyAcceptedResultEvidence(attempt, acceptedResult).pipe(
            Effect.provideService(
              EvidenceStore,
              EvidenceStore.of({ put: () => Effect.die("unused"), read: () => Effect.succeed(bytes) })
            ),
            Effect.flip
          )
        )
        expect(failure).toBeInstanceOf(AcceptedResultEvidenceConflict)
        expect(failure.attemptId).toBe(attempt.attemptId)
        expect(failure.runId).toBe(runId)
      }),
      { numRuns: 30 }
    )
  })
)
