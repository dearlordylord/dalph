import { NodeServices } from "@effect/platform-node"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Match, Ref, Result, Schema } from "effect"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import { expect } from "vitest"
import {
  AttemptId,
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  GitCommitSha,
  JournalDatabaseLocator,
  type JournalRecordKey,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskLifecycle,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorktreeLocator
} from "../../src/domain.js"
import { PlannedWorktreeReady } from "../../src/git-worktree.js"
import { describeJournalEvent } from "../../src/journal-event-descriptor.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  JournalDataCorruption,
  JournalStorageLocked,
  JournalStore,
  memoryJournalStoreLayer,
  outcomeRecordKey,
  providerObservationRequestRecordKey,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorkSessionEstablishedEvent,
  TaskWorkSessionEstablishmentIntentRecorded,
  TaskWorkSessionLookupFailed,
  TaskWorkSessionLookupRequested,
  TaskWorkSessionReported,
  taskWorkSessionReportedRecordKey,
  taskWorkStartAcknowledgedRecordKey,
  taskWorkStartFailedRecordKey,
  TaskWorkStartRequestAcknowledged,
  TaskWorkStartRequested,
  TaskWorkStartRequestFailed,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  trackerGraphObservationIntent,
  WorkflowJournalEvent
} from "../../src/journal-store.js"
import { journaledWorkflowInterpreterLayer } from "../../src/journaled-workflow-interpreter.js"
import { sqliteJournalStoreLayer } from "../../src/sqlite-journal-store.js"
import { taskRevisionFor } from "../../src/task-dag.js"
import { taskExecutorTestLayer } from "../../src/task-execution.js"
import {
  MatchingTaskWorkSessionReported,
  NoMatchingTaskWorkSessionReported,
  TaskRunner,
  TaskWorkSessionCorrelationConflict,
  TaskWorkSessionLookup,
  TaskWorkSessionLookupFailure,
  TaskWorkStartRequest,
  TaskWorkStartRequestAcknowledgement,
  TaskWorkStartRequestFailure
} from "../../src/task-work-start.js"
import { TrackerGraphReader } from "../../src/tracker-graph-reader.js"
import { ActiveTaskClaim, TrackerMutation } from "../../src/tracker-mutation.js"
import { deterministicTestWorkflowInterpreterLayer } from "../../src/workflow-interpreters.js"
import { recoverTaskWorkSessionEstablishments } from "../../src/workflow-operation-recovery.js"
import { WorkflowOutcome } from "../../src/workflow-outcome.js"
import { continueMissingPlannedTaskAttemptStages } from "../../src/workflow-recovery.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  WorkflowTrace
} from "../../src/workflow.js"
import { validSnapshot } from "../task-dag.js"
import type { TaskWorkSessionRecoveryConformanceCutPoint } from "./recovery-conformance-cut-point.js"
import { taskWorkSessionRecoveryConformanceCutPointFor } from "./task-work-session-recovery-conformance.js"

const runId = RunId.make("m1-prefix-run")
const taskId = TaskId.make("m1-prefix-task")
const task = {
  id: taskId,
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
}
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("m1-prefix-attempt"),
  baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
  branch: TaskBranchRef.make("refs/heads/m1-prefix"),
  executor: TaskExecutorLocator.make("executor:m1-prefix"),
  runId,
  session: TaskWorkSessionLocator.make("session:m1-prefix"),
  taskId,
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/dalph/m1-prefix")
})
const initialObservation = makeTrackerGraphObservationOperation(
  OperationId.make("m1-prefix-initial-observation"),
  FixtureTarget.make("m1-prefix-target")
)
const claimOperation = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: OperationId.make("m1-prefix-claim"),
    owner: ClaimOwner.make("m1-prefix-owner"),
    taskId,
    token: ClaimToken.make("m1-prefix-token")
  },
  predecessorOperationIds: [initialObservation.operationId]
})
const activeClaim = ActiveTaskClaim.make(claimOperation.acquisition)
const admissionObservation = makeTrackerGraphObservationOperation(
  OperationId.make("m1-prefix-admission-observation"),
  initialObservation.target,
  [claimOperation.acquisition.operationId]
)
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("m1-prefix-plan"),
  plannedAttempt,
  predecessorOperationIds: [admissionObservation.operationId]
})
const worktreeOperation = makeTaskWorktreeReconciliationOperation({
  operationId: OperationId.make("m1-prefix-worktree"),
  plannedAttempt,
  predecessorOperationIds: [planOperation.operationId]
})
const operationId = OperationId.make("m1-prefix-session")
const request = TaskWorkStartRequest.make({ operationId, plannedAttempt, task })
const operation = makeTaskWorkSessionEstablishmentOperation({
  predecessorOperationIds: [planOperation.operationId, worktreeOperation.operationId],
  request
})
const sessionId = TaskWorkSessionId.make("m1-prefix-provider-session")
const requestObservationId = ProviderObservationId.make("m1-prefix-request-observation")
const providerRequestId = ProviderRequestId.make("m1-prefix-provider-request")
const lookupObservationId = ProviderObservationId.make("m1-prefix-lookup-observation")
const acknowledgement = TaskWorkStartRequestAcknowledgement.make({
  observationId: requestObservationId,
  providerRequestId
})
const lookup = TaskWorkSessionLookup.make({ operationId, plannedAttempt })
const matchingReport = MatchingTaskWorkSessionReported.make({
  observationId: lookupObservationId,
  sessionId,
  work: { _tag: "NoProviderWorkReported" }
})
const absentReport = NoMatchingTaskWorkSessionReported.make({
  observationId: lookupObservationId
})
const conflictReport = TaskWorkSessionCorrelationConflict.make({
  conflicts: [{ detail: "provider correlation conflict", sessionId }],
  observationId: lookupObservationId
})
const lookupFailure = new TaskWorkSessionLookupFailure({
  detail: "provider registry unreadable",
  observationId: lookupObservationId
})
const requestFailure = new TaskWorkStartRequestFailure({
  detail: "provider request return unreadable",
  observationId: requestObservationId
})

interface SeedRecord {
  readonly event: WorkflowJournalEvent
  readonly key: JournalRecordKey
}

const baseline: ReadonlyArray<SeedRecord> = [
  {
    event: trackerGraphObservationIntent(initialObservation),
    key: intentRecordKey(initialObservation.operationId)
  },
  {
    event: TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: 4 }),
    key: intentRecordKey(claimOperation.acquisition.operationId)
  },
  {
    event: TaskClaimAcquiredEvent.make({ claim: activeClaim, version: 4 }),
    key: outcomeRecordKey(claimOperation.acquisition.operationId)
  },
  {
    event: trackerGraphObservationIntent(admissionObservation),
    key: intentRecordKey(admissionObservation.operationId)
  },
  {
    event: TaskAttemptPlannedEvent.make({ operation: planOperation, version: 4 }),
    key: attemptPlanRecordKey(plannedAttempt.attemptId)
  },
  {
    event: TaskWorktreeReconciliationIntendedEvent.make({ operation: worktreeOperation, version: 4 }),
    key: intentRecordKey(worktreeOperation.operationId)
  },
  {
    event: TaskWorktreeReadyEvent.make({
      operationId: worktreeOperation.operationId,
      proof: PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      }),
      version: 4
    }),
    key: outcomeRecordKey(worktreeOperation.operationId)
  }
]

const sessionIntentSeed: SeedRecord = {
  event: TaskWorkSessionEstablishmentIntentRecorded.make({ operation, version: 4 }),
  key: intentRecordKey(operationId)
}

const requestSeed: SeedRecord = {
  event: TaskWorkStartRequested.make({
    observationId: requestObservationId,
    request,
    version: 4
  }),
  key: providerObservationRequestRecordKey(requestObservationId)
}
const acknowledgementSeed: SeedRecord = {
  event: TaskWorkStartRequestAcknowledged.make({
    acknowledgement,
    operationId,
    version: 4
  }),
  key: taskWorkStartAcknowledgedRecordKey(operationId, requestObservationId)
}
const lookupSeed: SeedRecord = {
  event: TaskWorkSessionLookupRequested.make({
    lookup,
    observationId: lookupObservationId,
    version: 4
  }),
  key: providerObservationRequestRecordKey(lookupObservationId)
}
const matchingSeed: SeedRecord = {
  event: TaskWorkSessionReported.make({ operationId, report: matchingReport, version: 4 }),
  key: taskWorkSessionReportedRecordKey(operationId, lookupObservationId)
}
const sessionPrefixEvents: ReadonlyArray<SeedRecord> = [
  sessionIntentSeed,
  requestSeed,
  acknowledgementSeed,
  lookupSeed,
  matchingSeed,
  {
    event: TaskWorkSessionEstablishedEvent.make({
      outcome: WorkflowOutcome.cases.TaskWorkSessionEstablished.make({ operationId, sessionId }),
      version: 4
    }),
    key: outcomeRecordKey(operationId)
  }
]

const requestFailureSeed: SeedRecord = {
  event: TaskWorkStartRequestFailed.make({ failure: requestFailure, request, version: 4 }),
  key: taskWorkStartFailedRecordKey(operationId, requestObservationId)
}
const absentSeed: SeedRecord = {
  event: TaskWorkSessionReported.make({ operationId, report: absentReport, version: 4 }),
  key: taskWorkSessionReportedRecordKey(operationId, lookupObservationId)
}
const conflictSeed: SeedRecord = {
  event: TaskWorkSessionReported.make({ operationId, report: conflictReport, version: 4 }),
  key: taskWorkSessionReportedRecordKey(operationId, lookupObservationId)
}
const lookupFailureSeed: SeedRecord = {
  event: TaskWorkSessionLookupFailed.make({ failure: lookupFailure, operationId, version: 4 }),
  key: taskWorkSessionReportedRecordKey(operationId, lookupObservationId)
}

const cutPoints = [
  { cutPoint: "P0", name: "P0", records: baseline },
  { cutPoint: "P1", name: "P1", records: [...baseline, sessionIntentSeed] },
  { cutPoint: "P2", name: "P2", records: [...baseline, sessionIntentSeed, requestSeed] },
  {
    cutPoint: "P3",
    name: "P3-acknowledgement",
    records: [...baseline, sessionIntentSeed, requestSeed, acknowledgementSeed]
  },
  {
    cutPoint: "P3",
    name: "P3-request-failure",
    records: [...baseline, sessionIntentSeed, requestSeed, requestFailureSeed]
  },
  {
    cutPoint: "P4",
    name: "P4",
    records: [...baseline, sessionIntentSeed, requestSeed, acknowledgementSeed, lookupSeed]
  },
  {
    cutPoint: "P5",
    name: "P5-matching",
    records: [...baseline, sessionIntentSeed, requestSeed, acknowledgementSeed, lookupSeed, matchingSeed]
  },
  {
    cutPoint: "P5",
    name: "P5-absence",
    records: [...baseline, sessionIntentSeed, requestSeed, acknowledgementSeed, lookupSeed, absentSeed]
  },
  {
    cutPoint: "P5",
    name: "P5-unreadable",
    records: [...baseline, sessionIntentSeed, requestSeed, acknowledgementSeed, lookupSeed, lookupFailureSeed]
  },
  {
    cutPoint: "P5",
    name: "P5-conflict",
    records: [...baseline, sessionIntentSeed, requestSeed, acknowledgementSeed, lookupSeed, conflictSeed]
  },
  { cutPoint: "P6", name: "P6", records: [...baseline, ...sessionPrefixEvents] }
] as const satisfies ReadonlyArray<{
  readonly cutPoint: TaskWorkSessionRecoveryConformanceCutPoint
  readonly name: string
  readonly records: ReadonlyArray<SeedRecord>
}>

const seedRecords = Effect.fn("TaskWorkSessionReopening.seedRecords")(function*(
  records: ReadonlyArray<SeedRecord>
) {
  const journal = yield* JournalStore
  for (const record of records) yield* journal.append(runId, record.key, record.event)
})

interface ReplayProjection {
  readonly authority: {
    readonly lookupCount: number
    readonly requestCount: number
  }
  readonly semantic: ReadonlyArray<{
    readonly event: WorkflowJournalEvent
    readonly key: JournalRecordKey
    readonly position: number
  }>
}

type ReplayLookupBehavior = "Absent" | "Conflict" | "Matching" | "Unreadable"

const makeReplay = Effect.fn("TaskWorkSessionReopening.makeReplay")(function*(
  lookupBehavior: ReplayLookupBehavior = "Matching"
) {
  const lookupCount = yield* Ref.make(0)
  const requestCount = yield* Ref.make(0)
  const runnerLayer = Layer.succeed(
    TaskRunner,
    TaskRunner.of({
      lookupTaskWorkSession: () =>
        Ref.updateAndGet(lookupCount, (count) => count + 1).pipe(
          Effect.flatMap((count) => {
            const observationId = ProviderObservationId.make(`m1-prefix-replay-lookup-${count}`)
            return Match.value(lookupBehavior).pipe(
              Match.when("Absent", () => Effect.succeed(NoMatchingTaskWorkSessionReported.make({ observationId }))),
              Match.when("Conflict", () =>
                Effect.succeed(TaskWorkSessionCorrelationConflict.make({
                  conflicts: [{ detail: "replayed provider conflict", sessionId }],
                  observationId
                }))),
              Match.when("Matching", () =>
                Effect.succeed(MatchingTaskWorkSessionReported.make({
                  observationId,
                  sessionId,
                  work: { _tag: "NoProviderWorkReported" }
                }))),
              Match.when("Unreadable", () =>
                Effect.fail(
                  new TaskWorkSessionLookupFailure({
                    detail: "replayed provider registry unreadable",
                    observationId
                  })
                )),
              Match.exhaustive
            )
          })
        ),
      requestTaskWorkStart: () =>
        Ref.updateAndGet(requestCount, (count) => count + 1).pipe(
          Effect.map((count) =>
            TaskWorkStartRequestAcknowledgement.make({
              observationId: ProviderObservationId.make(`m1-prefix-replay-request-${count}`),
              providerRequestId: ProviderRequestId.make(`m1-prefix-replay-provider-request-${count}`)
            })
          )
        )
    })
  )
  const traceLayer = Layer.succeed(
    WorkflowTrace,
    WorkflowTrace.of({ emit: () => Effect.void })
  )
  const trackerMutationLayer = Layer.succeed(
    TrackerMutation,
    TrackerMutation.of({
      acquireTaskClaim: () => Effect.die("unused M1 prefix claim acquisition"),
      readTaskClaim: () => Effect.succeed(activeClaim),
      releaseTaskClaim: () => Effect.die("unused M1 prefix claim release")
    })
  )
  const interpreterLayer = journaledWorkflowInterpreterLayer(
    runId,
    deterministicTestWorkflowInterpreterLayer,
    taskExecutorTestLayer
  ).pipe(
    Layer.provide(runnerLayer),
    Layer.provide(Layer.succeed(
      TrackerGraphReader,
      TrackerGraphReader.of({
        read: () =>
          Effect.succeed(validSnapshot({
            revision: "m1-prefix-current",
            tasks: [task]
          }))
      })
    )),
    Layer.provide(traceLayer)
  )
  const recoverAndProject = Effect.gen(function*() {
    yield* recoverTaskWorkSessionEstablishments(runId)
    const records = yield* (yield* JournalStore).read(runId)
    return {
      authority: {
        lookupCount: yield* Ref.get(lookupCount),
        requestCount: yield* Ref.get(requestCount)
      },
      semantic: records.map(({ event, key, position }) => ({ event, key, position }))
    } satisfies ReplayProjection
  }).pipe(
    Effect.provide(interpreterLayer),
    Effect.provide(traceLayer)
  )
  const recoverResultAndProject = Effect.gen(function*() {
    const result = yield* Effect.result(recoverTaskWorkSessionEstablishments(runId))
    const records = yield* (yield* JournalStore).read(runId)
    return {
      failure: Result.isFailure(result) ? result.failure._tag : null,
      projection: {
        authority: {
          lookupCount: yield* Ref.get(lookupCount),
          requestCount: yield* Ref.get(requestCount)
        },
        semantic: records.map(({ event, key, position }) => ({ event, key, position }))
      } satisfies ReplayProjection
    }
  }).pipe(
    Effect.provide(interpreterLayer),
    Effect.provide(traceLayer)
  )
  const recomputeAndProject = Effect.gen(function*() {
    const journal = yield* JournalStore
    const records = yield* journal.read(runId)
    const issues = yield* continueMissingPlannedTaskAttemptStages(runId, records)
    if (issues.length > 0) return yield* Effect.die(issues)
    const recomputed = yield* journal.read(runId)
    return {
      authority: {
        lookupCount: yield* Ref.get(lookupCount),
        requestCount: yield* Ref.get(requestCount)
      },
      semantic: recomputed.map(({ event, key, position }) => ({ event, key, position }))
    } satisfies ReplayProjection
  }).pipe(
    Effect.provide(interpreterLayer),
    Effect.provide(traceLayer),
    Effect.provide(trackerMutationLayer)
  )
  return { recomputeAndProject, recoverAndProject, recoverResultAndProject }
})

const runMemoryLane = Effect.fn("TaskWorkSessionReopening.runMemoryLane")(function*(
  records: ReadonlyArray<SeedRecord>,
  recompute = false
) {
  const replay = yield* makeReplay()
  return yield* Effect.gen(function*() {
    yield* seedRecords(records)
    return yield* recompute ? replay.recomputeAndProject : replay.recoverAndProject
  }).pipe(Effect.provide(memoryJournalStoreLayer))
})

const runSqliteLane = Effect.fn("TaskWorkSessionReopening.runSqliteLane")(function*(
  filename: JournalDatabaseLocator,
  records: ReadonlyArray<SeedRecord>,
  recompute = false
) {
  yield* seedRecords(records).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
  yield* seedRecords(records).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
  const replay = yield* makeReplay()
  return yield* (recompute ? replay.recomputeAndProject : replay.recoverAndProject).pipe(
    Effect.provide(sqliteJournalStoreLayer({ filename }))
  )
})

const runMemoryNonterminalLane = Effect.fn(
  "TaskWorkSessionReopening.runMemoryNonterminalLane"
)(function*(
  behavior: Exclude<ReplayLookupBehavior, "Matching">,
  records: ReadonlyArray<SeedRecord>
) {
  const replay = yield* makeReplay(behavior)
  return yield* Effect.gen(function*() {
    yield* seedRecords(records)
    return yield* replay.recoverResultAndProject
  }).pipe(Effect.provide(memoryJournalStoreLayer))
})

const runSqliteNonterminalLane = Effect.fn(
  "TaskWorkSessionReopening.runSqliteNonterminalLane"
)(function*(
  behavior: Exclude<ReplayLookupBehavior, "Matching">,
  filename: JournalDatabaseLocator,
  records: ReadonlyArray<SeedRecord>
) {
  yield* seedRecords(records).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
  const replay = yield* makeReplay(behavior)
  return yield* replay.recoverResultAndProject.pipe(
    Effect.provide(sqliteJournalStoreLayer({ filename }))
  )
})

it.effect("replays every applicable M1 P0-P6 conformance cut point through fresh scopes", () =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-m1-prefixes-" })

    for (const { cutPoint, name, records } of cutPoints) {
      const endpoint = records.at(-1)?.event
      if (cutPoint !== "P0" && endpoint !== undefined) {
        expect(taskWorkSessionRecoveryConformanceCutPointFor(endpoint)).toBe(cutPoint)
        expect(describeJournalEvent(endpoint).expectedKey).toBe(records.at(-1)?.key)
      }

      const memory = yield* runMemoryLane(records, cutPoint === "P0")
      const sqlite = yield* runSqliteLane(
        JournalDatabaseLocator.make(`${directory}/${name}.sqlite`),
        records,
        cutPoint === "P0"
      )

      expect(sqlite).toEqual(memory)
      expect(memory.authority.requestCount).toBe(cutPoint === "P0" ? 1 : 0)
      expect(memory.authority.lookupCount).toBe(cutPoint === "P6" ? 0 : 1)
      const sessionIntents = memory.semantic.filter(
        ({ event }) => event._tag === "TaskWorkSessionEstablishmentIntentRecorded"
      )
      expect(sessionIntents).toHaveLength(1)
      expect(sessionIntents[0]?.event).toMatchObject({
        operation: cutPoint === "P0"
          ? {
            predecessorOperationIds: [
              planOperation.operationId,
              worktreeOperation.operationId,
              expect.stringContaining("recovery:")
            ],
            request: {
              plannedAttempt,
              task
            }
          }
          : {
            predecessorOperationIds: operation.predecessorOperationIds,
            request
          }
      })
    }
  })).pipe(Effect.provide(NodeServices.layer)))

it.effect("reopens absence, unreadability, and conflict with equal bounded nonterminal dispositions", () =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-m1-nonterminal-prefixes-" })
    const records = [...baseline, sessionIntentSeed]
    const cases = [
      {
        behavior: "Absent",
        expectedFailure: "TaskWorkSessionEstablishmentDidNotConverge",
        expectedLookups: 3,
        expectedRequests: 2
      },
      {
        behavior: "Unreadable",
        expectedFailure: "TaskWorkSessionLookupDidNotConverge",
        expectedLookups: 3,
        expectedRequests: 0
      },
      {
        behavior: "Conflict",
        expectedFailure: "TaskWorkSessionCorrelationConflict",
        expectedLookups: 1,
        expectedRequests: 0
      }
    ] as const

    for (const replayCase of cases) {
      const memory = yield* runMemoryNonterminalLane(replayCase.behavior, records)
      const sqlite = yield* runSqliteNonterminalLane(
        replayCase.behavior,
        JournalDatabaseLocator.make(`${directory}/${replayCase.behavior}.sqlite`),
        records
      )
      expect(sqlite).toEqual(memory)
      expect(memory.failure).toBe(replayCase.expectedFailure)
      expect(memory.projection.authority).toEqual({
        lookupCount: replayCase.expectedLookups,
        requestCount: replayCase.expectedRequests
      })
      expect(
        memory.projection.semantic.find(
          ({ event }) => event._tag === "TaskWorkSessionEstablishmentIntentRecorded"
        )?.event
      ).toMatchObject({
        operation: { request: { plannedAttempt, task } }
      })
    }
  })).pipe(Effect.provide(NodeServices.layer)))

it.effect("migrates and upcasts an M1 P1 conformance cut point before idempotent replay", () =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-m1-legacy-prefix-" })
    const filename = JournalDatabaseLocator.make(`${directory}/legacy.sqlite`)
    const records = [...baseline, sessionIntentSeed]

    yield* Effect.scoped(
      Effect.gen(function*() {
        const sql = yield* SqliteClient.make({ disableWAL: true, filename })
        yield* sql`CREATE TABLE journal_records (
        run_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 1),
        record_key TEXT NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY (run_id, position),
        UNIQUE (run_id, record_key)
      ) STRICT`
        yield* sql`PRAGMA user_version = 1`
        for (const [index, record] of records.entries()) {
          const encoded = Schema.encodeUnknownSync(WorkflowJournalEvent)(record.event)
          const { version: _version, ...legacy } = encoded
          yield* sql`INSERT INTO journal_records (run_id, position, record_key, event_json)
          VALUES (${runId}, ${index + 1}, ${record.key}, ${JSON.stringify(legacy)})`
        }
      }).pipe(Effect.provide(Reactivity.layer))
    )

    expect(yield* runSqliteLane(filename, records)).toEqual(yield* runMemoryLane(records))
  })).pipe(Effect.provide(NodeServices.layer)))

it.effect("rejects corrupt M1 prefix data and a competing live SQLite writer", () =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-m1-sqlite-safety-" })
    const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
    const records = [...baseline, sessionIntentSeed]
    yield* seedRecords(records).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

    yield* Effect.gen(function*() {
      yield* JournalStore
      const competingWriter = yield* Effect.gen(function*() {
        yield* JournalStore
      }).pipe(
        Effect.provide(sqliteJournalStoreLayer({ filename })),
        Effect.flip
      )
      expect(competingWriter).toBeInstanceOf(JournalStorageLocked)
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

    yield* Effect.scoped(
      Effect.gen(function*() {
        const sql = yield* SqliteClient.make({ disableWAL: true, filename })
        yield* sql`UPDATE journal_records
        SET payload_json = '{'
        WHERE record_key = ${intentRecordKey(operationId)}`
      }).pipe(Effect.provide(Reactivity.layer))
    )

    const corruption = yield* Effect.gen(function*() {
      return yield* (yield* JournalStore).read(runId)
    }).pipe(
      Effect.provide(sqliteJournalStoreLayer({ filename })),
      Effect.flip
    )
    expect(corruption).toBeInstanceOf(JournalDataCorruption)
  })).pipe(Effect.provide(NodeServices.layer)))
