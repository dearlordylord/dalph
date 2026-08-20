import { Context, Effect } from "effect"
import type { RunId } from "@dalph/contracts"
import type { OperationId } from "../../identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { InRunJournal } from "../../../workflow-journal/in-run-journal.js"
import {
  isCleanupEligibleDisposition,
  type BranchCleanupAuthorization,
  type IntegratorCandidateCleanupAuthorization,
  type WorktreeCleanupAuthorization
} from "./disposition.js"
import { BranchCleanupOutcome, runBranchCleanup } from "./branch.js"
import { IntegratorCandidateCleanupOutcome, runIntegratorCandidateCleanup } from "./integrator-candidate.js"
import { WorktreeCleanupOutcome, runWorktreeCleanup } from "./worktree.js"
import {
  validateBranchCleanupHistory,
  validateIntegratorCandidateCleanupHistory,
  validateIntegratorCandidateCleanupProvenance,
  validateWorktreeCleanupHistory,
  validateWorktreeCleanupProvenance
} from "./provenance.js"

/** The three independent cleanup responsibilities reconstructed for one Run. */
export type DispositionCleanupResponsibilities = {
  readonly branch: BranchCleanupAuthorization | undefined
  readonly candidate: IntegratorCandidateCleanupAuthorization | undefined
  readonly worktree: WorktreeCleanupAuthorization | undefined
}

/**
 * All independently reconstructable responsibilities in one established Run.
 * A Run may retain more than one exact cleanup occurrence for a family; the
 * selector therefore scopes validation and bounded execution by operation id.
 */
export type DispositionCleanupResponsibilitySet = {
  readonly branch: ReadonlyArray<BranchCleanupAuthorization>
  readonly candidate: ReadonlyArray<IntegratorCandidateCleanupAuthorization>
  readonly worktree: ReadonlyArray<WorktreeCleanupAuthorization>
}

/** Caller proposals are inputs to the family protocols, never selected authority. */
export type DispositionCleanupProposals = {
  readonly branch: ReadonlyArray<BranchCleanupAuthorization>
  readonly candidate: ReadonlyArray<IntegratorCandidateCleanupAuthorization>
  readonly worktree: ReadonlyArray<WorktreeCleanupAuthorization>
}

/** Results of one composed cleanup loop, retaining each family's typed outcome. */
export type DispositionCleanupLoopResult = {
  readonly branch: BranchCleanupOutcome | undefined
  readonly candidate: IntegratorCandidateCleanupOutcome | undefined
  readonly selected: DispositionCleanupResponsibilities
  readonly worktree: WorktreeCleanupOutcome | undefined
  readonly branchOutcomes: ReadonlyArray<BranchCleanupOutcome>
  readonly candidateOutcomes: ReadonlyArray<IntegratorCandidateCleanupOutcome>
  readonly worktreeOutcomes: ReadonlyArray<WorktreeCleanupOutcome>
}

/** The activation must remain bounded even when a damaged journal repeats a family. */
export const cleanupResponsibilitySelectionLimit = 3 as const // eslint-disable-line no-magic-numbers

/** Journal-derived cleanup authority made available to ordinary Run activation. */
export interface DispositionCleanupActivationService {
  readonly responsibilities: DispositionCleanupResponsibilitySet
}

export class DispositionCleanupActivation extends Context.Service<
  DispositionCleanupActivation,
  DispositionCleanupActivationService
>()("@dalph/DispositionCleanupActivation") {}

/**
 * Selects only responsibilities whose exact durable terminal occurrence is in
 * the supplied Run. A decoded caller subject is merely a candidate: journaled
 * replacement or successor evidence is what makes it eligible.
 */
const familyAuthorizations = <Authorization extends { readonly operationId: OperationId }>(
  records: ReadonlyArray<JournalRecord>,
  tag: "WorktreeCleanupAuthorized" | "BranchCleanupAuthorized" | "IntegratorCandidateCleanupAuthorized",
  authorizationOf: (record: JournalRecord) => Authorization | undefined,
  validate: (authorization: Authorization) => boolean
): ReadonlyArray<Authorization> =>
  records
    .filter(({ event }) => event._tag === tag)
    .toSorted((left, right) => Number(left.position) - Number(right.position))
    .map(authorizationOf)
    .filter((authorization): authorization is Authorization => authorization !== undefined && validate(authorization))
    .reduce<ReadonlyArray<Authorization>>(
      (selected, authorization) =>
        selected.some((candidate) => candidate.operationId === authorization.operationId)
          ? selected
          : [...selected, authorization],
      []
    )

const byOperation = <Authorization extends { readonly operationId: OperationId }>(
  values: ReadonlyArray<Authorization>
): ReadonlyArray<Authorization> =>
  values.reduce<ReadonlyArray<Authorization>>(
    (selected, value) =>
      selected.some((candidate) => candidate.operationId === value.operationId) ? selected : [...selected, value],
    []
  )

const bounded = <Authorization>(values: ReadonlyArray<Authorization>): ReadonlyArray<Authorization> =>
  values.slice(0, cleanupResponsibilitySelectionLimit)

const validWorktree = (records: ReadonlyArray<JournalRecord>, authorization: WorktreeCleanupAuthorization): boolean =>
  validateWorktreeCleanupProvenance(records, authorization)._tag === "Valid" &&
  validateWorktreeCleanupHistory(records, authorization)._tag === "Valid"

const validBranch = (records: ReadonlyArray<JournalRecord>, authorization: BranchCleanupAuthorization): boolean =>
  validateWorktreeCleanupProvenance(records, authorization)._tag === "Valid" &&
  validateBranchCleanupHistory(records, authorization)._tag === "Valid"

const validCandidate = (
  records: ReadonlyArray<JournalRecord>,
  authorization: IntegratorCandidateCleanupAuthorization
): boolean =>
  validateIntegratorCandidateCleanupProvenance(records, authorization)._tag === "Valid" &&
  validateIntegratorCandidateCleanupHistory(records, authorization)._tag === "Valid"

/**
 * Reconstructs cleanup responsibilities from exact journaled authorization
 * events. Raw activation proposals are deliberately not returned here: an
 * authorization is exposed only after its upstream provenance and family
 * prefix validate against the same Run journal.
 */
export const selectCleanupResponsibilities = (
  records: ReadonlyArray<JournalRecord>,
  operationId?: OperationId
): DispositionCleanupResponsibilities => {
  const selected = selectCleanupResponsibilitySet(records)
  const match = <Authorization extends { readonly operationId: OperationId }>(
    values: ReadonlyArray<Authorization>
  ): Authorization | undefined => values.find((value) => operationId === undefined || value.operationId === operationId)
  return { branch: match(selected.branch), candidate: match(selected.candidate), worktree: match(selected.worktree) }
}

/**
 * Reconstructs every valid exact responsibility independently. Invalid or
 * foreign history for one operation does not hide an unrelated operation in
 * the same family; each result is validated against its own operation prefix.
 */
export const selectCleanupResponsibilitySet = (
  records: ReadonlyArray<JournalRecord>
): DispositionCleanupResponsibilitySet => ({
  branch: bounded(
    familyAuthorizations(
      records,
      "BranchCleanupAuthorized",
      (record) => (record.event._tag === "BranchCleanupAuthorized" ? record.event.authorization : undefined),
      (authorization) => validBranch(records, authorization)
    )
  ),
  candidate: bounded(
    familyAuthorizations(
      records,
      "IntegratorCandidateCleanupAuthorized",
      (record) =>
        record.event._tag === "IntegratorCandidateCleanupAuthorized" ? record.event.authorization : undefined,
      (authorization) => validCandidate(records, authorization)
    )
  ),
  worktree: bounded(
    familyAuthorizations(
      records,
      "WorktreeCleanupAuthorized",
      (record) => (record.event._tag === "WorktreeCleanupAuthorized" ? record.event.authorization : undefined),
      (authorization) => validWorktree(records, authorization)
    )
  )
})

/**
 * Runs the same family protocols used by production activation. Worktree
 * settlement is the explicit gate for branch cleanup; candidate cleanup is an
 * independent family and never borrows either resource's authority.
 */
export const runDispositionCleanupLoop = Effect.fn("DispositionCleanup.loop")(function* (
  runId: RunId,
  proposals: DispositionCleanupProposals = { branch: [], candidate: [], worktree: [] }
) {
  const journal = yield* InRunJournal
  const initialRecords = yield* journal.read(runId)
  let selectedSet = selectCleanupResponsibilitySet(initialRecords)
  const worktreeCandidates = bounded(byOperation([...selectedSet.worktree, ...proposals.worktree]))
  const worktreeOutcomes = yield* Effect.forEach(worktreeCandidates, (authorization) =>
    isCleanupEligibleDisposition(authorization.disposition)
      ? runWorktreeCleanup(authorization)
      : Effect.succeed(WorktreeCleanupOutcome.cases.Preserved.make({ authorization, reason: "ineligible disposition" }))
  )

  selectedSet = selectCleanupResponsibilitySet(yield* journal.read(runId))
  const branchCandidates = bounded(byOperation([...selectedSet.branch, ...proposals.branch]))
  const branchOutcomes = yield* Effect.forEach(branchCandidates, (authorization) =>
    isCleanupEligibleDisposition(authorization.disposition)
      ? runBranchCleanup(authorization)
      : Effect.succeed(BranchCleanupOutcome.cases.Preserved.make({ authorization, reason: "ineligible disposition" }))
  )

  selectedSet = selectCleanupResponsibilitySet(yield* journal.read(runId))
  const candidateCandidates = bounded(byOperation([...selectedSet.candidate, ...proposals.candidate]))
  const candidateOutcomes = yield* Effect.forEach(candidateCandidates, (authorization) =>
    isCleanupEligibleDisposition(authorization.disposition)
      ? runIntegratorCandidateCleanup(authorization)
      : Effect.succeed(
          IntegratorCandidateCleanupOutcome.cases.Preserved.make({ authorization, reason: "ineligible disposition" })
        )
  )

  const selected = {
    branch: selectedSet.branch[0],
    candidate: selectedSet.candidate[0],
    worktree: selectedSet.worktree[0]
  }
  return {
    branch: branchOutcomes[0],
    candidate: candidateOutcomes[0],
    selected,
    worktree: worktreeOutcomes[0],
    branchOutcomes,
    candidateOutcomes,
    worktreeOutcomes
  } satisfies DispositionCleanupLoopResult
})

/**
 * Ordinary Run activation entry point. It has no boundary capability and
 * therefore only reconstructs the bounded, journal-derived set. The ordinary
 * composition supplies that set to `runDispositionCleanupLoop`, which is the
 * shared execution path used by controlled cassettes and production callers.
 */
export const activateDispositionCleanup = Effect.fn("DispositionCleanup.activate")(function* (runId: RunId) {
  const journal = yield* InRunJournal
  return selectCleanupResponsibilitySet(yield* journal.read(runId))
})
