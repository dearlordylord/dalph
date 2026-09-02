import { it } from "@effect/vitest"
import { Effect, Exit, Ref, Schema } from "effect"
import { expect } from "vitest"
import { AttemptId, TaskId } from "@dalph/contracts"
import { FixtureTarget, OperationId } from "@dalph/orchestrator"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/authored-domain.js"
import { makeStoryCursor, type StoryCursor } from "../../src/cassettes/authored-cursor.js"
import { changedAttemptRestartCancelsHeldResumeAuthoredCassette } from "../../src/cassettes/catalog.js"

const target = FixtureTarget.make("cassette-target")
const taskId = TaskId.make("A")
const successorAttemptId = AttemptId.make("attempt:A:1")
const graph = { revision: "causal-graph", tasks: [] } as const
const finalityOperation = { _tag: "ReadTrackerGraph", target } as const
const finalityContext = {
  graphReadCause: "PostQuiescenceReconfirmation" as const,
  operationId: OperationId.make("finality-graph"),
  predecessorOperationIds: []
}
const restartContext = {
  graphReadCause: "AttemptRestartAuthorityCheck" as const,
  operationId: OperationId.make("restart-graph"),
  predecessorOperationIds: []
}
const decision = { _tag: "RunMustRemainActive" as const, reason: "UnsettledResponsibility" as const }
const group = Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.ConcurrentInteractionGroup)(
  changedAttemptRestartCancelsHeldResumeAuthoredCassette.story.find(
    (item) =>
      item._tag === "ConcurrentInteractionGroup" &&
      item.members.some(({ role }) => role === "activation-finality-selection")
  )
)

type Role =
  | "activation-finality-selection"
  | "activation-finality-result"
  | "activation-return"
  | "restart-authority-graph"
  | "restart-authority-specification"
  | "restart-authority-claim"
  | "successor-worktree-selection"
  | "successor-begin-result"
const finalityRoles: ReadonlyArray<Role> = [
  "activation-finality-selection",
  "activation-finality-result",
  "activation-return"
]
const restartRoles: ReadonlyArray<Role> = [
  "restart-authority-graph",
  "restart-authority-specification",
  "restart-authority-claim",
  "successor-worktree-selection",
  "successor-begin-result"
]
const interleavings = <A>(left: ReadonlyArray<A>, right: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> => {
  if (left.length === 0) return [right]
  if (right.length === 0) return [left]
  return [
    ...interleavings(left.slice(1), right).map((tail) => [left[0] as A, ...tail]),
    ...interleavings(left, right.slice(1)).map((tail) => [right[0] as A, ...tail])
  ]
}

const consumeRole = (role: Role, cursor: StoryCursor): Effect.Effect<void, unknown> => {
  switch (role) {
    case "activation-finality-selection":
      return cursor.consumeDalphSelectionFor(finalityOperation, finalityContext).pipe(Effect.asVoid)
    case "activation-finality-result":
      return cursor.consumeTrackerGraphFor(target, finalityContext).pipe(Effect.asVoid)
    case "activation-return":
      return cursor.consumeCoordinatorActivationReturnedFor(decision).pipe(Effect.asVoid)
    case "restart-authority-graph":
      return cursor.consumeTrackerGraphFor(target, restartContext).pipe(Effect.asVoid)
    case "restart-authority-specification":
      return cursor.consumeTaskWorkSpecificationFor(taskId).pipe(Effect.asVoid)
    case "restart-authority-claim":
      return cursor.consumeTaskClaimReadFor(taskId).pipe(Effect.asVoid)
    case "successor-worktree-selection":
      return cursor
        .consumeDalphSelectionFor({ _tag: "ReconcileTaskWorktree", attemptId: successorAttemptId, taskId })
        .pipe(Effect.asVoid)
    case "successor-begin-result":
      return cursor.consumeExecutorReportFor("Begin", successorAttemptId).pipe(Effect.asVoid)
  }
}

it("round-trips the maintained graph-result and coordinator-return member forms", () => {
  const encoded = Schema.encodeSync(AuthoredCassetteStoryItem.cases.ConcurrentInteractionGroup)(group)
  expect(Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.ConcurrentInteractionGroup)(encoded)).toEqual(group)
})

it.effect("accepts all 56 legal interleavings of finality and the complete Restart authority lane", () =>
  Effect.gen(function* () {
    const legalOrders = interleavings(finalityRoles, restartRoles)
    const fingerprints = new Set<string>()
    for (const order of legalOrders) {
      const occurrences = yield* Ref.make(0)
      const cursor = yield* makeStoryCursor([group], {
        onOccurrence: () => Ref.update(occurrences, (count) => count + 1)
      })
      yield* Effect.forEach(order, (role) => consumeRole(role, cursor), { discard: true })
      fingerprints.add(order.map((role) => (role.startsWith("activation") ? "F" : "R")).join(""))
      expect(yield* cursor.storyPosition).toBe(1)
      expect(yield* Ref.get(occurrences)).toBe(1)
    }

    expect(legalOrders).toHaveLength(56)
    expect(fingerprints.size).toBe(56)
    expect(fingerprints).toContain("FFFRRRRR")
    expect(fingerprints).toContain("RRRRRFFF")
  })
)

it.effect("binds the finality graph result to its selected operation identity and keeps Restart distinct", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor([group])
    yield* cursor.consumeDalphSelectionFor(finalityOperation, finalityContext)

    const crossedFinality = yield* cursor
      .consumeTrackerGraphFor(target, { ...finalityContext, operationId: OperationId.make("foreign-finality") })
      .pipe(Effect.exit)
    expect(Exit.isFailure(crossedFinality)).toBe(true)
    yield* cursor.consumeTrackerGraphFor(target, finalityContext)

    const reusedByRestart = yield* cursor
      .consumeTrackerGraphFor(target, { ...restartContext, operationId: finalityContext.operationId })
      .pipe(Effect.exit)
    expect(Exit.isFailure(reusedByRestart)).toBe(true)
    yield* cursor.consumeTrackerGraphFor(target, restartContext)
  })
)

it.effect("fails closed without mutating a finality selection claimed under missing or wrong cause", () =>
  Effect.gen(function* () {
    for (const context of [undefined, restartContext] as const) {
      const cursor = yield* makeStoryCursor([group])
      const rejected = yield* cursor.consumeDalphSelectionFor(finalityOperation, context).pipe(Effect.exit)
      expect(Exit.isFailure(rejected)).toBe(true)

      yield* cursor.consumeDalphSelectionFor(finalityOperation, finalityContext)
      yield* cursor.consumeTrackerGraphFor(target, finalityContext)
    }
  })
)

it("rejects missing or fabricated selection ownership for the two graph causes", () => {
  const decode = (members: ReadonlyArray<unknown>) =>
    Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.ConcurrentInteractionGroup)({
      _tag: "ConcurrentInteractionGroup",
      members
    })
  const selection = group.members[0]
  expect(() =>
    decode([
      selection,
      {
        interaction: { _tag: "TrackerGraphReadReturned", cause: "PostQuiescenceReconfirmation", graph },
        predecessorRoles: [selection.role],
        role: "missing-selection-owner"
      }
    ])
  ).toThrow(/requires its exact selection role/)
  expect(() =>
    decode([
      selection,
      {
        interaction: {
          _tag: "TrackerGraphReadReturned",
          cause: "AttemptRestartAuthorityCheck",
          graph,
          selectionRole: selection.role
        },
        predecessorRoles: [selection.role],
        role: "fabricated-restart-selection"
      }
    ])
  ).toThrow(/must not fabricate a selection role/)
})
