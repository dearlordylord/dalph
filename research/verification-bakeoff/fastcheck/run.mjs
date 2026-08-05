/**
 * The property-based-testing tier of the bake-off.
 *
 *   node run.mjs [--runs 20000] [--steps 25] [--m8]
 *
 * Two properties per mutant:
 *   L1  a direct property over one generated graph and capacity
 *   L2  a random action sequence over ../MODEL.md, the same search Quint's
 *       simulator performs, so the two rows are directly comparable
 *
 * `--m8` swaps invariant I8 for the seeded specification error of
 * ../MUTANTS.md and runs it against the faithful model.
 */
import fc from "fast-check"
import {
  actionNames,
  actions,
  checkInvariants,
  defaultInvariantNames,
  deliveriesOf,
  hasObligation,
  initialState,
  MAX_CAPACITY,
  selectedOf,
  TASKS
} from "./model.mjs"

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : Number(process.argv[index + 1])
}
const numRuns = arg("runs", 20000)
const maxSteps = arg("steps", 25)
const useM8 = process.argv.includes("--m8")

const invariantNames = useM8 ? [...defaultInvariantNames, "ceilingOverHeldPositions"] : defaultInvariantNames

const ticketArb = fc.record({
  phase: fc.constantFrom("NoObligation", "Claimed", "Planned", "Executing", "Accepted", "Settled"),
  attempts: fc.constant(0),
  present: fc.boolean(),
  open: fc.boolean(),
  expectedHead: fc.constant(0)
})

const l1Property = (mutant) =>
  fc.property(fc.array(ticketArb, { minLength: 2, maxLength: 2 }), fc.integer({ min: 0, max: MAX_CAPACITY }), (ts, capacity) => {
    const tickets = Object.fromEntries(TASKS.map((id) => [id, ts[id]]))
    const selected = selectedOf(tickets, capacity, mutant)
    const delivered = deliveriesOf(tickets, capacity, mutant)
    // I1 bound, I4 retention.
    return (
      selected.length <= capacity &&
      TASKS.every((id) => !hasObligation(tickets[id]) || delivered.includes(id))
    )
  })

const stepArb = fc.record({
  action: fc.constantFrom(...actionNames),
  id: fc.constantFrom(...TASKS),
  present: fc.boolean(),
  open: fc.boolean(),
  capacity: fc.integer({ min: 0, max: MAX_CAPACITY })
})

const l2Property = (mutant) =>
  // `size: "max"` opts out of fast-check's default bias toward small inputs.
  // Under the default bias almost the whole budget goes to sequences too short
  // to reach a deep phase, and every L2 mutant survives.
  fc.property(fc.array(stepArb, { minLength: 1, maxLength: maxSteps, size: "max" }), (steps) => {
    let state = initialState()
    for (const step of steps) {
      const attempted = actions[step.action](state, step, mutant)
      if (attempted === null) continue
      state = attempted
      const broken = checkInvariants(state, mutant, invariantNames)
      if (broken.length > 0) throw new Error(`${broken.join(", ")} after ${step.action}(${step.id})`)
    }
    return true
  })

const verdict = (mutant, property) => {
  const startedAt = Date.now()
  const result = fc.check(property(mutant), { numRuns })
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  if (!result.failed) return { seconds, text: mutant === 0 ? "clean" : "missed" }
  const message = String(result.errorInstance?.message ?? "property false").split("\n")[0]
  return { seconds, text: `caught (${message})` }
}

console.log(`fast-check ${numRuns} runs, up to ${maxSteps} steps${useM8 ? ", I8 replaced by the M8 state predicate" : ""}`)
console.log("")
console.log("| Mutant | L1 property | s | L2 random sequence | s |")
console.log("|---|---|---|---|---|")

for (const mutant of [0, 1, 2, 4, 5, 6]) {
  const l1 = verdict(mutant, l1Property)
  const l2 = verdict(mutant, l2Property)
  console.log(`| M${mutant} | ${l1.text} | ${l1.seconds} | ${l2.text} | ${l2.seconds} |`)
}
