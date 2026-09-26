import assert from "node:assert/strict"
import test from "node:test"
import { selectQualityStages } from "./quality-check-selection.mjs"
import { fullQualityGateManifest } from "./quality-gate-stage-policy.mjs"

const manifest = fullQualityGateManifest("a".repeat(40))
const ids = (paths) => selectQualityStages(manifest, paths).map((stage) => stage.id)

void test("product changes retain runtime proof without infrastructure and catalog reruns", () => {
  const selected = ids(["packages/orchestrator/src/coordination/run/frontier.ts"])
  for (const id of [
    "production-artifacts",
    "typecheck",
    "format-lint",
    "secrets",
    "capability-registration",
    "delivery-repeatability",
    "coverage"
  ])
    assert.ok(selected.includes(id), id)
  for (const id of [
    "complexity",
    "duplicates",
    "custody-controls",
    "resume-controls",
    "reducer-lab",
    "recorded-catalog"
  ])
    assert.ok(!selected.includes(id), id)
})

void test("tooling, shared configuration, and unknown changes retain infrastructure controls", () => {
  for (const paths of [
    undefined,
    [],
    ["scripts/with-gate-slot.mjs"],
    ["package.json"],
    ["vitest.config.ts"],
    ["pnpm-lock.yaml"],
    ["packages/orchestrator/tsconfig.json"],
    ["packages/dalph/package.json"]
  ]) {
    const selected = ids(paths)
    for (const id of ["custody-controls", "resume-controls", "preflight-controls", "recorded-catalog", "reducer-lab"])
      assert.ok(selected.includes(id), `${JSON.stringify(paths)}: ${id}`)
    assert.ok(!selected.includes("complexity"))
    assert.ok(!selected.includes("duplicates"))
  }
})

void test("cassette and projection changes retain their unique catalog and Lab assertions", () => {
  for (const path of [
    "packages/dalph/src/cassettes/schema.ts",
    "packages/contracts/src/journal/projection.ts",
    "prototypes/reducer-lab/src/main.ts"
  ])
    for (const id of ["recorded-catalog", "reducer-lab"]) assert.ok(ids([path]).includes(id), `${path}: ${id}`)
})
