/* eslint-disable functional/immutable-data, max-lines -- The facet reducer uses private mutable fold state. */
import type {
  BranchCleanupJournalEvent,
  BranchCleanupObservation
} from "../workflow/protocols/disposition-cleanup/branch.js"
import type {
  IntegratorCandidateCleanupJournalEvent,
  IntegratorCandidateCleanupObservation
} from "../workflow/protocols/disposition-cleanup/integrator-candidate.js"
import type {
  WorktreeCleanupJournalEvent,
  WorktreeCleanupObservation
} from "../workflow/protocols/disposition-cleanup/worktree.js"
import type { TraceCleanupProgress, TraceCleanupStatus, TraceHistoryItem, TraceItemIdentity } from "./trace-reader.js"
import type { HistoricalFacetFactories, HistoricalFacetReductionState } from "./trace-reader-historical-facets.js"

type CleanupResultTag = "AlreadyAbsent" | "DefinitelyNotApplied" | "Removed" | "Unknown"

type CleanupObservation = WorktreeCleanupObservation | BranchCleanupObservation | IntegratorCandidateCleanupObservation
type CleanupJournalEvent =
  | WorktreeCleanupJournalEvent
  | BranchCleanupJournalEvent
  | IntegratorCandidateCleanupJournalEvent

const cleanupObservationStatus = (
  observation: CleanupObservation,
  source: TraceItemIdentity,
  factories: HistoricalFacetFactories
): TraceCleanupStatus => {
  switch (observation._tag) {
    case "Present":
      return factories.cleanupStatus.Present.make({ source })
    case "Absent":
      return factories.cleanupStatus.Absent.make({ source })
    case "Unreadable":
      return factories.cleanupStatus.ObservationPending.make({ source })
    case "Foreign":
      return factories.cleanupStatus.Contradicted.make({ detail: "Foreign", source })
    case "Unregistered":
      return factories.cleanupStatus.Contradicted.make({ detail: "Unregistered", source })
  }
}

const cleanupMutationResultTag = (result: { readonly _tag: CleanupResultTag }): CleanupResultTag => result._tag

type CleanupSettledEvent = Extract<CleanupJournalEvent, { readonly _tag: `${string}CleanupSettled` }>
type StaticCleanupStatusKind = "Absent" | "Authorized" | "MutationPending" | "ObservationPending"

const cleanupSettledEventTags: ReadonlySet<CleanupJournalEvent["_tag"]> = new Set([
  "BranchCleanupSettled",
  "IntegratorCandidateCleanupSettled",
  "WorktreeCleanupSettled"
])

const staticCleanupStatusByEventTag = {
  BranchCleanupAbsenceConfirmed: "Absent",
  BranchCleanupAuthorized: "Authorized",
  BranchCleanupMutationIntended: "MutationPending",
  BranchCleanupObservationIntended: "ObservationPending",
  IntegratorCandidateCleanupAbsenceConfirmed: "Absent",
  IntegratorCandidateCleanupAuthorized: "Authorized",
  IntegratorCandidateCleanupMutationIntended: "MutationPending",
  IntegratorCandidateCleanupObservationIntended: "ObservationPending",
  WorktreeCleanupAbsenceConfirmed: "Absent",
  WorktreeCleanupAuthorized: "Authorized",
  WorktreeCleanupMutationIntended: "MutationPending",
  WorktreeCleanupObservationIntended: "ObservationPending"
} as const satisfies Record<
  Exclude<
    CleanupJournalEvent["_tag"],
    `${string}CleanupContradicted` | `${string}CleanupObserved` | `${string}ResultRecorded` | `${string}CleanupSettled`
  >,
  StaticCleanupStatusKind
>

const isCleanupSettledEvent = (event: CleanupJournalEvent): event is CleanupSettledEvent =>
  cleanupSettledEventTags.has(event._tag)

const staticCleanupStatus = (
  kind: StaticCleanupStatusKind,
  source: TraceItemIdentity,
  factories: HistoricalFacetFactories
): TraceCleanupStatus => {
  switch (kind) {
    case "Absent":
      return factories.cleanupStatus.Absent.make({ source })
    case "Authorized":
      return factories.cleanupStatus.Authorized.make({ source })
    case "MutationPending":
      return factories.cleanupStatus.MutationPending.make({ source })
    case "ObservationPending":
      return factories.cleanupStatus.ObservationPending.make({ source })
  }
}

const cleanupStatusForEvent = (
  event: CleanupJournalEvent,
  source: TraceItemIdentity,
  factories: HistoricalFacetFactories
): TraceCleanupStatus => {
  if ("detail" in event) return factories.cleanupStatus.Contradicted.make({ detail: event.detail, source })
  if ("observation" in event) return cleanupObservationStatus(event.observation, source, factories)
  if ("result" in event) {
    return isCleanupSettledEvent(event)
      ? factories.cleanupStatus.Settled.make({ result: event.result._tag, source })
      : factories.cleanupStatus.MutationResultRecorded.make({ result: cleanupMutationResultTag(event.result), source })
  }
  return staticCleanupStatus(staticCleanupStatusByEventTag[event._tag], source, factories)
}

const reduceCleanupFamily = <
  Event extends CleanupJournalEvent,
  Step extends { readonly event: Event; readonly source: TraceItemIdentity },
  Tag extends TraceCleanupProgress["_tag"]
>(
  occurrence: { readonly event: Event },
  item: TraceHistoryItem,
  state: HistoricalFacetReductionState,
  progressTag: Tag,
  makeStep: (event: Event, source: TraceItemIdentity) => Step,
  makeProgress: (
    current: Extract<TraceCleanupProgress, { readonly _tag: Tag }> | undefined,
    input: {
      readonly event: Event
      readonly authorization: Event["authorization"]
      readonly status: TraceCleanupStatus
      readonly step: Step
    }
  ) => Extract<TraceCleanupProgress, { readonly _tag: Tag }>
): void => {
  const event = occurrence.event
  const status = cleanupStatusForEvent(event, item.identity, state.factories)
  const step = makeStep(event, item.identity)
  const current = state.cleanup.find(
    (progress): progress is Extract<TraceCleanupProgress, { readonly _tag: Tag }> =>
      progress._tag === progressTag && progress.authorization.operationId === event.authorization.operationId
  )
  if (current === undefined) {
    state.cleanup.push(makeProgress(undefined, { authorization: event.authorization, event, status, step }))
    return
  }
  const index = state.cleanup.indexOf(current)
  state.cleanup.splice(index, 1, makeProgress(current, { authorization: event.authorization, event, status, step }))
}

const reduceWorktreeCleanup = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  if (item.occurrence._tag !== "WorktreeCleanupOccurred") return
  reduceCleanupFamily(
    item.occurrence,
    item,
    state,
    "Worktree",
    (event, source) => state.factories.worktreeCleanupStep.make({ event, source }),
    (current, { authorization, status, step }) => {
      if (current === undefined) {
        return state.factories.cleanupProgress.Worktree.make({ authorization, status, steps: [step] })
      }
      return state.factories.cleanupProgress.Worktree.make({
        authorization: current.authorization,
        status,
        steps: [...current.steps, step]
      })
    }
  )
}

const reduceBranchCleanup = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  if (item.occurrence._tag !== "BranchCleanupOccurred") return
  reduceCleanupFamily(
    item.occurrence,
    item,
    state,
    "Branch",
    (event, source) => state.factories.branchCleanupStep.make({ event, source }),
    (current, { authorization, status, step }) => {
      if (current === undefined) {
        return state.factories.cleanupProgress.Branch.make({ authorization, status, steps: [step] })
      }
      return state.factories.cleanupProgress.Branch.make({
        authorization: current.authorization,
        status,
        steps: [...current.steps, step]
      })
    }
  )
}

const reduceIntegratorCandidateCleanup = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  if (item.occurrence._tag !== "IntegratorCandidateCleanupOccurred") return
  reduceCleanupFamily(
    item.occurrence,
    item,
    state,
    "IntegratorCandidate",
    (event, source) => state.factories.integratorCandidateCleanupStep.make({ event, source }),
    (current, { authorization, status, step }) => {
      if (current === undefined) {
        return state.factories.cleanupProgress.IntegratorCandidate.make({ authorization, status, steps: [step] })
      }
      return state.factories.cleanupProgress.IntegratorCandidate.make({
        authorization: current.authorization,
        status,
        steps: [...current.steps, step]
      })
    }
  )
}

const reduceControlFacts = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag === "AppliedControlDirection") {
    state.controls.push(
      state.factories.controlFact.Direction.make({
        direction: occurrence.direction,
        initiatedBy: occurrence.initiatedBy,
        ordinal: occurrence.ordinal,
        source: item.identity,
        subject: occurrence.subject
      })
    )
    return
  }
  if (occurrence._tag === "AppliedAttemptChoice") {
    state.controls.push(
      state.factories.controlFact.AttemptChoice.make({
        choice: occurrence.choice,
        initiatedBy: occurrence.initiatedBy,
        requestId: occurrence.requestId,
        source: item.identity,
        subject: occurrence.subject
      })
    )
    return
  }
  return
}

const reduceAttemptAbandonedDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  if (item.occurrence._tag !== "AttemptImplementationAbandoned") return
  const occurrence = item.occurrence
  state.dispositions.push(
    state.factories.dispositionFact.AttemptAbandoned.make({
      expectedClaim: occurrence.expectedClaim,
      initiatedBy: occurrence.initiatedBy,
      proof: occurrence.proof,
      requestId: occurrence.requestId,
      source: item.identity,
      subject: occurrence.subject
    })
  )
}

const reduceStoppedClaimDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  if (item.occurrence._tag !== "StoppedAttemptClaimPreserved") return
  const occurrence = item.occurrence
  state.dispositions.push(
    state.factories.dispositionFact.AttemptClaimPreserved.make({
      expectedClaim: occurrence.expectedClaim,
      observation: occurrence.observation,
      observationOperationId: occurrence.observationOperationId,
      requestId: occurrence.requestId,
      source: item.identity,
      subject: occurrence.subject
    })
  )
}

const reduceCancelledResponsibilityDisposition = (
  item: TraceHistoryItem,
  state: HistoricalFacetReductionState
): void => {
  if (item.occurrence._tag !== "CancelledAttemptImplementationResponsibilityRelinquished") return
  const occurrence = item.occurrence
  state.dispositions.push(
    state.factories.dispositionFact.CancelledAttemptResponsibilityRelinquished.make({
      authorizedClaim: occurrence.authorizedClaim,
      cancellationAppliedAt: occurrence.cancellationAppliedAt,
      initiatedBy: occurrence.initiatedBy,
      plannedAttempt: occurrence.plannedAttempt,
      proof: occurrence.proof,
      source: item.identity
    })
  )
}

const reduceCancelledClaimDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  if (item.occurrence._tag !== "CancelledAttemptClaimNoReleaseObserved") return
  const occurrence = item.occurrence
  state.dispositions.push(
    state.factories.dispositionFact.CancelledAttemptClaimPreserved.make({
      cancellationAppliedAt: occurrence.cancellationAppliedAt,
      expectedClaim: occurrence.expectedClaim,
      observation: occurrence.observation,
      observationOperationId: occurrence.observationOperationId,
      plannedAttempt: occurrence.plannedAttempt,
      source: item.identity
    })
  )
}

const reduceRunCancellationDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  if (item.occurrence._tag !== "RunCancellationApplied") return
  state.dispositions.push(
    state.factories.dispositionFact.RunCancellationApplied.make({
      initiatedBy: item.occurrence.initiatedBy,
      source: item.identity
    })
  )
}

const reduceCandidatePreservationDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  if (item.occurrence._tag !== "IntegratorSuccessorSessionFixed") return
  const occurrence = item.occurrence
  state.dispositions.push(
    state.factories.dispositionFact.IntegratorCandidatePreserved.make({
      predecessor: occurrence.predecessor,
      source: item.identity,
      successor: occurrence.successor
    })
  )
}

const reduceQuarantineDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  if (item.occurrence._tag !== "IntegrationQuarantined") return
  const occurrence = item.occurrence
  state.dispositions.push(
    state.factories.dispositionFact.IntegrationQuarantine.make({
      basis: occurrence.basis,
      correlation: occurrence.correlation,
      source: item.identity
    })
  )
}

const reduceNonConvergentDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  if (item.occurrence._tag !== "TargetPromotionNonConvergent") return
  const occurrence = item.occurrence
  state.dispositions.push(
    state.factories.dispositionFact.NonConvergentPromotion.make({
      correlation: occurrence.correlation,
      lastObservation: occurrence.lastObservation,
      source: item.identity
    })
  )
}

const reduceWorktreeLostDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "PlannedAttemptWorktreeObserved" || occurrence.observation._tag !== "AttemptWorktreeLost") {
    return
  }
  state.dispositions.push(
    state.factories.dispositionFact.WorktreeLost.make({
      observation: occurrence.observation,
      plannedAttempt: occurrence.observation.plannedAttempt,
      source: item.identity
    })
  )
}

const reduceAuthorityConflictDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  if (item.occurrence._tag !== "AttemptRestartAuthorityReadFailed") return
  const occurrence = item.occurrence
  state.dispositions.push(
    state.factories.dispositionFact.TaskAuthorityConflict.make({
      failure: occurrence.failure,
      source: item.identity,
      subject: occurrence.subject
    })
  )
}

const reduceReplacementPendingDisposition = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  const occurrence = item.occurrence
  if (occurrence._tag !== "AppliedAttemptChoice" || occurrence.choice !== "RestartTaskImplementation") return
  const replacement = state.items.find(
    ({ occurrence: candidate }) =>
      candidate._tag === "PlannedAttemptReplaced" && candidate.requestId.nonce === occurrence.requestId.nonce
  )
  if (replacement !== undefined) return
  state.dispositions.push(
    state.factories.dispositionFact.ReplacementPending.make({ choice: occurrence.subject, source: item.identity })
  )
}

const reduceControlDispositions = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  reduceAttemptAbandonedDisposition(item, state)
  reduceStoppedClaimDisposition(item, state)
  reduceCancelledResponsibilityDisposition(item, state)
  reduceCancelledClaimDisposition(item, state)
  reduceRunCancellationDisposition(item, state)
  reduceCandidatePreservationDisposition(item, state)
  reduceQuarantineDisposition(item, state)
  reduceNonConvergentDisposition(item, state)
  reduceWorktreeLostDisposition(item, state)
  reduceAuthorityConflictDisposition(item, state)
  reduceReplacementPendingDisposition(item, state)
}

/** Adds every accepted control, disposition, and cleanup occurrence to one fold state. */
export const reduceControlDispositionItem = (item: TraceHistoryItem, state: HistoricalFacetReductionState): void => {
  reduceControlFacts(item, state)
  reduceControlDispositions(item, state)
  reduceWorktreeCleanup(item, state)
  reduceBranchCleanup(item, state)
  reduceIntegratorCandidateCleanup(item, state)
}
