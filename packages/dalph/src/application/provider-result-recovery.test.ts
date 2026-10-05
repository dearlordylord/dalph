import { Schema } from "effect"
import { expect, it } from "vitest"
import {
  ProviderResultRecoveryHistory,
  ProviderResultRecoveryRecord,
  providerResultRecoveryHistoryTransitionProblem
} from "./provider-result-recovery.js"

const base = "a".repeat(40)
const predecessor = {
  cycleId: "cycle-original",
  plannedBaseSha: base,
  responses: [
    {
      _tag: "ResponseRejected",
      turnId: "original-turn",
      reason: "ResultEnvelopeInvalid",
      responseObservedAt: 20,
      intent: { _tag: "Initial", ordinal: 1, token: "original-token", intendedAt: 10 }
    }
  ]
}
const successorInitial = {
  cycleId: "cycle-recovered",
  plannedBaseSha: base,
  responses: [
    { _tag: "RequestIntended", intent: { _tag: "Initial", ordinal: 1, token: "recovery-token", intendedAt: 30 } }
  ]
}
const record = {
  authorizationId: { nonce: "continue-one", runId: "run", attemptId: "attempt" },
  predecessor,
  successorInitial
}
const decode = Schema.decodeUnknownSync(ProviderResultRecoveryRecord)
const decodeHistory = Schema.decodeUnknownSync(ProviderResultRecoveryHistory)

it("retains exact predecessor facts and one fresh unbounded initial intent", () => {
  const retained = decode(record)
  expect(retained.predecessor).toEqual(predecessor)
  expect(retained.successorInitial.responses).toHaveLength(1)
  expect(retained.successorInitial.responses[0]?.intent).not.toHaveProperty("deadline")
  expect(decodeHistory([record])).toEqual([retained])
})

it("refuses Base replacement, cycle reuse, old tokens, and recovery before the rejected answer", () => {
  for (const successor of [
    { ...successorInitial, plannedBaseSha: "b".repeat(40) },
    { ...successorInitial, cycleId: predecessor.cycleId },
    {
      ...successorInitial,
      responses: [
        {
          ...successorInitial.responses[0],
          intent: { ...successorInitial.responses[0]?.intent, token: "original-token" }
        }
      ]
    },
    {
      ...successorInitial,
      responses: [
        { ...successorInitial.responses[0], intent: { ...successorInitial.responses[0]?.intent, intendedAt: 19 } }
      ]
    }
  ])
    expect(() => decode({ ...record, successorInitial: successor })).toThrow()
})

it("retains successive cycle snapshots and refuses duplicate permissions or unrelated predecessors", () => {
  const second = {
    authorizationId: { ...record.authorizationId, nonce: "continue-two" },
    predecessor: {
      ...successorInitial,
      responses: [
        {
          _tag: "ResponseRejected",
          turnId: "recovery-turn",
          reason: "ResultEnvelopeInvalid",
          responseObservedAt: 40,
          intent: successorInitial.responses[0]?.intent
        }
      ]
    },
    successorInitial: {
      ...successorInitial,
      cycleId: "cycle-third",
      responses: [
        {
          _tag: "RequestIntended",
          intent: { ...successorInitial.responses[0]?.intent, token: "third-token", intendedAt: 50 }
        }
      ]
    }
  }
  expect(decodeHistory([record, second])).toHaveLength(2)
  expect(() => decodeHistory([record, { ...second, authorizationId: record.authorizationId }])).toThrow()
  expect(() => decodeHistory([record, { ...second, predecessor }])).toThrow()
  expect(() =>
    decodeHistory([record, { ...second, authorizationId: { ...second.authorizationId, attemptId: "foreign-attempt" } }])
  ).toThrow()
})

it("ordinary writes cannot erase or rewrite retained permission and response facts", () => {
  const history = decodeHistory([record])
  expect(providerResultRecoveryHistoryTransitionProblem(history, history)).toBeUndefined()
  expect(providerResultRecoveryHistoryTransitionProblem([], history)).toBeUndefined()
  expect(providerResultRecoveryHistoryTransitionProblem(history, [])).toBeDefined()
  const changed = decodeHistory([{ ...record, authorizationId: { ...record.authorizationId, nonce: "rewritten" } }])
  expect(providerResultRecoveryHistoryTransitionProblem(history, changed)).toBeDefined()
})
