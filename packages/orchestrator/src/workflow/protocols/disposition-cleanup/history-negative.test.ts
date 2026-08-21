import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalStore, type JournalRecord } from "../../../workflow-journal/store.js"
import { WorktreeLocator } from "@dalph/contracts"
import { OperationId } from "../../identity.js"
import {
  WorktreeCleanupAbsenceConfirmedEvent,
  WorktreeCleanupContradictedEvent,
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservation,
  WorktreeCleanupSettledEvent,
  runWorktreeCleanup,
  worktreeCleanupTestLayer
} from "./worktree.js"
import { WorktreeCleanupEvidenceRevision } from "./disposition.js"
import { authorization, attempt, baseSha, runId, successor } from "./fixtures.js"
import { appendReplacementProvenance } from "./provenance-fixtures.js"
import { validateWorktreeCleanupHistory } from "./provenance.js"

const present = WorktreeCleanupObservation.cases.Present.make({
  attemptId: attempt.attemptId,
  branch: attempt.branch,
  headSha: baseSha,
  locator: attempt.worktree,
  revision: WorktreeCleanupEvidenceRevision.make(1),
  writerQuiescent: true
})
const absent = WorktreeCleanupObservation.cases.Absent.make({
  locator: attempt.worktree,
  revision: WorktreeCleanupEvidenceRevision.make(2)
})
const removed = WorktreeCleanupMutationResult.cases.Removed.make({
  branch: attempt.branch,
  locator: attempt.worktree,
  revision: WorktreeCleanupEvidenceRevision.make(2)
})

const begin = Effect.fn("Issue69HistoryNegative.begin")(function* (target: string) {
  const journal = yield* JournalStore
  yield* journal.beginRun(
    runId,
    FixtureTarget.make(target),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  return journal
})

const rekey = (records: ReadonlyArray<JournalRecord>, predicate: (record: JournalRecord) => boolean) =>
  records.map((record) => (predicate(record) ? { ...record, key: JournalRecordKey.make("foreign-key") } : record))

const without = (records: ReadonlyArray<JournalRecord>, predicate: (record: JournalRecord) => boolean) =>
  records.filter((record) => !predicate(record))

const validHistory = (target: string) =>
  Effect.gen(function* () {
    const journal = yield* begin(target)
    yield* appendReplacementProvenance(attempt, successor)
    yield* runWorktreeCleanup(authorization)
    return yield* journal.read(runId)
  }).pipe(
    Effect.provide(worktreeCleanupTestLayer({ observations: [present, absent], mutations: [removed] })),
    Effect.provide(memoryJournalTestLayer)
  )

const authRecord = (records: ReadonlyArray<JournalRecord>) =>
  records.find(({ event }) => event._tag === "WorktreeCleanupAuthorized")
const intentRecord = (records: ReadonlyArray<JournalRecord>) =>
  records.find(({ event }) => event._tag === "WorktreeCleanupObservationIntended")
const observedRecords = (records: ReadonlyArray<JournalRecord>) =>
  records.filter(({ event }) => event._tag === "WorktreeCleanupObserved")
const mutationIntentRecord = (records: ReadonlyArray<JournalRecord>) =>
  records.find(({ event }) => event._tag === "WorktreeCleanupMutationIntended")
const mutationResultRecord = (records: ReadonlyArray<JournalRecord>) =>
  records.find(({ event }) => event._tag === "WorktreeCleanupMutationResultRecorded")
const absenceRecord = (records: ReadonlyArray<JournalRecord>) =>
  records.find(({ event }) => event._tag === "WorktreeCleanupAbsenceConfirmed")
const settledRecord = (records: ReadonlyArray<JournalRecord>) =>
  records.find(({ event }) => event._tag === "WorktreeCleanupSettled")

it.effect("rejects malformed worktree cleanup prefixes before retrying Git", () =>
  Effect.gen(function* () {
    const records = yield* validHistory("issue-69-history-negative-prefix")
    const authorized = authRecord(records)
    const observationIntent = intentRecord(records)
    const observed = observedRecords(records)
    const mutationIntent = mutationIntentRecord(records)
    const mutationResult = mutationResultRecord(records)
    const absence = absenceRecord(records)
    const settled = settledRecord(records)
    expect(authorized).toBeDefined()
    expect(observationIntent).toBeDefined()
    expect(observed).toHaveLength(2)
    expect(mutationIntent).toBeDefined()
    expect(mutationResult).toBeDefined()
    expect(absence).toBeDefined()
    expect(settled).toBeDefined()

    const cases: ReadonlyArray<readonly [string, ReadonlyArray<JournalRecord>]> = [
      ["missing authorization", without(records, (record) => record.event._tag === "WorktreeCleanupAuthorized")],
      [
        "duplicate authorization",
        authorized === undefined
          ? records
          : records.concat({ ...authorized, position: JournalPosition.make(Number(authorized.position) + 100) })
      ],
      ["authorization key", rekey(records, (record) => record.event._tag === "WorktreeCleanupAuthorized")],
      [
        "event before authorization",
        observationIntent === undefined
          ? records
          : records.map((record) =>
              record === observationIntent ? { ...record, position: JournalPosition.make(1) } : record
            )
      ],
      [
        "observation intent key",
        rekey(records, (record) => record.event._tag === "WorktreeCleanupObservationIntended")
      ],
      [
        "duplicate observation intent",
        observationIntent === undefined
          ? records
          : records.concat({
              ...observationIntent,
              position: JournalPosition.make(Number(observationIntent.position) + 100)
            })
      ],
      [
        "missing observation intent",
        without(records, (record) => record.event._tag === "WorktreeCleanupObservationIntended")
      ],
      ["observed key", rekey(records, (record) => record.event._tag === "WorktreeCleanupObserved")],
      [
        "missing observed intent",
        without(records, (record) => record.event._tag === "WorktreeCleanupObservationIntended")
      ],
      [
        "duplicate observed result",
        observed[0] === undefined
          ? records
          : records.concat({ ...observed[0], position: JournalPosition.make(Number(observed[0].position) + 100) })
      ],
      ["mutation intent key", rekey(records, (record) => record.event._tag === "WorktreeCleanupMutationIntended")],
      [
        "missing mutation intent",
        without(records, (record) => record.event._tag === "WorktreeCleanupMutationIntended")
      ],
      [
        "duplicate mutation intent",
        mutationIntent === undefined
          ? records
          : records.concat({ ...mutationIntent, position: JournalPosition.make(Number(mutationIntent.position) + 100) })
      ],
      [
        "mutation result key",
        rekey(records, (record) => record.event._tag === "WorktreeCleanupMutationResultRecorded")
      ],
      [
        "missing mutation result intent",
        without(records, (record) => record.event._tag === "WorktreeCleanupMutationResultRecorded")
      ],
      [
        "duplicate mutation result",
        mutationResult === undefined
          ? records
          : records.concat({ ...mutationResult, position: JournalPosition.make(Number(mutationResult.position) + 100) })
      ],
      ["missing absence", without(records, (record) => record.event._tag === "WorktreeCleanupAbsenceConfirmed")],
      ["absence key", rekey(records, (record) => record.event._tag === "WorktreeCleanupAbsenceConfirmed")],
      ["settlement key", rekey(records, (record) => record.event._tag === "WorktreeCleanupSettled")],
      [
        "event after settlement",
        settled === undefined
          ? records
          : records.concat({ ...settled, position: JournalPosition.make(Number(settled.position) + 100) })
      ]
    ]
    for (const [name, candidate] of cases) {
      expect(validateWorktreeCleanupHistory(candidate, authorization)._tag, name).toBe("Invalid")
    }
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a settled worktree prefix whose absence or result no longer matches", () =>
  Effect.gen(function* () {
    const records = yield* validHistory("issue-69-history-negative-settlement")
    const absence = absenceRecord(records)
    const settled = settledRecord(records)
    expect(absence?.event._tag).toBe("WorktreeCleanupAbsenceConfirmed")
    expect(settled?.event._tag).toBe("WorktreeCleanupSettled")
    if (absence?.event._tag !== "WorktreeCleanupAbsenceConfirmed") return
    if (settled?.event._tag !== "WorktreeCleanupSettled") return

    const foreignAbsence = WorktreeCleanupAbsenceConfirmedEvent.make({
      ...absence.event,
      observation: { ...absence.event.observation, locator: WorktreeLocator.make("/tmp/foreign") }
    })
    const staleSettlement = WorktreeCleanupSettledEvent.make({
      ...settled.event,
      result: { ...settled.event.result, revision: WorktreeCleanupEvidenceRevision.make(1) }
    })
    expect(
      validateWorktreeCleanupHistory(
        records.map((record) => (record === absence ? { ...record, event: foreignAbsence } : record)),
        authorization
      )._tag
    ).toBe("Invalid")
    expect(
      validateWorktreeCleanupHistory(
        records.map((record) => (record === settled ? { ...record, event: staleSettlement } : record)),
        authorization
      )._tag
    ).toBe("Invalid")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects events after a terminal contradiction and mismatched contradiction identity", () =>
  Effect.gen(function* () {
    const journal = yield* begin("issue-69-history-negative-contradiction")
    yield* appendReplacementProvenance(attempt, successor)
    const contradiction = yield* runWorktreeCleanup(authorization).pipe(
      Effect.provide(
        worktreeCleanupTestLayer({
          observations: [
            WorktreeCleanupObservation.cases.Foreign.make({
              locator: authorization.locator,
              observedBranch: authorization.owner.branch,
              observedHead: baseSha,
              reason: "OtherOwner",
              revision: authorization.evidenceRevision
            })
          ]
        })
      )
    )
    expect(contradiction._tag).toBe("Preserved")
    const records = yield* journal.read(runId)
    const contradicted = records.find(({ event }) => event._tag === "WorktreeCleanupContradicted")
    expect(contradicted?.event._tag).toBe("WorktreeCleanupContradicted")
    if (contradicted?.event._tag !== "WorktreeCleanupContradicted") return

    const invalidKey = records.map((record) =>
      record === contradicted ? { ...record, key: JournalRecordKey.make("foreign-contradiction") } : record
    )
    expect(validateWorktreeCleanupHistory(invalidKey, authorization)._tag).toBe("Invalid")
    const afterContradiction = records.concat({
      ...contradicted,
      position: JournalPosition.make(Number(contradicted.position) + 100),
      event: WorktreeCleanupContradictedEvent.make({
        ...contradicted.event,
        operationId: OperationId.make(`${authorization.operationId}:later`)
      })
    })
    expect(validateWorktreeCleanupHistory(afterContradiction, authorization)._tag).toBe("Invalid")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
