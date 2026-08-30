import {
  AcceptedResultEvidenceManifest,
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorCommandFailure,
  RunId,
  WorktreeLocator
} from "@dalph/contracts"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  acceptedManifestMatches,
  collectText,
  commandFailure,
  commitCandidates,
  commitFromTurn,
  commitMatchesHead,
  decodeAcceptedManifest,
  hasDuplicateOwnedTurnTokens,
  isActiveThread,
  isTerminalTurn,
  ownedTurnForRecord,
  ownedRecordPersistenceDisposition,
  ownedTurnTokenCounts,
  parsedCommitFromMessage,
  preserveCommandFailure,
  priorObservedTurnIsConsistent
} from "./codex-planned-attempt-executor.js"
import { CodexAttemptRecord, CodexOwnedTurnToken, CodexThreadId, CodexTurnId } from "./codex-attempt-store.js"
import { CodexThreadWorkingDirectory, type CodexThreadSnapshot, type CodexTurnSnapshot } from "./codex-app-server.js"

const correlation = PlannedAttemptExecutorCorrelation.make({
  attemptId: AttemptId.make("policy-attempt"),
  runId: RunId.make("policy-run")
})
const worktree = WorktreeLocator.make("/policy/worktree")
const threadId = CodexThreadId.make("policy-thread")
const token = CodexOwnedTurnToken.make("policy-token")
const turnId = CodexTurnId.make("policy-turn")

type TurnOverrides = Omit<Partial<CodexTurnSnapshot>, "ownedTurnToken"> & {
  readonly ownedTurnToken?: CodexOwnedTurnToken | undefined
}

const turn = (overrides: TurnOverrides = {}): CodexTurnSnapshot => {
  const { ownedTurnToken, ...otherOverrides } = overrides
  return {
    id: turnId,
    items: [],
    status: "inProgress",
    ...(ownedTurnToken === undefined && "ownedTurnToken" in overrides
      ? {}
      : { ownedTurnToken: ownedTurnToken ?? token }),
    ...otherOverrides
  }
}
const thread = (turns: ReadonlyArray<CodexTurnSnapshot>, status: CodexThreadSnapshot["status"] = "idle") => ({
  cwd: CodexThreadWorkingDirectory.make(worktree),
  id: threadId,
  status,
  turns
})
const recordFields = {
  attemptId: correlation.attemptId,
  correlationAttemptId: correlation.attemptId,
  correlationRunId: correlation.runId,
  threadId,
  worktree
}
const intent = CodexAttemptRecord.cases.TurnIntentRecorded.make({
  ...recordFields,
  currentToken: token,
  priorObservedTurnId: null
})
const observed = CodexAttemptRecord.cases.TurnObserved.make({
  ...recordFields,
  currentToken: token,
  observedTurnId: turnId,
  priorObservedTurnId: null
})

it("classifies every owned-turn lookup boundary without selecting an ambiguous turn", () => {
  expect(
    ownedTurnTokenCounts([turn(), turn({ id: CodexTurnId.make("without-token"), ownedTurnToken: undefined })])
  ).toEqual(new Map([[token, 1]]))
  expect(hasDuplicateOwnedTurnTokens(new Map([[token, 1]]))).toBe(false)
  expect(hasDuplicateOwnedTurnTokens(new Map([[token, 2]]))).toBe(true)
  expect(ownedTurnForRecord(thread([turn(), turn({ id: CodexTurnId.make("duplicate") })]), intent)).toEqual({
    _tag: "Contradiction"
  })
  expect(ownedTurnForRecord(thread([]), intent)).toEqual({ _tag: "Missing" })
  expect(ownedTurnForRecord(thread([]), observed)).toEqual({ _tag: "Contradiction" })
  expect(ownedTurnForRecord(thread([turn()]), intent)).toMatchObject({ _tag: "Found" })

  const empty = CodexAttemptRecord.cases.EmptyPreTurn.make({
    attemptId: correlation.attemptId,
    correlationAttemptId: correlation.attemptId,
    correlationRunId: correlation.runId,
    worktree
  })
  const associated = CodexAttemptRecord.cases.AssociatedPreTurn.make(recordFields)
  expect(ownedTurnForRecord(thread([]), empty)).toEqual({ _tag: "Missing" })
  expect(ownedTurnForRecord(thread([]), associated)).toEqual({ _tag: "Missing" })

  expect(ownedTurnForRecord(thread([turn({ id: CodexTurnId.make("changed") })]), observed)).toEqual({
    _tag: "Contradiction"
  })
  expect(
    ownedTurnForRecord(
      thread([
        turn({ correlation: PlannedAttemptExecutorCorrelation.make({ ...correlation, runId: RunId.make("other") }) })
      ]),
      observed
    )
  ).toMatchObject({ _tag: "Foreign" })
})

it("requires the prior observed turn to remain distinct and owned", () => {
  const priorId = CodexTurnId.make("prior-turn")
  const withPrior = CodexAttemptRecord.cases.TurnObserved.make({ ...observed, priorObservedTurnId: priorId })
  expect(priorObservedTurnIsConsistent(thread([turn()]), observed, turn())).toBe(true)
  expect(priorObservedTurnIsConsistent(thread([turn()]), withPrior, turn({ id: priorId }))).toBe(false)
  expect(priorObservedTurnIsConsistent(thread([turn()]), withPrior, turn())).toBe(false)
  expect(
    priorObservedTurnIsConsistent(thread([turn(), turn({ id: priorId, ownedTurnToken: undefined })]), withPrior, turn())
  ).toBe(false)
  expect(priorObservedTurnIsConsistent(thread([turn(), turn({ id: priorId })]), withPrior, turn())).toBe(true)
})

it("normalizes text, status, and command failures at their pure boundaries", () => {
  expect(collectText("text")).toBe("text")
  expect(collectText(null)).toBe("")
  expect(collectText({ text: "nested" })).toBe("nested")
  expect(collectText({ text: 42 })).toBe("")
  expect(isTerminalTurn(undefined)).toBe(false)
  expect(isTerminalTurn(turn({ status: "completed" }))).toBe(true)
  expect(isTerminalTurn(turn({ status: "failed" }))).toBe(true)
  expect(isTerminalTurn(turn({ status: "interrupted" }))).toBe(false)
  expect(isActiveThread(thread([], "active"), undefined)).toBe(true)
  expect(isActiveThread(thread([]), turn())).toBe(true)
  expect(isActiveThread(thread([]), turn({ status: "completed" }))).toBe(false)
  expect(commandFailure("Suspend", correlation, new Error("failed")).detail).toBe("failed")
  expect(commandFailure("StartOrContinue", correlation, "failed").detail).toBe("failed")
  const existingFailure = new PlannedAttemptExecutorCommandFailure({
    command: "Suspend",
    correlation,
    detail: "already classified"
  })
  expect(preserveCommandFailure("Suspend", correlation, existingFailure)).toBe(existingFailure)
  expect(preserveCommandFailure("StartOrContinue", correlation, new Error("wrapped")).detail).toBe("wrapped")
  expect(
    (
      [
        "EmptyPreTurn",
        "AssociatedPreTurn",
        "TurnIntentRecorded",
        "TurnObserved",
        "Running",
        "SafelySuspended",
        "Terminal"
      ] as const
    ).map(ownedRecordPersistenceDisposition)
  ).toEqual(["Reject", "Reject", "Intent", "Persistable", "Persistable", "Persistable", "Reject"])
})

it("requires one exact commit and the exact response correlation", () => {
  const commit = "a".repeat(40)
  const otherCommit = "b".repeat(40)
  const message = JSON.stringify({ commit, correlation })
  expect(parsedCommitFromMessage(message, correlation)).toEqual({ _tag: "Valid", candidate: commit })
  expect(parsedCommitFromMessage("not-json", correlation)).toEqual({ _tag: "Invalid" })
  expect(parsedCommitFromMessage("null", correlation)).toEqual({ _tag: "Invalid" })
  expect(parsedCommitFromMessage(JSON.stringify({ commit }), correlation)).toEqual({ _tag: "Invalid" })
  expect(
    parsedCommitFromMessage(
      JSON.stringify({ commit, correlation: { ...correlation, runId: "another-run" } }),
      correlation
    )
  ).toEqual({ _tag: "Invalid" })
  expect(parsedCommitFromMessage(JSON.stringify({ commit: 42, correlation }), correlation)).toEqual({
    _tag: "Valid",
    candidate: undefined
  })
  expect(commitCandidates(message, commit)).toEqual(new Set([commit]))
  expect(commitCandidates(`${commit} ${otherCommit}`, undefined)).toEqual(new Set([commit, otherCommit]))
  expect(commitCandidates("no commit", "invalid")).toEqual(new Set())
  expect(commitFromTurn(undefined, correlation)).toBeUndefined()
  expect(commitFromTurn(turn({ items: [] }), correlation)).toBeUndefined()
  expect(commitFromTurn(turn({ items: [{ type: "agentMessage", text: message }] }), correlation)).toBe(commit)
  expect(
    commitFromTurn(turn({ items: [{ type: "agentMessage", text: `${message} ${otherCommit}` }] }), correlation)
  ).toBeUndefined()
  expect(commitMatchesHead(undefined, GitCommitSha.make(commit))).toBe(false)
  expect(commitMatchesHead(GitCommitSha.make(otherCommit), GitCommitSha.make(commit))).toBe(false)
  expect(commitMatchesHead(GitCommitSha.make(commit), GitCommitSha.make(commit))).toBe(true)
})

it("round-trips generated accepted evidence manifests and rejects changed bytes", () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[0-9a-f]{40}$/), (commitText) => {
      const manifest = AcceptedResultEvidenceManifest.make({
        commit: GitCommitSha.make(commitText),
        correlation,
        formatVersion: 1,
        outcome: "Accepted",
        predecessor: null
      })
      const bytes = new TextEncoder().encode(JSON.stringify(manifest))
      expect(decodeAcceptedManifest(bytes)).toEqual(manifest)
      expect(acceptedManifestMatches(bytes, manifest)).toBe(true)
      expect(acceptedManifestMatches(new TextEncoder().encode("not-json"), manifest)).toBe(false)
    }),
    { numRuns: 100 }
  )
})
