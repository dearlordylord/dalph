import {
  AcceptedResult,
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  IntegratorCandidateResourceLocator,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  JournalPosition
} from "@dalph/orchestrator"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { CodexTurnId } from "./codex-attempt-store.js"
import { type CodexTurnSnapshot } from "./codex-app-server.js"
import { exactEnvelope } from "./codex-integrator-envelope.js"

const run = IntegratorRunCorrelation.make({
  ordinal: IntegratorRunOrdinal.make(1),
  session: IntegratorSessionCorrelation.make({
    acceptedResult: AcceptedResult.make({
      commit: GitCommitSha.make("b".repeat(40)),
      evidenceManifest: EvidenceReference.make({ byteLength: 0, digest: EvidenceDigest.make("0".repeat(64)) })
    }),
    candidateResource: IntegratorCandidateResourceLocator.make("candidate:envelope"),
    expectedTargetHead: GitCommitSha.make("a".repeat(40)),
    integrationTarget: IntegrationTarget.make({
      repository: GitRepositoryLocator.make("/tmp/envelope.git"),
      ref: IntegrationTargetRef.make("refs/heads/main")
    }),
    plannedAttempt: PlannedTaskAttempt.make({
      attemptId: AttemptId.make("envelope-attempt"),
      baseSha: GitCommitSha.make("a".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/envelope"),
      executor: TaskExecutorLocator.make("envelope-executor"),
      runId: RunId.make("envelope-run"),
      taskId: TaskId.make("envelope-task"),
      taskRevision: TaskRevision.make("envelope-revision"),
      worktree: WorktreeLocator.make("/tmp/envelope-worktree")
    }),
    queuedAt: JournalPosition.make(1),
    sessionId: IntegratorSessionId.make("envelope-session"),
    startedAt: JournalPosition.make(2),
    targetLineageObservedAt: JournalPosition.make(3)
  })
})

const turn = (text: string, items: ReadonlyArray<unknown> = [{ type: "agentMessage", text }]): CodexTurnSnapshot => ({
  id: CodexTurnId.make("envelope-turn"),
  status: "completed",
  items
})

const decode = (value: CodexTurnSnapshot) => Effect.runPromise(exactEnvelope(value, run))

describe("Codex Integrator result envelope", () => {
  it("accepts prepared and not-prepared envelopes", async () => {
    const prepared = await decode(
      turn('{"outcome":"PreparedCandidate","version":1,"candidate":"refs/heads/candidate"}')
    )
    const notPrepared = await decode(turn('{"outcome":"NotPrepared","version":1,"detail":"provider stopped"}'))
    expect(prepared._tag).toBe("PreparedCandidate")
    expect(notPrepared._tag).toBe("NotPrepared")
  })

  it("rejects missing, non-object, unknown, and empty envelope fields", async () => {
    const values = [
      await decode(turn("", [null, { type: "toolResult", text: "not an agent message" }])),
      await decode(turn("not-json")),
      await decode(turn("[]")),
      await decode(turn('{"outcome":"PreparedCandidate","version":1,"candidate":""}')),
      await decode(turn('{"outcome":"NotPrepared","version":1,"detail":""}')),
      await decode(turn('{"outcome":"Unknown","version":1,"detail":"provider stopped"}')),
      await decode(turn('{"outcome":"NotPrepared","version":2,"detail":"provider stopped"}'))
    ]
    for (const value of values) expect(value._tag).toBe("NotPrepared")
    expect(values[0]).toMatchObject({ detail: "Codex returned no unique result envelope" })
  })
})
