import { Cause, Effect, Exit } from "effect"
import { expect, it } from "vitest"
import { AttemptId, TaskId } from "@dalph/contracts"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/authored-domain.js"
import {
  AuthoredConcurrentReadBatchFailure,
  makeStoryCursor
} from "../../src/cassettes/authored-cursor.js"

const attemptId = AttemptId.make("batch-attempt")

const readClaim = { _tag: "ReadTaskClaim" as const, taskId: TaskId.make("A") }
const readWorktree = {
  _tag: "ReadTaskWorktree" as const,
  attemptId,
  taskId: TaskId.make("B")
}
const readLineage = {
  _tag: "ReadTargetLineage" as const,
  attemptId,
  taskId: TaskId.make("C")
}

const batch = (members: ReadonlyArray<Parameters<typeof AuthoredCassetteStoryItem.cases.ConcurrentReadBatch.make>[0]>) =>
  AuthoredCassetteStoryItem.cases.ConcurrentReadBatch.make({ members })

const claimMember = {
  operation: readClaim,
  result: { _tag: "TaskClaimCurrentReadReturned" as const, taskId: TaskId.make("A") }
}
const worktreeMember = { operation: readWorktree, result: { _tag: "NoProviderResult" as const } }
const lineageMember = { operation: readLineage, result: { _tag: "NoProviderResult" as const } }

const terminal = AuthoredCassetteStoryItem.cases.ExpectedBehavior.make({
  orchestration: null,
  protocol: null,
  taskWork: {
    absences: [{ _tag: "NoPlannedWorkUndertakenForTask", taskId: TaskId.make("A") }],
    results: []
  }
})

const consumePermutation = (members: ReadonlyArray<typeof claimMember | typeof worktreeMember | typeof lineageMember>) =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor([batch(members), terminal])
    for (const member of members) {
      yield* cursor.consumeDalphSelectionFor(member.operation)
      if (member.result._tag === "TaskClaimCurrentReadReturned") {
        const result = yield* cursor.consumeTaskClaimReadFor(TaskId.make("A"))
        expect(result._tag).toBe("Some")
      }
    }
    expect(yield* cursor.consumeTerminalAssertions).toEqual(terminal)
    return cursor
  })

it("consumes two and three independent observation permutations while retaining paired results", async () => {
  await Effect.runPromise(
    Effect.all([
      consumePermutation([claimMember, worktreeMember]),
      consumePermutation([worktreeMember, claimMember]),
      consumePermutation([lineageMember, claimMember, worktreeMember]),
      consumePermutation([worktreeMember, lineageMember, claimMember])
    ])
  )
})

it("fails closed for duplicate, unlisted, missing, and crossed ordered interactions", async () => {
  const duplicate = await Effect.runPromise(
    Effect.gen(function* () {
      const cursor = yield* makeStoryCursor([batch([claimMember]), terminal])
      yield* cursor.consumeDalphSelectionFor(readClaim)
      return yield* Effect.exit(cursor.consumeDalphSelectionFor(readClaim))
    })
  )
  expect(Exit.isFailure(duplicate)).toBe(true)
  if (Exit.isFailure(duplicate)) {
    expect(Cause.pretty(duplicate.cause)).toContain(AuthoredConcurrentReadBatchFailure.name)
  }

  const unlisted = await Effect.runPromise(
    Effect.gen(function* () {
      const cursor = yield* makeStoryCursor([batch([claimMember]), terminal])
      return yield* Effect.exit(cursor.consumeDalphSelectionFor(readWorktree))
    })
  )
  expect(Exit.isFailure(unlisted)).toBe(true)
  if (Exit.isFailure(unlisted)) {
    expect(Cause.pretty(unlisted.cause)).toContain(AuthoredConcurrentReadBatchFailure.name)
  }

  const missing = await Effect.runPromise(
    Effect.gen(function* () {
      const cursor = yield* makeStoryCursor([batch([claimMember, worktreeMember]), terminal])
      yield* cursor.consumeDalphSelectionFor(readClaim)
      yield* cursor.consumeTaskClaimReadFor(TaskId.make("A"))
      return yield* Effect.exit(cursor.consumeTerminalAssertions)
    })
  )
  expect(Exit.isFailure(missing)).toBe(true)
  if (Exit.isFailure(missing)) {
    expect(Cause.pretty(missing.cause)).toContain(AuthoredConcurrentReadBatchFailure.name)
  }

  const crossed = await Effect.runPromise(
    Effect.gen(function* () {
      const cursor = yield* makeStoryCursor([batch([claimMember]), terminal])
      return yield* Effect.exit(cursor.consumeTerminalAssertions)
    })
  )
  expect(Exit.isFailure(crossed)).toBe(true)
  if (Exit.isFailure(crossed)) {
    expect(Cause.pretty(crossed.cause)).toContain(AuthoredConcurrentReadBatchFailure.name)
  }
})

it("rejects an observation result whose identity is not coupled to its selection", () => {
  expect(() =>
    AuthoredCassetteStoryItem.cases.ConcurrentReadBatch.make({
      members: [
        {
          operation: readClaim,
          result: { _tag: "TaskClaimCurrentReadReturned", taskId: TaskId.make("B") }
        }
      ]
    })
  ).toThrow()
})
