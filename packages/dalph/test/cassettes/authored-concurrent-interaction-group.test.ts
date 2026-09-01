import { it } from "@effect/vitest"
import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect"
import { describe, expect } from "vitest"
import { AttemptId, TaskId } from "@dalph/contracts"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/authored-domain.js"
import { makeStoryCursor, type StoryCursor } from "../../src/cassettes/authored-cursor.js"

const aAttemptId = AttemptId.make("attempt:A:0")
const bAttemptId = AttemptId.make("attempt:B:1")
const cAttemptId = AttemptId.make("attempt:C:1")
const dAttemptId = AttemptId.make("attempt:D:1")
const eAttemptId = AttemptId.make("attempt:E:1")

const dPlanOperation = { _tag: "RecordTaskAttemptPlan", attemptId: dAttemptId, taskId: TaskId.make("D") } as const
const ePlanOperation = { _tag: "RecordTaskAttemptPlan", attemptId: eAttemptId, taskId: TaskId.make("E") } as const
const bWorktreeOperation = { _tag: "ReconcileTaskWorktree", attemptId: bAttemptId, taskId: TaskId.make("B") } as const
const cWorktreeOperation = { _tag: "ReconcileTaskWorktree", attemptId: cAttemptId, taskId: TaskId.make("C") } as const
const dWorktreeOperation = { _tag: "ReconcileTaskWorktree", attemptId: dAttemptId, taskId: TaskId.make("D") } as const
const eWorktreeOperation = { _tag: "ReconcileTaskWorktree", attemptId: eAttemptId, taskId: TaskId.make("E") } as const

const concurrentNode = (
  role: string,
  predecessorRoles: ReadonlyArray<string>,
  interaction: Readonly<Record<string, unknown>>
) => ({ interaction, predecessorRoles, role })

const concurrentGroup = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)({
  _tag: "ConcurrentInteractionGroup",
  members: [
    concurrentNode("P_D", [], { _tag: "DalphSelects", operation: dPlanOperation }),
    concurrentNode("P_E", [], { _tag: "DalphSelects", operation: ePlanOperation }),
    concurrentNode("W_B", [], { _tag: "DalphSelects", operation: bWorktreeOperation }),
    concurrentNode("W_C", [], { _tag: "DalphSelects", operation: cWorktreeOperation }),
    concurrentNode("X_A", [], {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: aAttemptId },
      request: "Begin"
    }),
    concurrentNode("W_D", ["P_D"], { _tag: "DalphSelects", operation: dWorktreeOperation }),
    concurrentNode("W_E", ["P_E"], { _tag: "DalphSelects", operation: eWorktreeOperation }),
    concurrentNode("X_B", ["W_B"], {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: bAttemptId },
      request: "Begin"
    }),
    concurrentNode("X_C", ["W_C"], {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: cAttemptId },
      request: "Begin"
    })
  ]
})
const activationReturn = AuthoredCassetteStoryItem.cases.CoordinatorActivationReturned.make({
  decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
})
const story = [concurrentGroup, activationReturn]

const causalGroupRoles = ["P_D", "P_E", "W_B", "W_C", "X_A", "W_D", "W_E", "X_B", "X_C"] as const
type CausalGroupRole = (typeof causalGroupRoles)[number]

const predecessorRoles: Readonly<Record<CausalGroupRole, ReadonlyArray<CausalGroupRole>>> = {
  P_D: [],
  P_E: [],
  W_B: [],
  W_C: [],
  X_A: [],
  W_D: ["P_D"],
  W_E: ["P_E"],
  X_B: ["W_B"],
  X_C: ["W_C"]
}

const consumeMember = (cursor: StoryCursor, role: CausalGroupRole) => {
  switch (role) {
    case "P_D":
      return cursor.consumeDalphSelectionFor(dPlanOperation).pipe(Effect.asVoid)
    case "P_E":
      return cursor.consumeDalphSelectionFor(ePlanOperation).pipe(Effect.asVoid)
    case "W_B":
      return cursor.consumeDalphSelectionFor(bWorktreeOperation).pipe(Effect.asVoid)
    case "W_C":
      return cursor.consumeDalphSelectionFor(cWorktreeOperation).pipe(Effect.asVoid)
    case "W_D":
      return cursor.consumeDalphSelectionFor(dWorktreeOperation).pipe(Effect.asVoid)
    case "W_E":
      return cursor.consumeDalphSelectionFor(eWorktreeOperation).pipe(Effect.asVoid)
    case "X_A":
      return cursor.consumeExecutorReportFor("Begin", aAttemptId).pipe(Effect.asVoid)
    case "X_B":
      return cursor.consumeExecutorReportFor("Begin", bAttemptId).pipe(Effect.asVoid)
    case "X_C":
      return cursor.consumeExecutorReportFor("Begin", cAttemptId).pipe(Effect.asVoid)
  }
}

function* legalCausalOrders(
  consumed: ReadonlyArray<CausalGroupRole> = [],
  outstanding: ReadonlyArray<CausalGroupRole> = causalGroupRoles
): Generator<ReadonlyArray<CausalGroupRole>> {
  if (outstanding.length === 0) {
    yield consumed
    return
  }
  for (const [index, role] of outstanding.entries()) {
    if (!predecessorRoles[role].every((predecessor) => consumed.includes(predecessor))) continue
    yield* legalCausalOrders([...consumed, role], [...outstanding.slice(0, index), ...outstanding.slice(index + 1)])
  }
}

const allLegalCausalOrders = [...legalCausalOrders()]
const causalRootRoles = ["P_D", "P_E", "W_B", "W_C", "X_A"] as const
const causalOrderFingerprint = (order: ReadonlyArray<CausalGroupRole>): string => JSON.stringify(order)
const causalRootShards = causalRootRoles.map((root) => ({
  orders: allLegalCausalOrders.filter((order) => order[0] === root),
  root
}))

const failCausalOrder = (
  root: (typeof causalRootRoles)[number],
  orderIndex: number,
  order: ReadonlyArray<CausalGroupRole>,
  phase: string,
  detail: string
): never => {
  return expect.fail(`causal ${root} shard order ${orderIndex} [${order.join(", ")}] failed ${phase}: ${detail}`)
}

const isExactActivationReturn = (item: AuthoredCassetteStoryItem): boolean =>
  item._tag === "CoordinatorActivationReturned" &&
  item.decision._tag === "RunMustRemainActive" &&
  item.decision.reason === "UnsettledResponsibility"

it("partitions all 22680 causal orders exactly once by their first enabled root", () => {
  const allFingerprints = allLegalCausalOrders.map(causalOrderFingerprint)
  const canonicalFullSet = new Set(allFingerprints)
  const canonicalShards = causalRootShards.map(({ orders, root }) => ({
    fingerprints: orders.map(causalOrderFingerprint),
    root
  }))
  const canonicalShardSets = canonicalShards.map(({ fingerprints }) => new Set(fingerprints))
  const canonicalShardUnion = new Set(canonicalShards.flatMap(({ fingerprints }) => fingerprints))

  expect(allLegalCausalOrders).toHaveLength(22_680)
  expect(canonicalFullSet.size).toBe(22_680)
  expect(causalRootShards.reduce((total, { orders }) => total + orders.length, 0)).toBe(22_680)
  expect(
    canonicalShards.every(({ fingerprints }, index) => fingerprints.length === canonicalShardSets[index]?.size)
  ).toBe(true)
  expect(canonicalShardUnion).toEqual(canonicalFullSet)
  expect(
    allFingerprints.every((fingerprint) => canonicalShardSets.filter((shard) => shard.has(fingerprint)).length === 1)
  ).toBe(true)
  expect(causalRootShards.every(({ orders, root }) => orders.every((order) => order[0] === root))).toBe(true)
  expect(allLegalCausalOrders).toContainEqual(["P_D", "W_D", "P_E", "W_E", "W_B", "X_B", "W_C", "X_C", "X_A"])
  expect(allLegalCausalOrders).toContainEqual(["W_B", "X_B", "P_D", "W_D", "W_C", "X_C", "X_A", "P_E", "W_E"])
})

describe("consumes the nine-node delivery cut in all 22680 causal orders before advancing once", () => {
  for (const { orders, root } of causalRootShards) {
    it.effect(`executes every causal order whose first enabled root is ${root}`, () =>
      Effect.gen(function* () {
        const shardStory = orders.flatMap(() => [concurrentGroup, activationReturn])
        let occurrenceCount = 0
        let latestOccurrence: { readonly item: AuthoredCassetteStoryItem; readonly storyPosition: number } | undefined
        const cursor = yield* makeStoryCursor(shardStory, {
          onOccurrence: (occurrence) =>
            Effect.sync(() => {
              occurrenceCount += 1
              latestOccurrence = occurrence
            })
        })

        for (const [orderIndex, order] of orders.entries()) {
          const groupPosition = orderIndex * 2
          for (const [memberIndex, role] of order.entries()) {
            if (memberIndex === causalGroupRoles.length - 1) {
              if ((yield* cursor.storyPosition) !== groupPosition) {
                failCausalOrder(root, orderIndex, order, "after the first eight members", "the group position advanced")
              }
              if (occurrenceCount !== groupPosition) {
                failCausalOrder(
                  root,
                  orderIndex,
                  order,
                  "after the first eight members",
                  "the group emitted an occurrence"
                )
              }
            }
            yield* consumeMember(cursor, role)
          }
          if ((yield* cursor.storyPosition) !== groupPosition + 1) {
            failCausalOrder(root, orderIndex, order, "after the ninth member", "the group did not advance exactly once")
          }
          if (occurrenceCount !== groupPosition + 1) {
            failCausalOrder(
              root,
              orderIndex,
              order,
              "after the ninth member",
              "the group did not emit exactly one occurrence"
            )
          }
          if (latestOccurrence?.item !== concurrentGroup || latestOccurrence.storyPosition !== groupPosition + 1) {
            failCausalOrder(
              root,
              orderIndex,
              order,
              "after the ninth member",
              "the emitted group item or position was not exact"
            )
          }

          const returned = yield* cursor.consumeCoordinatorActivationReturned
          if (!isExactActivationReturn(returned)) {
            failCausalOrder(
              root,
              orderIndex,
              order,
              "after the strict activation return",
              "the returned item was not exact"
            )
          }
          if ((yield* cursor.storyPosition) !== groupPosition + 2) {
            failCausalOrder(
              root,
              orderIndex,
              order,
              "after the strict activation return",
              "the story position did not advance"
            )
          }
          if (occurrenceCount !== groupPosition + 2) {
            failCausalOrder(
              root,
              orderIndex,
              order,
              "after the strict activation return",
              "the occurrence count was not exact"
            )
          }
        }
        expect(yield* cursor.storyPosition).toBe(shardStory.length)
        expect(occurrenceCount).toBe(shardStory.length)
      })
    )
  }
})

it.effect("retries each exact successor once after its predecessor follows an early typed failure", () =>
  Effect.gen(function* () {
    const edges: ReadonlyArray<readonly [CausalGroupRole, CausalGroupRole]> = [
      ["P_D", "W_D"],
      ["P_E", "W_E"],
      ["W_B", "X_B"],
      ["W_C", "X_C"]
    ]
    for (const [predecessor, successor] of edges) {
      const occurrences: Array<unknown> = []
      const cursor = yield* makeStoryCursor(story, {
        onOccurrence: (occurrence) => Effect.sync(() => occurrences.push(occurrence))
      })

      const early = yield* consumeMember(cursor, successor).pipe(Effect.flip)
      expect(early._tag).toBe("AuthoredCassetteInteractionMismatch")
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])

      yield* consumeMember(cursor, predecessor)
      yield* consumeMember(cursor, successor)
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])

      const duplicate = yield* consumeMember(cursor, successor).pipe(Effect.flip)
      expect(duplicate._tag).toBe("AuthoredCassetteInteractionMismatch")
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])
    }
  })
)

it.effect("returns each exact controlled executor report from its authored group node", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor(story)

    expect(yield* cursor.consumeExecutorReportFor("Begin", aAttemptId)).toEqual({
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: aAttemptId },
      request: "Begin"
    })
    yield* consumeMember(cursor, "W_B")
    expect(yield* cursor.consumeExecutorReportFor("Begin", bAttemptId)).toEqual({
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: bAttemptId },
      request: "Begin"
    })
    yield* consumeMember(cursor, "W_C")
    expect(yield* cursor.consumeExecutorReportFor("Begin", cAttemptId)).toEqual({
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: cAttemptId },
      request: "Begin"
    })
    expect(yield* cursor.storyPosition).toBe(0)
  })
)

it.effect("serializes simultaneous roots and successors and emits once after the causal join", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const occurrences: Array<{ readonly item: AuthoredCassetteStoryItem; readonly storyPosition: number }> = []
      const cursor = yield* makeStoryCursor(story, {
        onOccurrence: (occurrence) => Effect.sync(() => occurrences.push(occurrence))
      })
      const rootRelease = yield* Deferred.make<void>()
      const roots = yield* Effect.forEach(["P_D", "P_E", "W_B", "W_C", "X_A"] as const, (role) =>
        Effect.gen(function* () {
          const ready = yield* Deferred.make<void>()
          const fiber = yield* Deferred.succeed(ready, undefined).pipe(
            Effect.andThen(Deferred.await(rootRelease)),
            Effect.andThen(consumeMember(cursor, role)),
            Effect.forkScoped
          )
          return { fiber, ready }
        })
      )

      yield* Effect.forEach(roots, ({ ready }) => Deferred.await(ready), { concurrency: "unbounded", discard: true })
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])
      yield* Deferred.succeed(rootRelease, undefined)
      yield* Effect.forEach(roots, ({ fiber }) => Fiber.join(fiber), { concurrency: "unbounded", discard: true })
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])

      const successorRelease = yield* Deferred.make<void>()
      const successors = yield* Effect.forEach(["W_D", "W_E", "X_B", "X_C"] as const, (role) =>
        Effect.gen(function* () {
          const ready = yield* Deferred.make<void>()
          const fiber = yield* Deferred.succeed(ready, undefined).pipe(
            Effect.andThen(Deferred.await(successorRelease)),
            Effect.andThen(consumeMember(cursor, role)),
            Effect.forkScoped
          )
          return { fiber, ready }
        })
      )

      yield* Effect.forEach(successors, ({ ready }) => Deferred.await(ready), {
        concurrency: "unbounded",
        discard: true
      })
      yield* Deferred.succeed(successorRelease, undefined)
      yield* Effect.forEach(successors, ({ fiber }) => Fiber.join(fiber), { concurrency: "unbounded", discard: true })

      expect(yield* cursor.storyPosition).toBe(1)
      expect(occurrences).toEqual([{ item: concurrentGroup, storyPosition: 1 }])
      yield* cursor.consumeCoordinatorActivationReturned
      expect(yield* cursor.storyPosition).toBe(2)
    })
  )
)

it.effect("publishes the completed group before admitting the strict successor even when interrupted", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const callbackEntered = yield* Deferred.make<void>()
      const callbackRelease = yield* Deferred.make<void>()
      const strictStarted = yield* Deferred.make<void>()
      const occurrences: Array<{ readonly item: AuthoredCassetteStoryItem; readonly storyPosition: number }> = []
      const cursor = yield* makeStoryCursor(story, {
        onOccurrence: (occurrence) =>
          Effect.gen(function* () {
            if (occurrence.item._tag === "ConcurrentInteractionGroup") {
              yield* Deferred.succeed(callbackEntered, undefined)
              yield* Deferred.await(callbackRelease)
            }
            yield* Effect.sync(() => occurrences.push(occurrence))
          })
      })
      for (const role of ["P_D", "W_D", "P_E", "W_E", "W_B", "X_B", "W_C", "X_A"] as const) {
        yield* consumeMember(cursor, role)
      }

      const ninth = yield* consumeMember(cursor, "X_C").pipe(Effect.forkScoped)
      yield* Deferred.await(callbackEntered)
      const strict = yield* Deferred.succeed(strictStarted, undefined).pipe(
        Effect.andThen(cursor.consumeCoordinatorActivationReturned),
        Effect.forkScoped({ startImmediately: true })
      )
      yield* Deferred.await(strictStarted)

      expect(strict.pollUnsafe()).toBeUndefined()
      const interrupting = yield* Fiber.interrupt(ninth).pipe(Effect.forkScoped({ startImmediately: true }))
      expect(interrupting.pollUnsafe()).toBeUndefined()
      expect(occurrences).toEqual([])

      yield* Deferred.succeed(callbackRelease, undefined)
      const returned = yield* Fiber.join(strict)
      yield* Fiber.join(interrupting)
      const ninthExit = yield* Fiber.await(ninth)

      expect(returned).toEqual(activationReturn)
      expect(Exit.isFailure(ninthExit) && Cause.hasInterruptsOnly(ninthExit.cause)).toBe(true)
      expect(occurrences).toEqual([
        { item: concurrentGroup, storyPosition: 1 },
        { item: activationReturn, storyPosition: 2 }
      ])
      expect(yield* cursor.storyPosition).toBe(2)
    })
  )
)

it.effect("rejects foreign duplicate and downstream claims without advancing an incomplete group", () =>
  Effect.gen(function* () {
    const foreignOperation = {
      _tag: "ReconcileTaskWorktree",
      attemptId: AttemptId.make("attempt:X:1"),
      taskId: TaskId.make("X")
    } as const

    const foreignOccurrences: Array<unknown> = []
    const foreign = yield* makeStoryCursor(story, {
      onOccurrence: (occurrence) => Effect.sync(() => foreignOccurrences.push(occurrence))
    })
    expect((yield* foreign.consumeDalphSelectionFor(foreignOperation).pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteInteractionMismatch"
    )
    expect(yield* foreign.storyPosition).toBe(0)
    expect(foreignOccurrences).toEqual([])

    const duplicateOccurrences: Array<unknown> = []
    const duplicate = yield* makeStoryCursor(story, {
      onOccurrence: (occurrence) => Effect.sync(() => duplicateOccurrences.push(occurrence))
    })
    yield* consumeMember(duplicate, "W_B")
    expect((yield* consumeMember(duplicate, "W_B").pipe(Effect.flip))._tag).toBe("AuthoredCassetteInteractionMismatch")
    expect(yield* duplicate.storyPosition).toBe(0)
    expect(duplicateOccurrences).toEqual([])

    const downstreamOccurrences: Array<unknown> = []
    const downstream = yield* makeStoryCursor(story, {
      onOccurrence: (occurrence) => Effect.sync(() => downstreamOccurrences.push(occurrence))
    })
    expect((yield* downstream.consumeCoordinatorActivationReturned.pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteInteractionMismatch"
    )
    expect(yield* downstream.storyPosition).toBe(0)
    expect(downstreamOccurrences).toEqual([])
  })
)

it.effect("keeps an incomplete causal group current without inventing timeout semantics", () =>
  Effect.gen(function* () {
    const occurrences: Array<unknown> = []
    const cursor = yield* makeStoryCursor(story, {
      onOccurrence: (occurrence) => Effect.sync(() => occurrences.push(occurrence))
    })
    for (const role of ["P_D", "W_D", "P_E", "W_E", "W_B", "X_B", "W_C", "X_A"] as const) {
      yield* consumeMember(cursor, role)
    }

    expect(yield* cursor.storyPosition).toBe(0)
    expect((yield* cursor.currentStoryItem)?._tag).toBe("ConcurrentInteractionGroup")
    expect(occurrences).toEqual([])
  })
)

it.effect("recreates all causal group roles after its cursor scope is replaced", () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const first = yield* makeStoryCursor(story)
        yield* consumeMember(first, "P_D")
        yield* consumeMember(first, "W_D")
        yield* consumeMember(first, "X_A")
        expect(yield* first.storyPosition).toBe(0)
      })
    )

    yield* Effect.scoped(
      Effect.gen(function* () {
        const replacement = yield* makeStoryCursor(story)
        for (const role of ["P_D", "W_D", "P_E", "W_E", "W_B", "X_B", "W_C", "X_C", "X_A"] as const) {
          yield* consumeMember(replacement, role)
        }
        expect(yield* replacement.storyPosition).toBe(1)
      })
    )
  })
)
