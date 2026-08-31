import { RunId } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { TrackerTarget, taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import { RunLifecycleJournal } from "../../workflow-journal/store.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { hasUnfinishedRunResponsibility } from "./recovery-activation.js"
import { AllocatedWorkflowRunId, freshWorkflowRunId } from "./fresh-run-identity.js"
import { StartupRecoveryBlocked } from "./startup-recovery.js"

/** The production host allocated a new identity or recovered one exact unfinished identity. */
export const ProductionRunSelection = Schema.TaggedUnion({
  Allocated: { runId: AllocatedWorkflowRunId },
  Recovered: { runId: AllocatedWorkflowRunId }
})
export type ProductionRunSelection = typeof ProductionRunSelection.Type

const ProductionRunSelectionConflictEntry = Schema.Struct({ runId: RunId, target: TrackerTarget })

/** Valid unfinished histories cannot be assigned safely to the requested repository host. */
export class ProductionRunSelectionConflict extends Schema.TaggedError<ProductionRunSelectionConflict>()(
  "ProductionRunSelectionConflict",
  { conflicts: Schema.NonEmptyArray(ProductionRunSelectionConflictEntry), requestedTarget: TrackerTarget }
) {}

const isUnfinished = (
  reduction: Extract<ReturnType<typeof reduceWorkflowJournalHistory>, { readonly _tag: "ValidWorkflowJournalHistory" }>
): boolean => {
  const began = reduction.records.some(({ event }) => event._tag === "WorkflowRunBegan")
  const terminated = reduction.records.some(({ event }) => event._tag === "WorkflowRunTerminated")
  return (began && !terminated) || hasUnfinishedRunResponsibility(reduction.runState)
}

const recordedTarget = (
  reduction: Extract<ReturnType<typeof reduceWorkflowJournalHistory>, { readonly _tag: "ValidWorkflowJournalHistory" }>
): TrackerTarget | undefined => {
  const beginning = reduction.records.find(({ event }) => event._tag === "WorkflowRunBegan")
  /* v8 ignore next -- @preserve A valid unfinished Run reduction necessarily contains its first WorkflowRunBegan record. */
  return beginning?.event._tag === "WorkflowRunBegan" ? beginning.event.target : undefined
}

/**
 * Alice starts one configured repository host. Under the already-held
 * coordinator scope, Dalph validates every Hot history before it either reuses
 * the sole matching unfinished Run or allocates one genuinely fresh identity.
 */
export const selectProductionRun = Effect.fn("ProductionHost.selectRun")(function* (target: TrackerTarget) {
  const journal = yield* RunLifecycleJournal
  const scan = yield* journal.scanHot()
  const reductions = scan.runs.map(({ records, runId }) => reduceWorkflowJournalHistory(runId, records))
  const issues = [
    ...scan.issues,
    ...reductions.flatMap((reduction) => (reduction._tag === "InvalidWorkflowJournalHistory" ? reduction.issues : []))
  ]
  if (issues.length > 0) return yield* new StartupRecoveryBlocked({ issues })

  const unfinished = reductions.filter(
    (reduction): reduction is Extract<typeof reduction, { readonly _tag: "ValidWorkflowJournalHistory" }> =>
      reduction._tag === "ValidWorkflowJournalHistory" && isUnfinished(reduction)
  )
  const conflicts = unfinished.flatMap((reduction) => {
    const target = recordedTarget(reduction)
    /* v8 ignore next -- @preserve The unfinished filter admits only valid Run histories, whose required beginning names the target. */
    return target === undefined ? [] : [{ runId: reduction.runId, target }]
  })
  const [firstConflict, ...remainingConflicts] = conflicts
  if (
    firstConflict !== undefined &&
    (remainingConflicts.length > 0 || taskTrackerTargetKey(firstConflict.target) !== taskTrackerTargetKey(target))
  ) {
    return yield* new ProductionRunSelectionConflict({
      conflicts: [firstConflict, ...remainingConflicts],
      requestedTarget: target
    })
  }
  const recovered = firstConflict
  return recovered === undefined
    ? ProductionRunSelection.cases.Allocated.make({ runId: yield* freshWorkflowRunId(target) })
    : ProductionRunSelection.cases.Recovered.make({ runId: AllocatedWorkflowRunId.make(recovered.runId) })
})
