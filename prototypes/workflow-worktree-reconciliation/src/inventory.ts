import { readFile, readdir } from "node:fs/promises"
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
  "ExecutorBoundaryContactEvidence",
  "JournalChronology",
  "ProposalObservationEvidence",
  "ResponsibilityProjectionEvidence",
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
  name: Schema.NonEmptyString,
  rowCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
})
export type DurableSqliteTable = typeof DurableSqliteTable.Type

/** Every Workflow database row is classified before the scratch workspace is removed. */
export const DurableWorkflowRecordCategory = Schema.Literals([
  "WorkflowActivityReply",
  "WorkflowInvocation",
  "WorkflowRuntimeMigration",
  "UnknownWorkflowRecord"
])
export type DurableWorkflowRecordCategory = typeof DurableWorkflowRecordCategory.Type

export const DurableWorkflowRecord = Schema.Struct({
  category: DurableWorkflowRecordCategory,
  cells: Schema.Array(Schema.String),
  database: Schema.NonEmptyString,
  rowIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  table: Schema.NonEmptyString
})
export type DurableWorkflowRecord = typeof DurableWorkflowRecord.Type

/** Journal content is classified by accepted chronology, not by process-local projections. */
export const DurableJournalRecordCategory = Schema.Literals([
  "RunLifecycle",
  "TaskClaimIntent",
  "TaskClaimObservationIntent",
  "TaskClaimObservationOutcome",
  "TaskClaimOutcome",
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
  sqliteTables: Schema.Array(DurableSqliteTable),
  workflowRecords: Schema.Array(DurableWorkflowRecord)
})
export type DurableInventory = typeof DurableInventory.Type

const categoryFor = (name: string): DurableFileCategory => {
  if (name === "controlled-git-world.json") return "ControlledGitCurrentObservation"
  if (name === "controlled-git-calls.ndjson") return "ControlledGitEvidence"
  if (name === "activity-evidence.ndjson") return "ActivityReplayEvidence"
  if (name === "proposal-observations.ndjson") return "ProposalObservationEvidence"
  if (name === "decision-evidence.ndjson") return "DecisionEvidence"
  if (name === "executor-boundary-contacts.ndjson") return "ExecutorBoundaryContactEvidence"
  if (name === "journal.sqlite" || name === "journal.sqlite-shm" || name === "journal.sqlite-wal") return "JournalChronology"
  if (name === "responsibility-projections.ndjson") return "ResponsibilityProjectionEvidence"
  if (name === "workflow.sqlite" || name === "workflow.sqlite-shm" || name === "workflow.sqlite-wal") return "WorkflowExecutionStore"
  return "UnknownPersistentArtifact"
}

const forbiddenNeedles = [
  "proposal-state",
  "frontier",
  "frontier-state",
  "current-signal",
  "task-work-position",
  "live-owner",
  "physical-worktree",
  "physical-resource",
  "ui-state",
  "executor-process",
  "proposalState",
  "frontierState",
  "currentSignal",
  "taskWorkPosition",
  "liveOwner",
  "physicalWorktree",
  "physicalResource",
  "uiState",
  "executorProcess"
]

const forbiddenMatches = (value: string): ReadonlyArray<string> => {
  const normalized = value.toLowerCase()
  return forbiddenNeedles
    .filter((needle) => normalized.includes(needle.toLowerCase()))
    .map((needle) => `${value}:${needle}`)
}

const tableCategoryFor = (database: string, name: string): DurableSqliteTableCategory => {
  if (database === "journal.sqlite") return "JournalHistoryTable"
  if (database === "workflow.sqlite" && name.toLowerCase().includes("workflow")) return "WorkflowExecutionTable"
  if (database === "workflow.sqlite") return "WorkflowRuntimeTable"
  return "UnknownPersistentTable"
}

const workflowRecordCategoryFor = (table: string): DurableWorkflowRecordCategory => {
  if (table === "cluster_messages") return "WorkflowInvocation"
  if (table === "cluster_replies") return "WorkflowActivityReply"
  if (table === "sqlite_sequence" || table.toLowerCase().includes("migration")) return "WorkflowRuntimeMigration"
  return "UnknownWorkflowRecord"
}

const journalRecordCategoryFor = (eventTag: string): DurableJournalRecordCategory => {
  if (eventTag === "WorkflowRunBegan" || eventTag === "WorkflowRunTerminated") return "RunLifecycle"
  if (eventTag === "TaskClaimAcquisitionIntended") return "TaskClaimIntent"
  if (eventTag === "TaskClaimAcquired") return "TaskClaimOutcome"
  if (eventTag === "TaskTrackerReadIntentRecorded") return "TaskClaimObservationIntent"
  if (eventTag === "TaskTrackerFactsObserved") return "TaskClaimObservationOutcome"
  if (eventTag === "TaskAttemptPlanned") return "TaskPlan"
  if (eventTag === "TaskWorktreeReconciliationIntended") return "TaskWorktreeIntent"
  if (eventTag === "TaskWorktreeReady") return "TaskWorktreeOutcome"
  return "UnknownJournalRecord"
}

const tableRowsFor = (path: string, table: string): ReadonlyArray<unknown> => {
  const database = new DatabaseSync(path, { readBigInts: true })
  try {
    const escapedTable = table.replaceAll('"', '""')
    return database.prepare(`SELECT * FROM "${escapedTable}"`).all() as ReadonlyArray<unknown>
  } finally {
    database.close()
  }
}

const tableNamesFor = (path: string): ReadonlyArray<string> => {
  const database = new DatabaseSync(path, { readBigInts: true })
  try {
    const rows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    return Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })))(rows).map(({ name }) => name)
  } finally {
    database.close()
  }
}

const cellTextFor = (value: unknown): ReadonlyArray<string> => {
  if (typeof value === "string") return [value]
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return [String(value)]
  if (value instanceof Uint8Array) return [new TextDecoder().decode(value)]
  if (value === null || value === undefined) return []
  try {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? [String(value)] : [encoded]
  } catch {
    return [String(value)]
  }
}

const rowCellsFor = (row: unknown): ReadonlyArray<string> => {
  if (row === null || typeof row !== "object") return cellTextFor(row)
  return Object.values(row as Record<string, unknown>).flatMap(cellTextFor)
}

const evidenceContentFor = async (workspace: string, name: string): Promise<string> => {
  if (!name.endsWith(".ndjson") && !name.endsWith(".json")) return ""
  return readFile(join(workspace, name), "utf8")
}

export const inspectDurableInventory = async (
  workspace: string,
  records: ReadonlyArray<JournalRecord>
): Promise<DurableInventory> => {
  const names = (await readdir(workspace)).sort()
  const files = names.map((name) => DurableFile.make({ category: categoryFor(name), name }))
  if (files.some(({ category }) => category === "UnknownPersistentArtifact")) {
    throw new Error(`durable inventory found an unknown persistent file: ${names.join(",")}`)
  }
  const sqliteDatabases = names.filter((name) => name === "journal.sqlite" || name === "workflow.sqlite")
  const tableRows = sqliteDatabases.flatMap((database) =>
    tableNamesFor(join(workspace, database)).map((name) => ({
      database,
      name,
      rows: tableRowsFor(join(workspace, database), name)
    }))
  )
  const sqliteTables = tableRows.map(({ database, name, rows }) =>
    DurableSqliteTable.make({ category: tableCategoryFor(database, name), database, name, rowCount: rows.length })
  )
  const workflowRecords = tableRows
    .filter(({ database }) => database === "workflow.sqlite")
    .flatMap(({ database, name, rows }) =>
      rows.map((row, rowIndex) =>
        DurableWorkflowRecord.make({
          category: workflowRecordCategoryFor(name),
          cells: rowCellsFor(row),
          database,
          rowIndex,
          table: name
        })
      )
    )
  if (sqliteTables.some(({ category }) => category === "UnknownPersistentTable")) {
    throw new Error("durable inventory found an unknown SQLite table")
  }
  if (workflowRecords.some(({ category }) => category === "UnknownWorkflowRecord")) {
    throw new Error("durable inventory found an unknown Workflow record")
  }
  const evidenceContents = await Promise.all(names.map((name) => evidenceContentFor(workspace, name)))
  const forbiddenPersistedArtifacts = [
    ...names.flatMap(forbiddenMatches),
    ...sqliteTables.flatMap(({ database, name }) => forbiddenMatches(`${database}:${name}`)),
    ...tableRows.flatMap(({ database, name, rows }) =>
      rows.flatMap((row, rowIndex) =>
        rowCellsFor(row).flatMap((cell) => forbiddenMatches(`${database}:${name}:${rowIndex}:${cell}`))
      )
    ),
    ...workflowRecords.flatMap(({ database, table, rowIndex, cells }) =>
      cells.flatMap((cell) => forbiddenMatches(`${database}:${table}:${rowIndex}:${cell}`))
    ),
    ...evidenceContents.flatMap(forbiddenMatches),
    ...records.flatMap(({ event }) => forbiddenMatches(`journal:${JSON.stringify(event)}`))
  ]
  const journalRecords = records.map(({ event }) =>
    DurableJournalRecord.make({ category: journalRecordCategoryFor(event._tag), eventTag: event._tag })
  )
  return DurableInventory.make({
    files,
    forbiddenPersistedArtifacts,
    journalRecords,
    sqliteTables,
    workflowRecords
  })
}
