/**
 * The journal event alphabet of ../JOURNAL-EVENTS.md and the pure fold of
 * I15, reconstructing the L2 state alphabet of ../MODEL.md from an event
 * stream.
 *
 * Design decisions taken here, each traceable to ../JOURNAL-EVENTS.md:
 *
 * - No crash event. A crash is a truncated prefix, so `fold` never sees one;
 *   recovery IS `fold` (plus `foldFrom` for the resume-from-prefix shape).
 * - Intent precedes an ambiguous effect. Claim, worktree and promotion each
 *   split into an intent action plus an outcome occurrence. The fold applies
 *   an intent optimistically (a crash between intent and outcome must not
 *   silently lose the obligation — that is what the intent is journaled FOR)
 *   and lets the outcome occurrence reconcile: a claim record read carrying
 *   our exact token confirms the claim, any other token refutes it and the
 *   region reverts to NoObligation; a promotion outcome at a non-captured
 *   head is a failed compare-and-set and the task stays Integrating.
 * - Invalid in the current state means FAIL CLOSED, not throw. The design's
 *   Proposition 3 says "structurally invalid shared history fails the Run
 *   closed", and I15 requires the fold "total over contradictory histories",
 *   so a contradiction is a value in the state, sticky and freezing what it
 *   owns: a task-local contradiction fails that task's region (the region
 *   stops evolving, everything else keeps folding); a shared-history
 *   contradiction fails the whole Run (the state stops evolving). Throwing
 *   would make prefix-totality a property of the harness rather than of the
 *   fold.
 * - Region vs shared. Every guard is split into a task-local part (reads
 *   only the ticket's own phase/attempt/pending fields, hence only the
 *   task's own event subsequence) and a shared part (reads capacity,
 *   positions, pause, target head, target resource, run lifecycle). That
 *   split is what makes Proposition 3 checkable: `foldRegion` replays a
 *   task's subsequence with only the task-local guards, and the property is
 *   that a live Run's regions are exactly the fold of their own
 *   subsequences. The design does not pin down which failures are regional
 *   and which fail the Run; this partition is the interpretation, documented
 *   in ./NOTES.md.
 * - The pending-intent flags (claimPending, worktreePending,
 *   promotionPending) are the fold's own reconciliation tracking. They are
 *   not in MODEL.md's state alphabet because the shared benchmark has no
 *   claim, worktree or promotion entity; without them an outcome without a
 *   preceding intent could not be recognised as a contradiction.
 * - Events wider than the model (worktree pair, eligibility pair, claim
 *   release, Run lifecycle) are guarded structurally but are state-neutral
 *   with respect to the MODEL.md fields, because the benchmark has nothing
 *   for them to update. DirectionApplied carries a subject but pause is
 *   run-level in MODEL.md, so its effect is run-level.
 * - The two history flags of MODEL.md (admissionRespectedCeiling,
 *   promotedFromExactHead) are reconstructed for shape parity. Here they are
 *   definitional: an over-ceiling admission or a promotion not at the
 *   current target head is a shared contradiction and fails the Run, so the
 *   flags can only read true. ./NOTES.md says so rather than letting them
 *   pass as results.
 *
 * Mutants (the `mutant` argument, same discipline as ./model.mjs):
 *   1  an invalid event THROWS instead of failing closed  (breaks P1)
 *   2  foldFrom drops held positions on entry             (breaks P2)
 *   3  a regional contradiction poisons the whole Run     (breaks P3)
 * The nondeterminism mutant lives in ./journal-mutants.mjs so this file
 * stays free of wall-clock and entropy reads (P4 greps this file's source).
 */

export const TASKS = [0, 1]
export const MAX_CAPACITY = 2
export const MAX_HEAD = 4

export const REASONS = ["CorrectionLimitExhausted", "ContinuationLimitExhausted", "StaleTargetHead"]
export const INELIGIBILITY = ["MissingFromTargetClosure", "NotOpen", "PrerequisitesUnsatisfied"]

export const PHASES = [
  "NoObligation",
  "Claimed",
  "Planned",
  "Executing",
  "SuspensionRequested",
  "Suspended",
  "Accepted",
  "Integrating",
  "Promoted",
  "Abandoned",
  "Settled"
]

const HOLDS_POSITION = new Set(["Executing", "SuspensionRequested"])

// ------------------------------------------------------------------- alphabet

const action = (tag, fields) => ({ kind: "action", tag, ...fields })
const occurrence = (tag, fields) => ({ kind: "occurrence", tag, ...fields })

/** The 23 events of ../JOURNAL-EVENTS.md, with the action/occurrence split. */
export const E = {
  // Actions
  ClaimIntentRecorded: (task, token) => action("ClaimIntentRecorded", { task, token }),
  ClaimReleaseIntentRecorded: (task, token) => action("ClaimReleaseIntentRecorded", { task, token }),
  AttemptPlanned: (task, runId, attemptId) => action("AttemptPlanned", { task, runId, attemptId }),
  WorkAdmitted: (task, attemptId) => action("WorkAdmitted", { task, attemptId }),
  SuspensionRequested: (task, attemptId) => action("SuspensionRequested", { task, attemptId }),
  ResumeRequested: (task, attemptId) => action("ResumeRequested", { task, attemptId }),
  WorktreeIntentRecorded: (task, attemptId) => action("WorktreeIntentRecorded", { task, attemptId }),
  IntegrationSessionOpened: (task, expectedHead) => action("IntegrationSessionOpened", { task, expectedHead }),
  PromotionIntentRecorded: (task, expectedHead) => action("PromotionIntentRecorded", { task, expectedHead }),
  CandidateConstructionNonConvergent: (task, reason) => action("CandidateConstructionNonConvergent", { task, reason }),
  DeliverySettled: (task) => action("DeliverySettled", { task }),
  WorkflowRunBegun: (runId, target) => action("WorkflowRunBegun", { runId, target }),
  WorkflowRunTerminated: (runId) => action("WorkflowRunTerminated", { runId }),
  CapacityRevised: (capacity) => action("CapacityRevised", { capacity }),
  DirectionApplied: (subject, direction) => action("DirectionApplied", { subject, direction }),
  // Non-action occurrences
  TrackerFactsObserved: (subjects, facts, complete, contentIdentity) =>
    occurrence("TrackerFactsObserved", { subjects, facts, complete, contentIdentity }),
  ClaimRecordRead: (task, owner, token) => occurrence("ClaimRecordRead", { task, owner, token }),
  ClaimedTaskEligibilityObserved: (task, revision) => occurrence("ClaimedTaskEligibilityObserved", { task, revision }),
  ClaimedTaskIneligible: (task, reason) => occurrence("ClaimedTaskIneligible", { task, reason }),
  WorktreeReconciliationObserved: (task, attemptId, outcome) =>
    occurrence("WorktreeReconciliationObserved", { task, attemptId, outcome }),
  ExecutorReported: (task, attemptId, report) => occurrence("ExecutorReported", { task, attemptId, report }),
  PromotionOutcomeObserved: (task, head) => occurrence("PromotionOutcomeObserved", { task, head }),
  TargetHeadObserved: (head) => occurrence("TargetHeadObserved", { head })
}

export const EVENT_TAGS = Object.keys(E)

// --------------------------------------------------------------------- state

const initialTicket = () => ({
  phase: "NoObligation",
  attempts: 0,
  present: false,
  open: false,
  expectedHead: 0,
  // Fold-internal region fields, beyond MODEL.md: reconciliation tracking
  // for the intent/outcome pairs, and I18's exact stated retention reason.
  attemptId: null,
  runId: null,
  claimToken: null,
  claimPending: false,
  worktreePending: false,
  promotionPending: false,
  retentionReason: null,
  failed: null
})

export const initialState = () => ({
  tickets: Object.fromEntries(TASKS.map((id) => [id, initialTicket()])),
  capacity: 1,
  positions: [],
  paused: false,
  targetResource: [],
  targetHead: 0,
  runBegun: false,
  runId: null,
  runTarget: null,
  runTerminated: false,
  runFailed: null,
  // contentIdentity -> canonical contents, so the same logical read identity
  // carrying two different contents is a shared contradiction.
  seenObservations: {},
  // MODEL.md history flags, definitional here (see header).
  admissionRespectedCeiling: true,
  promotedFromExactHead: true,
  crashed: false
})

/** The per-task projection Proposition 3 quantifies over. */
export const regionOf = (state, task) => {
  const t = state.tickets[task]
  return {
    phase: t.phase,
    attempts: t.attempts,
    expectedHead: t.expectedHead,
    attemptId: t.attemptId,
    runId: t.runId,
    claimToken: t.claimToken,
    claimPending: t.claimPending,
    worktreePending: t.worktreePending,
    promotionPending: t.promotionPending,
    retentionReason: t.retentionReason,
    failed: t.failed
  }
}

// ---------------------------------------------------------------------- fold

const eligibleOf = (state) => TASKS.filter((id) => state.tickets[id].present && state.tickets[id].open)

const selected = (state, task) => {
  const eligible = eligibleOf(state)
  if (!eligible.includes(task)) return false
  const rank = eligible.filter((other) => other < task).length
  return rank < state.capacity
}

const failRun = (state, reason) => {
  const next = structuredClone(state)
  next.runFailed = { origin: "shared", reason }
  return next
}

const failRegion = (state, task, reason, mutant) => {
  const next = structuredClone(state)
  next.tickets[task].failed = reason
  if (mutant === 3) next.runFailed = { origin: "region", reason: `task ${task}: ${reason}` }
  return next
}

const correlates = (ticket, event) => ticket.attemptId !== null && ticket.attemptId === event.attemptId

const observationKey = (event) =>
  JSON.stringify({ subjects: event.subjects, facts: event.facts, complete: event.complete })

/**
 * One event applied to one state. `checkShared: false` is the region
 * projection of Proposition 3: only task-local guards are evaluated, which
 * is what "xs restricted to region A" means operationally.
 */
const step = (state, event, mutant, checkShared) => {
  if (state.runFailed !== null) return state
  if (state.runTerminated) return close(state, null, "shared", `event ${event.tag} after WorkflowRunTerminated`, mutant)

  const task = event.task
  const ticket = task !== undefined ? state.tickets[task] : null
  if (ticket === undefined) return close(state, null, "shared", `event ${event.tag} names unknown task ${task}`, mutant)

  // local(ticket): task-local guard. shared(state): shared-history guard.
  // apply(next): the state update on a fresh clone.
  const local = (predicate, reason) => {
    if (ticket.failed !== null) return "skip"
    return predicate(ticket) ? "ok" : reason
  }
  const shared = (predicate, reason) => (predicate(state) ? "ok" : reason)
  const run = (localResult, sharedResult, apply) => {
    if (localResult === "skip") return state
    if (localResult !== "ok") return close(state, task, "region", `${event.tag}: ${localResult}`, mutant)
    if (checkShared && sharedResult !== "ok") return close(state, null, "shared", `${event.tag}: ${sharedResult}`, mutant)
    const next = structuredClone(state)
    apply(next)
    return next
  }

  switch (event.tag) {
    case "ClaimIntentRecorded":
      return run(
        local((t) => t.phase === "NoObligation", "claim intent while obligation exists"),
        shared((s) => selected(s, task), "claim intent for a task outside the current selection"),
        (next) => {
          next.tickets[task].phase = "Claimed"
          next.tickets[task].claimToken = event.token
          next.tickets[task].claimPending = true
        }
      )
    case "ClaimReleaseIntentRecorded":
      return run(
        local((t) => t.phase === "Claimed" && t.claimToken === event.token, "release naming a token that is not the current claim"),
        shared(() => true),
        (next) => {
          next.tickets[task].phase = "NoObligation"
          next.tickets[task].claimToken = null
          next.tickets[task].claimPending = false
        }
      )
    case "ClaimRecordRead":
      return run(
        local(
          (t) => t.claimPending && (event.token === t.claimToken || t.phase === "Claimed"),
          "claim record read with no unresolved intent, or refuting a claim already built upon"
        ),
        shared(() => true),
        (next) => {
          if (event.token === next.tickets[task].claimToken) {
            next.tickets[task].claimPending = false
          } else {
            // The reread refutes the intent while the task is still only
            // Claimed: the ambiguous write did not land, and the region
            // reverts. A refutation after downstream progress is a
            // contradiction and fails the region in the guard above.
            next.tickets[task].phase = "NoObligation"
            next.tickets[task].claimToken = null
            next.tickets[task].claimPending = false
          }
        }
      )
    case "ClaimedTaskEligibilityObserved":
      return run(
        local((t) => t.phase === "Claimed", "eligibility observation for a task not Claimed"),
        shared(() => true),
        () => {}
      )
    case "ClaimedTaskIneligible":
      return run(
        local(
          (t) => t.phase === "Claimed" && INELIGIBILITY.includes(event.reason),
          "ineligibility observation for a task not Claimed, or a reason outside the alphabet"
        ),
        shared(() => true),
        () => {}
      )
    case "AttemptPlanned":
      return run(
        local((t) => t.phase === "Claimed" && t.attempts === 0, "attempt planned without a claim, or a second attempt (I10)"),
        shared((s) => !s.runBegun || s.runId === event.runId, "attempt planned under a runId that is not this run"),
        (next) => {
          next.tickets[task].phase = "Planned"
          next.tickets[task].attempts += 1
          next.tickets[task].attemptId = event.attemptId
          next.tickets[task].runId = event.runId
        }
      )
    case "WorkAdmitted":
      return run(
        local((t) => t.phase === "Planned" && correlates(t, event), "admission without a planned, correlating attempt"),
        shared((s) => !s.paused && s.positions.length < s.capacity, "admission under a pause or over the capacity ceiling"),
        (next) => {
          next.tickets[task].phase = "Executing"
          next.positions = [...next.positions, task]
          next.admissionRespectedCeiling = next.admissionRespectedCeiling && next.positions.length <= next.capacity
        }
      )
    case "SuspensionRequested":
      return run(
        local((t) => t.phase === "Executing" && correlates(t, event), "suspension requested for a task not Executing"),
        shared(() => true),
        (next) => {
          next.tickets[task].phase = "SuspensionRequested"
        }
      )
    case "ResumeRequested":
      return run(
        local((t) => t.phase === "Suspended" && correlates(t, event), "resume requested for a task not Suspended"),
        shared((s) => !s.paused && s.positions.length < s.capacity, "re-admission under a pause or over the capacity ceiling"),
        (next) => {
          next.tickets[task].phase = "Executing"
          next.positions = [...next.positions, task]
          next.admissionRespectedCeiling = next.admissionRespectedCeiling && next.positions.length <= next.capacity
        }
      )
    case "WorktreeIntentRecorded":
      return run(
        local(
          (t) => t.phase === "Planned" && correlates(t, event) && !t.worktreePending,
          "worktree intent without a planned attempt, or a second intent (I16)"
        ),
        shared(() => true),
        (next) => {
          next.tickets[task].worktreePending = true
        }
      )
    case "WorktreeReconciliationObserved":
      return run(
        local((t) => t.worktreePending && correlates(t, event), "worktree reconciliation with no unresolved intent"),
        shared(() => true),
        (next) => {
          next.tickets[task].worktreePending = false
        }
      )
    case "ExecutorReported": {
      const report = event.report
      if (report.kind === "Running") {
        return run(
          local(
            (t) => (t.phase === "Executing" || t.phase === "SuspensionRequested") && correlates(t, event),
            "running report for a task without work in flight"
          ),
          shared(() => true),
          () => {}
        )
      }
      if (report.kind === "SafelySuspended") {
        return run(
          local((t) => t.phase === "SuspensionRequested" && correlates(t, event), "safe suspension without a suspension request"),
          shared(() => true),
          (next) => {
            next.tickets[task].phase = "Suspended"
            next.positions = next.positions.filter((held) => held !== task)
          }
        )
      }
      return run(
        local((t) => t.phase === "Executing" && correlates(t, event), "terminal report for a task not Executing"),
        shared(() => true),
        (next) => {
          next.tickets[task].phase = "Accepted"
          next.positions = next.positions.filter((held) => held !== task)
        }
      )
    }
    case "IntegrationSessionOpened":
      return run(
        local((t) => t.phase === "Accepted", "integration session without an accepted result"),
        shared(
          (s) => s.targetResource.length === 0 && event.expectedHead === s.targetHead,
          "integration session over a held target resource or a head that is not the current target head"
        ),
        (next) => {
          next.tickets[task].phase = "Integrating"
          next.tickets[task].expectedHead = event.expectedHead
          next.targetResource = [task]
        }
      )
    case "PromotionIntentRecorded":
      return run(
        local(
          (t) => t.phase === "Integrating" && t.expectedHead === event.expectedHead && !t.promotionPending,
          "promotion intent without an open session, a mismatched captured head, or a second intent"
        ),
        shared(() => true),
        (next) => {
          next.tickets[task].promotionPending = true
        }
      )
    case "PromotionOutcomeObserved":
      return run(
        local((t) => t.phase === "Integrating" && t.promotionPending, "promotion outcome with no unresolved intent"),
        shared(
          (s) =>
            event.head !== s.tickets[task].expectedHead || (event.head === s.targetHead && s.targetHead < MAX_HEAD),
          "promotion landed at a head that is not the current target head (I13)"
        ),
        (next) => {
          next.tickets[task].promotionPending = false
          if (event.head === next.tickets[task].expectedHead) {
            next.tickets[task].phase = "Promoted"
            next.promotedFromExactHead = next.promotedFromExactHead && event.head === state.targetHead
            next.targetHead = next.targetHead + 1
            next.targetResource = []
          }
          // head !== expectedHead: a failed compare-and-set, legitimately
          // journaled. The task stays Integrating and keeps the resource.
        }
      )
    case "CandidateConstructionNonConvergent":
      return run(
        local(
          (t) => t.phase === "Integrating" && REASONS.includes(event.reason),
          "non-convergence without an open session, or a reason outside the nonempty Reason type"
        ),
        shared(
          (s) => event.reason !== "StaleTargetHead" || s.tickets[task].expectedHead !== s.targetHead,
          "StaleTargetHead recorded while the captured head is still current"
        ),
        (next) => {
          next.tickets[task].phase = "Abandoned"
          next.tickets[task].retentionReason = event.reason
          next.targetResource = next.targetResource.filter((held) => held !== task)
        }
      )
    case "DeliverySettled":
      return run(
        local((t) => t.phase === "Promoted", "settlement without a promotion"),
        shared(() => true),
        (next) => {
          next.tickets[task].phase = "Settled"
        }
      )
    case "TrackerFactsObserved": {
      const seen = state.seenObservations[event.contentIdentity]
      return runShared(state, event, mutant, checkShared, {
        guard: seen === undefined || seen === observationKey(event),
        reason: "the same logical read identity carrying two different contents",
        apply: (next) => {
          next.seenObservations[event.contentIdentity] = observationKey(event)
          for (const fact of event.facts) {
            if (TASKS.includes(fact.subject)) {
              next.tickets[fact.subject].present = fact.present
              next.tickets[fact.subject].open = fact.open
            }
          }
          if (event.complete) {
            // A complete observation proves unlisted subjects absent; an
            // incomplete one says nothing about them.
            for (const id of TASKS) {
              if (!event.subjects.includes(id)) {
                next.tickets[id].present = false
                next.tickets[id].open = false
              }
            }
          }
        }
      })
    }
    case "TargetHeadObserved":
      return runShared(state, event, mutant, checkShared, {
        guard: event.head === state.targetHead + 1 && event.head <= MAX_HEAD,
        reason: "target head observation that is not exactly the next head",
        apply: (next) => {
          next.targetHead = event.head
        }
      })
    case "CapacityRevised":
      return runShared(state, event, mutant, checkShared, {
        guard: Number.isInteger(event.capacity) && event.capacity >= 0 && event.capacity <= MAX_CAPACITY && event.capacity !== state.capacity,
        reason: "capacity revision outside 0..2 or to the current capacity",
        apply: (next) => {
          next.capacity = event.capacity
        }
      })
    case "DirectionApplied":
      return runShared(state, event, mutant, checkShared, {
        guard: event.direction === "Pause" ? !state.paused : event.direction === "Unpause" ? state.paused : false,
        reason: "pause direction that does not change the current pause state",
        apply: (next) => {
          next.paused = event.direction === "Pause"
        }
      })
    case "WorkflowRunBegun":
      return runShared(state, event, mutant, checkShared, {
        guard: !state.runBegun,
        reason: "a second WorkflowRunBegun",
        apply: (next) => {
          next.runBegun = true
          next.runId = event.runId
          next.runTarget = event.target
        }
      })
    case "WorkflowRunTerminated":
      return runShared(state, event, mutant, checkShared, {
        guard: state.runBegun && !state.runTerminated && state.runId === event.runId,
        reason: "termination without a begun run, or under a different runId",
        apply: (next) => {
          next.runTerminated = true
        }
      })
    default:
      return close(state, null, "shared", `event tag outside the alphabet: ${String(event.tag)}`, mutant)
  }
}

const runShared = (state, event, mutant, checkShared, { guard, reason, apply }) => {
  if (checkShared && !guard) return close(state, null, "shared", `${event.tag}: ${reason}`, mutant)
  const next = structuredClone(state)
  apply(next)
  return next
}

const close = (state, task, origin, reason, mutant) => {
  if (mutant === 1) throw new Error(`invalid event fails open: ${reason}`)
  if (origin === "region") return failRegion(state, task, reason, mutant)
  return failRun(state, reason)
}

/** I15's reduction: a pure fold of the retained journal, from the origin. */
export const fold = (events, mutant = 0) => foldFrom(initialState(), events, mutant)

/** Crash-recovery correctness: resume the fold from a reconstructed state. */
export const foldFrom = (state, events, mutant = 0) => {
  let current = structuredClone(state)
  if (mutant === 2) current.positions = []
  for (const event of events) current = step(current, event, mutant, true)
  return current
}

/**
 * "xs restricted to region A", operationalised: fold only A's own events,
 * evaluating only the task-local guards, and return the region projection.
 */
export const foldRegion = (task, events) => {
  let current = initialState()
  for (const event of events) {
    if (event.task !== task) continue
    current = step(current, event, 0, false)
  }
  return regionOf(current, task)
}
