import { readdir } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { join } from "node:path"
import { Schema } from "effect"
import type { JournalRecord } from "@dalph/orchestrator"

/** A durable file category allowed by this disposable experiment. */
export const DurableFileCategory = Schema.Literals([
  "ActivityReplayEvidence",
  "ControlledGitCurrentObservation",
  "ControlledGitEvidence",
  "DecisionEvidence",
  "ExecutorContactEvidence",
  "JournalChronology",
  "ProposalObservationEvidence",
  "WorkflowExecutionStore",
  "UnknownPersistentArtifact"
])
export type DurableFileCategory = typeof DurableFileCategory.Type

export const DurableFile = Schema.Struct({
  category: DurableFileCategory,
  name: Schema.NonEmptyString
})
export type DurableFile = typeof DurableFile.Type

/** SQLite table categories are checked separately from evidence files. */
export const DurableSqliteTableCategory = Schema.Literals([
  "JournalHistoryTable",
  "WorkflowExecutionTable",
  "WorkflowRuntimeTable",
  "UnknownPersistentTable"
])
export type DurableSqliteTableCategory = typeof DurableSqliteTableCategory.Type

export const DurableSqliteTable = Schema.Struct({
  category: DurableSqliteTableCategory,
  database: Schema.NonEmptyString,
  name: Schema.NonEmptyString
})
export type DurableSqliteTable = typeof DurableSqliteTable.Type

/** Journal content is classified by accepted chronology, not by process-local projections. */
export const DurableJournalRecordCategory = Schema.Literals([
  "RunLifecycle",
  "TaskPlan",
  "TaskWorktreeIntent",
  "TaskWorktreeOutcome",
  "UnknownJournalRecord"
])
export type DurableJournalRecordCategory = typeof DurableJournalRecordCategory.Type

export const DurableJournalRecord = Schema.Struct({
  category: DurableJournalRecordCategory,
  eventTag: Schema.NonEmptyString
})
export type DurableJournalRecord = typeof DurableJournalRecord.Type

/** Inventory returned before the harness removes the scratch workspace. */
export const DurableInventory = Schema.Struct({
  files: Schema.Array(DurableFile),
  forbiddenPersistedArtifacts: Schema.Array(Schema.String),
  journalRecords: Schema.Array(DurableJournalRecord),
  sqliteTables: Schema.Array(DurableSqliteTable)
})
export type DurableInventory = typeof DurableInventory.Type

const categoryFor = (name: string): DurableFileCategory => {
  if (name === "controlled-git-world.json") return "ControlledGitCurrentObservation"
  if (name === "controlled-git-calls.ndjson") return "ControlledGitEvidence"
  if (name === "activity-evidence.ndjson") return "ActivityReplayEvidence"
  if (name === "proposal-observations.ndjson") return "ProposalObservationEvidence"
  if (name === "decision-evidence.ndjson") return "DecisionEvidence"
  if (name === "executor-admission-contacts.ndjson") return "ExecutorContactEvidence"
  if (name === "journal.sqlite") return "JournalChronology"
  if (name === "workflow.sqlite") return "WorkflowExecutionStore"
  return "UnknownPersistentArtifact"
}

const forbiddenNeedles = [
  "proposal-state",
  "frontier",
  "current-signal",
  "task-work-position",
  "live-owner",
  "physical-worktree",
  "ui-state",
  "executor-process"
]

const forbiddenMatches = (value: string): ReadonlyArray<string> => {
  const normalized = value.toLowerCase()
  return forbiddenNeedles.filter((needle) => normalized.includes(needle)).map((needle) => `${value}:${needle}`)
}

const tableCategoryFor = (database: string, name: string): DurableSqliteTableCategory => {
  if (database === "journal.sqlite") return "JournalHistoryTable"
  if (database === "workflow.sqlite" && name.toLowerCase().includes("workflow")) return "WorkflowExecutionTable"
  if (database === "workflow.sqlite") return "WorkflowRuntimeTable"
  return "UnknownPersistentTable"
}

const journalRecordCategoryFor = (eventTag: string): DurableJournalRecordCategory => {
  if (eventTag === "WorkflowRunBegan" || eventTag === "WorkflowRunTerminated") return "RunLifecycle"
  if (eventTag === "TaskAttemptPlanned") return "TaskPlan"
  if (eventTag === "TaskWorktreeReconciliationIntended") return "TaskWorktreeIntent"
  if (eventTag === "TaskWorktreeReady") return "TaskWorktreeOutcome"
  return "UnknownJournalRecord"
}

const tableNamesFor = (path: string): ReadonlyArray<string> => {
  const database = new DatabaseSync(path)
  try {
    const rows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    return Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })))(rows).map(({ name }) => name)
  } finally {
    database.close()
  }
}

export const inspectDurableInventory = async (
  workspace: string,
  records: ReadonlyArray<JournalRecord>
): Promise<DurableInventory> => {
  const names = (await readdir(workspace)).sort()
  const files = names.map((name) => DurableFile.make({ category: categoryFor(name), name }))
  const sqliteTables = names
    .filter((name) => name === "journal.sqlite" || name === "workflow.sqlite")
    .flatMap((database) =>
      tableNamesFor(join(workspace, database)).map((name) =>
        DurableSqliteTable.make({ category: tableCategoryFor(database, name), database, name })
      )
    )
  const forbiddenPersistedArtifacts = [
    ...names.flatMap(forbiddenMatches),
    ...sqliteTables.flatMap(({ database, name }) => forbiddenMatches(`${database}:${name}`)),
    ...records.flatMap(({ event }) => forbiddenMatches(`journal:${event._tag}`))
  ]
  const journalRecords = records.map(({ event }) =>
    DurableJournalRecord.make({ category: journalRecordCategoryFor(event._tag), eventTag: event._tag })
  )
  return DurableInventory.make({
    files,
    forbiddenPersistedArtifacts,
    journalRecords,
    sqliteTables
  })
}
