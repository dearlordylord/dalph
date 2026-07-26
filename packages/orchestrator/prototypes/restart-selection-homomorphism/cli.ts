/* eslint-disable functional/immutable-data, import/no-nodejs-modules, no-console, no-restricted-globals */
import { emitKeypressEvents } from "node:readline"
import { comparePaths, initialScenario, type Scenario } from "./model.ts"

const bold = "\u001b[1m"
const dim = "\u001b[2m"
const green = "\u001b[32m"
const red = "\u001b[31m"
const reset = "\u001b[0m"

let scenario: Scenario = initialScenario

const toggle = (
  key: keyof Pick<
    Scenario,
    | "capacityAvailable"
    | "claimIntentRecorded"
    | "paused"
    | "prerequisitesComplete"
    | "taskOpen"
  >
) => {
  scenario = { ...scenario, [key]: !scenario[key] }
}

const cycleClaim = () => {
  const claim = scenario.claim === "Exact"
    ? "Missing"
    : scenario.claim === "Missing"
    ? "Foreign"
    : "Exact"
  scenario = { ...scenario, claim }
}

const render = () => {
  const comparison = comparePaths(scenario)
  console.clear()
  console.log(`${bold}PROTOTYPE — restart selection homomorphism${reset}`)
  console.log(`${dim}Same journal facts + same fresh observations must select the same next operation.${reset}\n`)
  console.log(`${bold}Inputs${reset}`)
  console.log(`  claim intent recorded:    ${scenario.claimIntentRecorded}`)
  console.log(`  task open:               ${scenario.taskOpen}`)
  console.log(`  prerequisites complete:  ${scenario.prerequisitesComplete}`)
  console.log(`  claim:                   ${scenario.claim}`)
  console.log(`  paused:                  ${scenario.paused}`)
  console.log(`  capacity available:      ${scenario.capacityAvailable}\n`)
  console.log(`${bold}Results${reset}`)
  console.log(`  uninterrupted:           ${comparison.uninterrupted}`)
  console.log(`  restart through #144:    ${comparison.currentIssue144Restart}`)
  console.log(`  complete restart:        ${comparison.completeRestart}`)
  console.log(
    `  complete paths match:    ${
      comparison.homomorphic
        ? `${green}YES${reset}`
        : `${red}NO${reset}`
    }`
  )
  console.log(
    `\n${red}#144 alone is incomplete whenever a next-operation decision is required.${reset}`
  )
  console.log(`\n${bold}Keys${reset}`)
  console.log(
    "  [j] claim intent  [o] task open  [b] blockers  [c] claim  [p] pause  [k] capacity  [q] quit"
  )
}

if (!process.stdin.isTTY) {
  console.error("Run this prototype in an interactive terminal.")
  process.exitCode = 1
} else {
  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on("keypress", (_value, key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      console.clear()
      return
    }
    if (key.name === "j") toggle("claimIntentRecorded")
    if (key.name === "o") toggle("taskOpen")
    if (key.name === "b") toggle("prerequisitesComplete")
    if (key.name === "c") cycleClaim()
    if (key.name === "p") toggle("paused")
    if (key.name === "k") toggle("capacityAvailable")
    render()
  })
  render()
}
