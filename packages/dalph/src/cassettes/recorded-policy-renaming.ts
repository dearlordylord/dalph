import type { RecordedCassetteEntry } from "./recorded-domain.js"

type CapacityChangeEntry = Extract<RecordedCassetteEntry, { readonly _tag: "TaskWorkCapacityChanged" }>
type RunBeginningEntry = Extract<RecordedCassetteEntry, { readonly _tag: "WorkflowRunBegan" }>
type RunTerminationEntry = Extract<RecordedCassetteEntry, { readonly _tag: "WorkflowRunTerminated" }>
type RunCancellationEntry = Extract<RecordedCassetteEntry, { readonly _tag: "RunCancellationApplied" }>

/**
 * Run policy and lifecycle entries contain no Dalph-allocated identity family,
 * so alpha-renaming preserves every field exactly.
 */
export const preserveRecordedRunPolicyChange = (entry: CapacityChangeEntry): CapacityChangeEntry => entry
export const preserveRecordedRunBeginning = (entry: RunBeginningEntry): RunBeginningEntry => entry
export const preserveRecordedRunTermination = (entry: RunTerminationEntry): RunTerminationEntry => entry
export const preserveRecordedRunCancellation = (entry: RunCancellationEntry): RunCancellationEntry => entry
