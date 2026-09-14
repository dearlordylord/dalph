// Focused quality prefix tests use synthetic original formal records, validated
// by the production reader. They do not claim actual checker dispatch; the
// formal-gate integration suite owns genuine controlled child receipts.
import { cpSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  digest,
  localHostIdentity,
  newIdentity,
  repositoryLocation,
  wallClockTimestamp
} from "./gate-custody-records.mjs"
import { beginFormalAttempt, publishFormalSuccess } from "./formal-success-evidence.mjs"
import { formalEvidenceContract } from "./formal-evidence-contract.mjs"
import { createQuintEffectiveProfile } from "./quint-effective-profile.mjs"

// Explicit runtime dependencies of the copied quality runner and original
// formal evidence reader. Keep tests/TS/declarations outside the candidate;
// every copied runtime input is still watched by the real candidate observer.
export const copyQualityRuntimeFixture = (worktree) => {
  const directory = join(worktree, "scripts")
  mkdirSync(directory, { recursive: true })
  for (const name of [
    "application-exit-model-registry.mjs",
    "effect-tsgo-platform-binary.mjs",
    "formal-evidence-contract.mjs",
    "formal-success-evidence.mjs",
    "gate-custody-records.mjs",
    "gate-input-observer.mjs",
    "gate-input-observer.py",
    "gate-quality-evidence.mjs",
    "gate-quality-run.mjs",
    "gate-registration.mjs",
    "gate-resume-artifacts.mjs",
    "gate-resume-inputs.mjs",
    "gate-resume-policy.mjs",
    "gate-run-artifacts.mjs",
    "gate-run-evidence.mjs",
    "preflight-census.mjs",
    "quality-gate-stage-policy.mjs",
    "quality-output-budget.mjs",
    "quint-effective-profile.mjs",
    "quint-gate-command-contract.mjs",
    "quint-gate-command-manifest.mjs",
    "quint-gate-concurrency.mjs",
    "quint-gate-fresh-task-command-oracle.mjs",
    "quint-gate-legacy-command-oracle.mjs",
    "quint-gate-policy.mjs",
    "quint-gate-production-plan.mjs",
    "quint-gate-timing.mjs",
    "quint-model-obligations.mjs",
    "quint-temporal-gate.mjs",
    "quint-witness-coverage.mjs",
    "run-bounded-command.mjs"
  ])
    cpSync(fileURLToPath(new URL(name, import.meta.url)), join(directory, name))
}

// These complete records are synthetic inputs created before any fixture
// process starts. Crash publication tests exercise the real atomic/fsync writes
// separately; repeating them for every fabricated child adds no proof here.
const initializeRecord = (path, record) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 })
}

/** One controlled workflow module shape for quality/resume integration fixtures. */
export const controlledFormalWorkflowSource = (message) => `
import {readFileSync} from 'node:fs';import {join} from 'node:path';
import {readReferencedFormalSuccess} from './formal-success-evidence.mjs';
export const runFormalWorkflow=async({report})=>{
 const evidencePath=readFileSync(join(process.cwd(),'.scratch','controlled-formal-path'),'utf8');
 const success=readReferencedFormalSuccess({recordPath:evidencePath,worktree:process.cwd()});
 report(${JSON.stringify(message)});
 return {status:'reused',success,evidencePath,finalizeApplicability:async()=>({success,evidencePath,identity:success.identity,observation:success.observation}),assertUnchanged:async()=>{},close:async()=>{}}
}`

export const seedQualityFormalBoundary = (worktree) => {
  const location = repositoryLocation(worktree)
  const runId = newIdentity()
  const runDirectory = join(location.custodyRoot, "runs", runId)
  Object.assign(location, { runId, runDirectory })
  const run = {
    version: 1,
    ...location,
    runId,
    host: localHostIdentity(),
    slot: 1,
    fixtureFormalSeed: true,
    commandArguments: ["controlled-formal-seed"],
    slotLock: join(location.commonDirectory, "dalph-gate-slot-1.lock"),
    slotFence: join(location.commonDirectory, "dalph-gate-slot-1.fence.json"),
    reportDirectory: join(worktree, ".scratch", "quality-gates", runId)
  }
  initializeRecord(join(runDirectory, "run.json"), run)
  initializeRecord(join(runDirectory, "identity.json"), { version: 1, inputDigest: "controlled-custody" })
  const profile = createQuintEffectiveProfile({ purpose: "local-guarded" })
  const profileIdentity = digest(JSON.stringify(profile))
  const toolchain = {
    nodeExecutable: process.execPath,
    quintEntryPoint: "controlled-cli",
    javaExecutable: "controlled-java",
    javaArguments: [],
    apalacheJar: "controlled-jar"
  }
  const identity = {
    version: formalEvidenceContract.inputPolicyVersion,
    worktree,
    toolchain,
    profileDigest: profileIdentity,
    inputDigest: digest("controlled-formal"),
    applicability: {
      version: formalEvidenceContract.inputPolicyVersion,
      observerVersion: formalEvidenceContract.observerVersion,
      sourceManifest: [],
      toolManifest: [],
      environmentDigests: {},
      toolchain: { versions: { fixture: "1" } },
      profile
    }
  }
  identity.applicabilityDigest = digest(JSON.stringify(identity.applicability))
  const ids = []
  const add = (parentId, command, outcome, exitCode, output = "") => {
    const obligationId = newIdentity()
    ids.push(obligationId)
    initializeRecord(join(runDirectory, "obligations", `${obligationId}.json`), {
      version: 1,
      runId,
      obligationId,
      parentId,
      command,
      state: "observed",
      processGroup: 2147483647
    })
    const logPath = join(run.reportDirectory, "logs", `${obligationId}.log`)
    initializeRecord(join(runDirectory, "receipts", `${obligationId}.json`), {
      version: 1,
      runId,
      obligationId,
      command,
      inputDigest: "controlled-custody",
      outcome,
      exitCode,
      signal: null,
      groupAbsent: true,
      outputLineCount: output ? output.split("\n").length : 0,
      logPath,
      log: { path: logPath, sha256: digest(output), bytes: Buffer.byteLength(output) },
      artifacts: []
    })
    return obligationId
  }
  const helperObligationId = add(
    "root",
    {
      executable: process.execPath,
      args: [join(worktree, "scripts", "run-formal-profile.mjs")],
      acceptedExitCodes: [0]
    },
    "passed",
    0
  )
  const serverEndpoint = "127.0.0.1:34567"
  const commands = profile.commands.map((command) => {
    const args = command.kind === "verify" ? [...command.args, "--server-endpoint", serverEndpoint] : [...command.args]
    let output = command.verdict.witnesses
      .map((witness) => `${witness} was witnessed in 1 trace(s) out of 1 explored (100.00%)`)
      .join("\n")
    if (command.verdict.collectedReplacementTest)
      output = "ok safeSuspensionAndExactFreshFactsAtomicallyRecordCleanP2Test passed 1 test(s)"
    if (command.verdict.temporal === "clean") output = "[ok] No violation found"
    if (command.verdict.temporal === "violation") output = "[violation] Found an issue"
    const exitCode = command.verdict.acceptedExitCodes[0]
    const obligationId = add(
      helperObligationId,
      {
        executable: process.execPath,
        args: [toolchain.quintEntryPoint, ...args],
        name: command.name,
        acceptedExitCodes: command.verdict.acceptedExitCodes
      },
      "passed",
      exitCode,
      output
    )
    return {
      position: command.position,
      name: command.name,
      kind: command.kind,
      args,
      executable: process.execPath,
      exitCode,
      output,
      obligationId,
      verdict: command.verdict
    }
  })
  const serverId = add(
    helperObligationId,
    {
      executable: toolchain.javaExecutable,
      args: [
        "-jar",
        toolchain.apalacheJar,
        `--out-dir=${join(runDirectory, "owned-server-output", helperObligationId)}`,
        "server",
        "--port=34567"
      ],
      acceptedExitCodes: [0]
    },
    "cancelled",
    143
  )
  const stopPath = join(runDirectory, "owned-server-stops", `${serverId}.json`)
  initializeRecord(stopPath, {
    version: 1,
    runId,
    obligationId: serverId,
    processGroup: 2147483647,
    serverEndpoint,
    disposition: "profile-complete",
    requestedAt: wallClockTimestamp()
  })
  initializeRecord(join(runDirectory, "absence", `${serverId}.json`), {
    version: 1,
    runId,
    obligationId: serverId,
    processGroup: 2147483647,
    state: "observed"
  })
  initializeRecord(join(runDirectory, "registration.json"), { version: 1, runId, state: "closed", obligations: ids })
  const report = {
    version: 1,
    profileResult: { profile, commands, entryPoint: toolchain.quintEntryPoint, serverEndpoint },
    serverEvidence: {
      obligationId: serverId,
      processGroup: 2147483647,
      serverEndpoint,
      stopPath,
      receiptPath: join(runDirectory, "receipts", `${serverId}.json`)
    }
  }
  const reportPath = join(runDirectory, "formal-executions", "controlled.json")
  initializeRecord(reportPath, report)
  const observation = {
    version: formalEvidenceContract.inputPolicyVersion,
    observerVersion: 1,
    ready: true,
    drained: true,
    unchanged: true,
    inputDigest: identity.inputDigest
  }
  const attempt = beginFormalAttempt({ location, identity, profileIdentity })
  const success = publishFormalSuccess({
    attempt,
    observation,
    execution: { helperObligationId, reportPath, reportDigest: digest(`${JSON.stringify(report)}\n`) }
  })
  return success.recordPath
}
