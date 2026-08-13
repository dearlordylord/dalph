import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const repositoryDocument = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

const budgetPolicies = [
  ["Tracker snapshot freshness", "Metrics only for elapsed age; fresh-read requirement for decisions."],
  ["Local DAG validation and frontier derivation", "Metrics only."],
  [
    "Claim and mutation admission",
    "Retry/backoff at the owning protocol; local admission is an observation/cancellation bound."
  ],
  [
    "Execution start and stop observation",
    "Observation/cancellation bound plus bounded command retries; remote execution latency is metrics only."
  ],
  ["Coordinator ownership contradiction", "Observation/cancellation bound."],
  ["Cancellation and application drain", "Hard timeout."],
  ["Recovery and reconciliation", "Retry/backoff at each named protocol; metrics only for wall-clock elapsed recovery."]
] as const

describe("control-plane budget documentation", () => {
  it("names every accepted boundary and its timing policy", () => {
    const budget = repositoryDocument("docs/architecture/control-plane-latency-and-responsiveness.md")

    for (const [boundary, policy] of budgetPolicies) {
      expect(budget).toContain(`| ${boundary} |`)
      expect(budget).toContain(`| ${policy} |`)
    }
  })

  it("keeps the accepted scenarios discoverable from the scenario and architecture maps", () => {
    const architecture = repositoryDocument("docs/ARCHITECTURE.md")
    const scenarios = repositoryDocument("docs/scenarios/README.md")

    expect(architecture).toContain("architecture/control-plane-latency-and-responsiveness.md")
    expect(scenarios).toContain("`issue-103-github-dry-run-cli.md` | 103")
    expect(scenarios).toContain("`issue-104-control-plane-latency-and-responsiveness.md` | 104")
  })
})
