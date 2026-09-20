import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  atomicRecord,
  digest,
  localHostIdentity,
  newIdentity,
  repositoryLocation,
  wallClockTimestamp
} from "./gate-custody-records.mjs"
import { createQuintEffectiveProfile } from "./quint-effective-profile.mjs"
import { formalEvidenceContract } from "./formal-evidence-contract.mjs"
import {
  beginFormalAttempt,
  formalSuccessPolicyVersion,
  invalidateFormalAttempt,
  publishFormalSuccess,
  readFormalSuccess,
  readReferencedFormalSuccess
} from "./formal-success-evidence.mjs"
import { formalInputPolicyVersion } from "./formal-input-policy.mjs"

// These original receipts are fabricated fixtures, not publications under test.
// Keep their correct bytes/modes without syncing the entire filesystem per seed.
const seedRecord = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 })
}

void test("shared formal evidence contract owns input observation and success generations", () => {
  assert.equal(formalInputPolicyVersion, formalEvidenceContract.inputPolicyVersion)
  assert.equal(formalSuccessPolicyVersion, formalEvidenceContract.successPolicyVersion)
  assert.notEqual(formalEvidenceContract.inputPolicyVersion, 2)
})

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-formal-evidence-"))
  execFileSync("git", ["init", "-q", root])
  const location = repositoryLocation(root)
  const runId = newIdentity()
  const runDirectory = join(location.custodyRoot, "runs", runId)
  Object.assign(location, { runDirectory, runId })
  const profile = createQuintEffectiveProfile({ purpose: "local-guarded" })
  const profileIdentity = digest(JSON.stringify(profile))
  const applicability = {
    version: formalEvidenceContract.inputPolicyVersion,
    observerVersion: formalEvidenceContract.observerVersion,
    sourceManifest: [{ location: { role: "repository-source", relativePath: "specs/model.qnt" } }],
    toolManifest: [],
    environmentDigests: {},
    toolchain: { versions: { fixture: "1" } },
    profile
  }
  const identity = {
    version: formalEvidenceContract.inputPolicyVersion,
    worktree: root,
    applicability,
    applicabilityDigest: digest(JSON.stringify(applicability)),
    inputDigest: digest("formal inputs"),
    profileDigest: profileIdentity,
    toolchain: {
      quintEntryPoint: "quint-cli.js",
      nodeExecutable: process.execPath,
      javaExecutable: "java",
      javaArguments: [],
      apalacheJar: "apalache.jar"
    }
  }
  const run = {
    version: 1,
    ...location,
    runId,
    host: localHostIdentity(),
    slot: 1,
    slotLock: join(location.commonDirectory, "dalph-gate-slot-1.lock"),
    slotFence: join(location.commonDirectory, "dalph-gate-slot-1.fence.json"),
    reportDirectory: join(root, ".scratch", "quality-gates", runId)
  }
  seedRecord(join(runDirectory, "run.json"), run)
  seedRecord(join(runDirectory, "identity.json"), { version: 1, inputDigest: "custody-digest" })
  const helperObligationId = newIdentity()
  const ids = []
  const add = (id, parentId, command, outcome = "passed", code = 0) => {
    ids.push(id)
    seedRecord(join(runDirectory, "obligations", `${id}.json`), {
      version: 1,
      runId,
      obligationId: id,
      parentId,
      command,
      state: "observed",
      processGroup: 2147483647
    })
    seedRecord(join(runDirectory, "receipts", `${id}.json`), {
      version: 1,
      runId,
      obligationId: id,
      command,
      inputDigest: "custody-digest",
      outcome,
      exitCode: code,
      signal: null,
      groupAbsent: true
    })
  }
  add(helperObligationId, "root", {
    executable: process.execPath,
    args: [join(root, "scripts", "run-formal-profile.mjs")],
    acceptedExitCodes: [0]
  })
  const serverEndpoint = "127.0.0.1:34567"
  const commands = profile.commands.map((command) => {
    const obligationId = newIdentity()
    const args = command.kind === "verify" ? [...command.args, "--server-endpoint", serverEndpoint] : command.args
    const exitCode = command.verdict.acceptedExitCodes[0]
    add(
      obligationId,
      helperObligationId,
      {
        executable: process.execPath,
        args: ["quint-cli.js", ...args],
        name: command.name,
        acceptedExitCodes: command.verdict.acceptedExitCodes
      },
      "passed",
      exitCode
    )
    let output = command.verdict.witnesses
      .map((name) => `${name} was witnessed in 1 trace(s) out of 1 explored (100.00%)`)
      .join("\n")
    if (command.verdict.collectedReplacementTest)
      output = "ok safeSuspensionAndExactFreshFactsAtomicallyRecordCleanP2Test passed 1 test(s)"
    if (command.verdict.temporal === "clean") output = "[ok] No violation found"
    if (command.verdict.temporal === "violation") output = "[violation] Found an issue"
    return {
      executable: process.execPath,
      position: command.position,
      name: command.name,
      kind: command.kind,
      args,
      verdict: command.verdict,
      obligationId,
      exitCode,
      output
    }
  })
  const serverId = newIdentity()
  add(
    serverId,
    helperObligationId,
    {
      executable: "java",
      args: [
        "-jar",
        "apalache.jar",
        `--out-dir=${join(runDirectory, "owned-server-output", helperObligationId)}`,
        "server",
        "--port=34567"
      ],
      acceptedExitCodes: [0]
    },
    "cancelled"
  )
  const stopPath = join(runDirectory, "owned-server-stops", `${serverId}.json`)
  seedRecord(stopPath, {
    version: 1,
    runId,
    obligationId: serverId,
    processGroup: 2147483647,
    serverEndpoint,
    disposition: "profile-complete",
    requestedAt: wallClockTimestamp()
  })
  seedRecord(join(runDirectory, "absence", `${serverId}.json`), {
    version: 1,
    runId,
    obligationId: serverId,
    processGroup: 2147483647,
    state: "observed"
  })
  seedRecord(join(runDirectory, "registration.json"), { version: 1, runId, state: "open", obligations: ids })
  const report = {
    version: 1,
    profileResult: { profile, commands, serverEndpoint, entryPoint: "quint-cli.js" },
    serverEvidence: {
      obligationId: serverId,
      processGroup: 2147483647,
      serverEndpoint,
      stopPath,
      receiptPath: join(runDirectory, "receipts", `${serverId}.json`)
    }
  }
  const reportPath = join(runDirectory, "formal-report.json")
  const saveReport = () => {
    seedRecord(reportPath, report)
    return digest(`${JSON.stringify(report)}\n`)
  }
  const execution = { helperObligationId, reportPath, reportDigest: saveReport() }
  const observation = {
    version: formalEvidenceContract.inputPolicyVersion,
    observerVersion: 1,
    ready: true,
    drained: true,
    unchanged: true,
    inputDigest: identity.inputDigest
  }
  return {
    location,
    identity,
    profileIdentity,
    execution,
    observation,
    report,
    saveReport,
    helperObligationId,
    options: { location, identity, profileIdentity },
    cleanup: () => rmSync(root, { recursive: true, force: true })
  }
}

const withFixture = (fn) => {
  const f = fixture()
  try {
    fn(f)
  } finally {
    f.cleanup()
  }
}

void test("records complete formal success only after obligations and terminal evidence; reuses original evidence with enclosing custody open", () =>
  withFixture((f) => {
    const attempt = beginFormalAttempt(f.options)
    const success = publishFormalSuccess({ attempt, execution: f.execution, observation: f.observation })
    const result = readFormalSuccess(f.options)
    assert.equal(result.status, "hit")
    assert.equal(result.success.finishedAt, success.finishedAt)
    assert.equal(result.evidencePath, attempt.recordPath)
  }))

void test("reuses stopped evidence across same-custody worktrees and rejects unsafe original custody", () =>
  withFixture((f) => {
    const attempt = beginFormalAttempt(f.options)
    publishFormalSuccess({ attempt, execution: f.execution, observation: f.observation })
    execFileSync("git", ["-C", f.location.worktree, "config", "user.email", "formal-fixture@example.invalid"])
    execFileSync("git", ["-C", f.location.worktree, "config", "user.name", "Formal Fixture"])
    writeFileSync(join(f.location.worktree, "tracked"), "same repository\n")
    execFileSync("git", ["-C", f.location.worktree, "add", "tracked"])
    execFileSync("git", ["-C", f.location.worktree, "commit", "-qm", "fixture"])
    const sibling = `${f.location.worktree}-sibling`
    const otherClone = `${f.location.worktree}-other-clone`
    try {
      execFileSync("git", ["-C", f.location.worktree, "worktree", "add", "-qb", "sibling", sibling])
      const location = repositoryLocation(sibling)
      const identity = { ...f.identity, worktree: location.worktree, inputDigest: digest("relocated exact inputs") }
      const reused = readFormalSuccess({ location, identity, profileIdentity: f.profileIdentity })
      assert.equal(reused.status, "hit", reused.reason)
      assert.equal(reused.evidencePath, attempt.recordPath)
      assert.equal(reused.success.worktree, f.location.worktree)

      execFileSync("git", ["clone", "-q", f.location.worktree, otherClone])
      const independentLocation = repositoryLocation(otherClone)
      assert.throws(
        () =>
          readReferencedFormalSuccess({
            recordPath: attempt.recordPath,
            worktree: independentLocation.worktree,
            identity: { ...identity, worktree: independentLocation.worktree },
            profileIdentity: f.profileIdentity
          }),
        /Invalid referenced formal locator/u,
        "another clone cannot consume this clone's custody record"
      )

      const success = JSON.parse(readFileSync(attempt.recordPath, "utf8"))
      atomicRecord(attempt.recordPath, {
        ...success,
        host: { ...success.host, bootId: `${success.host.bootId}-different-boot` }
      })
      assert.equal(
        readFormalSuccess({ location, identity, profileIdentity: f.profileIdentity }).status,
        "miss",
        "evidence from another host boot cannot be reused"
      )
      atomicRecord(attempt.recordPath, { ...success, worktree: `${success.worktree}-missing` })
      assert.equal(
        readFormalSuccess({ location, identity, profileIdentity: f.profileIdentity }).status,
        "miss",
        "evidence whose original worktree is no longer available cannot be reused"
      )
      atomicRecord(attempt.recordPath, success)

      const receiptPath = join(
        f.location.runDirectory,
        "receipts",
        `${f.report.profileResult.commands[0].obligationId}.json`
      )
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))
      atomicRecord(receiptPath, { ...receipt, groupAbsent: false })
      assert.equal(readFormalSuccess({ location, identity, profileIdentity: f.profileIdentity }).status, "miss")
      atomicRecord(receiptPath, receipt)

      const applicability = { ...identity.applicability, profile: { changed: true } }
      const changed = { ...identity, applicability, applicabilityDigest: digest(JSON.stringify(applicability)) }
      assert.equal(
        readFormalSuccess({ location, identity: changed, profileIdentity: f.profileIdentity }).status,
        "miss"
      )
    } finally {
      rmSync(sibling, { recursive: true, force: true })
      rmSync(otherClone, { recursive: true, force: true })
    }
  }))

void test("failed force prevents fallback to older success", () =>
  withFixture((f) => {
    publishFormalSuccess({ attempt: beginFormalAttempt(f.options), execution: f.execution, observation: f.observation })
    beginFormalAttempt(f.options)
    assert.equal(readFormalSuccess(f.options).status, "miss")
  }))

void test("publication crash accepts only complete stopped evidence", () =>
  withFixture((f) => {
    const attempt = beginFormalAttempt(f.options)
    assert.equal(readFormalSuccess(f.options).status, "miss")
    publishFormalSuccess({ attempt, execution: f.execution, observation: f.observation })
    rmSync(f.execution.reportPath)
    assert.equal(readFormalSuccess(f.options).status, "miss")
  }))

void test("reruns when required evidence is malformed truncated old-policy or mismatched; distinguishes optional logs", () =>
  withFixture((f) => {
    const attempt = beginFormalAttempt(f.options)
    publishFormalSuccess({ attempt, execution: f.execution, observation: f.observation })
    assert.equal(readFormalSuccess(f.options).status, "hit") // No diagnostic log exists.
    assert.equal(
      readFormalSuccess({ ...f.options, identity: { ...f.identity, version: 2 } }).status,
      "miss",
      "an identity from the former input policy cannot reuse current evidence"
    )
    const original = readFileSync(attempt.pointerPath, "utf8")
    const pointer = JSON.parse(original)
    for (const invalid of [
      "{",
      "{}",
      JSON.stringify({ ...pointer, version: 2 }),
      JSON.stringify({ ...pointer, policyVersion: 1 }),
      JSON.stringify({ ...pointer, attemptId: newIdentity() })
    ]) {
      writeFileSync(attempt.pointerPath, invalid)
      assert.equal(readFormalSuccess(f.options).status, "miss")
    }
    writeFileSync(attempt.pointerPath, original)
    const applicability = { ...f.identity.applicability, sourceManifest: [{ changed: true }] }
    assert.equal(
      readFormalSuccess({
        ...f.options,
        identity: {
          ...f.identity,
          inputDigest: digest("changed"),
          applicability,
          applicabilityDigest: digest(JSON.stringify(applicability))
        }
      }).status,
      "miss"
    )
  }))

for (const failure of ["omitted obligation", "unresolved child", "lost observation", "changed verdict"])
  void test(`raw partial checks cannot attest a complete profile: ${failure}`, () =>
    withFixture((f) => {
      const attempt = beginFormalAttempt(f.options)
      if (failure === "omitted obligation") {
        f.report.profileResult.commands.pop()
        f.execution.reportDigest = f.saveReport()
      }
      if (failure === "changed verdict") {
        f.report.profileResult.commands.find((item) => item.verdict.temporal === "violation").output =
          "[ok] No violation found"
        f.execution.reportDigest = f.saveReport()
      }
      if (failure === "lost observation") f.observation.drained = false
      if (failure === "unresolved child") {
        const id = f.report.profileResult.commands[0].obligationId
        const path = join(f.location.runDirectory, "receipts", `${id}.json`)
        rmSync(path)
      }
      assert.throws(() => publishFormalSuccess({ attempt, execution: f.execution, observation: f.observation }))
      assert.equal(readFormalSuccess(f.options).status, "miss")
    }))

void test("failed interrupted and crashed attempts cannot qualify or bypass custody", () =>
  withFixture((f) => {
    const attempt = beginFormalAttempt(f.options)
    const id = f.report.profileResult.commands[0].obligationId
    const path = join(f.location.runDirectory, "receipts", `${id}.json`)
    const original = JSON.parse(readFileSync(path, "utf8"))
    for (const outcome of ["failed", "timed-out", "interrupted", "cancelled"]) {
      atomicRecord(path, { ...original, outcome })
      assert.throws(() => publishFormalSuccess({ attempt, execution: f.execution, observation: f.observation }))
    }
    atomicRecord(path, { ...original, groupAbsent: false })
    assert.throws(() => publishFormalSuccess({ attempt, execution: f.execution, observation: f.observation }))
    assert.equal(readFormalSuccess(f.options).status, "miss")
  }))

void test("a stopped server without the planned complete-profile disposition cannot qualify", () =>
  withFixture((f) => {
    const attempt = beginFormalAttempt(f.options)
    const path = f.report.serverEvidence.stopPath
    const stop = JSON.parse(readFileSync(path, "utf8"))
    atomicRecord(path, { ...stop, disposition: "failed-profile" })
    assert.throws(() => publishFormalSuccess({ attempt, execution: f.execution, observation: f.observation }))
  }))

void test("input invalidation after publication prevents reuse and retains original success", () =>
  withFixture((f) => {
    const attempt = beginFormalAttempt(f.options)
    publishFormalSuccess({ attempt, execution: f.execution, observation: f.observation })
    invalidateFormalAttempt({ attempt, reason: "Input changed during final publication drain" })
    assert.equal(readFormalSuccess(f.options).status, "miss")
    assert.equal(JSON.parse(readFileSync(attempt.recordPath, "utf8")).state, "passed")
    const next = beginFormalAttempt(f.options)
    assert.throws(() => invalidateFormalAttempt({ attempt, reason: "late failure from old attempt" }))
    assert.equal(JSON.parse(readFileSync(next.pointerPath, "utf8")).attemptId, next.attemptId)
  }))

void test("historical handoff success remains valid after a later failed force attempt", () =>
  withFixture((f) => {
    const original = beginFormalAttempt(f.options)
    publishFormalSuccess({ attempt: original, execution: f.execution, observation: f.observation })
    beginFormalAttempt(f.options)
    assert.equal(readFormalSuccess(f.options).status, "miss")
    const recorded = readReferencedFormalSuccess({
      recordPath: original.recordPath,
      worktree: f.location.worktree,
      identity: f.identity,
      profileIdentity: f.profileIdentity
    })
    assert.equal(recorded.attemptId, original.attemptId)
    rmSync(f.execution.reportPath)
    assert.throws(() => readReferencedFormalSuccess({ recordPath: original.recordPath, worktree: f.location.worktree }))
  }))

void test("wrong owned-server output destination cannot attest complete success", () =>
  withFixture((f) => {
    const attempt = beginFormalAttempt(f.options)
    const id = f.report.serverEvidence.obligationId
    const paths = ["obligations", "receipts"].map((directory) => join(f.location.runDirectory, directory, `${id}.json`))
    const records = paths.map((path) => JSON.parse(readFileSync(path, "utf8")))
    for (const destination of [
      undefined,
      join(f.location.worktree, "_apalache-out"),
      join(f.location.runDirectory, "owned-server-output", newIdentity())
    ]) {
      for (const [index, path] of paths.entries()) {
        const original = records[index]
        const args = original.command.args.filter((argument) => !argument.startsWith("--out-dir="))
        if (destination !== undefined) args.splice(2, 0, `--out-dir=${destination}`)
        atomicRecord(path, { ...original, command: { ...original.command, args } })
      }
      assert.throws(
        () => publishFormalSuccess({ attempt, execution: f.execution, observation: f.observation }),
        /Owned server installed command changed/u
      )
      assert.equal(readFormalSuccess(f.options).status, "miss")
    }
  }))
