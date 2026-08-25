import { Context, Effect, Option, Schema } from "effect"
import type { RunId } from "@dalph/contracts"
import type { CoordinatorOwnershipError } from "../../../authorities/coordinator-ownership/ownership.js"
import type { OperationId } from "../../identity.js"
import { JournalRecord, type JournalAppendError, type JournalReadError } from "../../../workflow-journal/store.js"
import { InRunJournal } from "../../../workflow-journal/in-run-journal.js"
import {
  isCleanupEligibleDisposition,
  type BranchCleanupAuthorization,
  type IntegratorCandidateCleanupEvidenceSubject,
  type IntegratorCandidateCleanupEvidenceRevision,
  type IntegratorCandidateCleanupAuthorization,
  type WorktreeCleanupAuthorization,
  branchCleanupAuthorizationEquals,
  cleanupMutationRequestLimit,
  integratorCandidateCleanupAuthorizationEquals,
  worktreeCleanupAuthorizationEquals
} from "./disposition.js"
import {
  BranchCleanupAuthorizedEvent,
  BranchCleanupBoundary,
  BranchCleanupOutcome,
  runBranchCleanup
} from "./branch.js"
import {
  IntegratorCandidateCleanupAuthorizedEvent,
  IntegratorCandidateCleanupBoundary,
  IntegratorCandidateCleanupOutcome,
  runIntegratorCandidateCleanup
} from "./integrator-candidate.js"
import {
  WorktreeCleanupAuthorizedEvent,
  WorktreeCleanupBoundary,
  WorktreeCleanupOutcome,
  runWorktreeCleanup
} from "./worktree.js"
import {
  validateBranchCleanupHistory,
  validateIntegratorCandidateCleanupHistory,
  validateIntegratorCandidateCleanupProvenance,
  validateWorktreeCleanupHistory,
  validateWorktreeCleanupProvenance,
  validateSettledWorktreeForBranch
} from "./provenance.js"
import { WorkflowActor } from "../../registry/actor.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  candidateCleanupEvidenceSubjects,
  cleanupAuthorizationKey,
  deriveCleanupAuthorizations,
  type CandidateCleanupEvidenceRevisionFor
} from "./activation.js"

type CandidateEvidenceRevisionReader = (
  subject: IntegratorCandidateCleanupEvidenceSubject
) => Effect.Effect<IntegratorCandidateCleanupEvidenceRevision, unknown>

const candidateEvidenceKey = (subject: IntegratorCandidateCleanupEvidenceSubject): string =>
  `${subject.predecessor.sessionId}:${subject.locator}`

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
  /** Executes the same bounded protocol loop used by controlled compositions. */
  readonly run: Effect.Effect<
    DispositionCleanupLoopResult,
    JournalAppendError | JournalReadError | CoordinatorOwnershipError
  >
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
  authorizationOf: (event: JournalRecord["event"]) => Authorization | undefined,
  validate: (authorization: Authorization) => boolean
): ReadonlyArray<Authorization> =>
  records
    .toSorted((left, right) => Number(left.position) - Number(right.position))
    .map((record) => authorizationOf(record.event))
    .filter((authorization): authorization is Authorization => authorization !== undefined && validate(authorization))
    .reduce<ReadonlyArray<Authorization>>(
      (selected, authorization) =>
        selected.some((candidate) => candidate.operationId === authorization.operationId)
          ? /* v8 ignore next -- @preserve Each selected authorization validates against the complete family history, whose duplicate-authorization check rejects a repeated operation before reduction. */ selected
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

const hasTerminalCleanupEvent = (
  records: ReadonlyArray<JournalRecord>,
  authorization: BranchCleanupAuthorization | IntegratorCandidateCleanupAuthorization | WorktreeCleanupAuthorization
): boolean =>
  records.some((record) => {
    if (record.event._tag === "WorktreeCleanupSettled" || record.event._tag === "WorktreeCleanupContradicted") {
      if (!("expectedHead" in authorization) || "worktreeCleanupOperationId" in authorization) return false
      return (
        record.event.authorization.operationId === authorization.operationId &&
        worktreeCleanupAuthorizationEquals(record.event.authorization, authorization)
      )
    }
    if (record.event._tag === "BranchCleanupSettled" || record.event._tag === "BranchCleanupContradicted") {
      if (!("worktreeCleanupOperationId" in authorization)) return false
      return (
        record.event.authorization.operationId === authorization.operationId &&
        branchCleanupAuthorizationEquals(record.event.authorization, authorization)
      )
    }
    if (
      record.event._tag === "IntegratorCandidateCleanupSettled" ||
      record.event._tag === "IntegratorCandidateCleanupContradicted"
    ) {
      if ("expectedHead" in authorization || "worktreeCleanupOperationId" in authorization) return false
      return (
        record.event.authorization.operationId === authorization.operationId &&
        integratorCandidateCleanupAuthorizationEquals(record.event.authorization, authorization)
      )
    }
    return false
  })

/** Count only mutation intents for the exact authorized subject and operation. */
const mutationAttemptCount = (
  records: ReadonlyArray<JournalRecord>,
  authorization: BranchCleanupAuthorization | IntegratorCandidateCleanupAuthorization | WorktreeCleanupAuthorization
): number =>
  records.filter((record) => {
    if (record.event._tag === "WorktreeCleanupMutationIntended") {
      return (
        "expectedHead" in authorization &&
        !("worktreeCleanupOperationId" in authorization) &&
        record.event.authorization.operationId === authorization.operationId &&
        worktreeCleanupAuthorizationEquals(record.event.authorization, authorization)
      )
    }
    if (record.event._tag === "BranchCleanupMutationIntended") {
      return (
        "worktreeCleanupOperationId" in authorization &&
        record.event.authorization.operationId === authorization.operationId &&
        branchCleanupAuthorizationEquals(record.event.authorization, authorization)
      )
    }
    if (record.event._tag === "IntegratorCandidateCleanupMutationIntended") {
      return (
        !("expectedHead" in authorization) &&
        !("worktreeCleanupOperationId" in authorization) &&
        record.event.authorization.operationId === authorization.operationId &&
        integratorCandidateCleanupAuthorizationEquals(record.event.authorization, authorization)
      )
    }
    return false
  }).length

const hasMutationBudget = (
  records: ReadonlyArray<JournalRecord>,
  authorization: BranchCleanupAuthorization | IntegratorCandidateCleanupAuthorization | WorktreeCleanupAuthorization
): boolean => mutationAttemptCount(records, authorization) < cleanupMutationRequestLimit

const validWorktree = (records: ReadonlyArray<JournalRecord>, authorization: WorktreeCleanupAuthorization): boolean =>
  validateWorktreeCleanupProvenance(records, authorization)._tag === "Valid" &&
  validateWorktreeCleanupHistory(records, authorization)._tag === "Valid"

const validBranch = (records: ReadonlyArray<JournalRecord>, authorization: BranchCleanupAuthorization): boolean =>
  validateWorktreeCleanupProvenance(records, authorization)._tag === "Valid" &&
  validateSettledWorktreeForBranch(records, authorization)._tag === "Valid" &&
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
  records: ReadonlyArray<unknown>,
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
  records: ReadonlyArray<unknown>
): DispositionCleanupResponsibilitySet => {
  const journalRecords = records.filter((record): record is JournalRecord => Schema.is(JournalRecord)(record))
  return {
    branch: bounded(
      familyAuthorizations(
        journalRecords,
        (event) => (Schema.is(BranchCleanupAuthorizedEvent)(event) ? event.authorization : undefined),
        (authorization) => validBranch(journalRecords, authorization)
      ).filter(
        (authorization) =>
          !hasTerminalCleanupEvent(journalRecords, authorization) && hasMutationBudget(journalRecords, authorization)
      )
    ),
    candidate: bounded(
      familyAuthorizations(
        journalRecords,
        (event) => (Schema.is(IntegratorCandidateCleanupAuthorizedEvent)(event) ? event.authorization : undefined),
        (authorization) => validCandidate(journalRecords, authorization)
      ).filter(
        (authorization) =>
          !hasTerminalCleanupEvent(journalRecords, authorization) && hasMutationBudget(journalRecords, authorization)
      )
    ),
    worktree: bounded(
      familyAuthorizations(
        journalRecords,
        (event) => (Schema.is(WorktreeCleanupAuthorizedEvent)(event) ? event.authorization : undefined),
        (authorization) => validWorktree(journalRecords, authorization)
      ).filter(
        (authorization) =>
          !hasTerminalCleanupEvent(journalRecords, authorization) && hasMutationBudget(journalRecords, authorization)
      )
    )
  }
}

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
  yield* appendDerivedCleanupAuthorizations(runId, ["worktree", "candidate"])
  const initialRecords = yield* journal.read(runId)
  let selectedSet = selectCleanupResponsibilitySet(initialRecords)
  const scopedProposals = {
    branch: proposals.branch.filter((authorization) => authorization.disposition.plannedAttempt.runId === runId),
    candidate: proposals.candidate.filter(
      (authorization) => authorization.disposition.predecessor.plannedAttempt.runId === runId
    ),
    worktree: proposals.worktree.filter((authorization) => authorization.disposition.plannedAttempt.runId === runId)
  } satisfies DispositionCleanupProposals
  const worktreeCandidates = bounded(
    byOperation([...selectedSet.worktree, ...scopedProposals.worktree]).filter((authorization) =>
      hasMutationBudget(initialRecords, authorization)
    )
  )
  const worktreeOutcomes = yield* Effect.forEach(worktreeCandidates, (authorization) =>
    isCleanupEligibleDisposition(authorization.disposition)
      ? runWorktreeCleanup(authorization)
      : Effect.succeed(WorktreeCleanupOutcome.cases.Preserved.make({ authorization, reason: "ineligible disposition" }))
  )

  yield* appendDerivedCleanupAuthorizations(runId, ["branch"])
  selectedSet = selectCleanupResponsibilitySet(yield* journal.read(runId))
  const branchRecords = yield* journal.read(runId)
  const branchCandidates = bounded(
    byOperation([...selectedSet.branch, ...scopedProposals.branch]).filter((authorization) =>
      hasMutationBudget(branchRecords, authorization)
    )
  )
  const branchOutcomes = yield* Effect.forEach(branchCandidates, (authorization) =>
    isCleanupEligibleDisposition(authorization.disposition)
      ? runBranchCleanup(authorization)
      : Effect.succeed(BranchCleanupOutcome.cases.Preserved.make({ authorization, reason: "ineligible disposition" }))
  )

  selectedSet = selectCleanupResponsibilitySet(yield* journal.read(runId))
  const candidateRecords = yield* journal.read(runId)
  const candidateCandidates = bounded(
    byOperation([...selectedSet.candidate, ...scopedProposals.candidate]).filter((authorization) =>
      hasMutationBudget(candidateRecords, authorization)
    )
  )
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
export const activateDispositionCleanup = Effect.fn("DispositionCleanup.activate")(function* (
  runId: RunId,
  readEvidenceRevision?: CandidateEvidenceRevisionReader
) {
  // A settled worktree is the durable predecessor for branch cleanup.  Keeping
  // this in the same ordinary activation pass means a resumed Run can derive
  // the branch authorization without a caller supplying one; the loop will
  // execute it only when the settlement is already present.
  yield* appendDerivedCleanupAuthorizations(runId, ["worktree", "branch", "candidate"], readEvidenceRevision)
  const journal = yield* InRunJournal
  return selectCleanupResponsibilitySet(yield* journal.read(runId))
})

/**
 * Installs ordinary Run activation as a complete capability: terminal facts
 * are reconstructed and authorized before the caller receives it, and the
 * captured boundary services execute the same loop that controlled runs use.
 */
export const makeDispositionCleanupActivation = Effect.fn("DispositionCleanup.makeActivation")(function* (
  runId: RunId
) {
  const journal = yield* InRunJournal
  const worktreeBoundary = yield* WorktreeCleanupBoundary
  const branchBoundary = yield* BranchCleanupBoundary
  const candidateBoundary = yield* IntegratorCandidateCleanupBoundary
  const readEvidenceRevision =
    candidateBoundary.readEvidenceRevision ?? (() => Effect.fail("candidate evidence is unavailable"))
  const responsibilities = yield* activateDispositionCleanup(runId, readEvidenceRevision)
  const run = runDispositionCleanupLoop(runId).pipe(
    Effect.provideService(InRunJournal, journal),
    Effect.provideService(WorktreeCleanupBoundary, worktreeBoundary),
    Effect.provideService(BranchCleanupBoundary, branchBoundary),
    Effect.provideService(IntegratorCandidateCleanupBoundary, candidateBoundary)
  )
  return { responsibilities, run } satisfies DispositionCleanupActivationService
})

/**
 * Appends only canonical, validated authorizations. A same-key existing row is
 * never overwritten: a contradiction remains preserved for reconstruction.
 */
export const appendDerivedCleanupAuthorizations = Effect.fn("DispositionCleanup.appendDerivedAuthorizations")(
  function* (
    runId: RunId,
    families: ReadonlyArray<"branch" | "candidate" | "worktree">,
    readEvidenceRevision?: CandidateEvidenceRevisionReader
  ) {
    const journal = yield* InRunJournal
    let records = yield* journal.read(runId)
    const evidenceSubjects =
      families.includes("candidate") && readEvidenceRevision !== undefined
        ? candidateCleanupEvidenceSubjects(records)
        : []
    const evidencePairs =
      readEvidenceRevision === undefined
        ? []
        : yield* Effect.forEach(evidenceSubjects, (subject) =>
            readEvidenceRevision(subject).pipe(
              Effect.option,
              Effect.map((revision) =>
                Option.isSome(revision) ? ([candidateEvidenceKey(subject), revision.value] as const) : undefined
              )
            )
          )
    const evidenceRevisions = new Map(
      evidencePairs.filter(
        (pair): pair is readonly [string, IntegratorCandidateCleanupEvidenceRevision] => pair !== undefined
      )
    )
    const evidenceRevisionFor: CandidateCleanupEvidenceRevisionFor | undefined =
      readEvidenceRevision === undefined ? undefined : (subject) => evidenceRevisions.get(candidateEvidenceKey(subject))
    const derived = deriveCleanupAuthorizations(records, evidenceRevisionFor)
    const appendOne = Effect.fn("DispositionCleanup.appendOne")(function* (
      authorization: WorktreeCleanupAuthorization | BranchCleanupAuthorization | IntegratorCandidateCleanupAuthorization
    ) {
      const key = cleanupAuthorizationKey(authorization)
      if (records.some((record) => record.key === key)) return
      const event =
        "worktreeCleanupOperationId" in authorization
          ? BranchCleanupAuthorizedEvent.make({
              authorization,
              initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
              occurrenceClassification: "InitiatedAction",
              version: workflowJournalEventVersion
            })
          : "expectedHead" in authorization
            ? WorktreeCleanupAuthorizedEvent.make({
                authorization,
                initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
                occurrenceClassification: "InitiatedAction",
                version: workflowJournalEventVersion
              })
            : IntegratorCandidateCleanupAuthorizedEvent.make({
                authorization,
                initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
                occurrenceClassification: "InitiatedAction",
                version: workflowJournalEventVersion
              })
      yield* journal.append(runId, key, event)
      records = yield* journal.read(runId)
    })
    for (const family of families) {
      const authorizations = derived[family]
        .filter(
          (authorization) =>
            !hasTerminalCleanupEvent(records, authorization) && hasMutationBudget(records, authorization)
        )
        .slice(0, cleanupResponsibilitySelectionLimit)
      for (const authorization of authorizations) yield* appendOne(authorization)
    }
  }
)
