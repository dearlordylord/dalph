import { AttemptId, RunId } from "@dalph/contracts"
import { Chunk, Schema } from "effect"
import { latestPlannedAttemptExecutorEvidence } from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import type { ReconstructedRunState } from "../reconstruction/state.js"

/** The two process-local triggers that can request a refresh of Running work. */
export type ActiveWorkAuthorityRefreshSource = "TrackerNotification" | "Timer"

/** The ordinary process boundary that may select new work or continue accepted work. */
type OrdinaryRunEntry = { readonly _tag: "OrdinaryRunEntry" }

/** A pair is the authority subject; the rest of a planned attempt is not needed for selection. */
type ActiveWorkAuthorityRefreshSubject = Readonly<{ readonly attemptId: AttemptId; readonly runId: RunId }>
const ActiveWorkAuthorityRefreshSubject = Schema.Struct({ attemptId: AttemptId, runId: RunId })

const sameActiveWorkAuthorityRefreshSubject = (
  left: ActiveWorkAuthorityRefreshSubject,
  right: ActiveWorkAuthorityRefreshSubject
): boolean => left.runId === right.runId && left.attemptId === right.attemptId

const immutableActiveWorkAuthorityRefreshSubject = (
  subject: ActiveWorkAuthorityRefreshSubject
): ActiveWorkAuthorityRefreshSubject =>
  Object.freeze(ActiveWorkAuthorityRefreshSubject.make({ attemptId: subject.attemptId, runId: subject.runId }))

/**
 * The exact Running attempt pairs captured at one activation boundary. A
 * Chunk has no mutating collection methods; the owner also freezes each
 * authority value after schema construction, so later executor reports or
 * caller mutations cannot grant active-read authority retroactively. The
 * explicit uniqueness check preserves set semantics while Chunk preserves
 * the validated responsibility order for deterministic activation traces.
 */
const ActiveWorkAuthorityRefreshSubjects = Schema.Chunk(ActiveWorkAuthorityRefreshSubject)
  .check(
    Schema.makeFilter((subjects) => {
      const captured = [...subjects]
      return captured.every(
        (subject, index) =>
          captured.findIndex((candidate) => sameActiveWorkAuthorityRefreshSubject(candidate, subject)) === index
      )
        ? undefined
        : "the active-refresh subject set cannot contain duplicate RunId/AttemptId pairs"
    })
  )
  .pipe(Schema.brand("ActiveWorkAuthorityRefreshSubjects"))
type ActiveWorkAuthorityRefreshSubjects = typeof ActiveWorkAuthorityRefreshSubjects.Type

const freezeActiveWorkAuthorityRefreshSubjects = (
  subjects: ActiveWorkAuthorityRefreshSubjects
): ActiveWorkAuthorityRefreshSubjects => {
  for (const subject of subjects) Object.freeze(subject)
  return subjects
}

const makeActiveWorkAuthorityRefreshSubjects = (
  subjects: ReadonlyArray<ActiveWorkAuthorityRefreshSubject>
): ActiveWorkAuthorityRefreshSubjects =>
  freezeActiveWorkAuthorityRefreshSubjects(
    ActiveWorkAuthorityRefreshSubjects.make(
      Chunk.fromIterable(
        subjects
          .filter(
            (subject, index, candidates) =>
              candidates.findIndex((candidate) => sameActiveWorkAuthorityRefreshSubject(candidate, subject)) === index
          )
          .map(immutableActiveWorkAuthorityRefreshSubject)
      )
    )
  )

/**
 * Captures distinct exact RunId/AttemptId pairs in a fresh set. A separate
 * constructor keeps this process-local value immutable from the caller's
 * later collection changes and canonicalizes duplicate semantic subjects.
 */
export const activeWorkAuthorityRefreshSubjectsFor = makeActiveWorkAuthorityRefreshSubjects

/**
 * Selects every exact unfinished attempt whose latest executor evidence in a
 * validated journal prefix is `Running`. Responsibility reconstruction has
 * already removed historical and superseded plans; the evidence fold removes
 * safely suspended, terminal, and invalidated reports. The caller supplies
 * the prefix read at the activation boundary, so later publications cannot
 * enter this immutable subject set.
 */
export const activeWorkAuthorityRefreshSubjectsForRunState = (
  runState: Pick<ReconstructedRunState, "runId" | "responsibility" | "workflowHistory">
): ActiveWorkAuthorityRefreshSubjects =>
  activeWorkAuthorityRefreshSubjectsFor(
    runState.responsibility.entries.flatMap((entry) => {
      if (entry._tag !== "PlannedAttemptExecutorWorkResponsibility") return []
      const { plannedAttempt } = entry
      if (plannedAttempt.runId !== runState.runId) return []
      return latestPlannedAttemptExecutorEvidence(runState.workflowHistory.records, plannedAttempt)?.report._tag ===
        "ExecutorWorkExecuting"
        ? [{ runId: plannedAttempt.runId, attemptId: plannedAttempt.attemptId }]
        : []
    })
  )

/** Checks one planned attempt against the immutable activation subject set. */
export const activeWorkAuthorityRefreshSubjectsContain = (
  subjects: ActiveWorkAuthorityRefreshSubjects,
  plannedAttempt: ActiveWorkAuthorityRefreshSubject
): boolean => [...subjects].some((subject) => sameActiveWorkAuthorityRefreshSubject(subject, plannedAttempt))

/**
 * A tracker notification or timer is allowed to refresh authority for work
 * already proven `Running`; the brand prevents callers from manufacturing
 * that privilege by merely spelling the discriminant, source, and subjects.
 */
const ActiveWorkAuthorityRefresh = Schema.TaggedStruct("ActiveWorkAuthorityRefresh", {
  source: Schema.Literals(["TrackerNotification", "Timer"]),
  subjects: ActiveWorkAuthorityRefreshSubjects
}).pipe(Schema.brand("RunActivationActiveWorkAuthorityRefresh"))

type ActiveWorkAuthorityRefresh = typeof ActiveWorkAuthorityRefresh.Type

/** The external event that permits one ordinary entry or an owner-minted authority refresh. */
export type RunActivationOpportunity = OrdinaryRunEntry | ActiveWorkAuthorityRefresh

export const RunActivationOpportunity = {
  OrdinaryRunEntry: (): OrdinaryRunEntry => ({ _tag: "OrdinaryRunEntry" })
} as const

/**
 * Internal owner seam. The package surface exports only the ordinary
 * constructor; `RunReactivationOwner` is the sole production caller that
 * mints this branded opportunity.
 */
export const activeWorkAuthorityRefreshForOwner = (
  source: ActiveWorkAuthorityRefreshSource,
  subjects: ActiveWorkAuthorityRefreshSubjects
): ActiveWorkAuthorityRefresh => {
  const opportunity = ActiveWorkAuthorityRefresh.make({
    _tag: "ActiveWorkAuthorityRefresh",
    source,
    subjects: makeActiveWorkAuthorityRefreshSubjects([...subjects])
  })
  freezeActiveWorkAuthorityRefreshSubjects(opportunity.subjects)
  return Object.freeze(opportunity)
}
