import { execFileSync } from "node:child_process"
import { expect, it } from "vitest"
// @ts-expect-error The quality-gate policy is an executable JavaScript module.
import * as qualityGateStagePolicy from "./quality-gate-stage-policy.mjs"
import { qualityGateFixtureTestTimeoutMilliseconds, runQualityGateFixture } from "./quality-gate-test-fixture.js"

const { boundedQualityGateCommand, complexityQualityGate, qualityGateTestEnvironment } = qualityGateStagePolicy

it("passes the resolved hosted base to the bounded complexity stage", () => {
  const gate = complexityQualityGate("0123456789abcdef0123456789abcdef01234567")

  expect(
    boundedQualityGateCommand({ gate, nodeExecutable: "/fixture/node", pnpmEntryPoint: "/fixture/pnpm.cjs" })
  ).toMatchObject({
    args: ["/fixture/pnpm.cjs", "--silent", "check:complexity", "--candidate=0123456789abcdef0123456789abcdef01234567"]
  })
})

it(
  "gives coverage and complexity the same canonical explicit-candidate base",
  async () => {
    const baseSha = execFileSync("git", ["rev-parse", "HEAD^"], { encoding: "utf8" }).trim()
    const { invocationArguments, invocationCoverageBases, result } = await runQualityGateFixture({
      environment: {
        DALPH_COVERAGE_BASE_SHA: execFileSync("git", ["rev-parse", "HEAD^^"], { encoding: "utf8" }).trim()
      },
      fixtureName: "explicit-complexity-base",
      gateArguments: [`--candidate=${baseSha}`]
    })

    expect(result.exitCode).toBe(0)
    expect(invocationArguments).toContainEqual(["check:complexity", `--candidate=${baseSha}`])
    expect(invocationCoverageBases).toContainEqual(["test:coverage", baseSha])
    expect(qualityGateTestEnvironment(baseSha, { DALPH_COVERAGE_BASE_SHA: "stale" }).DALPH_COVERAGE_BASE_SHA).toBe(
      baseSha
    )
  },
  qualityGateFixtureTestTimeoutMilliseconds
)

it(
  "forwards the hosted coverage base through the full-gate runner",
  async () => {
    const baseSha = execFileSync("git", ["rev-parse", "HEAD^"], { encoding: "utf8" }).trim()
    const { invocationArguments, result } = await runQualityGateFixture({
      environment: { CI: "true", DALPH_COVERAGE_BASE_SHA: baseSha },
      fixtureName: "complexity-base"
    })

    expect(result.exitCode).toBe(0)
    expect(invocationArguments).toContainEqual(["check:complexity", `--candidate=${baseSha}`])
  },
  qualityGateFixtureTestTimeoutMilliseconds
)
