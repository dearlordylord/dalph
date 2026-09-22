import { spawnSync } from "node:child_process"
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

import { digest, readRecord, repositoryLocation } from "./gate-custody-records.mjs"
import { readRunEvidence } from "./gate-run-evidence.mjs"
import { createQualityGateStagePlan, supportedNodeVersionsFromPackage } from "./quality-gate-stage-plan.mjs"
import { fullQualityGateManifest, qualityGateQualificationStageIds } from "./quality-gate-stage-policy.mjs"
import {
  deliveryRepeatabilityDefaultIterations,
  deliveryRepeatabilityExpectedAcceptedOrderDigest,
  deliveryRepeatabilityExpectedOccurrenceCount
} from "./run-delivery-repeatability.mjs"

const hostedQualityEvidenceVersion = 1
export const hostedQualityStageIds = qualityGateQualificationStageIds
export const hostedQualityNodeVersions = Object.freeze(supportedNodeVersionsFromPackage())

const canonicalSha = (value, label) => {
  if (!/^[0-9a-f]{40}$/u.test(value ?? "")) throw new Error(`${label} must be a canonical 40-character SHA`)
  return value
}

const canonicalTimestamp = (value, label) => {
  const milliseconds = Date.parse(value ?? "")
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be an ISO timestamp`)
  return new Date(milliseconds).toISOString()
}

const canonicalBinding = (binding) => {
  const value = {
    candidateSha: canonicalSha(binding?.candidateSha, "Hosted quality candidate"),
    baseSha: canonicalSha(binding?.baseSha, "Hosted quality Base"),
    runId: binding?.runId,
    runAttempt: binding?.runAttempt
  }
  if (typeof value.runId !== "string" || value.runId.length === 0 || value.runId.length > 128)
    throw new Error("Hosted quality run ID is invalid")
  if (typeof value.runAttempt !== "string" || !/^[1-9]\d*$/u.test(value.runAttempt))
    throw new Error("Hosted quality run attempt is invalid")
  return value
}

export const assertHostedQualityEnvironmentBinding = (binding, environment = process.env) => {
  binding = canonicalBinding(binding)
  if (environment.GITHUB_ACTIONS !== "true") return binding
  const expected = {
    candidateSha: environment.GITHUB_SHA,
    baseSha: environment.DALPH_COVERAGE_BASE_SHA,
    runId: environment.GITHUB_RUN_ID,
    runAttempt: environment.GITHUB_RUN_ATTEMPT
  }
  if (!same(binding, expected)) throw new Error("Hosted quality binding differs from the GitHub runner identity")
  const redundant = {
    candidateSha: environment.DALPH_HOSTED_QUALITY_CANDIDATE_SHA,
    baseSha: environment.DALPH_HOSTED_QUALITY_BASE_SHA,
    runId: environment.DALPH_HOSTED_QUALITY_RUN_ID,
    runAttempt: environment.DALPH_HOSTED_QUALITY_RUN_ATTEMPT
  }
  if (!same(binding, redundant)) throw new Error("Hosted quality binding differs from the workflow plan identity")
  return binding
}

export const assertHostedQualityPlanEnvironment = ({ binding, environment = process.env }) => {
  const plan = createQualityGateStagePlan({
    baseSha: binding.baseSha,
    candidateSha: binding.candidateSha,
    nodeExecutable: "node",
    nodeVersions: hostedQualityNodeVersions,
    pnpmEntryPoint: "pnpm"
  })
  if (environment.GITHUB_ACTIONS !== "true") return plan
  let nodeVersions
  let expectedCells
  try {
    nodeVersions = JSON.parse(environment.DALPH_HOSTED_QUALITY_NODE_VERSIONS)
    expectedCells = JSON.parse(environment.DALPH_HOSTED_QUALITY_STAGE_PLAN)
  } catch {
    throw new Error("Hosted quality workflow plan JSON is unavailable or malformed")
  }
  if (!same(nodeVersions, plan.nodeVersions) || !same(expectedCells, plan.expectedCells))
    throw new Error("Hosted quality workflow plan differs from the checked-in stage algebra")
  return plan
}

export const selectedHostedQualityStage = ({
  baseSha,
  candidateSha,
  nodeExecutable,
  nodeVersion,
  nodeVersions = hostedQualityNodeVersions,
  pnpmEntryPoint,
  stageId,
  worktree
}) => {
  canonicalSha(baseSha, "Hosted quality Base")
  canonicalSha(candidateSha, "Hosted quality candidate")
  if (!isAbsolute(nodeExecutable ?? ""))
    throw new Error("Hosted quality owner Node executable must be an absolute path")
  if (!isAbsolute(pnpmEntryPoint ?? ""))
    throw new Error("Hosted quality owner pnpm entry point must be an absolute path")
  // The plan is portable evidence: aggregate and every runner compare this
  // semantic command, while the execution manifest below retains the owner
  // process' absolute tool locators for custody evidence.
  const plan = createQualityGateStagePlan({
    baseSha,
    candidateSha,
    nodeVersions,
    nodeExecutable: "node",
    pnpmEntryPoint: "pnpm"
  })
  if (!plan.expectedCells.some((cell) => cell.nodeVersion === nodeVersion && cell.stageId === stageId))
    throw new Error(`Unknown hosted quality matrix cell '${String(nodeVersion)}:${String(stageId)}'`)
  const stages = fullQualityGateManifest(baseSha, {
    candidateHeadSha: candidateSha,
    nodeExecutable,
    pnpmEntryPoint,
    worktree
  }).filter(({ boundary }) => boundary === "qualification")
  if (stages.map(({ id }) => id).join(",") !== hostedQualityStageIds.join(","))
    throw new Error("Hosted quality stage policy differs from the required suffix inventory")
  const selected = stages.find(({ id }) => id === stageId)
  if (selected === undefined) throw new Error(`Unknown hosted quality stage '${String(stageId)}'`)
  return { executionManifest: stages, plan, stage: selected }
}

const gitHead = (worktree) => {
  const result = spawnSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: worktree,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  })
  if (result.error !== undefined || result.status !== 0) throw new Error("Hosted quality candidate HEAD is unavailable")
  return canonicalSha(result.stdout.trim(), "Hosted quality candidate HEAD")
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const qualificationRejectionCodes = new Set([
  "FixtureContextMismatch",
  "IntegrationTargetMismatch",
  "InvalidAcceptedProgress",
  "InvalidFreshRoute",
  "InvalidIntegrationTarget",
  "InvalidOperationIdentity",
  "InvalidPlannedAttempt",
  "InvalidProposalIdentitySource",
  "InvalidRunIdentity",
  "InvalidSpecification",
  "InvalidTask",
  "PlannedAttemptMismatch",
  "ProposalIdentityMismatch",
  "ProposalSubjectMismatch",
  "SpecificationMismatch",
  "TaskMismatch"
])
const closedDiagnosticCodes = (log) =>
  [...log.matchAll(/"code":"([A-Za-z0-9]+)"/gu)]
    .map((match) => match[1])
    .filter((code, index, codes) => qualificationRejectionCodes.has(code) && codes.indexOf(code) === index)

const descendantStages = (stages, rootId) => {
  const selected = []
  const selectedIds = new Set([rootId])
  for (;;) {
    const next = stages.filter(
      (stage) =>
        selectedIds.has(stage.parentId) && stage.obligationId !== rootId && !selectedIds.has(stage.obligationId)
    )
    if (next.length === 0) return selected
    for (const stage of next) {
      selected.push(stage)
      selectedIds.add(stage.obligationId)
    }
  }
}

const terminalEvidenceFailure = ({ acceptedExitCodes, exitCode, outcome, signal, stopped }) => {
  if (
    stopped !== true ||
    !Array.isArray(acceptedExitCodes) ||
    acceptedExitCodes.some((code) => !Number.isSafeInteger(code) || code < 0) ||
    new Set(acceptedExitCodes).size !== acceptedExitCodes.length ||
    !(exitCode === null || (Number.isSafeInteger(exitCode) && exitCode >= 0)) ||
    !(signal === null || /^SIG[A-Z0-9]+$/u.test(signal ?? "")) ||
    (exitCode !== null && signal !== null)
  )
    return true
  if (outcome === "passed") return signal !== null || !acceptedExitCodes.includes(exitCode)
  if (outcome === "launch-failed") return exitCode !== null || signal !== null
  if (["failed", "timed-out", "cancelled", "interrupted"].includes(outcome)) return false
  const ordinaryExit = /^exit:(\d+)$/u.exec(outcome ?? "")
  return (
    ordinaryExit === null ||
    signal !== null ||
    exitCode !== Number(ordinaryExit[1]) ||
    acceptedExitCodes.includes(exitCode)
  )
}
const portableArtifact = ({ outputDirectory, source, target }) => {
  const output = join(outputDirectory, target)
  mkdirSync(dirname(output), { recursive: true })
  copyFileSync(source, output)
  const bytes = readFileSync(output)
  return { path: target, bytes: bytes.length, sha256: digest(bytes) }
}

const deliveryIterationPattern =
  /^delivery repeatability fresh iteration (\d+)\/(\d+) PASS elapsedMs=\S+ occurrenceCount=(\d+) acceptedOrderDigest=([0-9a-f]{64}) candidateSha=([0-9a-f]{40})$/u
const deliverySummaryPattern =
  /^delivery repeatability complete mode=fresh .* occurrenceCount=(\d+) acceptedOrderDigest=([0-9a-f]{64}) candidateSha=([0-9a-f]{40})$/u

const deliveryEvidence = (log, outcome, candidateSha) => {
  canonicalSha(candidateSha, "Hosted quality delivery candidate")
  const iterations = []
  const summaries = []
  for (const line of log.split(/\r?\n/u)) {
    if (/^delivery repeatability fresh iteration\b/u.test(line)) {
      const match = line.match(deliveryIterationPattern)
      if (match === null) {
        if (outcome === "passed")
          throw new Error("Delivery repeatability log contains a malformed iteration digest line")
        continue
      }
      iterations.push(match)
    }
    if (/^delivery repeatability complete\b/u.test(line)) {
      const match = line.match(deliverySummaryPattern)
      if (match === null) {
        if (outcome === "passed") throw new Error("Delivery repeatability log contains a malformed production summary")
        continue
      }
      summaries.push(match)
    }
  }
  const candidateMismatch =
    iterations.some((match) => match[5] !== candidateSha) || summaries.some((match) => match[3] !== candidateSha)
  const result = {
    expectedIterations: deliveryRepeatabilityDefaultIterations,
    completedIterations: iterations.length,
    summaryCount: summaries.length,
    occurrenceCount: deliveryRepeatabilityExpectedOccurrenceCount,
    acceptedOrderDigest: deliveryRepeatabilityExpectedAcceptedOrderDigest
  }
  if (candidateMismatch)
    throw new Error("Delivery repeatability digest candidate differs from the hosted quality binding")
  if (
    outcome === "passed" &&
    (iterations.length !== deliveryRepeatabilityDefaultIterations ||
      iterations.some(
        (match) =>
          Number(match[1]) !== iterations.indexOf(match) + 1 ||
          Number(match[2]) !== deliveryRepeatabilityDefaultIterations ||
          Number(match[3]) !== deliveryRepeatabilityExpectedOccurrenceCount ||
          match[4] !== deliveryRepeatabilityExpectedAcceptedOrderDigest
      ) ||
      summaries.length > 1 ||
      summaries.some(
        (match) =>
          Number(match[1]) !== deliveryRepeatabilityExpectedOccurrenceCount ||
          match[2] !== deliveryRepeatabilityExpectedAcceptedOrderDigest
      ))
  )
    throw new Error("Passing delivery stage lacks its exact complete delivery digest evidence")
  return result
}

/** Owner-host export: validate live custody records first, then copy only content-addressed portable evidence. */
export const exportHostedQualityStageEvidence = ({
  binding,
  cellStartedAt,
  nodeVersion,
  outputDirectory,
  runDirectory,
  runId,
  stageId
}) => {
  binding = canonicalBinding(binding)
  if (gitHead(process.cwd()) !== binding.candidateSha)
    throw new Error("Hosted quality candidate differs from the checked-out HEAD")
  const evidence = readRunEvidence({ runDirectory, runId })
  if (
    evidence.runId !== runId ||
    evidence.baseSha !== binding.baseSha ||
    evidence.custody !== "stopped" ||
    evidence.registration !== "closed" ||
    evidence.terminal?.sourceUnchanged !== true
  )
    throw new Error("Hosted quality owner run lacks terminal stopped custody for exact inputs")
  const identity = readRecord(join(runDirectory, "identity.json"))
  const selected = selectedHostedQualityStage({
    baseSha: binding.baseSha,
    candidateSha: binding.candidateSha,
    nodeExecutable: identity.node?.executable,
    nodeVersion,
    pnpmEntryPoint: identity.pnpm?.executable,
    stageId,
    worktree: evidence.worktree
  })
  if (identity.node?.version?.replace(/^v/u, "") !== nodeVersion)
    throw new Error("Hosted quality Node matrix identity differs from the owner runtime")
  const stage = evidence.stages.find(({ command }) => same(command, selected.stage.execution))
  if (stage === undefined) throw new Error(`Hosted quality run did not execute selected stage '${stageId}'`)
  if (!stage.stopped || stage.outcome === "UNPROVEN")
    throw new Error(`Hosted quality stage '${stageId}' lacks terminal stopped custody`)
  const cellStart = canonicalTimestamp(cellStartedAt, "Hosted quality cell start")
  const childStart = Date.parse(stage.startedAt ?? "")
  const childFinish = Date.parse(stage.finishedAt ?? "")
  if (
    !Number.isFinite(childStart) ||
    !Number.isFinite(childFinish) ||
    Date.parse(cellStart) > childStart ||
    childFinish < childStart
  )
    throw new Error("Hosted quality stage timing does not include an ordered cell start")

  mkdirSync(outputDirectory, { recursive: true })
  if (realpathSync(outputDirectory) !== resolve(outputDirectory))
    throw new Error("Hosted quality output directory must not traverse a symbolic link")
  const artifacts = [portableArtifact({ outputDirectory, source: stage.logPath, target: "stage.log" })]
  const descendants = descendantStages(evidence.stages, stage.obligationId)
  const descendantIndexes = new Map(descendants.map((child, index) => [child.obligationId, index]))
  const childDiagnostics = descendants.map((child) => {
    if (!child.stopped || child.outcome === "UNPROVEN")
      throw new Error("Hosted quality descendant lacks terminal stopped custody")
    const log = readFileSync(child.logPath)
    return {
      parent: child.parentId === stage.obligationId ? "stage" : descendantIndexes.get(child.parentId),
      command: { acceptedExitCodes: child.command.acceptedExitCodes, sha256: digest(JSON.stringify(child.command)) },
      log: { bytes: log.length, diagnosticCodes: closedDiagnosticCodes(log.toString("utf8")), sha256: digest(log) },
      stopped: child.stopped,
      exitCode: child.exitCode,
      outcome: child.outcome,
      signal: child.signal
    }
  })
  if (stageId === "coverage") {
    for (const kind of ["final", "summary"]) {
      const artifact = evidence.coverage[kind]
      if (artifact !== undefined) {
        const copied = portableArtifact({
          outputDirectory,
          source: artifact.path,
          target: `coverage/coverage-${kind}.json`
        })
        if (copied.sha256 !== artifact.sha256 || copied.bytes !== artifact.bytes)
          throw new Error(`Hosted quality coverage ${kind} bytes differ from owner evidence`)
        artifacts.push(copied)
      }
    }
  }
  const outcome = stage.outcome === "passed" ? "passed" : "failed"
  const artifactPaths = artifacts.map(({ path }) => path)
  if (
    outcome === "passed" &&
    stageId === "coverage" &&
    !["coverage/coverage-final.json", "coverage/coverage-summary.json"].every((path) => artifactPaths.includes(path))
  )
    throw new Error("Passing hosted coverage stage lacks final and summary artifacts")
  const log = readFileSync(join(outputDirectory, "stage.log"), "utf8")
  const selectedCell = selected.plan.stages.find((cell) => cell.nodeVersion === nodeVersion && cell.stageId === stageId)
  const { identity: stageIdentity, ...stageContract } = selectedCell
  const payload = {
    version: hostedQualityEvidenceVersion,
    binding,
    stageId,
    expectedStageIds: hostedQualityStageIds,
    configurationDigest: selected.plan.configurationDigest,
    nodeVersion,
    policyDigest: selected.plan.policyDigest,
    stageContract,
    stageIdentity,
    tool: { pnpmSha256: identity.pnpm?.digest },
    outcome,
    terminal: {
      custody: evidence.custody,
      sourceUnchanged: evidence.terminal.sourceUnchanged,
      childOutcome: stage.outcome,
      exitCode: stage.exitCode,
      signal: stage.signal
    },
    timing: { cellStartedAt: cellStart, startedAt: stage.startedAt, finishedAt: stage.finishedAt },
    artifacts,
    childDiagnostics,
    ...(stageId === "delivery-repeatability" ? { delivery: deliveryEvidence(log, outcome, binding.candidateSha) } : {})
  }
  const envelope = { ...payload, envelopeSha256: digest(JSON.stringify(payload)) }
  writeFileSync(join(outputDirectory, "envelope.json"), `${JSON.stringify(envelope, undefined, 2)}\n`, { flag: "wx" })
  return envelope
}

const artifactFailure = (envelope, root, artifact) => {
  if (
    artifact === null ||
    typeof artifact !== "object" ||
    typeof artifact.path !== "string" ||
    artifact.path.startsWith("/") ||
    relative(".", artifact.path).startsWith("..") ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < 0 ||
    !/^[0-9a-f]{64}$/u.test(artifact.sha256 ?? "")
  )
    return "malformed portable artifact identity"
  try {
    const path = resolve(root, artifact.path)
    if (relative(resolve(root), path).startsWith("..")) return `artifact escapes report root ${artifact.path}`
    const status = lstatSync(path)
    if (!status.isFile()) return `artifact is not a regular file ${artifact.path}`
    const bytes = readFileSync(path)
    if (bytes.length !== artifact.bytes || digest(bytes) !== artifact.sha256)
      return `artifact digest mismatch for ${artifact.path}`
    return undefined
  } catch (error) {
    if (error?.code === "ENOENT") return `missing artifact ${artifact.path}`
    return `unable to read artifact ${artifact.path}: ${error.message}`
  }
}

const validateEnvelope = ({ binding, envelope, plan, reportRoot }) => {
  const failures = []
  const { envelopeSha256, ...payload } = envelope ?? {}
  if (envelope?.version !== hostedQualityEvidenceVersion || digest(JSON.stringify(payload)) !== envelopeSha256)
    failures.push("malformed or unsealed envelope")
  if (!same(envelope?.binding, binding)) failures.push("candidate/Base/run-attempt binding mismatch")
  if (!hostedQualityStageIds.includes(envelope?.stageId)) failures.push("unknown stage identity")
  const expectedKeys = [
    "artifacts",
    "binding",
    "childDiagnostics",
    "configurationDigest",
    ...(envelope?.stageId === "delivery-repeatability" ? ["delivery"] : []),
    "envelopeSha256",
    "expectedStageIds",
    "nodeVersion",
    "outcome",
    "policyDigest",
    "stageId",
    "stageContract",
    "stageIdentity",
    "terminal",
    "timing",
    "tool",
    "version"
  ].sort()
  if (!same(Object.keys(envelope ?? {}).sort(), expectedKeys)) failures.push("malformed envelope fields")
  if (!same(envelope?.expectedStageIds, plan.expectedStageIds)) failures.push("expected stage inventory mismatch")
  if (envelope?.configurationDigest !== plan.configurationDigest)
    failures.push("stage policy/configuration digest mismatch")
  if (envelope?.policyDigest !== plan.policyDigest) failures.push("stage policy digest mismatch")
  const expectedCell = plan.stages.find(
    ({ nodeVersion, stageId }) => nodeVersion === envelope?.nodeVersion && stageId === envelope?.stageId
  )
  if (expectedCell === undefined || !same(envelope?.stageIdentity, expectedCell.identity))
    failures.push("Node/stage cell identity mismatch")
  if (expectedCell !== undefined) {
    const { identity: _identity, ...expectedContract } = expectedCell
    if (!same(envelope?.stageContract, expectedContract)) failures.push("stage command/bounds contract mismatch")
  }
  if (!/^[0-9a-f]{64}$/u.test(envelope?.tool?.pnpmSha256 ?? "")) failures.push("malformed tool identity")
  if (!same(Object.keys(envelope?.tool ?? {}).sort(), ["pnpmSha256"])) failures.push("malformed tool fields")
  if (!["passed", "failed"].includes(envelope?.outcome)) failures.push("malformed stage outcome")
  if (!same(Object.keys(envelope?.timing ?? {}).sort(), ["cellStartedAt", "finishedAt", "startedAt"]))
    failures.push("malformed timing fields")
  const cellStarted = Date.parse(envelope?.timing?.cellStartedAt)
  const started = Date.parse(envelope?.timing?.startedAt)
  const finished = Date.parse(envelope?.timing?.finishedAt)
  if (
    !Number.isFinite(cellStarted) ||
    !Number.isFinite(started) ||
    !Number.isFinite(finished) ||
    cellStarted > started ||
    finished < started
  )
    failures.push("malformed stage timing")
  else if (
    expectedCell !== undefined &&
    finished - started >
      expectedCell.bounds.timeoutMilliseconds +
        expectedCell.bounds.terminationGraceMilliseconds +
        expectedCell.bounds.processGroupAbsenceTimeoutMilliseconds
  )
    failures.push("stage duration exceeded its bounded settlement allowance")
  if (
    envelope?.terminal?.custody !== "stopped" ||
    envelope?.terminal?.sourceUnchanged !== true ||
    !["passed", "failed", "timed-out", "cancelled", "interrupted", "launch-failed"].some(
      (outcome) =>
        envelope?.terminal?.childOutcome === outcome || /^exit:\d+$/u.test(envelope?.terminal?.childOutcome ?? "")
    )
  )
    failures.push("terminal stopped custody is absent")
  if (
    !same(Object.keys(envelope?.terminal ?? {}).sort(), [
      "childOutcome",
      "custody",
      "exitCode",
      "signal",
      "sourceUnchanged"
    ])
  )
    failures.push("malformed terminal fields")
  if (
    envelope?.outcome === "passed" &&
    (envelope?.terminal?.childOutcome !== "passed" ||
      envelope?.terminal?.exitCode !== 0 ||
      envelope?.terminal?.signal !== null)
  )
    failures.push("passing outcome differs from terminal child evidence")
  const ordinaryExit = /^exit:(\d+)$/u.exec(envelope?.terminal?.childOutcome ?? "")
  if (envelope?.outcome === "failed" && (envelope?.terminal?.childOutcome === "passed" || ordinaryExit?.[1] === "0"))
    failures.push("failed outcome differs from terminal child evidence")
  if (
    ordinaryExit !== null &&
    (envelope?.terminal?.exitCode !== Number(ordinaryExit[1]) || envelope?.terminal?.signal !== null)
  )
    failures.push("ordinary exit terminal evidence differs from child outcome")
  if (
    !(
      envelope?.terminal?.exitCode === null ||
      (Number.isSafeInteger(envelope?.terminal?.exitCode) && envelope.terminal.exitCode >= 0)
    ) ||
    !(envelope?.terminal?.signal === null || /^SIG[A-Z0-9]+$/u.test(envelope?.terminal?.signal ?? "")) ||
    (envelope?.terminal?.exitCode !== null && envelope?.terminal?.signal !== null)
  )
    failures.push("malformed terminal exit/signal correlation")
  if (!Array.isArray(envelope?.artifacts) || envelope.artifacts.length === 0)
    failures.push("artifact inventory is absent")
  else {
    const artifactPaths = envelope.artifacts.map((artifact) => artifact?.path)
    if (new Set(artifactPaths).size !== envelope.artifacts.length) failures.push("duplicate portable artifact path")
    for (const artifact of envelope.artifacts) {
      if (!same(Object.keys(artifact ?? {}).sort(), ["bytes", "path", "sha256"]))
        failures.push("malformed portable artifact fields")
      const failure = artifactFailure(envelope, reportRoot, artifact)
      if (failure !== undefined) failures.push(failure)
    }
  }
  const paths = Array.isArray(envelope?.artifacts) ? envelope.artifacts.map((artifact) => artifact?.path) : []
  if (!paths.includes("stage.log")) failures.push("retained stage log is absent")
  const allowedPaths = new Set([
    "stage.log",
    ...(envelope?.stageId === "coverage" ? ["coverage/coverage-final.json", "coverage/coverage-summary.json"] : [])
  ])
  const childDiagnostics = Array.isArray(envelope?.childDiagnostics) ? envelope.childDiagnostics : []
  if (!Array.isArray(envelope?.childDiagnostics)) failures.push("child diagnostic inventory is absent")
  for (const [index, diagnostic] of childDiagnostics.entries()) {
    const expectedDiagnosticKeys = ["command", "exitCode", "log", "outcome", "parent", "signal", "stopped"]
    if (!same(Object.keys(diagnostic ?? {}).sort(), expectedDiagnosticKeys))
      failures.push("malformed child diagnostic fields")
    if (
      diagnostic?.parent !== "stage" &&
      (!Number.isSafeInteger(diagnostic?.parent) || diagnostic.parent < 0 || diagnostic.parent >= index)
    )
      failures.push("child diagnostic parent association is invalid")
    if (
      diagnostic?.command === null ||
      typeof diagnostic?.command !== "object" ||
      !same(Object.keys(diagnostic.command).sort(), ["acceptedExitCodes", "sha256"]) ||
      !/^[0-9a-f]{64}$/u.test(diagnostic.command.sha256 ?? "") ||
      diagnostic?.log === null ||
      typeof diagnostic?.log !== "object" ||
      !same(Object.keys(diagnostic.log).sort(), ["bytes", "diagnosticCodes", "sha256"]) ||
      !Number.isSafeInteger(diagnostic.log.bytes) ||
      diagnostic.log.bytes < 0 ||
      !/^[0-9a-f]{64}$/u.test(diagnostic.log.sha256 ?? "") ||
      !Array.isArray(diagnostic.log.diagnosticCodes) ||
      diagnostic.log.diagnosticCodes.some((code) => !qualificationRejectionCodes.has(code)) ||
      new Set(diagnostic.log.diagnosticCodes).size !== diagnostic.log.diagnosticCodes.length ||
      terminalEvidenceFailure({
        acceptedExitCodes: diagnostic.command.acceptedExitCodes,
        exitCode: diagnostic.exitCode,
        outcome: diagnostic.outcome,
        signal: diagnostic.signal,
        stopped: diagnostic.stopped
      })
    )
      failures.push("child diagnostic terminal evidence is malformed")
  }
  for (const path of paths) if (!allowedPaths.has(path)) failures.push(`unexpected portable artifact ${path}`)
  if (envelope?.outcome === "passed" && envelope.stageId === "coverage")
    for (const path of ["coverage/coverage-final.json", "coverage/coverage-summary.json"])
      if (!paths.includes(path)) failures.push(`passing coverage evidence lacks ${path}`)
  if (envelope?.outcome === "passed" && envelope.stageId === "delivery-repeatability") {
    const delivery = envelope.delivery
    if (
      delivery?.expectedIterations !== deliveryRepeatabilityDefaultIterations ||
      delivery?.completedIterations !== deliveryRepeatabilityDefaultIterations ||
      ![0, 1].includes(delivery?.summaryCount) ||
      delivery?.occurrenceCount !== deliveryRepeatabilityExpectedOccurrenceCount ||
      delivery?.acceptedOrderDigest !== deliveryRepeatabilityExpectedAcceptedOrderDigest
    )
      failures.push("passing delivery evidence lacks the exact delivery digest")
    try {
      const observedDelivery = deliveryEvidence(
        readFileSync(join(reportRoot, "stage.log"), "utf8"),
        "passed",
        binding.candidateSha
      )
      if (!same(delivery, observedDelivery)) failures.push("delivery digest differs from the retained log")
    } catch (error) {
      failures.push(error.message)
    }
  }
  const files = []
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name)
      const status = lstatSync(path)
      if (status.isDirectory()) walk(path)
      else if (status.isFile()) files.push(relative(reportRoot, path))
      else failures.push(`unsupported portable bundle entry ${relative(reportRoot, path)}`)
    }
  }
  walk(reportRoot)
  if (
    !same(
      files.sort((left, right) => left.localeCompare(right)),
      ["envelope.json", ...paths].sort((left, right) => left.localeCompare(right))
    )
  )
    failures.push("portable bundle file inventory mismatch")
  return failures
}

/** Fail-slow aggregation returns every stage row and every independently observable defect. */
export const aggregateHostedQualityStages = ({ binding, reports }) => {
  binding = canonicalBinding(binding)
  const plan = createQualityGateStagePlan({
    baseSha: binding.baseSha,
    candidateSha: binding.candidateSha,
    nodeExecutable: "node",
    nodeVersions: hostedQualityNodeVersions,
    pnpmEntryPoint: "pnpm"
  })
  const failures = []
  const byCell = new Map()
  let commonPnpm
  for (const report of reports) {
    let envelope
    try {
      envelope = JSON.parse(readFileSync(report, "utf8"))
    } catch (error) {
      failures.push(`Malformed hosted quality report ${report}: ${error.message}`)
      continue
    }
    const stageId = envelope?.stageId
    if (!hostedQualityStageIds.includes(stageId)) {
      failures.push(`Hosted quality report ${report} has no recognized stage identity`)
      continue
    }
    const cell = `${envelope.nodeVersion}:${stageId}`
    if (byCell.has(cell)) {
      failures.push(`Duplicate hosted quality evidence for Node ${envelope.nodeVersion} ${stageId}`)
      continue
    }
    const validation = validateEnvelope({ binding, envelope, plan, reportRoot: dirname(report) })
    for (const failure of validation) failures.push(`${stageId}: ${failure}`)
    if (commonPnpm !== undefined && commonPnpm !== envelope.tool?.pnpmSha256)
      failures.push(`${stageId}: mixed pnpm tool identity`)
    commonPnpm ??= envelope.tool?.pnpmSha256
    byCell.set(cell, { envelope, report, validation })
  }
  const rows = plan.expectedCells.map(({ nodeVersion, stageId }) => {
    const expectedCell = plan.stages.find((cell) => cell.nodeVersion === nodeVersion && cell.stageId === stageId)
    const report = byCell.get(`${nodeVersion}:${stageId}`)
    if (report === undefined) {
      failures.push(`Node ${nodeVersion} ${stageId}: missing expected stage evidence`)
      return {
        nodeVersion,
        stageId,
        outcome: "UNPROVEN",
        artifacts: [],
        command: expectedCell?.command,
        failures: ["missing expected stage evidence"]
      }
    }
    return {
      nodeVersion,
      stageId,
      outcome: report.validation.length === 0 ? report.envelope.outcome : "UNPROVEN",
      artifacts: Array.isArray(report.envelope.artifacts)
        ? report.envelope.artifacts
            .filter((artifact) => typeof artifact?.path === "string")
            .map(({ path }) => join(dirname(report.report), path))
        : [],
      command: expectedCell?.command,
      failures: report.validation
    }
  })
  if (rows.some(({ outcome }) => outcome !== "passed")) failures.push("One or more hosted quality stages did not pass")
  const validTimes = [...byCell.values()]
    .filter(({ validation }) => validation.length === 0)
    .map(({ envelope }) => ({
      outcome: envelope.outcome,
      cellStarted: Date.parse(envelope.timing?.cellStartedAt),
      started: Date.parse(envelope.timing?.startedAt),
      finished: Date.parse(envelope.timing?.finishedAt)
    }))
    .filter(
      ({ cellStarted, finished, started }) =>
        Number.isFinite(cellStarted) &&
        Number.isFinite(started) &&
        Number.isFinite(finished) &&
        cellStarted <= started &&
        finished >= started
    )
  const firstStarted =
    validTimes.length === 0 ? undefined : Math.min(...validTimes.map(({ cellStarted }) => cellStarted))
  const lastFinished = validTimes.length === 0 ? undefined : Math.max(...validTimes.map(({ finished }) => finished))
  const failedFinished = validTimes.filter(({ outcome }) => outcome !== "passed").map(({ finished }) => finished)
  const metrics = {
    makespanMilliseconds:
      firstStarted === undefined || lastFinished === undefined ? undefined : lastFinished - firstStarted,
    firstActionableFailureMilliseconds:
      firstStarted === undefined || failedFinished.length === 0 ? undefined : Math.min(...failedFinished) - firstStarted
  }
  return { version: 1, binding, rows, failures, metrics, succeeded: failures.length === 0 }
}

export const hostedQualityRunDirectory = (runId, cwd = process.cwd()) =>
  join(repositoryLocation(cwd).custodyRoot, "runs", runId)

export const readHostedQualityRunReference = (path) => {
  const record = readRecord(path)
  if (record.version !== 1 || !/^[0-9a-f-]{36}$/u.test(record.runId ?? ""))
    throw new Error("Hosted quality owner run reference is malformed")
  return record.runId
}
