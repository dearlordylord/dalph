import { Effect, Schema } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  AttemptId,
  FixtureTarget,
  GitCommitSha,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskId,
  TaskLifecycle,
  WorktreeLocator
} from "./domain.js"
import { intentRecordKey, JournalStore, managedWorkflowIntent, memoryJournalStoreLayer } from "./journal-store.js"
import { TaskWorkStartRequest } from "./task-work-start.js"
import {
  causalGraphProjection,
  compareOperationIds,
  makeTaskWorkSessionEstablishmentOperation,
  makeTrackerGraphObservationOperation,
  WorkflowOperation,
  workflowOperationId
} from "./workflow.js"

it("preserves operation identity and direct predecessors across journal codec roundtrips", () => {
  fc.assert(fc.property(
    fc.uniqueArray(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 8 }),
    (predecessors) => {
      const taskId = TaskId.make("task")
      const operation = makeTaskWorkSessionEstablishmentOperation({
        predecessorOperationIds: predecessors.map((id) => OperationId.make(id)),
        request: TaskWorkStartRequest.make({
          operationId: OperationId.make("stable-operation"),
          plannedAttempt: PlannedTaskAttempt.make({
            attemptId: AttemptId.make("attempt"),
            baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
            branch: TaskBranchRef.make("refs/heads/task"),
            runId: RunId.make("run"),
            taskId,
            worktree: WorktreeLocator.make("/tmp/task")
          }),
          task: {
            id: taskId,
            lifecycle: TaskLifecycle.cases.Open.make({}),
            parentTaskId: null,
            prerequisiteIds: []
          }
        })
      })
      const decoded = Schema.decodeUnknownSync(WorkflowOperation)(
        Schema.encodeUnknownSync(WorkflowOperation)(operation)
      )

      expect(decoded).toEqual(operation)
      expect(workflowOperationId(decoded)).toBe(operation.request.operationId)
    }
  ))
})

it("uses one locale-independent canonical order for operation identities", () => {
  fc.assert(fc.property(
    fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 20 }),
    (identities) => {
      const branded = identities.map((identity) => OperationId.make(identity))
      const expected = branded.toSorted((left, right) => left < right ? -1 : left > right ? 1 : 0)
      expect(branded.toSorted(compareOperationIds)).toEqual(expected)
      expect(compareOperationIds(OperationId.make("same"), OperationId.make("same"))).toBe(0)
    }
  ))
})

it("preserves the causal graph across legal concurrent journal interleavings", async () => {
  await fc.assert(fc.asyncProperty(
    fc.array(fc.array(fc.boolean(), { maxLength: 8 }), { minLength: 1, maxLength: 8 }),
    fc.array(fc.integer(), { minLength: 1, maxLength: 8 }),
    async (edgeChoices, orderKeys) => {
      const operations = edgeChoices.map((choices, index) => ({
        ...makeTrackerGraphObservationOperation(
          OperationId.make(`operation-${index}`),
          FixtureTarget.make(`target-${index}`)
        ),
        predecessorOperationIds: Array.from(
          { length: index },
          (_, predecessorIndex) => predecessorIndex
        )
          .filter((predecessorIndex) => choices[predecessorIndex] ?? false)
          .map((predecessorIndex) => OperationId.make(`operation-${predecessorIndex}`))
      }))
      const pending = [...operations]
      const interleaved: typeof operations = []
      const emitted = new Set<OperationId>()
      while (pending.length > 0) {
        const available = pending.filter((operation) =>
          operation.predecessorOperationIds.every((id) => emitted.has(id))
        ).toSorted((left, right) => {
          const leftIndex = Number(left.operationId.split("-")[1])
          const rightIndex = Number(right.operationId.split("-")[1])
          return (orderKeys[leftIndex % orderKeys.length] ?? 0)
              - (orderKeys[rightIndex % orderKeys.length] ?? 0)
            || left.operationId.localeCompare(right.operationId)
        })
        const next = available[0]
        if (next === undefined) throw new Error("generated causal graph contains a cycle")
        interleaved.push(next)
        emitted.add(next.operationId)
        pending.splice(pending.indexOf(next), 1)
      }

      const replayed = await Effect.runPromise(
        Effect.gen(function*() {
          const journal = yield* JournalStore
          const runId = RunId.make("causal-interleaving-run")
          for (const operation of interleaved) {
            yield* journal.append(
              runId,
              intentRecordKey(operation.operationId),
              managedWorkflowIntent(operation)
            )
          }
          return (yield* journal.read(runId)).flatMap(({ event }) =>
            event._tag === "ManagedWorkflowIntent" ? [event.operation] : []
          )
        }).pipe(Effect.provide(memoryJournalStoreLayer))
      )

      expect(replayed.map(workflowOperationId)).toEqual(
        interleaved.map(({ operationId }) => operationId)
      )
      expect(causalGraphProjection(replayed)).toEqual(
        causalGraphProjection(operations)
      )
    }
  ))
})
