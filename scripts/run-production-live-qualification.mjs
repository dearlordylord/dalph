import { createHash, randomUUID } from "node:crypto"
import { execFile as nodeExecFile, spawn } from "node:child_process"
import { access, chmod, constants, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { promisify } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"

const execFile = promisify(nodeExecFile)

/** The one built controller entry point owned by the production qualification runtime. */
export const productionLiveQualificationBin = "packages/dalph/dist/bin/production-live-qualification.js"
/** The shipped Dalph entry selected by the strict runtime manifest. */
export const productionLiveQualificationShippedBin = "packages/dalph/dist/bin/dalph.js"
/** The built formal-provenance validator that processes both downloaded logs. */
export const productionLiveQualificationFormalValidatorBin =
  "packages/dalph/dist/src/qualification/qualification-provenance.js"
export const productionLiveQualificationEnvironment = "production-live-qualification"
export const productionLiveQualificationOptIn = "DALPH_RUN_PRODUCTION_LIVE_QUALIFICATION"
export const formalQualificationJobNames = Object.freeze({
  dedicated: Object.freeze(["Dedicated formal evidence shard 0", "Dedicated formal evidence shard 1"]),
  stressed: Object.freeze(["Stressed formal evidence shard 0", "Stressed formal evidence shard 1"])
})

const exactSha = /^[0-9a-f]{40}$/u
const repository = /^[^\s/]+\/[^\s/]+$/u
const positiveInteger = /^[1-9][0-9]*$/u
const hostedFormalJobLimitSeconds = 16 * 60
const secretEnvironmentNames = new Set([
  "GITHUB_TOKEN",
  "DALPH_LIVE_GITHUB_TOKEN",
  "DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL"
])
const secretEnvironmentPattern = /(TOKEN|SECRET|CREDENTIAL|PASSWORD|PRIVATE_KEY)/iu

const requiredEnvironmentNames = [
  productionLiveQualificationOptIn,
  "DALPH_CANDIDATE_SHA",
  "DALPH_COVERAGE_BASE_SHA",
  "DALPH_LIVE_QUALIFICATION_SOURCE_SHA",
  "DALPH_LIVE_QUALIFICATION_SOURCE_REPOSITORY",
  "DALPH_LIVE_QUALIFICATION_SOURCE_BASE_SHA",
  "DALPH_LIVE_QUALIFICATION_BUILT_ENTRY",
  "DALPH_LIVE_QUALIFICATION_SHIPPED_ENTRY",
  "DALPH_LIVE_QUALIFICATION_LOCKFILE",
  "DALPH_LIVE_QUALIFICATION_CODEX_EXECUTABLE",
  "DALPH_LIVE_QUALIFICATION_PUBLICATION_CONTAINER",
  "DALPH_LIVE_QUALIFICATION_WORKFLOW",
  "DALPH_LIVE_QUALIFICATION_RUN_ID",
  "DALPH_LIVE_QUALIFICATION_JOB_ID",
  "DALPH_LIVE_QUALIFICATION_REPOSITORY",
  "DALPH_LIVE_QUALIFICATION_MANIFEST",
  "DALPH_LIVE_QUALIFICATION_ARTIFACT",
  "DALPH_LIVE_QUALIFICATION_RETAINED_LOCATORS",
  "DALPH_LIVE_QUALIFICATION_FORMAL_ROOT",
  "DALPH_LIVE_QUALIFICATION_PROTECTED_ENVIRONMENT",
  "GITHUB_ACTIONS",
  "GITHUB_WORKFLOW",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_JOB",
  "GITHUB_REPOSITORY",
  "GITHUB_SERVER_URL",
  "GITHUB_SHA",
  "DALPH_LIVE_GITHUB_TOKEN"
]

const valueOf = (environment, name) => {
  const value = environment[name]
  if (value === undefined || value === "") throw new Error(`missing required qualification input: ${name}`)
  return value
}

const exactLocator = (environment, name) => {
  const value = valueOf(environment, name)
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new Error(`qualification input ${name} contains forbidden path characters`)
  }
  if (!nodePath.isAbsolute(value) || nodePath.normalize(value) !== value) {
    throw new Error(`qualification input ${name} must be a normalized absolute path`)
  }
  return value
}

const exactShaInput = (environment, name) => {
  const value = valueOf(environment, name)
  if (!exactSha.test(value))
    throw new Error(`qualification input ${name} must be exactly 40 lowercase hexadecimal characters`)
  return value
}

const positiveIntegerInput = (environment, name) => {
  const value = valueOf(environment, name)
  if (!positiveInteger.test(value)) throw new Error(`qualification input ${name} must be a positive integer`)
  return value
}

const requireReadableFile = async (path, name) => {
  let status
  try {
    status = await lstat(path)
    await access(path, constants.R_OK)
  } catch (error) {
    throw new Error(`qualification input ${name} is not a readable file`, { cause: error })
  }
  if (!status.isFile() || status.size === 0) throw new Error(`qualification input ${name} is not a nonempty file`)
}

const positiveSafeInteger = (value, name) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`qualification ${name} must be a positive numeric Actions identifier`)
  }
  return value
}

const nonnegativeSeconds = (value, name) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`qualification ${name} must be a finite nonnegative duration in seconds`)
  }
  return value
}

const readJsonObject = async (path, name) => {
  let source
  try {
    source = await readFile(path, "utf8")
  } catch (error) {
    throw new Error(`qualification input ${name} is not readable JSON`, { cause: error })
  }
  let value
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error(`qualification input ${name} is not readable JSON`, { cause: error })
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`qualification input ${name} must be a JSON object`)
  }
  return value
}

const decodeRetentionCheckpoint = async (sourceRepository, value) => {
  const runtime = await import(
    pathToFileURL(
      nodePath.join(sourceRepository, "packages/dalph/dist/src/qualification/live-qualification-runtime.js")
    ).href
  )
  const { Effect } = await import("effect")
  if (typeof runtime.decodeProductionLiveQualificationRetentionReport !== "function") {
    throw new Error("built live qualification runtime is missing its retention-report decoder")
  }
  return Effect.runPromise(runtime.decodeProductionLiveQualificationRetentionReport(value))
}

const publicJournalEventKindDecoder = async () => {
  const [{ WorkflowJournalEvent }, { Schema }] = await Promise.all([import("@dalph/orchestrator"), import("effect")])
  const eventKinds = []
  const collectEventKinds = (ast) => {
    if (ast._tag === "Union") {
      for (const member of ast.types) collectEventKinds(member)
      return
    }
    if (ast._tag !== "Objects") throw new Error("workflow journal event vocabulary is not a tagged union")
    const tag = ast.propertySignatures.find(({ name }) => name === "_tag")?.type
    if (tag?._tag !== "Literal" || typeof tag.literal !== "string") {
      throw new Error("workflow journal event vocabulary has a non-literal tag")
    }
    eventKinds.push(tag.literal)
  }
  collectEventKinds(WorkflowJournalEvent.ast)
  if (eventKinds.length === 0 || new Set(eventKinds).size !== eventKinds.length) {
    throw new Error("workflow journal event vocabulary is empty or ambiguous")
  }
  return Schema.decodeUnknownSync(Schema.Literals(eventKinds))
}

const dispositionCounts = (resources) =>
  Object.fromEntries(
    [...new Set(resources.map(({ disposition }) => disposition))]
      .sort((left, right) => left.localeCompare(right))
      .map((disposition) => [disposition, resources.filter((resource) => resource.disposition === disposition).length])
  )

const unavailableObservation = (reason) => ({ _tag: "Unavailable", reason })

const observeJournalKinds = async (journalPath) => {
  if (journalPath === undefined) return unavailableObservation("CheckpointIncomplete")
  let database
  try {
    const [{ DatabaseSync }, decodeEventKind] = await Promise.all([
      import("node:sqlite"),
      publicJournalEventKindDecoder()
    ])
    database = new DatabaseSync(journalPath, { readOnly: true })
    const readPartition = (table) =>
      database
        .prepare(`SELECT event_kind FROM ${table} ORDER BY run_id, position`)
        .all()
        .map(({ event_kind: eventKind }) => decodeEventKind(eventKind))
    const hot = readPartition("journal_records")
    const cold = readPartition("journal_records_cold")
    if (hot.length + cold.length > 1_000) return unavailableObservation("UnexpectedRecordCount")
    return { _tag: "Observed", hotEventKinds: hot, coldEventKinds: cold }
  } catch {
    return unavailableObservation("Unreadable")
  } finally {
    database?.close()
  }
}

const observeApplicationServerStarts = async (privateStateDirectory) => {
  if (privateStateDirectory === undefined) return unavailableObservation("CheckpointIncomplete")
  try {
    const source = await readFile(nodePath.join(privateStateDirectory, "app-server-processes"), "utf8")
    const observations = source.split("\n").filter((line) => line.length > 0)
    if (observations.some((line) => !/^linux:[1-9][0-9]*:pid:[1-9][0-9]*$/u.test(line))) {
      return unavailableObservation("Unreadable")
    }
    const count = observations.length
    return count <= 16 ? { _tag: "Observed", count } : unavailableObservation("UnexpectedRecordCount")
  } catch {
    return unavailableObservation("Unreadable")
  }
}

/**
 * After a hosted cancellation, publish only fixed journal event kinds and an
 * app-server start count. Journal payloads, private Codex state, prompts,
 * credentials, and runner-local locators never cross this boundary.
 */
export const captureProductionLiveQualificationDiagnostics = async ({ environment = nodeProcess.env } = {}) => {
  const publicationContainer = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_PUBLICATION_CONTAINER")
  const sourceRepository = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_SOURCE_REPOSITORY")
  const retentionReport = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_RETAINED_LOCATORS")
  const qualificationArtifact = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_ARTIFACT")
  const diagnostics = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_DIAGNOSTICS")
  if (
    sourceRepository !== nodePath.resolve(nodeProcess.cwd()) ||
    nodePath.dirname(diagnostics) !== publicationContainer ||
    diagnostics === retentionReport ||
    diagnostics === qualificationArtifact
  ) {
    throw new Error(
      "qualification diagnostics require the command repository and a distinct output under the publication container"
    )
  }
  const hosted = {
    sourceSha: exactShaInput(environment, "DALPH_CANDIDATE_SHA"),
    runId: positiveSafeInteger(Number(positiveIntegerInput(environment, "GITHUB_RUN_ID")), "GITHUB_RUN_ID"),
    runAttempt: positiveSafeInteger(
      Number(positiveIntegerInput(environment, "GITHUB_RUN_ATTEMPT")),
      "GITHUB_RUN_ATTEMPT"
    ),
    job: valueOf(environment, "GITHUB_JOB")
  }
  let checkpoint
  let checkpointRead = "Absent"
  let checkpointSource
  try {
    checkpointSource = await readFile(retentionReport, "utf8")
  } catch (error) {
    checkpointRead = error?.code === "ENOENT" ? "Absent" : "Unreadable"
  }
  if (checkpointSource !== undefined) {
    checkpointRead = "Unreadable"
    try {
      checkpoint = await decodeRetentionCheckpoint(sourceRepository, JSON.parse(checkpointSource))
    } catch {
      checkpoint = undefined
    }
  }
  if (checkpoint === undefined && checkpointRead === "Absent") {
    try {
      const qualified = JSON.parse(await readFile(qualificationArtifact, "utf8"))
      if (qualified?.schemaVersion === 1 && qualified?.artifactStage === "Final") return undefined
    } catch {
      // A missing or malformed final artifact does not erase the hosted failure diagnostic.
    }
  }
  let report
  if (checkpoint === undefined) {
    report = {
      schemaVersion: 1,
      outcome: "NotQualified",
      hosted,
      checkpoint: unavailableObservation(checkpoint === undefined ? checkpointRead : "Unreadable"),
      journal: unavailableObservation("CheckpointUnavailable"),
      applicationServerStarts: unavailableObservation("CheckpointUnavailable")
    }
  } else {
    const retainedLocalLocators = checkpoint.local
      .filter(({ disposition }) => disposition === "Retained")
      .map(({ locator }) => locator)
    const journalPaths = retainedLocalLocators.filter((locator) => nodePath.basename(locator) === "journal.sqlite")
    const privateStateDirectories = retainedLocalLocators.filter(
      (locator) => nodePath.basename(locator) === "codex-executor-private"
    )
    report = {
      schemaVersion: 1,
      outcome: "NotQualified",
      hosted,
      checkpoint: {
        _tag: "Observed",
        phase: checkpoint.phase,
        githubResourceCount: checkpoint.github.length,
        githubDispositions: dispositionCounts(checkpoint.github),
        localResourceCount: checkpoint.local.length,
        localDispositions: dispositionCounts(checkpoint.local)
      },
      journal: await observeJournalKinds(journalPaths.length === 1 ? journalPaths[0] : undefined),
      applicationServerStarts: await observeApplicationServerStarts(
        privateStateDirectories.length === 1 ? privateStateDirectories[0] : undefined
      )
    }
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  for (const [name, value] of Object.entries(environment)) {
    if (
      (secretEnvironmentNames.has(name) || secretEnvironmentPattern.test(name)) &&
      typeof value === "string" &&
      value !== "" &&
      serialized.includes(value)
    ) {
      throw new Error("qualification diagnostics contain a protected credential")
    }
  }
  await mkdir(publicationContainer, { recursive: true, mode: 0o700 })
  const replacement = `${diagnostics}.replacement`
  try {
    await writeFile(replacement, serialized, { mode: 0o600 })
    await rename(replacement, diagnostics)
  } finally {
    await rm(replacement, { force: true })
  }
  return report
}

const githubRunIdentity = (environment) => ({
  repository: valueOf(environment, "GITHUB_REPOSITORY"),
  runAttempt: positiveSafeInteger(
    Number(positiveIntegerInput(environment, "GITHUB_RUN_ATTEMPT")),
    "GITHUB_RUN_ATTEMPT"
  ),
  runId: positiveSafeInteger(Number(positiveIntegerInput(environment, "GITHUB_RUN_ID")), "GITHUB_RUN_ID")
})
const githubRunInputs = (environment) => ({
  ...githubRunIdentity(environment),
  token: valueOf(environment, "GITHUB_TOKEN")
})

/** Require already-completed hosted CI for this exact candidate before any formal worker starts. */
export const requireSuccessfulCandidateCi = async ({
  environment = nodeProcess.env,
  fetchImpl = globalThis.fetch
} = {}) => {
  if (typeof fetchImpl !== "function") throw new Error("GitHub Actions CI lookup requires fetch")
  const headSha = exactShaInput(environment, "DALPH_CANDIDATE_SHA")
  const sourceRepository = valueOf(environment, "GITHUB_REPOSITORY")
  if (!repository.test(sourceRepository)) throw new Error("GitHub workflow repository identity is invalid")
  const token = valueOf(environment, "GITHUB_TOKEN")
  const apiBase = new URL(environment.GITHUB_API_URL ?? "https://api.github.com")
  if (apiBase.protocol !== "https:") throw new Error("GitHub API URL must use HTTPS")
  const endpoint = new URL(
    `repos/${sourceRepository}/actions/runs`,
    apiBase.href.endsWith("/") ? apiBase : `${apiBase.href}/`
  )
  endpoint.searchParams.set("head_sha", headSha)
  endpoint.searchParams.set("per_page", "100")
  let response
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "dalph-production-live-qualification"
      }
    })
  } catch (error) {
    throw new Error("GitHub Actions CI lookup failed", { cause: error })
  }
  if (!response.ok) throw new Error(`GitHub Actions CI lookup failed with status ${response.status}`)
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    throw new Error("GitHub Actions CI lookup returned invalid JSON", { cause: error })
  }
  if (payload === null || typeof payload !== "object" || !Array.isArray(payload.workflow_runs)) {
    throw new Error("GitHub Actions CI lookup returned an invalid workflow-run list")
  }
  const accepted = payload.workflow_runs.some(
    (run) =>
      run !== null &&
      typeof run === "object" &&
      run.name === "CI" &&
      run.head_sha === headSha &&
      run.status === "completed" &&
      run.conclusion === "success"
  )
  if (!accepted) throw new Error("exact candidate requires a completed successful CI workflow")
  return { headSha, workflow: "CI" }
}

const formalShardPaths = (root, kind, shard) => ({
  reportPath: nodePath.join(root, kind, `shard-${shard}`, "report.json"),
  metadataPath: nodePath.join(root, kind, `shard-${shard}`, "provenance.json")
})

const readFormalShardMetadata = async ({ environment, kind, metadataPath, reportPath, shard }) => {
  const metadata = await readJsonObject(metadataPath, `${kind} shard ${shard} formal provenance`)
  const { runAttempt, runId } = githubRunIdentity(environment)
  if (metadata.profile !== kind || metadata.shard !== shard) {
    throw new Error(`${kind} shard ${shard} formal provenance identity is incorrect`)
  }
  const expectedCondition =
    kind === "dedicated"
      ? { kind: "dedicated-hosted-job", runnerLabel: "ubuntu-24.04-arm" }
      : { kind: "cpu-affinity", runnerLabel: "ubuntu-latest", cpuList: "0-1" }
  if (
    metadata.condition === null ||
    typeof metadata.condition !== "object" ||
    Array.isArray(metadata.condition) ||
    Object.entries(expectedCondition).some(([name, value]) => metadata.condition[name] !== value)
  )
    throw new Error(`${kind} shard ${shard} formal provenance execution condition is incorrect`)
  const effectiveParallelism = positiveSafeInteger(
    metadata.condition.effectiveParallelism,
    `${kind} shard ${shard} formal effective parallelism`
  )
  let condition
  if (kind === "dedicated") {
    condition = { ...expectedCondition, effectiveParallelism }
  } else {
    const hostParallelism = positiveSafeInteger(
      metadata.condition.hostParallelism,
      `${kind} shard ${shard} formal host parallelism`
    )
    if (effectiveParallelism !== 2 || hostParallelism <= 2) {
      throw new Error(`${kind} shard ${shard} formal provenance does not prove CPU-affinity stress`)
    }
    condition = { ...expectedCondition, hostParallelism, effectiveParallelism }
  }
  if (metadata.sourceSha !== valueOf(environment, "DALPH_LIVE_QUALIFICATION_SOURCE_SHA")) {
    throw new Error(`${kind} shard ${shard} formal provenance source SHA does not match the candidate`)
  }
  if (metadata.reviewedBaseSha !== valueOf(environment, "DALPH_LIVE_QUALIFICATION_SOURCE_BASE_SHA")) {
    throw new Error(`${kind} shard ${shard} formal provenance Base SHA does not match the reviewed Base`)
  }
  if (metadata.workflowName !== "Production live qualification") {
    throw new Error(`${kind} shard ${shard} formal provenance workflow is not protected`)
  }
  if (metadata.runId !== runId || metadata.runAttempt !== runAttempt || metadata.jobName !== "formal") {
    throw new Error(`${kind} shard ${shard} formal provenance run attempt or worker is incorrect`)
  }
  if (typeof metadata.nodeVersion !== "string" || !/^24\.20\.\d+$/u.test(metadata.nodeVersion)) {
    throw new Error(`${kind} shard ${shard} formal provenance Node version is unsupported`)
  }
  if (metadata.report !== "report.json" || nodePath.basename(reportPath) !== metadata.report) {
    throw new Error(`${kind} shard ${shard} formal report name is incorrect`)
  }
  await requireReadableFile(reportPath, `${kind} shard ${shard} formal report`)
  const reportSource = await readFile(reportPath, "utf8")
  const reportDigest = createHash("sha256").update(reportSource).digest("hex")
  if (metadata.reportDigest !== reportDigest) {
    throw new Error(`${kind} shard ${shard} formal report digest does not match its job provenance`)
  }
  return {
    condition,
    formalSeconds: nonnegativeSeconds(metadata.formalSeconds, `${kind} shard ${shard} formal duration`),
    nodeVersion: metadata.nodeVersion,
    profile: kind,
    reportPath,
    reportDigest,
    reviewedBaseSha: metadata.reviewedBaseSha,
    runAttempt,
    runId,
    setupInstallSeconds: nonnegativeSeconds(
      metadata.setupInstallSeconds,
      `${kind} shard ${shard} setup/install duration`
    ),
    shard,
    sourceSha: metadata.sourceSha,
    workflowName: metadata.workflowName
  }
}

const currentRunAttemptJobs = async ({ environment, fetchImpl = globalThis.fetch }) => {
  if (typeof fetchImpl !== "function") throw new Error("GitHub Actions job lookup requires fetch")
  const { repository: sourceRepository, runAttempt, runId, token } = githubRunInputs(environment)
  if (!repository.test(sourceRepository)) throw new Error("GitHub workflow repository identity is invalid")
  const apiBase = new URL(environment.GITHUB_API_URL ?? "https://api.github.com")
  if (apiBase.protocol !== "https:") throw new Error("GitHub API URL must use HTTPS")
  const endpoint = new URL(
    `repos/${sourceRepository}/actions/runs/${runId}/attempts/${runAttempt}/jobs`,
    apiBase.href.endsWith("/") ? apiBase : `${apiBase.href}/`
  )
  endpoint.searchParams.set("per_page", "100")
  let response
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "dalph-production-live-qualification"
      }
    })
  } catch (error) {
    throw new Error("GitHub Actions job lookup failed", { cause: error })
  }
  if (!response.ok) throw new Error(`GitHub Actions job lookup failed with status ${response.status}`)
  let payload
  try {
    payload = await response.json()
  } catch (error) {
    throw new Error("GitHub Actions job lookup returned invalid JSON", { cause: error })
  }
  if (payload === null || typeof payload !== "object" || !Array.isArray(payload.jobs)) {
    throw new Error("GitHub Actions job lookup returned an invalid job list")
  }
  return payload.jobs
}

const resolveFormalJob = (jobs, kind, shard, runId, runAttempt) => {
  const name = formalQualificationJobNames[kind][shard]
  const matches = jobs.filter(
    (job) =>
      job !== null &&
      typeof job === "object" &&
      job.name === name &&
      job.run_id === runId &&
      job.run_attempt === runAttempt
  )
  if (matches.length !== 1) {
    throw new Error(`${kind} shard ${shard} formal Actions job must resolve uniquely for the current run attempt`)
  }
  const job = matches[0]
  if (job.status !== "completed" || job.conclusion !== "success") {
    throw new Error(`${kind} shard ${shard} formal Actions job did not complete successfully`)
  }
  if (typeof job.started_at !== "string" || typeof job.completed_at !== "string") {
    throw new Error(`${kind} shard ${shard} formal Actions job timestamps are invalid`)
  }
  const started = Date.parse(job.started_at)
  const completed = Date.parse(job.completed_at)
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    throw new Error(`${kind} shard ${shard} formal Actions job timestamps are invalid`)
  }
  return {
    completeJobSeconds: (completed - started) / 1000,
    completedAt: job.completed_at,
    id: positiveSafeInteger(job.id, `${kind} shard ${shard} formal Actions job ID`),
    name,
    startedAt: job.started_at
  }
}

const enrichFormalMetadata = async ({ environment, job, kind, metadataPath, reportPath, shard }) => {
  const profile = await readFormalShardMetadata({ environment, kind, shard, reportPath, metadataPath })
  if (
    job.completeJobSeconds < profile.setupInstallSeconds + profile.formalSeconds ||
    job.completeJobSeconds >= hostedFormalJobLimitSeconds
  ) {
    throw new Error(`${kind} shard ${shard} Actions job duration does not satisfy the hosted timing contract`)
  }
  const enriched = {
    condition: profile.condition,
    completeJobSeconds: job.completeJobSeconds,
    formalSeconds: profile.formalSeconds,
    job: {
      jobId: job.id,
      name: job.name,
      runAttempt: profile.runAttempt,
      runId: profile.runId,
      workflow: "Production live qualification"
    },
    completedAt: job.completedAt,
    nodeVersion: profile.nodeVersion,
    profile: profile.profile,
    protectedEnvironment: productionLiveQualificationEnvironment,
    report: "report.json",
    reportDigest: profile.reportDigest,
    reviewedBaseSha: profile.reviewedBaseSha,
    runId: profile.runId,
    runAttempt: profile.runAttempt,
    shard,
    sourceSha: profile.sourceSha,
    startedAt: job.startedAt,
    setupInstallSeconds: profile.setupInstallSeconds,
    jobName: "formal",
    workflowName: profile.workflowName
  }
  const serialized = `${JSON.stringify(enriched, null, 2)}\n`
  if (serialized.includes(valueOf(environment, "GITHUB_TOKEN"))) {
    throw new Error(`${kind} formal provenance unexpectedly contains the Actions token`)
  }
  await writeFile(metadataPath, serialized, { mode: 0o600 })
  return enriched
}

const suppliedFormalProfile = async ({ environment, formalRoot, kind }) => {
  const shards = await Promise.all(
    [0, 1].map(async (shard) => {
      const paths = formalShardPaths(formalRoot, kind, shard)
      const profile = await readFormalShardMetadata({ environment, kind, shard, ...paths })
      const metadata = await readJsonObject(paths.metadataPath, `${kind} shard ${shard} formal provenance`)
      const job = metadata.job
      if (job === null || typeof job !== "object" || Array.isArray(job)) {
        throw new Error(`${kind} shard ${shard} formal provenance is missing its Actions job`)
      }
      const completeJobSeconds = nonnegativeSeconds(
        metadata.completeJobSeconds,
        `${kind} shard ${shard} complete-job duration`
      )
      let reportSource
      try {
        reportSource = await readFile(profile.reportPath, "utf8")
      } catch (error) {
        throw new Error(`${kind} shard ${shard} formal report is not readable`, { cause: error })
      }
      return {
        condition: profile.condition,
        completeJobSeconds,
        completedAt: metadata.completedAt,
        formalSeconds: profile.formalSeconds,
        job: {
          jobId: positiveSafeInteger(job.jobId, `${kind} shard ${shard} Actions job ID`),
          name: job.name,
          runAttempt: positiveSafeInteger(job.runAttempt, `${kind} shard ${shard} Actions run attempt`),
          runId: positiveSafeInteger(job.runId, `${kind} shard ${shard} Actions run ID`),
          workflow: job.workflow
        },
        reportSource,
        setupInstallSeconds: profile.setupInstallSeconds,
        shard,
        sourceSha: profile.sourceSha,
        nodeVersion: profile.nodeVersion,
        startedAt: metadata.startedAt
      }
    })
  )
  return {
    nodeVersion: shards[0].nodeVersion,
    profileKind: kind,
    runAttempt: shards[0].job.runAttempt,
    runId: shards[0].job.runId,
    shards,
    sourceSha: shards[0].sourceSha
  }
}

/** Process both downloaded formal logs through the built runtime validator. */
export const buildFormalQualificationProvenance = async ({ environment, inputs }) => {
  const validatorPath = nodePath.resolve(inputs.sourceRepository, productionLiveQualificationFormalValidatorBin)
  try {
    const validator = await import(pathToFileURL(validatorPath).href)
    if (typeof validator.requiredQualificationFormalProvenance !== "function") {
      throw new Error("missing validator export")
    }
    const { Effect } = await import("effect")
    const effect = validator.requiredQualificationFormalProvenance(inputs.candidateSha, {
      dedicated: await suppliedFormalProfile({ environment, kind: "dedicated", formalRoot: inputs.formalRoot }),
      stressed: await suppliedFormalProfile({ environment, kind: "stressed", formalRoot: inputs.formalRoot })
    })
    return await Effect.runPromise(effect)
  } catch (error) {
    throw new Error("qualification formal provenance failed built validation", { cause: error })
  }
}

/** Resolves only safe numeric job IDs and writes no raw GitHub API response. */
export const resolveFormalQualificationJobs = async ({
  environment = nodeProcess.env,
  fetchImpl = globalThis.fetch
} = {}) => {
  if (environment.GITHUB_WORKFLOW !== "Production live qualification") {
    throw new Error("formal job resolution requires the Production live qualification workflow")
  }
  if (environment.DALPH_LIVE_QUALIFICATION_PROTECTED_ENVIRONMENT !== productionLiveQualificationEnvironment) {
    throw new Error(`formal job resolution requires protected environment ${productionLiveQualificationEnvironment}`)
  }
  const { runAttempt, runId } = githubRunInputs(environment)
  const jobs = await currentRunAttemptJobs({ environment, fetchImpl })
  const formalRoot = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_FORMAL_ROOT")
  const resolved = Object.fromEntries(
    ["dedicated", "stressed"].map((kind) => [
      kind,
      [0, 1].map((shard) => resolveFormalJob(jobs, kind, shard, runId, runAttempt))
    ])
  )
  const jobIds = Object.values(resolved)
    .flat()
    .map(({ id }) => id)
  if (new Set(jobIds).size !== 4) throw new Error("all four formal Actions job IDs must be distinct")
  await Promise.all(
    Object.entries(resolved).flatMap(([kind, profileJobs]) =>
      profileJobs.map((job, shard) =>
        enrichFormalMetadata({ environment, job, kind, shard, ...formalShardPaths(formalRoot, kind, shard) })
      )
    )
  )
  return resolved
}

/** Validate the protected workflow's non-secret shape before any provider child starts. */
export const validateProductionLiveQualificationEnvironment = async (environment) => {
  if (environment[productionLiveQualificationOptIn] !== "1") {
    throw new Error(`requires ${productionLiveQualificationOptIn}=1`)
  }

  for (const name of requiredEnvironmentNames) valueOf(environment, name)
  const candidateSha = exactShaInput(environment, "DALPH_CANDIDATE_SHA")
  const reviewedBaseSha = exactShaInput(environment, "DALPH_COVERAGE_BASE_SHA")
  if (exactShaInput(environment, "DALPH_LIVE_QUALIFICATION_SOURCE_SHA") !== candidateSha) {
    throw new Error("live qualification source SHA does not match the exact requested candidate SHA")
  }
  if (exactShaInput(environment, "DALPH_LIVE_QUALIFICATION_SOURCE_BASE_SHA") !== reviewedBaseSha) {
    throw new Error("live qualification source Base SHA does not match the exact reviewed Base SHA")
  }
  if (valueOf(environment, "DALPH_LIVE_QUALIFICATION_WORKFLOW") !== "Production live qualification") {
    throw new Error("live qualification workflow provenance is not the protected workflow")
  }
  positiveIntegerInput(environment, "DALPH_LIVE_QUALIFICATION_RUN_ID")
  valueOf(environment, "DALPH_LIVE_QUALIFICATION_JOB_ID")
  const configuredRepository = valueOf(environment, "DALPH_LIVE_QUALIFICATION_REPOSITORY")
  if (!repository.test(configuredRepository)) {
    throw new Error("qualification input DALPH_LIVE_QUALIFICATION_REPOSITORY must be owner/repository")
  }
  if (environment.GITHUB_ACTIONS !== "true") throw new Error("live qualification requires GitHub Actions")
  if (environment.GITHUB_WORKFLOW !== "Production live qualification") {
    throw new Error("live qualification requires the Production live qualification workflow")
  }
  if (valueOf(environment, "DALPH_LIVE_QUALIFICATION_RUN_ID") !== valueOf(environment, "GITHUB_RUN_ID")) {
    throw new Error("live qualification run provenance does not match the current workflow run")
  }
  if (valueOf(environment, "DALPH_LIVE_QUALIFICATION_JOB_ID") !== valueOf(environment, "GITHUB_JOB")) {
    throw new Error("live qualification job provenance does not match the current workflow job")
  }
  if (environment.DALPH_LIVE_QUALIFICATION_PROTECTED_ENVIRONMENT !== productionLiveQualificationEnvironment) {
    throw new Error(`live qualification requires protected environment ${productionLiveQualificationEnvironment}`)
  }
  if (!repository.test(valueOf(environment, "GITHUB_REPOSITORY"))) {
    throw new Error("GitHub workflow repository identity is invalid")
  }
  if (!/^https:\/\//u.test(valueOf(environment, "GITHUB_SERVER_URL"))) {
    throw new Error("GitHub workflow server URL must use HTTPS")
  }
  positiveIntegerInput(environment, "GITHUB_RUN_ID")
  positiveIntegerInput(environment, "GITHUB_RUN_ATTEMPT")
  valueOf(environment, "GITHUB_JOB")
  if (!exactSha.test(valueOf(environment, "GITHUB_SHA"))) {
    throw new Error("GitHub workflow SHA must be exactly 40 lowercase hexadecimal characters")
  }

  const manifest = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_MANIFEST")
  const artifact = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_ARTIFACT")
  const retainedLocators = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_RETAINED_LOCATORS")
  const formalRoot = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_FORMAL_ROOT")
  const sourceRepository = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_SOURCE_REPOSITORY")
  const builtEntry = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_BUILT_ENTRY")
  const shippedEntry = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_SHIPPED_ENTRY")
  const lockfile = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_LOCKFILE")
  const codexExecutable = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_CODEX_EXECUTABLE")
  const codexEntry = nodePath.resolve(nodePath.dirname(codexExecutable), "../@openai/codex/bin/codex.js")
  const publicationContainer = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_PUBLICATION_CONTAINER")
  if (builtEntry !== nodePath.resolve(sourceRepository, productionLiveQualificationBin)) {
    throw new Error("qualification built entry must be the explicit production-live controller path")
  }
  if (shippedEntry !== nodePath.resolve(sourceRepository, productionLiveQualificationShippedBin)) {
    throw new Error("qualification shipped entry must be the explicit Dalph CLI path")
  }
  if (nodePath.dirname(retainedLocators) !== publicationContainer || retainedLocators === artifact) {
    throw new Error("qualification retention report must be distinct and under the publication container")
  }
  await requireReadableFile(builtEntry, "built production-live qualification controller")
  await requireReadableFile(shippedEntry, "built shipped Dalph entry")
  await requireReadableFile(codexEntry, "locked Codex JavaScript entry")
  for (const kind of ["dedicated", "stressed"]) {
    for (const shard of [0, 1]) {
      const paths = formalShardPaths(formalRoot, kind, shard)
      await requireReadableFile(paths.reportPath, `${kind} shard ${shard} formal report`)
      await requireReadableFile(paths.metadataPath, `${kind} shard ${shard} formal provenance`)
    }
  }

  return {
    candidateSha,
    reviewedBaseSha,
    configuredRepository,
    manifest,
    artifact,
    retainedLocators,
    formalRoot,
    builtEntry,
    shippedEntry,
    codexExecutable,
    codexJavaScriptEntry: codexEntry,
    lockfile,
    publicationContainer,
    sourceRepository
  }
}

const secretFreeManifest = (manifest, environment) => {
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`
  for (const name of secretEnvironmentNames) {
    const secret = environment[name]
    if (typeof secret === "string" && secret !== "" && serialized.includes(secret)) {
      throw new Error("qualification manifest contains a protected credential")
    }
  }
  return serialized
}

/** Construct the strict controller document without copying any secret/config payload. */
export const createProductionLiveQualificationManifest = ({ environment, formal, inputs }) => {
  const [owner, name] = inputs.configuredRepository.split("/")
  if (owner === undefined || name === undefined) throw new Error("qualification repository identity is invalid")
  if (formal === null || typeof formal !== "object" || Array.isArray(formal)) {
    throw new Error("qualification formal provenance is not a validated object")
  }
  return {
    schemaVersion: 1,
    invocationId: `live-q-${randomUUID()}`,
    sourceRepository: inputs.sourceRepository,
    sourceBaseSha: inputs.reviewedBaseSha,
    builtEntry: inputs.shippedEntry,
    lockfile: inputs.lockfile,
    codexExecutable: inputs.codexExecutable,
    codexJavaScriptEntry: inputs.codexJavaScriptEntry,
    publicationContainer: inputs.publicationContainer,
    artifact: inputs.artifact,
    retentionReport: inputs.retainedLocators,
    repository: { owner, name },
    createIssueOperationId: `live-create-issue-${randomUUID()}`,
    hosted: {
      sourceSha: inputs.candidateSha,
      workflow: valueOf(environment, "DALPH_LIVE_QUALIFICATION_WORKFLOW"),
      runId: positiveSafeInteger(
        Number(positiveIntegerInput(environment, "DALPH_LIVE_QUALIFICATION_RUN_ID")),
        "DALPH_LIVE_QUALIFICATION_RUN_ID"
      ),
      runAttempt: githubRunIdentity(environment).runAttempt,
      job: valueOf(environment, "DALPH_LIVE_QUALIFICATION_JOB_ID"),
      protectedEnvironment: valueOf(environment, "DALPH_LIVE_QUALIFICATION_PROTECTED_ENVIRONMENT")
    },
    formal
  }
}

export const writeProductionLiveQualificationManifest = async ({ environment, manifest }) => {
  const locator = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_MANIFEST")
  const serialized = secretFreeManifest(manifest, environment)
  await mkdir(nodePath.dirname(locator), { recursive: true, mode: 0o700 })
  await writeFile(locator, serialized, { mode: 0o600 })
  await chmod(locator, 0o600)
  return locator
}

const environmentWithoutSecrets = (environment) =>
  Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) =>
        value !== undefined && !secretEnvironmentNames.has(name) && !secretEnvironmentPattern.test(name)
    )
  )

/** Keep the current repository's Actions token and ambient secrets out of the controller and target child. */
const environmentForLiveChild = (environment) => ({
  ...environmentWithoutSecrets(environment),
  DALPH_LIVE_GITHUB_TOKEN: valueOf(environment, "DALPH_LIVE_GITHUB_TOKEN")
})

const readGitCandidateSha = async ({ environment, repositoryRoot }) => {
  const result = await execFile("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: environmentWithoutSecrets(environment)
  })
  return result.stdout.trim()
}

const spawnLiveController = ({ args, cwd, environment, executable }) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: environment, stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", (exitCode, signal) => resolve({ exitCode, signal }))
  })

const invocationFor = ({ builtEntry, environment, manifest, repositoryRoot }) => ({
  executable: nodeProcess.execPath,
  args: [builtEntry, "--manifest", manifest],
  environment,
  cwd: repositoryRoot
})

/**
 * Validate one protected invocation, observe the checked-out candidate, and
 * launch the shipped controller exactly once. A controlled-provider or child failure is
 * returned to the caller; this wrapper has no retry or resume path.
 */
export const runProductionLiveQualification = async ({
  buildFormal = buildFormalQualificationProvenance,
  environment = nodeProcess.env,
  readCandidateSha = readGitCandidateSha,
  repositoryRoot = nodeProcess.cwd(),
  runCommand = spawnLiveController
} = {}) => {
  const inputs = await validateProductionLiveQualificationEnvironment(environment)
  if (inputs.sourceRepository !== nodePath.resolve(repositoryRoot)) {
    throw new Error("qualification source repository must be the checked-out command repository")
  }
  const observedCandidateSha = await readCandidateSha({ repositoryRoot, environment })
  if (observedCandidateSha !== inputs.candidateSha) {
    throw new Error("candidate HEAD does not match the exact requested candidate SHA")
  }

  await mkdir(inputs.publicationContainer, { recursive: true, mode: 0o700 })
  const formal = await buildFormal({ environment, inputs, repositoryRoot })
  const manifest = createProductionLiveQualificationManifest({ environment, inputs, formal })
  await writeProductionLiveQualificationManifest({ environment, manifest })

  const result = await runCommand(
    invocationFor({
      builtEntry: inputs.builtEntry,
      manifest: inputs.manifest,
      environment: environmentForLiveChild(environment),
      repositoryRoot
    })
  )
  if (result.signal !== undefined && result.signal !== null) {
    throw new Error(`production-live qualification controller terminated by ${result.signal}`)
  }
  if (result.exitCode !== 0) {
    throw new Error(`production-live qualification controller exited with status ${String(result.exitCode)}`)
  }
  return result
}

const main = async () => {
  if (nodeProcess.argv.includes("--capture-hosted-diagnostics")) {
    await captureProductionLiveQualificationDiagnostics()
    return
  }
  if (nodeProcess.argv.includes("--require-successful-ci")) {
    await requireSuccessfulCandidateCi()
    return
  }
  if (nodeProcess.argv.includes("--resolve-formal-jobs")) {
    await resolveFormalQualificationJobs()
    return
  }
  await runProductionLiveQualification()
}

if (nodeProcess.argv[1] !== undefined && fileURLToPath(import.meta.url) === nodeProcess.argv[1]) {
  main().catch((error) => {
    nodeProcess.stderr.write(`Production live qualification failed: ${error.message}\n`)
    nodeProcess.exitCode = 1
  })
}
