import { DatabaseSync } from "node:sqlite"
import { join } from "node:path"
import type {
  AdapterName,
  CanonicalTraceEvent,
  ProviderCall,
  RecoveredDecision
} from "./contracts.ts"
import { fixture } from "./contracts.ts"

const scalarCount = (database: DatabaseSync, sql: string): number => {
  const statement = database.prepare(sql)
  statement.setReadBigInts(true)
  const row: unknown = statement.get()
  if (typeof row !== "object" || row === null || !("count" in row)) return 0
  const count = row.count
  return typeof count === "bigint" ? Number(count) : typeof count === "number" ? count : 0
}

const adapterHasDurableIntent = (workspace: string, adapter: AdapterName): boolean => {
  const database = new DatabaseSync(
    join(workspace, adapter === "journal-baseline" ? "journal-baseline.sqlite" : "effect-workflow.sqlite"),
    { readOnly: true }
  )
  try {
    return adapter === "journal-baseline"
      ? scalarCount(
          database,
          "SELECT COUNT(*) AS count FROM journal_records WHERE event_kind = 'TaskClaimAcquisitionIntended'"
        ) === 1
      : scalarCount(
          database,
          "SELECT COUNT(*) AS count FROM cluster_messages WHERE tag = 'activity' AND payload LIKE '%ReconcileExactTaskClaimV1%'"
        ) === 1
  } finally {
    database.close()
  }
}

export const projectCanonicalTrace = (
  workspace: string,
  adapter: AdapterName,
  providerCalls: ReadonlyArray<ProviderCall>,
  decision: RecoveredDecision
): ReadonlyArray<CanonicalTraceEvent> => {
  const trace: Array<CanonicalTraceEvent> = [{ _tag: "RunExecutionEstablished", runId: fixture.runId }]
  let intentProjected = false
  const hasDurableIntent = adapterHasDurableIntent(workspace, adapter)
  for (const call of providerCalls) {
    if (call.request === "GitHub.ReadClaim" && call.trackerRevision !== null) {
      trace.push({ _tag: "TaskClaimObserved", result: call.result, trackerRevision: call.trackerRevision })
    }
    if (call.request === "GitHub.CreateClaim" && call.trackerRevision !== null) {
      if (!hasDurableIntent) throw new Error(`${adapter} crossed GitHub without durable claim intent`)
      if (!intentProjected) {
        trace.push({ _tag: "TaskClaimAcquisitionIntended", taskId: fixture.claim.taskId })
        intentProjected = true
      }
      trace.push({ _tag: "TaskClaimRequestApplied", trackerRevision: call.trackerRevision })
    }
    if (call.request === "GitHub.ReadCurrentTaskFacts" && call.trackerRevision !== null) {
      trace.push({ _tag: "CurrentTaskFactsObserved", result: call.result, trackerRevision: call.trackerRevision })
    }
  }
  trace.push({ _tag: "RunDecisionRecovered", decision })
  return trace
}
