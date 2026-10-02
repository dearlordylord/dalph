import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import { selectQualityStages } from "./quality-check-selection.mjs"
import { baselineQualityGates, fullQualityGateManifest } from "./quality-gate-stage-policy.mjs"

const manifest = fullQualityGateManifest("a".repeat(40))
const ids = (paths) => selectQualityStages(manifest, paths).map((stage) => stage.id)

void test("maintained Lab proof keeps its measured finite command bound", () => {
  assert.equal(baselineQualityGates().find((gate) => gate.args[0] === "check:lab")?.timeout, 7 * 60_000)
  assert.equal(manifest.find((stage) => stage.id === "reducer-lab")?.timeout, 7 * 60_000)
})

void test("product changes retain runtime proof without infrastructure and catalog reruns", () => {
  const selected = ids(["packages/orchestrator/src/coordination/run/frontier.ts"])
  for (const id of [
    "production-artifacts",
    "typecheck",
    "format-lint",
    "secrets",
    "capability-registration",
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
  assert.ok(!selected.includes("delivery-repeatability"))
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
    for (const id of ["custody-controls", "resume-controls", "preflight-controls", "recorded-catalog"])
      assert.ok(selected.includes(id), `${JSON.stringify(paths)}: ${id}`)
    assert.equal(selected.includes("reducer-lab"), paths === undefined || paths.length === 0, JSON.stringify(paths))
    assert.ok(!selected.includes("complexity"))
    assert.ok(!selected.includes("duplicates"))
  }
})

void test("cassette and projection changes retain catalog assertions without Lab UI evaluation", () => {
  for (const path of ["packages/dalph/src/cassettes/schema.ts", "packages/contracts/src/journal/projection.ts"]) {
    assert.ok(ids([path]).includes("recorded-catalog"), path)
    assert.ok(!ids([path]).includes("reducer-lab"), path)
  }
  const labPaths = ids(["prototypes/reducer-lab/src/main.ts"])
  for (const id of ["recorded-catalog", "reducer-lab"]) assert.ok(labPaths.includes(id), id)
})

void test("manual historical deep sampling and smoke share the fresh-process runner", () => {
  const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts
  assert.equal(
    scripts["test:delivery-repeatability"],
    "DALPH_RUN_HISTORICAL_CHRONOLOGY=1 node scripts/run-delivery-repeatability.mjs"
  )
  assert.equal(scripts["test:delivery-smoke"], "DALPH_RUN_HISTORICAL_CHRONOLOGY=1 node scripts/run-delivery-smoke.mjs")
})
