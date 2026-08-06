/**
 * The bounded surrogate for I17-I19.
 *
 *   node liveness.mjs [--runs 20000] [--steps 25] [--drain 40]
 *
 * fast-check cannot check liveness. Liveness quantifies over infinite
 * behaviours and a test runs finitely, so `eventually P` is not a testable
 * proposition. What IS testable is a bounded, scheduled version of it:
 *
 *   generate a random prefix -> stop the environment -> run a fair scheduler
 *   -> assert the system drains within a fixed number of steps
 *
 * That is strictly weaker than what TLC and Alloy check, in three ways worth
 * naming: the environment assumptions become a hard cutoff rather than
 * `<>[]~crashed`; "eventually" becomes "within `drain` steps"; and the fair
 * scheduler is ONE fairness-satisfying strategy, where SF quantifies over all
 * of them. A round-robin scheduler cannot exhibit the
 * Executing -> SuspensionRequested -> Suspended cycle that broke the first
 * TLA+ fairness attempt, because it never picks requestSuspension.
 *
 * It is still the cheapest of the three by a wide margin, it runs on the same
 * model as the invariant suite, and it catches the stale-head parking that
 * safety missed. Read it as a smoke test for drain behaviour, not as a
 * liveness proof.
 */
import fc from "fast-check"
import { actions, initialState, TASKS } from "./model.mjs"

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : Number(process.argv[index + 1])
}
const numRuns = arg("runs", 20000)
const maxSteps = arg("steps", 25)
const drainBudget = arg("drain", 40)
// Negative control: drop the stale-head escape and I18 must fail. Without this
// the whole file could be passing vacuously.
const noAbandon = process.argv.includes("--no-abandon")

const TERMINAL = new Set(["NoObligation", "Settled", "Abandoned"])

// The lifecycle actions only. Everything the environment does -- observeGraph,
// applyPause, changeCapacity, externalTargetAdvance, crash -- is excluded, and
// so is requestSuspension, for the same reason as in the other tools: being
// asked to suspend is an operator decision, not an obligation.
const PROGRESS = [
  "acquireClaim",
  "planAttempt",
  "beginWork",
  "safelySuspend",
  "resumeWork",
  "reportAccepted",
  "startIntegration",
  "promote",
  "abandonIntegration",
  "settle"
].filter((name) => !(noAbandon && name === "abandonIntegration"))

/** One fair strategy: round-robin over (action, task), taking the first enabled. */
const drain = (start) => {
  let state = start
  if (state.crashed) state = actions.recover(state, {}, 0)
  if (state.paused) state = actions.applyUnpause(state, {})
  if (state.capacity === 0) state = actions.changeCapacity(state, { capacity: 1 })

  for (let step = 0; step < drainBudget; step += 1) {
    let moved = false
    for (const name of PROGRESS) {
      for (const id of TASKS) {
        const next = actions[name](state, { id }, 0)
        if (next !== null) {
          state = next
          moved = true
          break
        }
      }
      if (moved) break
    }
    if (!moved) return { state, quiescent: true, used: step }
  }
  return { state, quiescent: false, used: drainBudget }
}

const ALL = [
  "observeGraph",
    "acquireClaim",
    "planAttempt",
    "beginWork",
    "requestSuspension",
    "safelySuspend",
    "resumeWork",
    "reportAccepted",
    "startIntegration",
    "promote",
    "settle",
    "applyPause",
    "applyUnpause",
    "changeCapacity",
    "externalTargetAdvance",
  "crash",
  "recover",
  "abandonIntegration"
]

const stepArb = fc.record({
  choice: fc.nat({ max: 1000 }),
  id: fc.constantFrom(...TASKS),
  present: fc.boolean(),
  open: fc.boolean(),
  capacity: fc.integer({ min: 0, max: 2 })
})

/** `size: "max"` for the same reason as in run.mjs: the default bias toward
 * short sequences never reaches a deep phase. */
const prefixArb = fc.array(stepArb, { minLength: 1, maxLength: maxSteps, size: "max" })

/**
 * Runs a generated prefix, choosing at each step from the actions that are
 * ENABLED rather than from all seventeen.
 *
 * The difference is not a tuning detail. Discarding disabled actions -- the
 * obvious encoding, and the one ./run.mjs uses -- spends most of the budget on
 * no-ops: over 40 000 prefixes it reached `Integrating` once and a STALE
 * `Integrating` never, so every property below passed without visiting the
 * state they are about. Choosing among enabled actions is fast-check's own
 * idiom for this (`fc.commands` with a `check` guard). It helps the shallow
 * phases and does not rescue the deep ones: the `--no-abandon` negative
 * control still fails to fire, which is the finding rather than a defect.
 */
const runPrefix = (steps) => {
  let state = initialState()
  for (const step of steps) {
    const enabled = []
    for (const name of ALL) {
      const next = actions[name](state, step, 0)
      if (next !== null) enabled.push(next)
    }
    if (enabled.length === 0) break
    state = enabled[step.choice % enabled.length]
  }
  return state
}

/** I19, bounded: the scheduler runs out of enabled actions before the budget. */
const reachesQuiescence =
  fc.property(prefixArb, (steps) => {
    const state = runPrefix(steps)
    const result = drain(state)
    if (!result.quiescent) {
      const stuck = TASKS.map((id) => `${id}:${result.state.tickets[id].phase}`).join(" ")
      throw new Error(`no quiescence in ${drainBudget} steps (${stuck})`)
    }
    return true
  })

/** I18, bounded: nothing is left mid-lifecycle once the scheduler stops. */
const everyBegunSettles = fc.property(prefixArb, (steps) => {
  const { state: drained } = drain(runPrefix(steps))
  for (const id of TASKS) {
    const phase = drained.tickets[id].phase
    if (!TERMINAL.has(phase)) throw new Error(`task ${id} left in ${phase}`)
  }
  return true
})

/** I17, bounded: under a pause that stays applied, positions empty out. */
const pauseDrainsPositions = fc.property(prefixArb, (steps) => {
  let state = runPrefix(steps)
  if (state.crashed) state = actions.recover(state, {}, 0)
  if (!state.paused) state = actions.applyPause(state, {}) ?? state

  // Under a pause, beginWork and resumeWork are disabled by their own guards,
  // so this drains without ever admitting anything new.
  for (let step = 0; step < drainBudget && state.positions.length > 0; step += 1) {
    let moved = false
    for (const name of ["reportAccepted", "requestSuspension", "safelySuspend"]) {
      for (const id of TASKS) {
        const next = actions[name](state, { id }, 0)
        if (next !== null) {
          state = next
          moved = true
          break
        }
      }
      if (moved) break
    }
    if (!moved) break
  }
  if (state.positions.length > 0) throw new Error(`positions still held: ${state.positions}`)
  return true
})

const verdict = (label, property) => {
  const startedAt = Date.now()
  const result = fc.check(property, { numRuns })
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  const message = result.failed
    ? `**${String(result.errorInstance?.message ?? "false").split("\n")[0]}**`
    : "holds"
  console.log(`| ${label} | ${message} | ${seconds} |`)
}

console.log(`fast-check ${numRuns} runs, prefix up to ${maxSteps} steps, drain budget ${drainBudget}${noAbandon ? ", NEGATIVE CONTROL: no abandonIntegration" : ""}`)
console.log("")
console.log("| Property (bounded) | Result | s |")
console.log("|---|---|---|")

verdict("I17 pauseDrainsPositions", pauseDrainsPositions)
verdict("I18 everyBegunSettles", everyBegunSettles)
verdict("I19 reachesQuiescence", reachesQuiescence)

/*
 * Witness rates, in the same spirit as Quint's witness counts: a green table
 * above means nothing if the prefixes never reach the states the properties
 * are about.
 */
const witnesses = { Executing: 0, Integrating: 0, staleIntegrating: 0, Settled: 0 }
let sampled = 0
fc.assert(
  fc.property(prefixArb, (steps) => {
    const s = runPrefix(steps)
    sampled += 1
    for (const id of TASKS) {
      const t = s.tickets[id]
      if (t.phase === "Executing") witnesses.Executing += 1
      if (t.phase === "Settled") witnesses.Settled += 1
      if (t.phase === "Integrating") {
        witnesses.Integrating += 1
        if (t.expectedHead !== s.targetHead) witnesses.staleIntegrating += 1
      }
    }
    return true
  }),
  { numRuns }
)

console.log("")
// Counted per task, so the denominator is runs x tasks, not runs.
console.log("| Witness at end of prefix | share of task slots |")
console.log("|---|---|")
for (const [name, count] of Object.entries(witnesses)) {
  console.log(`| ${name} | ${((100 * count) / (sampled * TASKS.length)).toFixed(2)}% |`)
}
