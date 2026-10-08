/* eslint-disable import/no-nodejs-modules -- An exact child deadline detects synchronous event-loop starvation. */
import { execFileSync } from "node:child_process"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { RunId } from "@dalph/contracts"
import fc from "fast-check"
import { expect, it } from "vitest"
import { remotePublicationTargetForTest } from "../../test/support/direct-publication.js"
import { validSnapshot } from "../../test/task-dag.js"
import { completedRunFinalityFixture } from "../../test/run-finality.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../control/policy.js"
import { OperationId } from "../workflow/identity.js"
import { taskTrackerReadIntent } from "../workflow/registry/event.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import { makeTrackerGraphObservationOperation } from "../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../workflow/task-tracker-facts/observation.js"
import { JournalPosition } from "./identity.js"
import { makeHistoricalWorkflowRunBeganRecord } from "./run-lifecycle.js"
import type { JournalRecord } from "./store.js"
import { terminationPreconditionIssues } from "./termination-preconditions.js"

const runId = RunId.make("finality-pressure-run")
const target = FixtureTarget.make("finality-pressure-target")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const evidence = completedRunFinalityFixture({ runId, target }).evidence
type Read = { readonly completed: boolean; readonly predecessors: ReadonlyArray<number> }
const recordsFor = (reads: ReadonlyArray<Read>, prefix = "graph"): ReadonlyArray<JournalRecord> => {
  const identities = reads.map((_, index) => OperationId.make(`${prefix}:${index}`))
  return [
    makeHistoricalWorkflowRunBeganRecord(runId, target, initialPolicy, remotePublicationTargetForTest),
    ...reads.flatMap((read, index) => {
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make(`${prefix}:${index}`),
        target,
        identities.filter((_, predecessor) => read.predecessors.includes(predecessor))
      )
      const snapshot = validSnapshot({
        revision: `revision:${index}`,
        rootTaskId: "root",
        tasks: [
          {
            id: "root",
            lifecycle: { _tag: read.completed ? "CompletedSuccessfully" : "Open" },
            parentTaskId: null,
            prerequisiteIds: []
          }
        ]
      })
      return [
        taskTrackerReadIntent(operation),
        taskTrackerFactsObservedEvent(operation.operationId, makeCompleteTaskTrackerFactsObserved(operation, snapshot))
      ].map((event, offset) => ({
        event,
        key: describeJournalEvent(event).expectedKey,
        position: JournalPosition.make(2 + index * 2 + offset),
        runId
      }))
    })
  ]
}

it("matches independent causal maximality for generated tracker histories", () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ completed: fc.boolean(), edges: fc.array(fc.nat(15), { maxLength: 16 }) }), {
        minLength: 1,
        maxLength: 16
      }),
      (generated) => {
        const reads = generated.map((read, index) => ({
          completed: read.completed,
          predecessors: [...new Set(read.edges.filter((edge) => edge < index))]
        }))
        // Independent Floyd-Warshall closure over accepted chronological edges.
        const reachable = reads.map((read) => reads.map((_, index) => read.predecessors.includes(index)))
        for (let via = 0; via < reads.length; via++) {
          for (let from = 0; from < reads.length; from++) {
            for (let to = 0; to < reads.length; to++) {
              const row = reachable[from]
              if (row !== undefined) row[to] = row[to] === true || (row[via] === true && reachable[via]?.[to] === true)
            }
          }
        }
        const maximal = reads.filter(
          (_, index) => !reachable.some((row, other) => other !== index && row[index] === true)
        )
        const conflicting = maximal.some((left) => maximal.some((right) => left.completed !== right.completed))
        expect(terminationPreconditionIssues(recordsFor(reads), runId, evidence)).toEqual(
          conflicting ? ["termination requires tracker graph observations to be causally comparable"] : []
        )
      }
    )
  )
})

it("preserves explicit supersession through an unobserved graph-read predecessor", () => {
  const records = recordsFor([
    { completed: false, predecessors: [] },
    { completed: false, predecessors: [0] },
    { completed: true, predecessors: [1] }
  ])
    .filter(({ position }) => position !== 5)
    .map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))
  expect(terminationPreconditionIssues(records, runId, evidence)).toEqual([])
})

it("rejects a future predecessor before deriving graph maximality", () => {
  expect(
    terminationPreconditionIssues(
      recordsFor([
        { completed: false, predecessors: [1] },
        { completed: true, predecessors: [] }
      ]),
      runId,
      evidence
    )
  ).toEqual(["termination requires a valid workflow-journal history prefix"])
})

it("finishes finality checking after a thousand graph reads within the host response budget", () => {
  const size = 1052
  const reads = Array.from({ length: size }, (_, index) => ({
    completed: index === size - 1,
    predecessors:
      index % 10 === 0 || index === size - 1 ? Array.from({ length: index }, (_, predecessor) => predecessor) : []
  }))
  const records = recordsFor(reads, `run-graph:${"a".repeat(600)}`)
  const moduleUrl = new URL("../../dist/src/workflow-journal/termination-preconditions.js", import.meta.url)
  const code = `import { terminationPreconditionIssues } from ${JSON.stringify(moduleUrl.href)}; let input = ''; for await (const chunk of process.stdin) input += chunk; const { records, runId, evidence } = JSON.parse(input); process.stdout.write(JSON.stringify(terminationPreconditionIssues(records, runId, evidence)));`
  // A process deadline can interrupt the original synchronous loop; a Vitest timer cannot.
  const evaluate = () =>
    execFileSync(process.execPath, ["--input-type=module", "--eval", code], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      input: JSON.stringify({ records, runId, evidence }),
      encoding: "utf8",
      timeout: 5000
    })
  expect(JSON.parse(evaluate())).toEqual([])
  expect(JSON.parse(evaluate())).toEqual([])
}, 15000)
