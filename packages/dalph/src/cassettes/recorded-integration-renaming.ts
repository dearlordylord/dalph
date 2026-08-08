import type { PlannedTaskAttempt } from "@dalph/contracts"
import type { RecordedCassetteEntry } from "./recorded-domain.js"

export type RecordedIntegrationEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "IntegrationResponsibilityBegan" | "IntegrationStarted" }
>

export const isRecordedIntegrationEntry = (entry: RecordedCassetteEntry): entry is RecordedIntegrationEntry =>
  entry._tag === "IntegrationResponsibilityBegan" || entry._tag === "IntegrationStarted"

/** Integration target and commit are configured facts; only the planned attempt is alpha-renamed. */
export const renameRecordedIntegrationEntry = (
  entry: RecordedIntegrationEntry,
  renamePlannedAttempt: (attempt: PlannedTaskAttempt) => PlannedTaskAttempt
): RecordedIntegrationEntry => ({ ...entry, plannedAttempt: renamePlannedAttempt(entry.plannedAttempt) })
