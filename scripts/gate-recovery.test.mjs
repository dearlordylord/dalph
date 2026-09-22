import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { readRecord, repositoryLocation } from "./gate-custody-records.mjs"
import { currentSourceInputDigest } from "./gate-run-identity.mjs"
import {
  beginRecoveredQualification,
  completeRecoveredQualification,
  gateRecoveryPath,
  reconcileGateRecovery,
  recordGateObstruction,
  requireGateRecoveryAdmission
} from "./gate-recovery.mjs"

const wrapper = fileURLToPath(new URL("./with-gate-slot.mjs", import.meta.url))
const diagnosis = fileURLToPath(new URL("./run-gate-diagnosis.mjs", import.meta.url))
const verification = fileURLToPath(new URL("./run-gate-repair-verification.mjs", import.meta.url))

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-gate-recovery-"))
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git("init", "-q")
  writeFileSync(join(root, ".gitignore"), ".scratch/\n")
  mkdirSync(join(root, "scripts"))
  writeFileSync(
    join(root, "scripts", "run-quality-gate.mjs"),
    "if (process.env.CONTROLLED_GATE_FAILURE === '1') process.exitCode = 7\n"
  )
  writeFileSync(
    join(root, "scripts", "focused-reproducer.mjs"),
    "import { existsSync } from 'node:fs'; if (!existsSync('repair.marker')) { console.error('cleanup join stalled'); process.exitCode = 9 }\n"
  )
  git("add", ".")
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base")
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "candidate"
  )
  return {
    root,
    baseSha: git("rev-parse", "HEAD^"),
    focusedCommand: [process.execPath, join(root, "scripts", "focused-reproducer.mjs")],
    cleanup: () => rmSync(root, { recursive: true, force: true })
  }
}

const environment = (extra = {}) => {
  const value = { ...process.env, ...extra }
  for (const name of [
    "DALPH_GATE_RUN_DIRECTORY",
    "DALPH_GATE_RUN_ID",
    "DALPH_GATE_OBLIGATION",
    "DALPH_GATE_SLOT",
    "DALPH_GATE_DEADLINE",
    "DALPH_GATE_RECOVERY_MODE",
    "DALPH_COVERAGE_DIRECTORY",
    "DALPH_COVERAGE_BASE_SHA",
    "DALPH_GATE_GIT_HISTORY"
  ])
    delete value[name]
  return value
}

const fullGate = (fixture_) =>
  spawnSync(
    process.execPath,
    [
      wrapper,
      "--",
      process.execPath,
      join(fixture_.root, "scripts", "run-quality-gate.mjs"),
      "--local-handoff",
      `--candidate=${fixture_.baseSha}`
    ],
    { cwd: fixture_.root, encoding: "utf8", env: environment() }
  )

const evidence = (fixture_, runId = randomUUID()) => ({
  runId,
  baseSha: fixture_.baseSha,
  sourceInputDigest: currentSourceInputDigest(fixture_.root),
  qualification: "UNPROVEN",
  terminal: { commandExit: 7 },
  stages: [
    {
      obligationId: randomUUID(),
      command: { name: "controlled failing qualification" },
      outcome: "exit:7",
      exitCode: 7,
      signal: null,
      log: { path: "/controlled/failure.log", sha256: "1".repeat(64), bytes: 1 }
    }
  ]
})

const seedObstruction = (fixture_) => {
  const location = repositoryLocation(fixture_.root)
  const gateEvidence = evidence(fixture_)
  recordGateObstruction({ location, evidence: gateEvidence })
  return { failedRunId: gateEvidence.runId, location }
}

const focusedDiagnosis = ({
  command,
  expected = "exit:9",
  failedRunId,
  fixture_,
  contains = command === undefined ? "cleanup join stalled" : "controlled diagnostic observation",
  question = "where did execution stop?"
}) =>
  spawnSync(
    process.execPath,
    [
      wrapper,
      "--",
      process.execPath,
      diagnosis,
      failedRunId,
      `--question=${question}`,
      "--alternatives=product progress stopped | cleanup join stalled",
      "--observation=the focused child exposes whether cleanup reaches its final checkpoint",
      `--contains=${contains}`,
      `--expect=${expected}`,
      "--supports=2",
      "--",
      ...(command ?? fixture_.focusedCommand)
    ],
    { cwd: fixture_.root, encoding: "utf8", env: environment() }
  )

const verifyRepair = (fixture_, failedRunId, intervention) =>
  spawnSync(
    process.execPath,
    [
      wrapper,
      "--",
      process.execPath,
      verification,
      failedRunId,
      ...(intervention === undefined ? [] : [`--intervention=${intervention}`])
    ],
    { cwd: fixture_.root, encoding: "utf8", env: environment() }
  )

void test("a failed full gate blocks blind reruns across candidate changes", () => {
  const f = fixture()
  try {
    const { location } = seedObstruction(f)
    const recovery = readRecord(gateRecoveryPath(location))
    assert.equal(recovery.state, "diagnosis-required")
    writeFileSync(join(f.root, "changed-candidate.txt"), "changed\n")
    const rejected = fullGate(f)
    assert.equal(rejected.status, 1, rejected.stderr)
    assert.match(rejected.stderr, /requires focused diagnosis/u)
    assert.equal(readRecord(gateRecoveryPath(location)).failedRunId, recovery.failedRunId)
  } finally {
    f.cleanup()
  }
})

void test("diagnosis, changed repair, verification, and qualification form distinct transitions", () => {
  const f = fixture()
  try {
    const { failedRunId, location } = seedObstruction(f)
    const diagnosed = focusedDiagnosis({ failedRunId, fixture_: f })
    assert.equal(diagnosed.status, 0, diagnosed.stderr)
    assert.equal(readRecord(gateRecoveryPath(location)).state, "repair-required")
    assert.match(fullGate(f).stderr, /repair the diagnosed obstruction/u)

    writeFileSync(join(f.root, "repair.marker"), "repaired\n")
    const verified = verifyRepair(f, failedRunId)
    assert.equal(verified.status, 0, verified.stderr)
    const sourceInputDigest = currentSourceInputDigest(f.root)
    assert.equal(
      requireGateRecoveryAdmission({ currentSourceInputDigest: sourceInputDigest, location }).state,
      "verified"
    )
    const qualificationRunId = randomUUID()
    beginRecoveredQualification({ currentSourceInputDigest: sourceInputDigest, location, runId: qualificationRunId })
    completeRecoveredQualification({ location, passed: true, runId: qualificationRunId })
    assert.equal(existsSync(gateRecoveryPath(location)), false)
  } finally {
    f.cleanup()
  }
})

void test("an inconclusive diagnosis retains the obstruction and prose renaming cannot repeat it", () => {
  const f = fixture()
  try {
    const { failedRunId, location } = seedObstruction(f)
    const first = focusedDiagnosis({ expected: "passed", failedRunId, fixture_: f })
    assert.equal(first.status, 1, first.stderr)
    assert.equal(readRecord(gateRecoveryPath(location)).state, "diagnosis-required")
    const renamed = focusedDiagnosis({
      expected: "passed",
      failedRunId,
      fixture_: f,
      question: "is this the same intervention under a new hypothesis?"
    })
    assert.equal(renamed.status, 1, renamed.stderr)
    assert.match(renamed.stderr, /already ran/u)
  } finally {
    f.cleanup()
  }
})

void test("a matching exit without the predicted output remains inconclusive", () => {
  const f = fixture()
  try {
    const { failedRunId, location } = seedObstruction(f)
    const result = focusedDiagnosis({
      command: [process.execPath, "-e", "console.error('different observation');process.exit(9)"],
      failedRunId,
      fixture_: f
    })
    assert.equal(result.status, 1, result.stderr)
    const attempt = readRecord(gateRecoveryPath(location)).diagnosisAttempts.at(-1)
    assert.equal(attempt.actualOutcome, "exit:9")
    assert.equal(attempt.outputMatched, false)
    assert.equal(attempt.outcome, "inconclusive")
  } finally {
    f.cleanup()
  }
})

void test("a shell-wrapped broad gate is rejected at the nested admission boundary", () => {
  const f = fixture()
  try {
    const { failedRunId, location } = seedObstruction(f)
    const shell = join(f.root, ".scratch", "broad-wrapper.sh")
    mkdirSync(join(f.root, ".scratch"), { recursive: true })
    writeFileSync(
      shell,
      `#!/bin/bash\nunset DALPH_GATE_RECOVERY_MODE\nexec ${process.execPath} ${wrapper} -- ${process.execPath} ${join(f.root, "scripts", "run-quality-gate.mjs")} --local-handoff --candidate=${f.baseSha}\n`
    )
    const command = ["bash", shell]
    const result = focusedDiagnosis({ command, expected: "passed", failedRunId, fixture_: f })
    assert.equal(result.status, 1, result.stderr)
    const recovery = readRecord(gateRecoveryPath(location))
    assert.equal(recovery.state, "diagnosis-required")
    const log = readFileSync(recovery.diagnosisAttempts.at(-1).log.path, "utf8")
    assert.match(log, /cannot launch a broad admitted command/u)
  } finally {
    f.cleanup()
  }
})

void test("unsetting the mode cannot directly invoke the full quality entry point", () => {
  const f = fixture()
  try {
    const { failedRunId, location } = seedObstruction(f)
    const command = [
      "bash",
      "-c",
      `unset DALPH_GATE_RECOVERY_MODE; quality_name=run-quality-; quality_name+=gate.mjs; exec ${process.execPath} ${JSON.stringify(dirname(wrapper))}/$quality_name --local-handoff --candidate=${f.baseSha}`
    ]
    const result = focusedDiagnosis({
      command,
      contains: "cannot launch the full quality gate",
      expected: "exit:1",
      failedRunId,
      fixture_: f
    })
    assert.equal(result.status, 0, result.stderr)
    const attempt = readRecord(gateRecoveryPath(location)).diagnosisAttempts.at(-1)
    assert.equal(attempt.actualOutcome, "exit:1")
    assert.equal(attempt.outputMatched, true)
  } finally {
    f.cleanup()
  }
})

void test("a later candidate change invalidates verification but can be reverified", () => {
  const f = fixture()
  try {
    const { failedRunId, location } = seedObstruction(f)
    assert.equal(focusedDiagnosis({ failedRunId, fixture_: f }).status, 0)
    writeFileSync(join(f.root, "repair.marker"), "repaired\n")
    assert.equal(verifyRepair(f, failedRunId).status, 0)
    writeFileSync(join(f.root, "later-change.txt"), "later\n")
    assert.throws(
      () => requireGateRecoveryAdmission({ currentSourceInputDigest: currentSourceInputDigest(f.root), location }),
      /became stale/u
    )
    assert.equal(verifyRepair(f, failedRunId).status, 0)
    assert.equal(readRecord(gateRecoveryPath(location)).state, "verified")
  } finally {
    f.cleanup()
  }
})

void test("an ignored-resource intervention can be verified without a candidate content edit", () => {
  const f = fixture()
  try {
    const { failedRunId, location } = seedObstruction(f)
    const ignoredMarker = join(f.root, ".scratch", "external-resource-ready")
    const command = [
      process.execPath,
      "-e",
      `if(!require('fs').existsSync(${JSON.stringify(ignoredMarker)})){console.error('controlled diagnostic observation');process.exit(9)}`
    ]
    assert.equal(focusedDiagnosis({ command, failedRunId, fixture_: f }).status, 0)
    mkdirSync(join(f.root, ".scratch"), { recursive: true })
    writeFileSync(ignoredMarker, "ready\n")
    const verified = verifyRepair(f, failedRunId, "provisioned the ignored external resource")
    assert.equal(verified.status, 0, verified.stderr)
    assert.equal(
      readRecord(gateRecoveryPath(location)).verificationAttempts.at(-1).intervention,
      "provisioned the ignored external resource"
    )
  } finally {
    f.cleanup()
  }
})

void test("a failed verification permits a changed diagnostic strategy", () => {
  const f = fixture()
  try {
    const { failedRunId, location } = seedObstruction(f)
    assert.equal(focusedDiagnosis({ failedRunId, fixture_: f }).status, 0)
    const failedVerification = verifyRepair(f, failedRunId, "attempted external cleanup")
    assert.equal(failedVerification.status, 1, failedVerification.stderr)
    assert.equal(readRecord(gateRecoveryPath(location)).state, "repair-required")
    const changed = focusedDiagnosis({
      command: [process.execPath, "-e", "console.error('controlled diagnostic observation');process.exit(8)"],
      expected: "exit:8",
      failedRunId,
      fixture_: f,
      question: "did the prior hypothesis miss a second obstruction?"
    })
    assert.equal(changed.status, 0, changed.stderr)
    const recovery = readRecord(gateRecoveryPath(location))
    assert.equal(recovery.state, "repair-required")
    assert.equal(recovery.diagnosisAttempts.length, 2)
  } finally {
    f.cleanup()
  }
})

void test("repeated broad failure preserves parent diagnostic history", () => {
  const f = fixture()
  try {
    const { failedRunId, location } = seedObstruction(f)
    const obstructionId = readRecord(gateRecoveryPath(location)).obstructionId
    assert.equal(focusedDiagnosis({ failedRunId, fixture_: f }).status, 0)
    recordGateObstruction({ evidence: evidence(f), location })
    const recovery = readRecord(gateRecoveryPath(location))
    assert.equal(recovery.obstructionId, obstructionId)
    assert.equal(recovery.gateAttempts.length, 2)
    assert.equal(recovery.diagnosisAttempts.length, 1)
  } finally {
    f.cleanup()
  }
})

void test("reconciliation creates an obstruction for an interrupted first full gate", () => {
  const f = fixture()
  try {
    const location = repositoryLocation(f.root)
    const runId = randomUUID()
    reconcileGateRecovery({ location, run: { requiresQualityComposite: true }, runId })
    const recovery = readRecord(gateRecoveryPath(location))
    assert.equal(recovery.failedRunId, runId)
    assert.equal(recovery.inputIdentity, "UNPROVEN")
    assert.equal(recovery.state, "diagnosis-required")
  } finally {
    f.cleanup()
  }
})

void test("reconciliation returns interrupted verification to repair-required", () => {
  const f = fixture()
  try {
    const { failedRunId, location } = seedObstruction(f)
    assert.equal(focusedDiagnosis({ failedRunId, fixture_: f }).status, 0)
    const record = readRecord(gateRecoveryPath(location))
    const verificationRunId = randomUUID()
    writeFileSync(join(f.root, "repair.marker"), "repaired\n")
    const sourceInputDigest = currentSourceInputDigest(f.root)
    const actionId = randomUUID()
    const running = {
      ...record,
      state: "verification-running",
      verificationRunId,
      verificationAttempts: [
        ...record.verificationAttempts,
        {
          actionId,
          diagnosisActionId: record.diagnosisAttempts.at(-1).actionId,
          sourceInputDigest,
          outcome: "UNPROVEN"
        }
      ]
    }
    writeFileSync(gateRecoveryPath(location), `${JSON.stringify(running)}\n`)
    reconcileGateRecovery({ location, runId: verificationRunId })
    const reconciled = readRecord(gateRecoveryPath(location))
    assert.equal(reconciled.state, "repair-required")
    assert.equal(reconciled.verificationAttempts.at(-1).outcome, "UNPROVEN")
    const resumed = verifyRepair(f, failedRunId)
    assert.equal(resumed.status, 0, resumed.stderr)
    assert.equal(readRecord(gateRecoveryPath(location)).state, "verified")
  } finally {
    f.cleanup()
  }
})
