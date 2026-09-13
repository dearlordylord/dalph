// Focused quality prefix tests use synthetic original formal records, validated
// by the production reader. They do not claim actual checker dispatch; the
// formal-gate integration suite owns genuine controlled child receipts.
import { join } from "node:path"
import {
  atomicRecord,
  digest,
  localHostIdentity,
  newIdentity,
  repositoryLocation,
  wallClockTimestamp
} from "./gate-custody-records.mjs"
import { beginFormalAttempt, publishFormalSuccess } from "./formal-success-evidence.mjs"
import { createQuintEffectiveProfile } from "./quint-effective-profile.mjs"

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
  atomicRecord(join(runDirectory, "run.json"), run)
  atomicRecord(join(runDirectory, "identity.json"), { version: 1, inputDigest: "controlled-custody" })
  const profile = createQuintEffectiveProfile()
  const profileIdentity = digest(JSON.stringify(profile))
  const toolchain = {
    nodeExecutable: process.execPath,
    quintEntryPoint: "controlled-cli",
    javaExecutable: "controlled-java",
    javaArguments: [],
    apalacheJar: "controlled-jar"
  }
  const identity = {
    version: 1,
    worktree,
    toolchain,
    profileDigest: profileIdentity,
    inputDigest: digest("controlled-formal")
  }
  const ids = []
  const add = (parentId, command, outcome, exitCode, output = "") => {
    const obligationId = newIdentity()
    ids.push(obligationId)
    atomicRecord(join(runDirectory, "obligations", `${obligationId}.json`), {
      version: 1,
      runId,
      obligationId,
      parentId,
      command,
      state: "observed",
      processGroup: 2147483647
    })
    const logPath = join(run.reportDirectory, "logs", `${obligationId}.log`)
    atomicRecord(join(runDirectory, "receipts", `${obligationId}.json`), {
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
      args: ["-jar", toolchain.apalacheJar, "server", "--port=34567"],
      acceptedExitCodes: [0]
    },
    "cancelled",
    143
  )
  const stopPath = join(runDirectory, "owned-server-stops", `${serverId}.json`)
  atomicRecord(stopPath, {
    version: 1,
    runId,
    obligationId: serverId,
    processGroup: 2147483647,
    serverEndpoint,
    disposition: "profile-complete",
    requestedAt: wallClockTimestamp()
  })
  atomicRecord(join(runDirectory, "absence", `${serverId}.json`), {
    version: 1,
    runId,
    obligationId: serverId,
    processGroup: 2147483647,
    state: "observed"
  })
  atomicRecord(join(runDirectory, "registration.json"), { version: 1, runId, state: "closed", obligations: ids })
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
  atomicRecord(reportPath, report)
  const observation = {
    version: 1,
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
