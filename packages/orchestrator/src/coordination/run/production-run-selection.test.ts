import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { RunId } from "@dalph/contracts"
import { Effect, Layer } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { type JournalScan, JournalSemanticIssue } from "../../workflow-journal/recovery-model.js"
import { JournalPartition, JournalPosition } from "../../workflow-journal/identity.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { makeWorkflowRunBeganRecord, makeWorkflowRunTerminatedRecord } from "../../workflow-journal/run-lifecycle.js"
import { RunLifecycleJournal } from "../../workflow-journal/store.js"
import { completedRunFinalityFixture } from "../../../test/run-finality.js"
import { StartupRecoveryBlocked } from "./startup-recovery.js"
import { ProductionRunSelectionConflict, selectProductionRun } from "./production-run-selection.js"

const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })

const journalLayer = (scan: JournalScan) => Layer.mock(RunLifecycleJournal, { scanHot: () => Effect.succeed(scan) })

it.effect("allocates one fresh production Run only when no unfinished history exists", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("production-host-empty")
    const selected = yield* selectProductionRun(target)

    expect(selected._tag).toBe("Allocated")
    expect(selected.runId).toMatch(/^r1\./)
  }).pipe(Effect.provide(journalLayer({ issues: [], runs: [] })), Effect.provide(NodeCrypto.layer))
)

it.effect("selects the sole exact unfinished production Run without allocating a replacement", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("production-host-recovered")
    const runId = RunId.make("existing-production-run")
    const selected = yield* selectProductionRun(target)

    expect(selected).toEqual({ _tag: "Recovered", runId })
  }).pipe(
    Effect.provide(
      journalLayer({
        issues: [],
        runs: [
          {
            records: [
              makeWorkflowRunBeganRecord(
                RunId.make("existing-production-run"),
                FixtureTarget.make("production-host-recovered"),
                policy
              )
            ],
            runId: RunId.make("existing-production-run")
          }
        ]
      })
    ),
    Effect.provide(NodeCrypto.layer)
  )
)

it.effect("rejects one unfinished production Run for another target", () => {
  const requestedTarget = FixtureTarget.make("production-host-requested-target")
  const recordedTarget = FixtureTarget.make("production-host-recorded-target")
  const runId = RunId.make("mismatched-unfinished-run")
  return Effect.gen(function* () {
    const failure = yield* selectProductionRun(requestedTarget).pipe(Effect.flip)

    expect(failure).toEqual(
      new ProductionRunSelectionConflict({ conflicts: [{ runId, target: recordedTarget }], requestedTarget })
    )
  }).pipe(
    Effect.provide(
      journalLayer({
        issues: [],
        runs: [{ records: [makeWorkflowRunBeganRecord(runId, recordedTarget, policy)], runId }]
      })
    ),
    Effect.provide(NodeCrypto.layer)
  )
})

it.effect("excludes a valid terminal history and allocates one fresh production Run", () => {
  const runId = RunId.make("terminal-production-run")
  const target = FixtureTarget.make("production-host-after-terminal")
  const fixture = completedRunFinalityFixture({ runId, target })
  return Effect.gen(function* () {
    const selected = yield* selectProductionRun(target)

    expect(selected._tag).toBe("Allocated")
    expect(selected.runId).not.toBe(runId)
  }).pipe(
    Effect.provide(
      journalLayer({
        issues: [],
        runs: [
          {
            records: [
              makeWorkflowRunBeganRecord(runId, target, policy),
              {
                event: fixture.intent,
                key: intentRecordKey(fixture.operation.operationId),
                position: JournalPosition.make(2),
                runId
              },
              {
                event: fixture.observation,
                key: outcomeRecordKey(fixture.operation.operationId),
                position: JournalPosition.make(3),
                runId
              },
              makeWorkflowRunTerminatedRecord(runId, JournalPosition.make(4), "Completed", fixture.evidence)
            ],
            runId
          }
        ]
      })
    ),
    Effect.provide(NodeCrypto.layer)
  )
})

it.effect("names every unfinished Run when production discovery is unsafe", () =>
  Effect.gen(function* () {
    const requestedTarget = FixtureTarget.make("production-host-requested")
    const firstRunId = RunId.make("first-unfinished-run")
    const secondRunId = RunId.make("second-unfinished-run")
    const failure = yield* selectProductionRun(requestedTarget).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(ProductionRunSelectionConflict)
    expect(failure).toMatchObject({ conflicts: [{ runId: firstRunId }, { runId: secondRunId }], requestedTarget })
  }).pipe(
    Effect.provide(
      journalLayer({
        issues: [],
        runs: [
          {
            records: [
              makeWorkflowRunBeganRecord(
                RunId.make("first-unfinished-run"),
                FixtureTarget.make("production-host-requested"),
                policy
              )
            ],
            runId: RunId.make("first-unfinished-run")
          },
          {
            records: [
              makeWorkflowRunBeganRecord(
                RunId.make("second-unfinished-run"),
                FixtureTarget.make("another-target"),
                policy
              )
            ],
            runId: RunId.make("second-unfinished-run")
          }
        ]
      })
    ),
    Effect.provide(NodeCrypto.layer)
  )
)

it.effect("fails malformed production discovery before allocating a Run", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("production-host-malformed")
    const failure = yield* selectProductionRun(target).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(StartupRecoveryBlocked)
    expect(failure).toMatchObject({ issues: [{ _tag: "JournalSemanticIssue", runId: RunId.make("malformed-run") }] })
  }).pipe(
    Effect.provide(
      journalLayer({
        issues: [
          new JournalSemanticIssue({
            detail: "malformed history",
            partition: JournalPartition.make("Hot"),
            runId: RunId.make("malformed-run")
          })
        ],
        runs: []
      })
    ),
    Effect.provide(NodeCrypto.layer)
  )
)

it.effect("fails when a discovered Hot Run has an invalid journal history", () => {
  const target = FixtureTarget.make("production-host-invalid-hot-history")
  const runId = RunId.make("invalid-hot-history-run")
  const beginning = makeWorkflowRunBeganRecord(runId, target, policy)
  return Effect.gen(function* () {
    const failure = yield* selectProductionRun(target).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(StartupRecoveryBlocked)
    expect(failure).toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ runId })]) })
  }).pipe(
    Effect.provide(journalLayer({ issues: [], runs: [{ records: [beginning, beginning], runId }] })),
    Effect.provide(NodeCrypto.layer)
  )
})
