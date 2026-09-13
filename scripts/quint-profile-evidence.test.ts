import { describe, expect, it } from "vitest"

import { quintGateCommandManifest } from "./quint-gate-command-manifest.mjs"
import { parseProfileLog } from "./generate-quint-profile-evidence.mjs"

const fixtureLog = (commands: Array<{ kind: string; name: string }>) => {
  const phaseCounts = Object.fromEntries(
    ["typecheck", "test", "sampled-run", "verify"].map((kind) => [
      kind,
      commands.filter((command) => command.kind === kind).length
    ])
  )
  return [
    ...commands.map(
      (command) =>
        `Quint command timing: ${command.kind} ${command.name} 1.00s result=${command.name.includes("temporal mutant") ? "exit:1" : "exit:0"}`
    ),
    ...Object.entries(phaseCounts).map(
      ([kind, count]) => `Quint phase timing: ${kind} ${count} command(s), ${count}.00s`
    ),
    "Complete Quint model gate: 105.00s (budget 750s)"
  ].join("\n")
}

const parseFixture = (commands: Array<{ kind: string; name: string }>) =>
  parseProfileLog({
    id: "fixture",
    node: "fixture",
    repeat: "1",
    installSeconds: "-",
    log: fixtureLog(commands),
    sourcePath: "fixture.log"
  })

const commandAt = (commands: Array<{ kind: string; name: string }>, index: number) => {
  const command = commands[index]
  if (command === undefined) throw new Error(`missing fixture command ${index}`)
  return command
}

describe("Quint profile evidence parser", () => {
  it.each([
    [
      "duplicate",
      (commands: Array<{ kind: string; name: string }>) =>
        commands.map((command, index) => (index === 2 ? commandAt(commands, 1) : command))
    ],
    ["missing", (commands: Array<{ kind: string; name: string }>) => commands.slice(0, -1)],
    [
      "reordered",
      (commands: Array<{ kind: string; name: string }>) =>
        commands.map((command, index) =>
          index === 0 ? commandAt(commands, 1) : index === 1 ? commandAt(commands, 0) : command
        )
    ],
    [
      "wrong kind",
      (commands: Array<{ kind: string; name: string }>) =>
        commands.map((command, index) => (index === 0 ? { ...commandAt(commands, 0), kind: "test" } : command))
    ]
  ])("rejects a %s command sequence", (_label, mutate) => {
    const commands = quintGateCommandManifest.map((command) => ({ ...command }))
    expect(() => parseFixture(mutate(commands))).toThrow(/manifest|Expected 105 commands/)
  })

  it("rejects phase totals outside emitted per-command rounding tolerance", () => {
    const commands = quintGateCommandManifest.map((command) => ({ ...command }))
    const log = fixtureLog(commands).replace(
      "Quint phase timing: test 46 command(s), 46.00s",
      "Quint phase timing: test 46 command(s), 47.00s"
    )
    expect(() => parseProfileLog({ id: "fixture", node: "fixture", repeat: "1", installSeconds: "-", log })).toThrow(
      "Phase total mismatch for test"
    )
  })

  it("retains each exact command exit result and rejects an unknown result", () => {
    const commands = quintGateCommandManifest.map((command) => ({ ...command }))
    const parsed = parseFixture(commands)
    expect(parsed.commands).toContainEqual(
      expect.objectContaining({
        name: "planned-attempt executor temporal mutant releasableEvidenceNeverReleasesPosition (TLC)",
        result: "exit:1"
      })
    )

    expect(() =>
      parseProfileLog({
        id: "fixture",
        node: "fixture",
        repeat: "1",
        installSeconds: "-",
        log: fixtureLog(commands).replace("result=exit:0", "result=unknown")
      })
    ).toThrow(/manifest|Expected 105 commands/)
  })
})
