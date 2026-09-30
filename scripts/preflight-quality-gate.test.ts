import { expect, it } from "vitest"
// @ts-expect-error The quality-gate policy is an executable JavaScript module.
import { fullQualityGateManifest, preflightQualityGates } from "./quality-gate-stage-policy.mjs"
import {
  broadQualityGateStructuralCommands,
  qualityGateFixturePairTestTimeoutMilliseconds,
  qualityGateFixtureTestTimeoutMilliseconds,
  qualityGateBroadPlanBaseSha,
  runQualityGateFixture
} from "./quality-gate-test-fixture.js"

const structuralCommands = broadQualityGateStructuralCommands
const broadQualificationCommands = ["test:delivery-repeatability", "test:recorded-catalog", "test"]
const pinnedSourceOnlyPaths = [
  "docs/ISSUE-386-ACCEPTANCE-AUDIT.md",
  "docs/scenarios/production-codex-integrator.md",
  "packages/dalph/src/application/codex-integrator.test.ts",
  "packages/dalph/src/application/codex-integrator.ts"
]
const selectedCommands = (changedPaths: ReadonlyArray<string>) =>
  (
    fullQualityGateManifest("4c6761a4f07bbdf9198763f44686ebae27eba680", { changedPaths }) as ReadonlyArray<{
      readonly args: ReadonlyArray<string>
    }>
  ).map(({ args }) => args[0])

it("selects the exact narrow inventory for the pinned Base paths and the broad shared inventory", () => {
  expect(selectedCommands(pinnedSourceOnlyPaths)).toEqual([
    "check:artifacts",
    "typecheck",
    "lint:code",
    "check:circular",
    "check:secrets",
    "test:capability-registration",
    "test:delivery-smoke",
    "test"
  ])
  expect(selectedCommands(["scripts/run-quality-gate.mjs"])).toEqual([
    ...structuralCommands.filter((command) => command !== "check:lab"),
    ...broadQualificationCommands
  ])
})

it("keeps the split custody controls inside their original bounded deadline", () => {
  const gates = preflightQualityGates("fixture-base")
  for (const command of ["test:gate-custody", "test:gate-resume"])
    expect(gates.find(({ args }: { readonly args: ReadonlyArray<string> }) => args[0] === command)).toMatchObject({
      timeout: 120_000
    })
})

it(
  "reports multiple independent structural failures before any expensive qualification",
  async () => {
    expect(structuralCommands).not.toContain("test:mbt")
    const { invocations, result } = await runQualityGateFixture({
      environment: { DALPH_COVERAGE_BASE_SHA: qualityGateBroadPlanBaseSha() },
      fixtureName: "preflight-failures",
      failureCommands: ["lint:code", "typecheck", "check:artifacts"]
    })
    expect(invocations).toEqual(structuralCommands)
    expect(result.output).toContain("3 failed stages")
    for (const command of ["lint:code", "typecheck", "check:artifacts"])
      expect(result.output).toContain(`Preflight failed: pnpm ${command}`)
    expect(result.output).toContain("qualification stages did not start")
  },
  qualityGateFixtureTestTimeoutMilliseconds
)

it(
  "standalone preflight and successful full gate share one exact structural inventory",
  async () => {
    const preflight = await runQualityGateFixture({
      environment: { DALPH_COVERAGE_BASE_SHA: qualityGateBroadPlanBaseSha() },
      fixtureName: "preflight-standalone",
      runner: "scripts/run-preflight.mjs"
    })
    const full = await runQualityGateFixture({
      environment: { DALPH_COVERAGE_BASE_SHA: qualityGateBroadPlanBaseSha() },
      fixtureName: "preflight-full"
    })
    expect(preflight.invocations).toEqual(structuralCommands)
    expect(full.invocations).toEqual([...structuralCommands, ...broadQualificationCommands])
    for (const command of structuralCommands)
      expect(full.invocations.filter((invocation) => invocation === command)).toHaveLength(1)
    expect(preflight.invocationArguments).toContainEqual(["lint:code", "--census"])
  },
  qualityGateFixturePairTestTimeoutMilliseconds
)

it(
  "does not qualify a candidate when the focused formal controls fail",
  async () => {
    const { invocations, result } = await runQualityGateFixture({
      environment: { DALPH_COVERAGE_BASE_SHA: qualityGateBroadPlanBaseSha() },
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

it(
  "fails before formal evidence and qualification when the maintained Lab fails",
  async () => {
    const { invocations, result } = await runQualityGateFixture({
      environment: { DALPH_COVERAGE_BASE_SHA: qualityGateBroadPlanBaseSha() },
      fixtureName: "reducer-lab-failure",
      failureCommand: "check:lab"
    })

    expect(invocations).toEqual(structuralCommands)
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("Preflight failed: pnpm check:lab")
    expect(result.output).toContain("qualification stages did not start")
    expect(invocations).not.toContain("test:delivery-repeatability")
    expect(invocations).not.toContain("test:recorded-catalog")
    expect(invocations).not.toContain("test")
    expect(invocations).not.toContain("check:quint")
  },
  qualityGateFixtureTestTimeoutMilliseconds
)
