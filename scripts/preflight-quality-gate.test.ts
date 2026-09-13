import { expect, it } from "vitest"
import {
  qualityGateFixturePairTestTimeoutMilliseconds,
  qualityGateFixtureTestTimeoutMilliseconds,
  runQualityGateFixture
} from "./quality-gate-test-fixture.js"

const structuralCommands = [
  "typecheck",
  "typecheck:effect",
  "lint:code",
  "check:circular",
  "check:complexity",
  "check:duplicates",
  "test:coverage:explanation",
  "test:gate-custody",
  "test:gate-resume",
  "test:preflight",
  "test:ci-change-classification",
  "test:quint:selection",
  "check:secrets",
  "check:artifacts",
  "test:capability-registration"
]

it(
  "reports multiple independent structural failures before any expensive qualification",
  async () => {
    expect(structuralCommands).not.toContain("test:mbt")
    const { invocations, result } = await runQualityGateFixture({
      fixtureName: "preflight-failures",
      failureCommands: ["lint:code", "check:complexity", "check:artifacts"]
    })
    expect(invocations).toEqual(structuralCommands)
    expect(result.output).toContain("3 failed stages")
    for (const command of ["lint:code", "check:complexity", "check:artifacts"])
      expect(result.output).toContain(`Preflight failed: pnpm ${command}`)
    expect(result.output).toContain("qualification stages did not start")
  },
  qualityGateFixtureTestTimeoutMilliseconds
)

it(
  "standalone preflight and successful full gate share one exact structural inventory",
  async () => {
    const preflight = await runQualityGateFixture({
      fixtureName: "preflight-standalone",
      runner: "scripts/run-preflight.mjs"
    })
    const full = await runQualityGateFixture({ fixtureName: "preflight-full" })
    expect(preflight.invocations).toEqual(structuralCommands)
    expect(full.invocations.slice(0, structuralCommands.length)).toEqual(structuralCommands)
    for (const command of structuralCommands)
      expect(full.invocations.filter((invocation) => invocation === command)).toHaveLength(1)
    expect(full.invocations).toContain("test:coverage")
    expect(preflight.invocationArguments).toContainEqual(["lint:code", "--census"])
  },
  qualityGateFixturePairTestTimeoutMilliseconds
)

it(
  "does not qualify a candidate when the final formal selection controls fail",
  async () => {
    const { invocations, result } = await runQualityGateFixture({
      fixtureName: "formal-selection-controls-failure",
      failureCommand: "test:quint:selection"
    })
    expect(invocations).toEqual(structuralCommands)
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("Preflight failed: pnpm test:quint:selection")
    expect(invocations).not.toContain("test:coverage")
    expect(invocations).not.toContain("check:quint")
  },
  qualityGateFixtureTestTimeoutMilliseconds
)
