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
  qualityGatePolicyIdentity,
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
    ["delivery-repeatability", "recorded-catalog", "coverage"]
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
    { nodeVersion: "24.20.0", stageId: "delivery-repeatability" },
    { nodeVersion: "24.20.0", stageId: "recorded-catalog" },
    { nodeVersion: "24.20.0", stageId: "coverage" },
    { nodeVersion: "25.1.0", stageId: "delivery-repeatability" },
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
      "24.20.0:delivery-repeatability",
      "24.20.0:recorded-catalog",
      "24.20.0:coverage",
      "25.1.0:delivery-repeatability",
      "25.1.0:recorded-catalog",
      "25.1.0:coverage"
    ]
  )

  const delivery = plan.stages.find(({ stageId }) => stageId === "delivery-repeatability")
  assert.deepEqual(delivery?.command.args, ["pnpm", "--silent", "test:delivery-repeatability"])
  assert.deepEqual(delivery?.bounds, {
    processGroupAbsenceTimeoutMilliseconds: 2_000,
    terminationGraceMilliseconds: 15_000,
    timeoutMilliseconds: 1_140_000
  })
  assert.deepEqual(delivery?.artifactObligations, [
    { id: "delivery-digest", required: true, type: "delivery-repeatability-digest" }
  ])
  assert.deepEqual(delivery?.identity, {
    baseSha,
    candidateSha,
    nodeVersion: "24.20.0",
    policy: qualityGatePolicyIdentity,
    policyDigest: plan.policyDigest,
    configurationDigest: plan.configurationDigest,
    stageId: "delivery-repeatability",
    version: 1
  })

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
