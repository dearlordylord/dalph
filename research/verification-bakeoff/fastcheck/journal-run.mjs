/**
 * The I15 journal propositions of ../JOURNAL-EVENTS.md, checked against
 * ./journal.mjs.
 *
 *   node journal-run.mjs [--runs 3000] [--steps 50]
 *
 * Four clean properties, each paired with a witness or a negative control,
 * because a property that cannot fail proves nothing:
 *
 *   P1 prefix-totality   fold is defined on every prefix of an ARBITRARY
 *                        event sequence (a crash truncates anywhere), and
 *                        every intermediate state is well-formed. Witnessed
 *                        by non-trivial states actually being reached.
 *   P2 homomorphism      fold(p ++ q) === foldFrom(fold(p), q) for arbitrary
 *                        splits. Witnessed by splits landing between an
 *                        intent and its outcome -- the canonical hard case.
 *   P3 regional          a live Run's regions are exactly the fold of their
 *     contradiction      own subsequences; failures are attributed region or
 *                        shared; closed stays closed. Negative control:
 *                        mutant 3 poisons the Run from a region failure.
 *   P4 determinism       repeated folds agree, plus a static grep of
 *                        journal.mjs for wall-clock/entropy reads. Negative
 *                        control: ./journal-mutants.mjs commits that defect.
 *
 * Negative controls (mutant discipline of ../MUTANTS.md): each mutant must
 * be CAUGHT by its property, or this runner exits non-zero.
 */
import { readFileSync } from "node:fs"
import fc from "fast-check"
import {
  E,
  EVENT_TAGS,
  fold,
  foldFrom,
  foldRegion,
  INELIGIBILITY,
  initialState,
  MAX_CAPACITY,
  PHASES,
  regionOf,
  REASONS,
  TASKS
} from "./journal.mjs"
import { foldStamped } from "./journal-mutants.mjs"

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : Number(process.argv[index + 1])
}
const numRuns = arg("runs", 2000)
const maxSteps = arg("steps", 50)

// ------------------------------------------------------------------ helpers

const canon = (value) =>
  Array.isArray(value)
    ? `[${value.map(canon).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canon(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value)

const sameSet = (left, right) => {
  const l = [...left].sort((a, b) => a - b)
  const r = [...right].sort((a, b) => a - b)
  return l.length === r.length && l.every((value, index) => value === r[index])
}

const HOLDS_POSITION = new Set(["Executing", "SuspensionRequested"])

/** Structural well-formedness every prefix state must satisfy (P1). */
const checkShape = (state) => {
  for (const id of TASKS) {
    const t = state.tickets[id]
    if (!t) return `ticket ${id} missing`
    if (!PHASES.includes(t.phase)) return `ticket ${id} has phase ${t.phase}`
    if (t.attempts < 0 || t.attempts > 1) return `ticket ${id} attempts ${t.attempts}`
    if (t.failed !== null && typeof t.failed !== "string") return `ticket ${id} failed marker malformed`
  }
  if (!Number.isInteger(state.capacity) || state.capacity < 0 || state.capacity > MAX_CAPACITY)
    return `capacity ${state.capacity}`
  if (!Number.isInteger(state.targetHead) || state.targetHead < 0 || state.targetHead > 4)
    return `targetHead ${state.targetHead}`
  if (!sameSet(state.positions, TASKS.filter((id) => HOLDS_POSITION.has(state.tickets[id].phase))))
    return `positions ${state.positions} disagree with phases`
  if (!sameSet(state.targetResource, TASKS.filter((id) => state.tickets[id].phase === "Integrating")))
    return `target resource ${state.targetResource} disagrees with Integrating tickets`
  if (state.runFailed !== null && state.runFailed.origin !== "shared") return "run failure not attributed to shared history"
  return null
}

// --------------------------------------------------------------- generators

const taskArb = fc.constantFrom(...TASKS)
const tokenArb = fc.constantFrom(0, 1)
const idArb = fc.constantFrom(0, 1)
const reasonArb = fc.constantFrom(...REASONS)
const reportArb = fc.oneof(
  fc.constant({ kind: "Running" }),
  fc.constant({ kind: "SafelySuspended" }),
  fc.record({ kind: fc.constant("Terminal"), result: idArb })
)

const factsArb = fc
  .array(fc.record({ subject: taskArb, present: fc.boolean(), open: fc.boolean() }), { minLength: 0, maxLength: 2 })
  .map((facts) => {
    const bySubject = new Map(facts.map((fact) => [fact.subject, fact]))
    return [...bySubject.values()]
  })

/** Fully arbitrary events: the garbage a truncated, contradictory journal is made of. */
const eventArb = fc.oneof(
  ...EVENT_TAGS.map((tag) => {
    switch (tag) {
      case "ClaimIntentRecorded":
      case "ClaimReleaseIntentRecorded":
        return fc.record({ task: taskArb, token: tokenArb }).map(({ task, token }) => E[tag](task, token))
      case "AttemptPlanned":
        return fc.record({ task: taskArb, runId: idArb, attemptId: idArb }).map(({ task, runId, attemptId }) => E[tag](task, runId, attemptId))
      case "WorkAdmitted":
      case "SuspensionRequested":
      case "ResumeRequested":
      case "WorktreeIntentRecorded":
        return fc.record({ task: taskArb, attemptId: idArb }).map(({ task, attemptId }) => E[tag](task, attemptId))
      case "IntegrationSessionOpened":
      case "PromotionIntentRecorded":
        return fc.record({ task: taskArb, expectedHead: fc.integer({ min: 0, max: 5 }) }).map(({ task, expectedHead }) => E[tag](task, expectedHead))
      case "CandidateConstructionNonConvergent":
        return fc.record({ task: taskArb, reason: reasonArb }).map(({ task, reason }) => E[tag](task, reason))
      case "DeliverySettled":
        return taskArb.map((task) => E[tag](task))
      case "WorkflowRunBegun":
        return fc.record({ runId: idArb, target: idArb }).map(({ runId, target }) => E[tag](runId, target))
      case "WorkflowRunTerminated":
        return idArb.map((runId) => E[tag](runId))
      case "CapacityRevised":
        return fc.integer({ min: 0, max: 3 }).map((capacity) => E[tag](capacity))
      case "DirectionApplied":
        return fc
          .record({ subject: fc.constantFrom(0, 1, "run"), direction: fc.constantFrom("Pause", "Unpause") })
          .map(({ subject, direction }) => E[tag](subject, direction))
      case "TrackerFactsObserved":
        return fc
          .record({ facts: factsArb, complete: fc.boolean(), contentIdentity: fc.integer({ min: 0, max: 3 }) })
          .map(({ facts, complete, contentIdentity }) =>
            E[tag]([...new Set(facts.map((fact) => fact.subject))], facts, complete, contentIdentity)
          )
      case "ClaimRecordRead":
        return fc.record({ task: taskArb, owner: idArb, token: tokenArb }).map(({ task, owner, token }) => E[tag](task, owner, token))
      case "ClaimedTaskEligibilityObserved":
        return fc.record({ task: taskArb, revision: idArb }).map(({ task, revision }) => E[tag](task, revision))
      case "ClaimedTaskIneligible":
        return fc.record({ task: taskArb, reason: fc.constantFrom(...INELIGIBILITY) }).map(({ task, reason }) => E[tag](task, reason))
      case "WorktreeReconciliationObserved":
        return fc.record({ task: taskArb, attemptId: idArb, outcome: fc.constantFrom("Created", "AlreadyExisted", "Missing") })
          .map(({ task, attemptId, outcome }) => E[tag](task, attemptId, outcome))
      case "ExecutorReported":
        return fc.record({ task: taskArb, attemptId: idArb, report: reportArb }).map(({ task, attemptId, report }) => E[tag](task, attemptId, report))
      case "PromotionOutcomeObserved":
        return fc.record({ task: taskArb, head: fc.integer({ min: 0, max: 5 }) }).map(({ task, head }) => E[tag](task, head))
      case "TargetHeadObserved":
        return fc.integer({ min: 0, max: 5 }).map((head) => E[tag](head))
      default:
        throw new Error(`eventArb missing ${tag}`)
    }
  })
)

const introducedFailure = (before, after) =>
  (after.runFailed !== null && before.runFailed === null) ||
  TASKS.some((id) => after.tickets[id].failed !== null && before.tickets[id].failed === null)

/** Candidate events worth trying from this state, field values taken from it. */
const candidates = (state) => {
  const out = []
  const freshIdentity = 100 + Object.keys(state.seenObservations).length
  for (const t of TASKS) {
    const ticket = state.tickets[t]
    const attemptId = ticket.attemptId ?? 0
    out.push(
      E.ClaimIntentRecorded(t, 0),
      E.ClaimIntentRecorded(t, 1),
      E.ClaimReleaseIntentRecorded(t, ticket.claimToken ?? 0),
      E.ClaimRecordRead(t, state.runId ?? 0, ticket.claimToken ?? 0),
      E.ClaimRecordRead(t, state.runId ?? 0, (ticket.claimToken ?? 0) + 1),
      E.ClaimedTaskEligibilityObserved(t, 0),
      ...INELIGIBILITY.map((reason) => E.ClaimedTaskIneligible(t, reason)),
      E.AttemptPlanned(t, state.runId ?? 0, 0),
      E.WorkAdmitted(t, attemptId),
      E.SuspensionRequested(t, attemptId),
      E.ResumeRequested(t, attemptId),
      E.WorktreeIntentRecorded(t, attemptId),
      E.WorktreeReconciliationObserved(t, attemptId, "Created"),
      E.ExecutorReported(t, attemptId, { kind: "Running" }),
      E.ExecutorReported(t, attemptId, { kind: "SafelySuspended" }),
      E.ExecutorReported(t, attemptId, { kind: "Terminal", result: 0 }),
      E.IntegrationSessionOpened(t, state.targetHead),
      E.PromotionIntentRecorded(t, ticket.expectedHead),
      E.PromotionOutcomeObserved(t, ticket.expectedHead),
      E.PromotionOutcomeObserved(t, ticket.expectedHead + 1),
      // Only StaleTargetHead: ../JOURNAL-EVENTS.md states the two limit
      // reasons are unreachable in this abstraction (the benchmark has no
      // correction loop), so the plausible environment never records them.
      // The fold still accepts them, and injected arbitrary events may carry
      // them -- the witness table says how often that happened.
      E.CandidateConstructionNonConvergent(t, "StaleTargetHead"),
      E.DeliverySettled(t)
    )
  }
  const bothFacts = TASKS.map((subject) => ({ subject, present: true, open: true }))
  out.push(
    E.TrackerFactsObserved(TASKS, bothFacts, true, freshIdentity),
    E.TrackerFactsObserved(TASKS, bothFacts, false, freshIdentity + 1),
    E.TrackerFactsObserved([0], [{ subject: 0, present: true, open: true }], true, freshIdentity + 2),
    E.TrackerFactsObserved(TASKS, TASKS.map((subject) => ({ subject, present: true, open: false })), true, freshIdentity + 3),
    E.TargetHeadObserved(state.targetHead + 1),
    E.CapacityRevised(0),
    E.CapacityRevised(1),
    E.CapacityRevised(2),
    E.DirectionApplied("run", "Pause"),
    E.DirectionApplied("run", "Unpause"),
    E.WorkflowRunBegun(0, 0)
  )
  // A sane operator terminates a Run only once nothing is in flight; offering
  // it earlier would just truncate every generated journal.
  if (TASKS.every((id) => ["NoObligation", "Settled", "Abandoned"].includes(state.tickets[id].phase)))
    out.push(E.WorkflowRunTerminated(state.runId ?? 0))
  return out
}

const enabledWithNext = (state) =>
  candidates(state)
    .map((event) => ({ event, next: foldFrom(state, [event]) }))
    .filter(({ next }) => !introducedFailure(state, next))

const ADVANCING = new Set([
  "WorkflowRunBegun",
  "TrackerFactsObserved",
  "ClaimIntentRecorded",
  "ClaimReleaseIntentRecorded",
  "AttemptPlanned",
  "WorkAdmitted",
  "SuspensionRequested",
  "ResumeRequested",
  "WorktreeIntentRecorded",
  "ExecutorReported",
  "IntegrationSessionOpened",
  "PromotionIntentRecorded",
  "PromotionOutcomeObserved",
  "CandidateConstructionNonConvergent",
  "DeliverySettled"
])

const stepArb = fc.record({
  choice: fc.nat({ max: 1000 }),
  inject: fc.boolean(),
  event: eventArb
})

/**
 * Mostly-coherent journals with injected contradictions, in the same idiom
 * as ./liveness.mjs: at each step prefer an event the fold currently accepts
 * (biased toward lifecycle-advancing ones), and sometimes inject an
 * arbitrary event. Fully arbitrary sequences never reach a deep phase, which
 * is the vacuity lesson this study already learned once. The injection rate
 * is deliberately low (~1/8 of steps): at 1/2 nearly every journal dies on
 * injected garbage before reaching a deep phase, and the witnesses go to
 * zero.
 */
const plausible = (steps) => {
  const events = []
  let state = initialState()
  for (const step of steps) {
    const enabled = enabledWithNext(state)
    let picked = step.event
    let pickedNext = null
    if (!(step.inject && step.choice % 4 === 0) && enabled.length > 0) {
      // "Advancing" means lifecycle-moving AND state-changing: an idempotent
      // observation or a Running report must not crowd the pool.
      const now = canon(state)
      const advancing = enabled.filter(({ event, next }) => ADVANCING.has(event.tag) && canon(next) !== now)
      const pool = advancing.length > 0 && step.choice % 10 < 8 ? advancing : enabled
      const entry = pool[Math.floor(step.choice / 10) % pool.length]
      picked = entry.event
      pickedNext = entry.next
    }
    events.push(picked)
    state = pickedNext ?? foldFrom(state, [picked])
  }
  return events
}

const plausibleArb = fc.array(stepArb, { minLength: 1, maxLength: maxSteps, size: "max" })
const arbitrarySeqArb = fc.array(eventArb, { minLength: 0, maxLength: maxSteps, size: "max" })

// ------------------------------------------------------- directed sequences

/** A full normal lifecycle for task 0, plus intent/outcome splits. */
const directedSequences = [
  [
    E.WorkflowRunBegun(0, 0),
    E.TrackerFactsObserved(TASKS, TASKS.map((subject) => ({ subject, present: true, open: true })), true, 0),
    E.ClaimIntentRecorded(0, 0),
    E.ClaimRecordRead(0, 0, 0),
    E.AttemptPlanned(0, 0, 0),
    E.WorktreeIntentRecorded(0, 0),
    E.WorktreeReconciliationObserved(0, 0, "Created"),
    E.WorkAdmitted(0, 0),
    E.ExecutorReported(0, 0, { kind: "Running" }),
    E.ExecutorReported(0, 0, { kind: "Terminal", result: 0 }),
    E.IntegrationSessionOpened(0, 0),
    E.PromotionIntentRecorded(0, 0),
    E.PromotionOutcomeObserved(0, 0),
    E.DeliverySettled(0),
    E.WorkflowRunTerminated(0)
  ],
  // Crash between a claim intent and its outcome; recovery reconciles.
  [E.TrackerFactsObserved([0], [{ subject: 0, present: true, open: true }], true, 0), E.ClaimIntentRecorded(0, 0), E.ClaimRecordRead(0, 0, 1)],
  // A regional contradiction (admission with no planned attempt) inside an
  // otherwise coherent journal.
  [
    E.WorkflowRunBegun(0, 0),
    E.TrackerFactsObserved(TASKS, TASKS.map((subject) => ({ subject, present: true, open: true })), true, 0),
    E.WorkAdmitted(0, 0),
    E.ClaimIntentRecorded(1, 0),
    E.AttemptPlanned(1, 0, 0),
    E.WorkAdmitted(1, 0)
  ],
  // Ends holding a position: a reconstruction that loses it (M2) diverges
  // from the full fold in the FINAL state, so the split must catch it.
  [
    E.WorkflowRunBegun(0, 0),
    E.TrackerFactsObserved([0], [{ subject: 0, present: true, open: true }], true, 0),
    E.ClaimIntentRecorded(0, 0),
    E.AttemptPlanned(0, 0, 0),
    E.WorkAdmitted(0, 0)
  ]
]

// ---------------------------------------------------------------- witnesses

const witnesses = {
  runs: 0,
  runFailed: 0,
  regionFailed: 0,
  pendingIntentSplits: 0,
  promoted: 0,
  settled: 0,
  abandoned: 0,
  abandonedStale: 0,
  abandonedLimits: 0,
  p3AliveCompared: 0
}

// --------------------------------------------------------------- properties

/** P1: fold is defined on every prefix; every prefix state is well-formed. */
const prefixTotality = (mutant = 0) =>
  fc.property(arbitrarySeqArb, (events) => {
    let state = initialState()
    for (const event of events) {
      state = foldFrom(state, [event], mutant)
      const problem = checkShape(state)
      if (problem) throw new Error(`P1 ill-formed state: ${problem}`)
    }
    return true
  })

/** P2: fold(p ++ q) === foldFrom(fold(p), q). */
const homomorphism = (mutant = 0) =>
  fc.property(plausibleArb, fc.nat({ max: 999 }), (steps, splitChoice) => {
    const xs = plausible(steps)
    const i = xs.length === 0 ? 0 : splitChoice % (xs.length + 1)
    const p = xs.slice(0, i)
    const q = xs.slice(i)
    const mid = fold(p, mutant)
    if (
      mutant === 0 &&
      TASKS.some((t) => mid.tickets[t].claimPending || mid.tickets[t].worktreePending || mid.tickets[t].promotionPending)
    )
      witnesses.pendingIntentSplits += 1
    if (canon(fold([...p, ...q], mutant)) !== canon(foldFrom(mid, q, mutant)))
      throw new Error(`P2 homomorphism broken at split ${i}/${xs.length}`)
    return true
  })

const homomorphismDirected = (mutant = 0) => {
  for (const xs of directedSequences) {
    for (let i = 0; i <= xs.length; i += 1) {
      if (canon(fold(xs, mutant)) !== canon(foldFrom(fold(xs.slice(0, i), mutant), xs.slice(i), mutant)))
        return `P2 directed case broken at split ${i}`
    }
  }
  return null
}

/** P3: regional contradiction. */
const regionalContradiction = (mutant = 0) =>
  fc.property(plausibleArb, (steps) => {
    const xs = plausible(steps)
    let state = initialState()
    let runClosed = null
    const regionClosed = {}
    for (const event of xs) {
      state = foldFrom(state, [event], mutant)
      if (runClosed === null && state.runFailed !== null) runClosed = canon(state)
      for (const t of TASKS) {
        if (!(t in regionClosed) && state.tickets[t].failed !== null) regionClosed[t] = canon(regionOf(state, t))
      }
    }
    if (mutant === 0) {
      witnesses.runs += 1
      if (state.runFailed !== null) witnesses.runFailed += 1
      if (TASKS.some((t) => state.tickets[t].failed !== null)) witnesses.regionFailed += 1
    }
    // Failure attribution: the Run fails only on shared history.
    if (state.runFailed !== null && state.runFailed.origin !== "shared")
      throw new Error(`P3 run failure attributed to ${state.runFailed.origin}: ${state.runFailed.reason}`)
    // Closed stays closed, for the Run and for each region.
    if (runClosed !== null && canon(state) !== runClosed) throw new Error("P3 a failed Run kept evolving")
    for (const t of TASKS) {
      if (t in regionClosed && canon(regionOf(state, t)) !== regionClosed[t])
        throw new Error(`P3 a failed region ${t} kept evolving`)
    }
    // A live Run's regions are exactly the fold of their own subsequences.
    if (state.runFailed === null) {
      if (mutant === 0) witnesses.p3AliveCompared += 1
      for (const t of TASKS) {
        const alone = foldRegion(t, xs)
        const region = regionOf(state, t)
        if ((region.failed === null) !== (alone.failed === null))
          throw new Error(`P3 region ${t} failure not attributable to its own subsequence`)
        if (region.failed === null && canon(region) !== canon(alone))
          throw new Error(`P3 region ${t} content differs from its own subsequence fold`)
      }
    }
    return true
  })

/** P4: repeated folds agree, dynamically. */
const determinism = (foldFn = fold) =>
  fc.property(plausibleArb, (steps) => {
    const xs = plausible(steps)
    if (canon(foldFn(xs)) !== canon(foldFn(xs))) throw new Error("P4 the same journal folded to two states")
    return true
  })

/** P4, statically: the fold's source contains no wall-clock or entropy reads. */
const staticGuard = (file) => {
  const source = readFileSync(new URL(file, import.meta.url), "utf8")
  const forbidden = /Date\.now|Math\.random|new\s+Date\b|performance\.now|crypto\.(randomUUID|getRandomValues)/
  return forbidden.test(source)
}

// ------------------------------------------------------------------- checks

let failures = 0

const verdict = (label, property, runs = numRuns) => {
  const startedAt = Date.now()
  const result = fc.check(property, { numRuns: runs })
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  const message = result.failed ? `**${String(result.errorInstance?.message ?? "false").split("\n")[0]}**` : "holds"
  if (result.failed) failures += 1
  console.log(`| ${label} | ${message} | ${runs} | ${seconds} |`)
}

/** A negative control: the property MUST catch the defect. */
const control = (label, property, runs = numRuns) => {
  const startedAt = Date.now()
  const result = fc.check(property, { numRuns: runs })
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  if (result.failed) {
    const message = String(result.errorInstance?.message ?? "false").split("\n")[0]
    console.log(`| ${label} | caught (${message}) | ${runs} | ${seconds} |`)
  } else {
    failures += 1
    console.log(`| ${label} | **NOT CAUGHT -- the property cannot fail** | ${runs} | ${seconds} |`)
  }
}

const controlDirected = (label, problem) => {
  if (problem === null) {
    failures += 1
    console.log(`| ${label} | **NOT CAUGHT on directed cases -- the property cannot fail** | — | — |`)
  } else {
    console.log(`| ${label} | caught (${problem}) | — | — |`)
  }
}

console.log(`fast-check ${numRuns} runs, sequences up to ${maxSteps} events, size: "max"`)
console.log("")
console.log("| Property | Result | runs | s |")
console.log("|---|---|---|---|")

verdict("P1 prefix-totality (arbitrary sequences)", prefixTotality(), numRuns * 4)
verdict("P2 homomorphism (plausible)", homomorphism())
const p2Directed = homomorphismDirected()
if (p2Directed !== null) {
  failures += 1
  console.log(`| P2 homomorphism (directed) | **${p2Directed}** | — | — |`)
} else {
  console.log(`| P2 homomorphism (directed) | holds | — | — |`)
}
verdict("P3 regional contradiction (plausible)", regionalContradiction())
verdict("P4 determinism (dynamic)", determinism())
if (staticGuard("./journal.mjs")) {
  failures += 1
  console.log(`| P4 determinism (static grep) | **journal.mjs reads a nondeterministic source** | — | — |`)
} else {
  console.log(`| P4 determinism (static grep) | holds | — | — |`)
}

console.log("")
console.log("| Negative control | Result | runs | s |")
console.log("|---|---|---|---|")

control("M1 invalid event throws (breaks P1)", prefixTotality(1), Math.max(200, Math.floor(numRuns / 4)))
controlDirected("M2 foldFrom drops positions (breaks P2)", homomorphismDirected(2))
control("M3 region failure poisons the Run (breaks P3)", regionalContradiction(3), Math.max(200, Math.floor(numRuns / 4)))
control("M4 fold stamps wall-clock (breaks P4 dynamic)", determinism(foldStamped), 100)
if (staticGuard("./journal-mutants.mjs")) {
  console.log(`| M4 static grep fires on journal-mutants.mjs | caught | — | — |`)
} else {
  failures += 1
  console.log(`| M4 static grep fires on journal-mutants.mjs | **NOT CAUGHT -- the grep is blind** | — | — |`)
}

// Witness pass: a green suite means nothing if the states the propositions
// are about are never reached.
const endWinesses = { Promoted: 0, Settled: 0, Abandoned: 0, Executing: 0, Integrating: 0 }
fc.assert(
  fc.property(plausibleArb, (steps) => {
    const state = fold(plausible(steps))
    for (const id of TASKS) {
      const phase = state.tickets[id].phase
      if (phase in endWinesses) endWinesses[phase] += 1
      if (phase === "Abandoned") {
        if (state.tickets[id].retentionReason === "StaleTargetHead") witnesses.abandonedStale += 1
        else witnesses.abandonedLimits += 1
      }
    }
    return true
  }),
  { numRuns }
)
witnesses.promoted = endWinesses.Promoted
witnesses.settled = endWinesses.Settled
witnesses.abandoned = endWinesses.Abandoned

console.log("")
console.log("| Witness | count |")
console.log("|---|---|")
console.log(`| P2 splits landing on a pending intent | ${witnesses.pendingIntentSplits} |`)
console.log(`| P3 runs ending Run-failed | ${witnesses.runFailed} / ${witnesses.runs} |`)
console.log(`| P3 runs with a failed region | ${witnesses.regionFailed} / ${witnesses.runs} |`)
console.log(`| P3 live-Run region comparisons | ${witnesses.p3AliveCompared} |`)
console.log(`| Runs ending Promoted | ${witnesses.promoted} |`)
console.log(`| Runs ending Settled | ${witnesses.settled} |`)
console.log(`| Runs ending Abandoned (StaleTargetHead) | ${witnesses.abandonedStale} |`)
console.log(`| Runs ending Abandoned (limit reasons) | ${witnesses.abandonedLimits} |`)

const required = [
  ["P2 splits landing on a pending intent", witnesses.pendingIntentSplits],
  ["P3 runs ending Run-failed", witnesses.runFailed],
  ["P3 runs with a failed region", witnesses.regionFailed],
  ["P3 live-Run region comparisons", witnesses.p3AliveCompared],
  ["runs ending Settled", witnesses.settled],
  ["runs ending Abandoned (StaleTargetHead)", witnesses.abandonedStale]
]
for (const [label, count] of required) {
  if (count === 0) {
    failures += 1
    console.log(`\n**vacuous: ${label} never occurred**`)
  }
}
// ../JOURNAL-EVENTS.md: CorrectionLimitExhausted and ContinuationLimitExhausted
// are unreachable in this abstraction. The plausible environment never
// records them; a nonzero count can only come from injected arbitrary
// events, which is the fold being total over the full alphabet, not the
// benchmark reaching the limits.
console.log(
  `\nAbandoned by limit reasons: ${witnesses.abandonedLimits} -- reachable only through injected arbitrary events; the plausible environment never records them, as the design states.`
)

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log("\nall clean, all negative controls caught, all witnesses nonzero")
}
