import type { RunId } from "@dalph/contracts"

/** One decoded recovery subject shared by public transport qualification fixtures. */
const gitObjectHexLength = 40
export const runningHostRecoveryInput = (runId: RunId) => ({
  direction: "ContinueRetainedAttempt",
  requestId: { nonce: "one-explicit-recovery", runId },
  subject: {
    _tag: "RejectedResult",
    reportOrdinal: 2,
    plannedAttempt: {
      attemptId: "attempt-A",
      runId,
      taskId: "A",
      taskRevision: "revision-A",
      executor: "executor:controlled-fake",
      baseSha: "a".repeat(gitObjectHexLength),
      branch: "refs/heads/dalph/A",
      worktree: "/tmp/dalph-A"
    }
  }
})
