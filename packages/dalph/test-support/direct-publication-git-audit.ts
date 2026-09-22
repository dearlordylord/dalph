import type { TaskId } from "@dalph/contracts"
import type { JournalRecord } from "@dalph/orchestrator"

export type DirectPublicationGitBoundaryKind =
  | "LocalCandidateAncestryRead"
  | "LocalTargetPromotion"
  | "RemotePublication"
  | "RemoteRead"

export interface DirectPublicationGitBoundary {
  readonly kind: DirectPublicationGitBoundaryKind
  readonly position: JournalRecord["position"]
  readonly tag: JournalRecord["event"]["_tag"]
}

export type DirectPublicationSuccessToCloseAudit =
  | {
      readonly _tag: "Complete"
      readonly boundaries: ReadonlyArray<DirectPublicationGitBoundary>
      readonly closeIndex: number
      readonly publicationIndex: number
    }
  | { readonly _tag: "MissingClose" | "MissingPublication" }

const gitBoundary = (record: JournalRecord): DirectPublicationGitBoundary | undefined => {
  const tag = record.event._tag
  if (tag === "RemotePublicationAdmissionReadIntended" || tag === "RemoteBaselineReadIntended")
    return { kind: "RemoteRead", position: record.position, tag }
  if (tag === "RemotePublicationAttemptIntended") return { kind: "RemotePublication", position: record.position, tag }
  if (tag === "TargetPromotionAttemptIntended") return { kind: "LocalTargetPromotion", position: record.position, tag }
  if (
    tag === "CompletionTaskCandidateAncestryReadIntended" ||
    tag === "PostPromotionBlockerCandidateAncestryReadIntended"
  )
    return { kind: "LocalCandidateAncestryRead", position: record.position, tag }
  return undefined
}

/** Audits Git boundary intents after exact publication proof and through the task close acknowledgement. */
export const auditDirectPublicationSuccessToClose = (
  records: ReadonlyArray<JournalRecord>,
  taskId: TaskId
): DirectPublicationSuccessToCloseAudit => {
  const publicationIndex = records.findIndex(
    ({ event }) =>
      event._tag === "RemotePublicationSucceeded" &&
      event.correlation.qualifiedCandidate.run.session.plannedAttempt.taskId === taskId
  )
  if (publicationIndex < 0) return { _tag: "MissingPublication" }

  const closeIndex = records.findIndex(
    ({ event }, index) =>
      index > publicationIndex &&
      event._tag === "IntegrationFinalitySettled" &&
      event.claim.plannedAttempt.taskId === taskId
  )
  if (closeIndex < 0) return { _tag: "MissingClose" }

  return {
    _tag: "Complete",
    boundaries: records.slice(publicationIndex + 1, closeIndex + 1).flatMap((record) => {
      const boundary = gitBoundary(record)
      return boundary === undefined ? [] : [boundary]
    }),
    closeIndex,
    publicationIndex
  }
}
