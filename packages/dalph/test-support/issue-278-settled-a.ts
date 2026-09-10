import { AcceptedResultEvidenceManifest } from "@dalph/contracts"
import { Effect } from "effect"
import {
  deriveIntegrationFinalityStateFor,
  reduceWorkflowJournalHistory,
  type EvidenceStore,
  type JournalStore
} from "@dalph/orchestrator"
import { runAuthoredScenarioCassette } from "../src/cassettes/authored-runner.js"
import { projectRecordedCassette, foldRecordedCassette } from "../src/cassettes/index.js"
import { completeSingletonDeliveryCassette } from "./complete-singleton-delivery.js"

/** Exact ordinary A prefix. No FullRerun predecessor exists in this independent starting history. */
export const makeIssue278SettledA = Effect.fn("Issue278.makeSettledA")(function* () {
  const run = yield* runAuthoredScenarioCassette(completeSingletonDeliveryCassette)
  const settledAt = run.records.findIndex(({ event }) => event._tag === "IntegrationFinalitySettled")
  if (settledAt < 0) return yield* Effect.die("A fixture did not settle")
  const records = run.records.slice(0, settledAt + 1)
  const recorded = yield* projectRecordedCassette(records)
  const folded = foldRecordedCassette(recorded)
  const history = reduceWorkflowJournalHistory(run.runId, records)
  if (history._tag !== "ValidWorkflowJournalHistory" || folded._tag !== "ValidWorkflowJournalHistory")
    return yield* Effect.die("A prefix failed production reconstruction")
  const beginning = records[0]?.event
  const settlement = records[settledAt]?.event
  if (beginning?._tag !== "WorkflowRunBegan" || settlement?._tag !== "IntegrationFinalitySettled")
    return yield* Effect.die("A prefix missing exact beginning or settlement")
  const claim = settlement.claim
  if (deriveIntegrationFinalityStateFor(records, claim)?._tag !== "IntegrationFinalitySettled")
    return yield* Effect.die("A prefix lacks production-validated exact finality settlement")
  const seed = Effect.fn("Issue278.seedSettledA")(function* (input: {
    readonly journal: JournalStore["Service"]
    readonly evidence: EvidenceStore["Service"]
  }) {
    for (const { event } of records) {
      if (
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report._tag === "ExecutorWorkTerminal" &&
        event.report.result._tag === "Accepted"
      ) {
        const reference = yield* input.evidence
          .put(
            new TextEncoder().encode(
              JSON.stringify(
                AcceptedResultEvidenceManifest.make({
                  commit: event.report.result.acceptedResult.commit,
                  correlation: event.report.correlation,
                  formatVersion: 1,
                  outcome: "Accepted",
                  predecessor: null
                })
              )
            )
          )
          .pipe(Effect.orDie)
        if (JSON.stringify(reference) !== JSON.stringify(event.report.result.acceptedResult.evidenceManifest))
          return yield* Effect.die("A immutable evidence bytes do not match its retained reference")
      }
    }
    for (const record of records) {
      if (record.event._tag === "WorkflowRunBegan")
        yield* input.journal
          .beginRun(record.runId, record.event.target, record.event.initialControlPolicy)
          .pipe(Effect.orDie)
      else if (record.event._tag === "WorkflowRunTerminated")
        return yield* Effect.die("settled A prefix must remain nonterminal")
      else yield* input.journal.append(record.runId, record.key, record.event).pipe(Effect.orDie)
    }
  })
  return { records, history, folded, claim, runId: run.runId, target: beginning.target, seed }
})
