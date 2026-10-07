import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import {
  createQualityGateStagePlan,
  qualityGateStagePlanPolicyDigest,
  supportedNodeVersionsFromPackage,
  writeQualityGateStagePlanOutputs
} from "./quality-gate-stage-plan.mjs"
import {
  fullQualityGateManifest,
  qualityGateCleanRunnerPreparation,
  qualityGateQualificationStageIds,
  qualificationQualityGates
} from "./quality-gate-stage-policy.mjs"

const baseSha = "b".repeat(40)
const candidateSha = "c".repeat(40)

void test("the shared manifest names the three independent suffix obligations once", () => {
  const manifestIds = fullQualityGateManifest(baseSha)
    .filter(({ boundary }) => boundary === "qualification")
    .map(({ id }) => id)
  assert.deepEqual(manifestIds, qualityGateQualificationStageIds)
  assert.deepEqual(
    qualificationQualityGates().map(({ id }) => id),
    ["mbt-replay", "recorded-catalog", "coverage"]
  )
  assert.deepEqual(qualityGateCleanRunnerPreparation, {
    artifactTransfer: "none",
    commands: [
      { args: ["install", "--frozen-lockfile"], id: "frozen-install", timeoutMilliseconds: 300_000 },
      { args: ["check:artifacts"], id: "artifact-preparation", timeoutMilliseconds: 300_000 }
    ],
    id: "frozen-install-and-artifact-preparation",
    preflightRerun: false,
    timeoutMilliseconds: 600_000
  })
})

void test("generates one exact candidate/Base/policy plan entry for every Node and suffix stage", () => {
  const plan = createQualityGateStagePlan({ baseSha, candidateSha, nodeVersions: ["24.20.0", "25.1.0"] })

  assert.deepEqual(plan.expectedStageIds, qualityGateQualificationStageIds)
  assert.deepEqual(plan.expectedCells, [
    { nodeVersion: "24.20.0", stageId: "mbt-replay" },
    { nodeVersion: "24.20.0", stageId: "recorded-catalog" },
    { nodeVersion: "24.20.0", stageId: "coverage" },
    { nodeVersion: "25.1.0", stageId: "mbt-replay" },
    { nodeVersion: "25.1.0", stageId: "recorded-catalog" },
    { nodeVersion: "25.1.0", stageId: "coverage" }
  ])
  assert.deepEqual(plan.nodeVersions, ["24.20.0", "25.1.0"])
  assert.equal(plan.stages.length, 6)
  assert.equal(plan.policyDigest, qualityGateStagePlanPolicyDigest)
  assert.match(plan.configurationDigest, /^[0-9a-f]{64}$/u)
  assert.equal(plan.configDigest, plan.configurationDigest)
  assert.deepEqual(plan.cleanRunnerPreparation, qualityGateCleanRunnerPreparation)
  assert.ok(
    plan.stages.every(
      ({ cleanRunnerPreparation }) =>
        JSON.stringify(cleanRunnerPreparation) === JSON.stringify(qualityGateCleanRunnerPreparation)
    )
  )
  assert.deepEqual(
    plan.stages.map(({ nodeVersion, stageId }) => `${nodeVersion}:${stageId}`),
    [
      "24.20.0:mbt-replay",
      "24.20.0:recorded-catalog",
      "24.20.0:coverage",
      "25.1.0:mbt-replay",
      "25.1.0:recorded-catalog",
      "25.1.0:coverage"
    ]
  )

  const coverage = plan.stages.find(({ stageId }) => stageId === "coverage")
  assert.deepEqual(coverage?.artifactObligations, [
    { id: "coverage-final", path: "coverage/coverage-final.json", required: true, type: "coverage" },
    { id: "coverage-summary", path: "coverage/coverage-summary.json", required: true, type: "coverage" }
  ])
})

void test("allows an explicitly selected known suffix stage while retaining canonical order", () => {
  const plan = createQualityGateStagePlan({ baseSha, candidateSha, nodeVersions: ["24.20.0"], stageIds: ["coverage"] })
  assert.deepEqual(plan.expectedStageIds, ["coverage"])
  assert.deepEqual(
    plan.stages.map(({ stageId }) => stageId),
    ["coverage"]
  )
})

void test("fails closed for unsupported stage, identity, candidate/Base, and Node inputs", () => {
  const valid = { baseSha, candidateSha, nodeVersions: ["24.20.0"] }
  assert.throws(
    () => createQualityGateStagePlan({ ...valid, stageIds: ["tests"] }),
    /Unsupported qualification stage ID: tests/u
  )
  assert.throws(
    () => createQualityGateStagePlan({ ...valid, policyIdentity: { id: "foreign", revision: 1, version: 1 } }),
    /Unsupported quality stage policy identity/u
  )
  assert.throws(() => createQualityGateStagePlan({ ...valid, baseSha: "BASE" }), /Base SHA/u)
  assert.throws(() => createQualityGateStagePlan({ ...valid, candidateSha: "HEAD" }), /candidate SHA/u)
  assert.throws(() => createQualityGateStagePlan({ ...valid, nodeVersions: ["v24.20.0"] }), /Node semver/u)
  assert.throws(() => createQualityGateStagePlan({ ...valid, nodeVersions: ["24.20.0", "24.20.0"] }), /distinct/u)
})

void test("derives the hosted Node matrix from package engines and writes stable workflow outputs", () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-quality-stage-plan-"))
  try {
    const packagePath = join(root, "package.json")
    writeFileSync(packagePath, JSON.stringify({ engines: { node: "^24.20.0 || ^25.1.0" } }))
    assert.deepEqual(supportedNodeVersionsFromPackage(packagePath), ["24.20.0", "25.1.0"])

    const outputPath = join(root, "github-output")
    const plan = createQualityGateStagePlan({ baseSha, candidateSha, nodeVersions: ["24.20.0"] })
    const outputs = writeQualityGateStagePlanOutputs(plan, outputPath)
    assert.equal(outputs["configuration-digest"], plan.configurationDigest)
    assert.equal(
      readFileSync(outputPath, "utf8"),
      [
        `configuration-digest=${plan.configurationDigest}`,
        `expected-cells=${JSON.stringify(plan.expectedCells)}`,
        `node-versions=${JSON.stringify(plan.nodeVersions)}`,
        `policy-digest=${plan.policyDigest}`,
        `stage-ids=${JSON.stringify(plan.expectedStageIds)}`,
        ""
      ].join("\n")
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("the plan CLI rejects unsupported options before emitting a matrix", () => {
  const script = fileURLToPath(new URL("./quality-gate-stage-plan.mjs", import.meta.url))
  assert.throws(
    () =>
      execFileSync(process.execPath, [script, "--base", baseSha, "--candidate", candidateSha, "--foreign", "value"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }),
    /Unsupported quality stage plan argument: --foreign/u
  )
})

void test("ordinary hosted changes select the same coverage policy as local checks", () => {
  const changedPaths = ["packages/dalph/src/application/cli.ts"]
  const plan = createQualityGateStagePlan({ baseSha, candidateSha, nodeVersions: ["24.20.0", "25.1.0"], changedPaths })
  assert.deepEqual(plan.nodeVersions, ["24.20.0"])
  assert.deepEqual(plan.expectedStageIds, ["mbt-replay", "coverage"])
  const local = fullQualityGateManifest(baseSha, { changedPaths }).filter(
    ({ boundary }) => boundary === "qualification"
  )
  assert.deepEqual(
    local.map(({ id }) => id),
    plan.expectedStageIds
  )
  assert.deepEqual(
    plan.stages.map((stage) => stage.command.args.slice(2)),
    local.map(({ args }) => args)
  )
  const broad = createQualityGateStagePlan({
    baseSha,
    candidateSha,
    nodeVersions: ["24.20.0", "25.1.0"],
    changedPaths: ["scripts/run-bounded-command.mjs"]
  })
  assert.equal(broad.stages.length, 6)
})

void test("the hosted suffix job budget contains preparation, child stop, and evidence export", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
  const suffix = workflow.split("  quality-suffix:\n")[1]?.split(/^  [a-z][a-z-]*:\n/mu)[0]
  assert.ok(suffix, "missing hosted quality suffix job")
  const timeout = suffix.match(/^    timeout-minutes: (\d+)$/mu)
  assert.ok(timeout, "hosted suffix requires an explicit finite outer deadline")
  const jobBudgetMilliseconds = Number(timeout[1]) * 60_000
  const setupAndEvidenceReserveMilliseconds = 5 * 60_000
  for (const stage of qualificationQualityGates()) {
    const requiredMilliseconds =
      stage.cleanRunnerPreparation.timeoutMilliseconds +
      stage.timeout +
      stage.terminationGrace +
      stage.processGroupAbsenceTimeout +
      setupAndEvidenceReserveMilliseconds
    assert.ok(
      jobBudgetMilliseconds >= requiredMilliseconds,
      `${stage.id} requires preparation + complete child allowance + proved stop + setup/evidence reserve; ` +
        `outer ${jobBudgetMilliseconds}ms truncates ${requiredMilliseconds}ms`
    )
  }
})

void test("manual coverage diagnostics cross UID isolation and retain successful child logs", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
  assert.match(workflow, /coverage-diagnostics:\n\s+description:.*\n\s+type: boolean\n\s+default: false/u)
  assert.ok(workflow.includes("DALPH_CI_DISPATCH_BASE_SHA: ${{ inputs['comparison-base'] || '' }}"))
  const suffix = workflow.split("  quality-suffix:\n")[1]?.split(/^  [a-z][a-z-]*:\n/mu)[0]
  assert.ok(suffix)
  assert.ok(
    suffix.includes(
      "github.event_name == 'workflow_dispatch' && inputs['coverage-diagnostics'] && matrix.stageId == 'coverage'"
    )
  )
  assert.ok(suffix.includes('"DALPH_COVERAGE_RESOURCE_OBSERVATIONS=$DALPH_COVERAGE_RESOURCE_OBSERVATIONS"'))
  const logs = suffix.split("      - name: Upload failed hosted quality child logs\n")[1]?.split("      # This step")[0]
  assert.ok(logs?.includes("inputs['coverage-diagnostics'] && matrix.stageId == 'coverage'"))
  assert.ok(logs?.includes("include-hidden-files: true"))
})
