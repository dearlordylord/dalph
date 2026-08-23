import { Schema } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import {
  CodexOwnedTurnToken,
  CodexPurgedWorkUnitEvidence,
  CodexPurgedWorkUnitReplacementLedger,
  CodexReplacementHistoryEntry,
  CodexReplacementRequestDigest,
  CodexReplacementOperationId,
  CodexReplacementRequestId,
  CodexThreadId,
  CodexTurnId,
  appendCodexReplacementHistory,
  decodeCodexPurgedWorkUnitReplacementLedger,
  encodeCodexPurgedWorkUnitReplacementLedger,
  mergeCodexReplacementLedger
} from "../../src/application/codex-attempt-store.js"

const suffixArbitrary = fc.stringMatching(/^[a-z0-9]{1,12}$/)

const makeLedger = (suffix: string): CodexPurgedWorkUnitReplacementLedger => {
  const taskId = TaskId.make(`task:replacement:${suffix}`)
  const specification = makeTaskWorkSpecification({
    body: `Continue retained work ${suffix}.`,
    taskId,
    title: `Retained work ${suffix}`
  })
  const attempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`attempt:replacement:${suffix}`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/replacement-${suffix}`),
    executor: TaskExecutorLocator.make("executor:codex-app-server"),
    runId: RunId.make(`run:replacement:${suffix}`),
    taskId,
    taskRevision: specification.fingerprint,
    worktree: WorktreeLocator.make(`/tmp/dalph-replacement-${suffix}`)
  })
  const threadId = CodexThreadId.make(`thread:replacement:${suffix}`)
  const predecessorTurnId = CodexTurnId.make(`turn:u1:${suffix}`)
  const predecessorToken = CodexOwnedTurnToken.make(`token:u1:${suffix}`)
  const operationId = CodexReplacementOperationId.make(`operation:replacement:${suffix}`)
  const requestId = CodexReplacementRequestId.make(`request:replacement:${suffix}`)
  const requestDigest = CodexReplacementRequestDigest.make("a".repeat(64))
  const evidence = CodexPurgedWorkUnitEvidence.make({
    predecessorToken,
    predecessorTurnId,
    threadId,
    worktree: attempt.worktree
  })
  const intent = CodexReplacementHistoryEntry.cases.IntentRecorded.make({ operationId, requestDigest, requestId })
  return CodexPurgedWorkUnitReplacementLedger.make({
    history: [CodexReplacementHistoryEntry.cases.Purged.make({ evidence }), intent],
    operationId,
    plannedAttempt: attempt,
    requestId
  })
}

it("roundtrips arbitrary persisted replacement ledgers through Schema and the private encoding", () => {
  fc.assert(
    fc.property(suffixArbitrary, (suffix) => {
      const ledger = makeLedger(suffix)
      const encoded = Schema.encodeUnknownSync(CodexPurgedWorkUnitReplacementLedger)(ledger)
      expect(Schema.decodeUnknownSync(CodexPurgedWorkUnitReplacementLedger)(encoded)).toEqual(ledger)
      expect(decodeCodexPurgedWorkUnitReplacementLedger(encodeCodexPurgedWorkUnitReplacementLedger(ledger))).toEqual(
        ledger
      )
    }),
    { numRuns: 100 }
  )
})

it("preserves exact correlation and history when a replacement phase is appended", () => {
  fc.assert(
    fc.property(suffixArbitrary, (suffix) => {
      const ledger = makeLedger(suffix)
      const turnIntent = CodexReplacementHistoryEntry.cases.TurnIntentRecorded.make({
        operationId: ledger.operationId,
        replacementToken: CodexOwnedTurnToken.make(`token:u2:${suffix}`)
      })
      const turnIntentMerge = appendCodexReplacementHistory(ledger, turnIntent)
      expect(turnIntentMerge._tag).toBe("Appended")
      if (turnIntentMerge._tag !== "Appended") return
      const boundary = CodexReplacementHistoryEntry.cases.TurnBoundaryCrossingBegan.make({
        operationId: ledger.operationId,
        replacementToken: turnIntent.replacementToken
      })
      const boundaryMerge = appendCodexReplacementHistory(turnIntentMerge.ledger, boundary)
      expect(boundaryMerge._tag).toBe("Appended")
      if (boundaryMerge._tag !== "Appended") return
      const observed = CodexReplacementHistoryEntry.cases.TurnObserved.make({
        operationId: ledger.operationId,
        replacementToken: turnIntent.replacementToken,
        replacementTurnId: CodexTurnId.make(`turn:u2:${suffix}`)
      })
      const observedMerge = appendCodexReplacementHistory(boundaryMerge.ledger, observed)
      expect(observedMerge._tag).toBe("Appended")
      if (observedMerge._tag !== "Appended") return
      const sealed = CodexReplacementHistoryEntry.cases.Sealed.make({
        operationId: ledger.operationId,
        replacementToken: turnIntent.replacementToken,
        replacementTurnId: observed.replacementTurnId
      })
      const sealedMerge = appendCodexReplacementHistory(observedMerge.ledger, sealed)
      expect(sealedMerge._tag).toBe("Appended")
      if (sealedMerge._tag !== "Appended") return
      const appended = sealedMerge.ledger

      expect(appended.history.slice(0, ledger.history.length)).toEqual(ledger.history)
      expect(appended.history.map(({ _tag }) => _tag)).toEqual([
        "Purged",
        "IntentRecorded",
        "TurnIntentRecorded",
        "TurnBoundaryCrossingBegan",
        "TurnObserved",
        "Sealed"
      ])
      expect(appended.plannedAttempt).toEqual(ledger.plannedAttempt)
      expect(appended.history[0]).toEqual(ledger.history[0])
      expect(appended.operationId).toBe(ledger.operationId)
      expect(mergeCodexReplacementLedger(ledger, ledger)).toEqual({ _tag: "Idempotent", ledger })
      expect(mergeCodexReplacementLedger(ledger, turnIntentMerge.ledger)).toEqual({
        _tag: "Appended",
        ledger: turnIntentMerge.ledger
      })
      expect(mergeCodexReplacementLedger(boundaryMerge.ledger, observedMerge.ledger)).toEqual({
        _tag: "Appended",
        ledger: observedMerge.ledger
      })
      expect(mergeCodexReplacementLedger(appended, appended)).toEqual({ _tag: "Idempotent", ledger: appended })
    }),
    { numRuns: 100 }
  )
})

it("rejects replacement request identity reuse and one-field correlation/history mutations", () => {
  fc.assert(
    fc.property(
      fc.tuple(suffixArbitrary, suffixArbitrary).filter(([suffix, otherSuffix]) => suffix !== otherSuffix),
      ([suffix, otherSuffix]) => {
        const ledger = makeLedger(suffix)
        const other = makeLedger(otherSuffix)
        const reusedRequest = { ...other, requestId: ledger.requestId }
        expect(mergeCodexReplacementLedger(ledger, reusedRequest)).toMatchObject({ _tag: "Contradiction" })

        expect(() =>
          Schema.decodeUnknownSync(CodexPurgedWorkUnitReplacementLedger)({
            ...ledger,
            plannedAttempt: other.plannedAttempt
          })
        ).toThrow()
        const first = ledger.history[0]
        const otherFirst = other.history[0]
        if (first._tag !== "Purged" || otherFirst._tag !== "Purged") return
        const changedPredecessor = Schema.decodeUnknownSync(CodexPurgedWorkUnitReplacementLedger)({
          ...ledger,
          history: [
            CodexReplacementHistoryEntry.cases.Purged.make({
              evidence: { ...first.evidence, predecessorTurnId: otherFirst.evidence.predecessorTurnId }
            }),
            ledger.history[1]
          ]
        })
        expect(mergeCodexReplacementLedger(ledger, changedPredecessor)).toMatchObject({ _tag: "Contradiction" })
        expect(() =>
          Schema.decodeUnknownSync(CodexPurgedWorkUnitReplacementLedger)({
            ...ledger,
            history: [
              ledger.history[0],
              CodexReplacementHistoryEntry.cases.IntentRecorded.make({
                operationId: other.operationId,
                requestDigest: CodexReplacementRequestDigest.make("b".repeat(64)),
                requestId: ledger.requestId
              })
            ]
          })
        ).toThrow()
      }
    ),
    { numRuns: 100 }
  )
})

it("rejects every malformed replacement-history boundary and non-append successor", () => {
  const ledger = makeLedger("malformed")
  const purge = ledger.history[0]
  const intent = ledger.history[1]
  expect(purge._tag).toBe("Purged")
  expect(intent?._tag).toBe("IntentRecorded")
  if (purge._tag !== "Purged" || intent === undefined || intent._tag !== "IntentRecorded") return
  const replacementToken = CodexOwnedTurnToken.make("token:u2:malformed")
  const replacementTurnId = CodexTurnId.make("turn:u2:malformed")
  const turnIntent = CodexReplacementHistoryEntry.cases.TurnIntentRecorded.make({
    operationId: ledger.operationId,
    replacementToken
  })
  const boundary = CodexReplacementHistoryEntry.cases.TurnBoundaryCrossingBegan.make({
    operationId: ledger.operationId,
    replacementToken
  })
  const observed = CodexReplacementHistoryEntry.cases.TurnObserved.make({
    operationId: ledger.operationId,
    replacementToken,
    replacementTurnId
  })
  const sealed = CodexReplacementHistoryEntry.cases.Sealed.make({
    operationId: ledger.operationId,
    replacementToken,
    replacementTurnId
  })
  const decode = (history: ReadonlyArray<CodexReplacementHistoryEntry>, overrides = {}) =>
    Schema.decodeUnknownSync(CodexPurgedWorkUnitReplacementLedger)({ ...ledger, ...overrides, history })
  const reject = (history: ReadonlyArray<CodexReplacementHistoryEntry>, overrides = {}) =>
    expect(() => decode(history, overrides)).toThrow()

  expect(() => CodexReplacementRequestDigest.make("not-a-digest")).toThrow()
  reject([intent, intent])
  reject([purge])
  reject([purge, intent, turnIntent, boundary, observed, sealed, sealed])
  reject([purge, intent, boundary])
  reject([
    purge,
    intent,
    CodexReplacementHistoryEntry.cases.TurnIntentRecorded.make({
      operationId: CodexReplacementOperationId.make("foreign-operation"),
      replacementToken
    })
  ])
  reject([
    purge,
    intent,
    turnIntent,
    CodexReplacementHistoryEntry.cases.TurnBoundaryCrossingBegan.make({
      operationId: ledger.operationId,
      replacementToken: CodexOwnedTurnToken.make("foreign-token")
    })
  ])
  reject([
    purge,
    intent,
    turnIntent,
    boundary,
    CodexReplacementHistoryEntry.cases.TurnObserved.make({
      operationId: ledger.operationId,
      replacementToken: CodexOwnedTurnToken.make("foreign-token"),
      replacementTurnId
    })
  ])
  reject([
    purge,
    intent,
    turnIntent,
    boundary,
    observed,
    CodexReplacementHistoryEntry.cases.Sealed.make({
      operationId: ledger.operationId,
      replacementToken: CodexOwnedTurnToken.make("foreign-token"),
      replacementTurnId
    })
  ])
  reject([
    purge,
    intent,
    turnIntent,
    boundary,
    observed,
    CodexReplacementHistoryEntry.cases.Sealed.make({
      operationId: ledger.operationId,
      replacementToken,
      replacementTurnId: CodexTurnId.make("foreign-turn")
    })
  ])
  reject([
    purge,
    intent,
    turnIntent,
    boundary,
    CodexReplacementHistoryEntry.cases.TurnObserved.make({
      operationId: ledger.operationId,
      replacementToken,
      replacementTurnId: purge.evidence.predecessorTurnId
    }),
    CodexReplacementHistoryEntry.cases.Sealed.make({
      operationId: ledger.operationId,
      replacementToken,
      replacementTurnId: purge.evidence.predecessorTurnId
    })
  ])
  reject([purge, { ...intent, operationId: CodexReplacementOperationId.make("foreign-operation") }])
  reject([purge, intent], {
    plannedAttempt: { ...ledger.plannedAttempt, worktree: WorktreeLocator.make("/tmp/foreign-worktree") }
  })

  const full = decode([purge, intent, turnIntent, boundary, observed, sealed])
  expect(mergeCodexReplacementLedger(full, ledger)).toMatchObject({ _tag: "Contradiction" })
  expect(appendCodexReplacementHistory(full, sealed)).toEqual({ _tag: "Idempotent", ledger: full })
  expect(
    appendCodexReplacementHistory(
      ledger,
      CodexReplacementHistoryEntry.cases.Sealed.make({
        operationId: ledger.operationId,
        replacementToken,
        replacementTurnId
      })
    )
  ).toMatchObject({ _tag: "Contradiction" })
})
