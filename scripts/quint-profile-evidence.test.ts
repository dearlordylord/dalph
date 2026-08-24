import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

type Command = { kind: string; name: string; durationSeconds: number }
type Profile = {
  id: string
  node: string
  installSeconds: number | null
  formalSeconds: number
  budgetSeconds: number
  source: { path: string; sha256: string }
  commandCount: number
  phaseCommandCounts: Record<string, number>
  phaseTotals: Record<string, number>
  commands: Array<Command>
}

const evidence = JSON.parse(
  readFileSync(new URL("../research/quint-hosted-equivalent-profile.raw.json", import.meta.url), "utf8")
) as { schemaVersion: number; generatedBy: string; profiles: Array<Profile> }
const report = readFileSync(new URL("../research/quint-hosted-equivalent-profile.md", import.meta.url), "utf8")

describe("Quint profile evidence artifact", () => {
  it("retains every profile command and the gate-reported phase totals", () => {
    expect(evidence.schemaVersion).toBe(1)
    expect(evidence.generatedBy).toContain("generate-quint-profile-evidence.mjs")
    expect(evidence.profiles).toHaveLength(5)

    for (const profile of evidence.profiles) {
      expect(profile.commandCount).toBe(92)
      expect(profile.commands).toHaveLength(92)
      expect(profile.phaseCommandCounts).toEqual({ typecheck: 13, test: 40, "sampled-run": 20, verify: 19 })
      expect(profile.source.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(profile.formalSeconds).toBeGreaterThan(0)
      expect(profile.budgetSeconds).toBe(600)
      expect(profile.commands).toContainEqual(
        expect.objectContaining({
          kind: "verify",
          name: "planned-attempt executor temporal mutant releasableEvidenceNeverReleasesPosition (TLC)"
        })
      )
    }

    expect(evidence.profiles.map((profile) => profile.formalSeconds)).toEqual([348.65, 385.21, 325.4, 317.75, 572.29])
    expect(evidence.profiles.map((profile) => profile.phaseTotals)).toContainEqual({
      typecheck: 35.6,
      test: 176.29,
      "sampled-run": 102.24,
      verify: 258.13
    })
  })

  it("documents how the checked-in artifact was generated", () => {
    expect(report).toContain("quint-hosted-equivalent-profile.raw.json")
    expect(report).toContain("generate-quint-profile-evidence.mjs")
    expect(report).toContain("SHA-256")
    expect(report).toContain("The source logs are not claimed to be")
  })
})
