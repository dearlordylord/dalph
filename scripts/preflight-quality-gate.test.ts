import { expect, it } from "vitest"
import {
  qualityGateFixturePairTestTimeoutMilliseconds,
  qualityGateFixtureTestTimeoutMilliseconds,
  runQualityGateFixture
} from "./quality-gate-test-fixture.js"

const structuralCommands = [
  "check:artifacts",
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
  "test:formal:controls",
  "check:secrets",
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
    expect(full.invocations).toContain("test")
    expect(preflight.invocationArguments).toContainEqual(["lint:code", "--census"])
  },
  qualityGateFixturePairTestTimeoutMilliseconds
)

it(
  "does not qualify a candidate when the focused formal controls fail",
  async () => {
    const { invocations, result } = await runQualityGateFixture({
      fixtureName: "formal-controls-failure",
      failureCommand: "test:formal:controls"
    })
    expect(invocations).toEqual(structuralCommands)
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("Preflight failed: pnpm test:formal:controls")
    expect(invocations).not.toContain("test")
    expect(invocations).not.toContain("check:quint")
  },
  qualityGateFixtureTestTimeoutMilliseconds
)
