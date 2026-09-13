import { randomUUID } from "node:crypto"
import { execFile as nodeExecFile, spawn } from "node:child_process"
import { access, chmod, constants, lstat, mkdir, readFile, writeFile } from "node:fs/promises"
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
  dedicated: "Dedicated formal evidence",
  stressed: "Stressed formal evidence"
})

const exactSha = /^[0-9a-f]{40}$/u
const repository = /^[^\s/]+\/[^\s/]+$/u
const positiveInteger = /^[1-9][0-9]*$/u
const secretEnvironmentNames = new Set(["GITHUB_TOKEN", "DALPH_LIVE_GITHUB_TOKEN", "DALPH_CODEX_PROVIDER_CREDENTIAL"])
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
  "DALPH_LIVE_QUALIFICATION_FORMAL_DEDICATED",
  "DALPH_LIVE_QUALIFICATION_FORMAL_STRESSED",
  "DALPH_LIVE_QUALIFICATION_FORMAL_DEDICATED_METADATA",
  "DALPH_LIVE_QUALIFICATION_FORMAL_STRESSED_METADATA",
  "DALPH_LIVE_QUALIFICATION_PROTECTED_ENVIRONMENT",
  "GITHUB_ACTIONS",
  "GITHUB_WORKFLOW",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_JOB",
  "GITHUB_REPOSITORY",
  "GITHUB_SERVER_URL",
  "GITHUB_SHA",
  "DALPH_LIVE_GITHUB_TOKEN",
  "DALPH_CODEX_PROVIDER_CREDENTIAL"
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

const exactAbsoluteInput = (value, name) => {
  if (typeof value !== "string" || !nodePath.isAbsolute(value) || nodePath.normalize(value) !== value) {
    throw new Error(`qualification input ${name} must be a normalized absolute path`)
  }
  return value
}

const githubRunInputs = (environment) => ({
  repository: valueOf(environment, "GITHUB_REPOSITORY"),
  runAttempt: positiveSafeInteger(
    Number(positiveIntegerInput(environment, "GITHUB_RUN_ATTEMPT")),
    "GITHUB_RUN_ATTEMPT"
  ),
  runId: positiveSafeInteger(Number(positiveIntegerInput(environment, "GITHUB_RUN_ID")), "GITHUB_RUN_ID"),
  token: valueOf(environment, "GITHUB_TOKEN")
})

const readFormalProfileMetadata = async ({ environment, kind, logPath, metadataPath }) => {
  const metadata = await readJsonObject(metadataPath, `${kind} formal provenance`)
  const { runAttempt, runId } = githubRunInputs(environment)
  if (metadata.profile !== kind) throw new Error(`${kind} formal provenance profile is incorrect`)
  if (metadata.sourceSha !== valueOf(environment, "DALPH_LIVE_QUALIFICATION_SOURCE_SHA")) {
    throw new Error(`${kind} formal provenance source SHA does not match the candidate`)
  }
  if (metadata.reviewedBaseSha !== valueOf(environment, "DALPH_LIVE_QUALIFICATION_SOURCE_BASE_SHA")) {
    throw new Error(`${kind} formal provenance Base SHA does not match the reviewed Base`)
  }
  if (metadata.workflowName !== "Production live qualification") {
    throw new Error(`${kind} formal provenance workflow is not the protected workflow`)
  }
  if (metadata.runId !== runId || metadata.runAttempt !== runAttempt) {
    throw new Error(`${kind} formal provenance run does not match the current workflow attempt`)
  }
  if (metadata.jobName !== `formal-${kind}`) {
    throw new Error(`${kind} formal provenance job does not match its formal worker`)
  }
  if (typeof metadata.nodeVersion !== "string" || !/^24\.20\.\d+$/u.test(metadata.nodeVersion)) {
    throw new Error(`${kind} formal provenance Node version is unsupported`)
  }
  const metadataLog = exactAbsoluteInput(metadata.log, `${kind} formal log locator`)
  if (nodePath.basename(metadataLog) !== nodePath.basename(logPath)) {
    throw new Error(`${kind} formal provenance log locator is not the downloaded log`)
  }
  const setupInstallSeconds = nonnegativeSeconds(metadata.setupInstallSeconds, `${kind} setup/install duration`)
  const completeJobSeconds = nonnegativeSeconds(metadata.completeJobSeconds, `${kind} complete-job duration`)
  const formalSeconds = nonnegativeSeconds(metadata.formalSeconds, `${kind} formal duration`)
  if (completeJobSeconds < setupInstallSeconds) {
    throw new Error(`${kind} complete-job duration cannot precede setup/install completion`)
  }
  if (
    !Array.isArray(metadata.negativeControls) ||
    metadata.negativeControls.length === 0 ||
    metadata.negativeControls.some((value) => typeof value !== "string" || value.length === 0)
  ) {
    throw new Error(`${kind} formal provenance negative controls are invalid`)
  }
  await requireReadableFile(logPath, `${kind} formal evidence`)
  return {
    completeJobSeconds,
    formalSeconds,
    log: logPath,
    negativeControls: metadata.negativeControls,
    nodeVersion: metadata.nodeVersion,
    profile: kind,
    reviewedBaseSha: metadata.reviewedBaseSha,
    runAttempt,
    runId,
    setupInstallSeconds,
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

const resolveFormalJob = (jobs, kind, runId, runAttempt) => {
  const name = formalQualificationJobNames[kind]
  const matches = jobs.filter(
    (job) =>
      job !== null &&
      typeof job === "object" &&
      job.name === name &&
      job.run_id === runId &&
      job.run_attempt === runAttempt
  )
  if (matches.length !== 1) {
    throw new Error(`${kind} formal Actions job must resolve uniquely for the current run attempt`)
  }
  const job = matches[0]
  if (job.status !== "completed" || job.conclusion !== "success") {
    throw new Error(`${kind} formal Actions job did not complete successfully`)
  }
  return { id: positiveSafeInteger(job.id, `${kind} formal Actions job ID`), name }
}

const enrichFormalMetadata = async ({ environment, job, kind, logPath, metadataPath }) => {
  const profile = await readFormalProfileMetadata({ environment, kind, logPath, metadataPath })
  const enriched = {
    completeJobSeconds: profile.completeJobSeconds,
    formalSeconds: profile.formalSeconds,
    job: { jobId: job.id, runId: profile.runId, workflow: "Candidate qualification" },
    log: profile.log,
    negativeControls: profile.negativeControls,
    nodeVersion: profile.nodeVersion,
    profile: profile.profile,
    protectedEnvironment: productionLiveQualificationEnvironment,
    runAttempt: profile.runAttempt,
    sourceSha: profile.sourceSha,
    setupInstallSeconds: profile.setupInstallSeconds,
    workflowName: profile.workflowName
  }
  const serialized = `${JSON.stringify(enriched, null, 2)}\n`
  if (serialized.includes(valueOf(environment, "GITHUB_TOKEN"))) {
    throw new Error(`${kind} formal provenance unexpectedly contains the Actions token`)
  }
  await writeFile(metadataPath, serialized, { mode: 0o600 })
  return enriched
}

const suppliedFormalProfile = async ({ environment, kind, logPath, metadataPath }) => {
  const profile = await readFormalProfileMetadata({ environment, kind, logPath, metadataPath })
  const metadata = await readJsonObject(metadataPath, `${kind} formal provenance`)
  const job = metadata.job
  if (job === null || typeof job !== "object" || Array.isArray(job)) {
    throw new Error(`${kind} formal provenance is missing the resolved Actions job`)
  }
  if (job.workflow !== "Candidate qualification") {
    throw new Error(`${kind} formal provenance job workflow is invalid`)
  }
  const jobId = positiveSafeInteger(job.jobId, `${kind} formal Actions job ID`)
  const jobRunId = positiveSafeInteger(job.runId, `${kind} formal Actions run ID`)
  if (jobRunId !== profile.runId) {
    throw new Error(`${kind} formal provenance Actions run does not match the current attempt`)
  }
  let log
  try {
    log = await readFile(profile.log, "utf8")
  } catch (error) {
    throw new Error(`${kind} formal evidence log is not readable`, { cause: error })
  }
  return {
    completeJobSeconds: profile.completeJobSeconds,
    job: { jobId, runId: jobRunId, workflow: job.workflow },
    log,
    negativeControls: profile.negativeControls,
    nodeVersion: profile.nodeVersion,
    setupInstallSeconds: profile.setupInstallSeconds,
    sourceSha: profile.sourceSha
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
      dedicated: await suppliedFormalProfile({
        environment,
        kind: "dedicated",
        logPath: inputs.dedicatedFormal,
        metadataPath: inputs.dedicatedFormalMetadata
      }),
      stressed: await suppliedFormalProfile({
        environment,
        kind: "stressed",
        logPath: inputs.stressedFormal,
        metadataPath: inputs.stressedFormalMetadata
      })
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
  const dedicated = resolveFormalJob(jobs, "dedicated", runId, runAttempt)
  const stressed = resolveFormalJob(jobs, "stressed", runId, runAttempt)
  if (dedicated.id === stressed.id) throw new Error("formal Actions job IDs must be distinct")
  await enrichFormalMetadata({
    environment,
    kind: "dedicated",
    job: dedicated,
    logPath: exactLocator(environment, "DALPH_LIVE_QUALIFICATION_FORMAL_DEDICATED"),
    metadataPath: exactLocator(environment, "DALPH_LIVE_QUALIFICATION_FORMAL_DEDICATED_METADATA")
  })
  await enrichFormalMetadata({
    environment,
    kind: "stressed",
    job: stressed,
    logPath: exactLocator(environment, "DALPH_LIVE_QUALIFICATION_FORMAL_STRESSED"),
    metadataPath: exactLocator(environment, "DALPH_LIVE_QUALIFICATION_FORMAL_STRESSED_METADATA")
  })
  return { dedicated, stressed }
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
  const dedicatedFormal = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_FORMAL_DEDICATED")
  const stressedFormal = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_FORMAL_STRESSED")
  const dedicatedFormalMetadata = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_FORMAL_DEDICATED_METADATA")
  const stressedFormalMetadata = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_FORMAL_STRESSED_METADATA")
  const sourceRepository = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_SOURCE_REPOSITORY")
  const builtEntry = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_BUILT_ENTRY")
  const shippedEntry = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_SHIPPED_ENTRY")
  const lockfile = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_LOCKFILE")
  const codexExecutable = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_CODEX_EXECUTABLE")
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
  await requireReadableFile(dedicatedFormal, "dedicated formal evidence")
  await requireReadableFile(stressedFormal, "stressed formal evidence")
  await requireReadableFile(dedicatedFormalMetadata, "dedicated formal provenance")
  await requireReadableFile(stressedFormalMetadata, "stressed formal provenance")

  return {
    candidateSha,
    reviewedBaseSha,
    configuredRepository,
    manifest,
    artifact,
    retainedLocators,
    dedicatedFormal,
    dedicatedFormalMetadata,
    stressedFormal,
    stressedFormalMetadata,
    builtEntry,
    shippedEntry,
    codexExecutable,
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

/** Keep the current repository's Actions token out of the controller and target child. */
const environmentForLiveChild = (environment) => ({
  ...environmentWithoutSecrets(environment),
  DALPH_LIVE_GITHUB_TOKEN: valueOf(environment, "DALPH_LIVE_GITHUB_TOKEN"),
  DALPH_CODEX_PROVIDER_CREDENTIAL: valueOf(environment, "DALPH_CODEX_PROVIDER_CREDENTIAL")
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
 * launch the shipped controller exactly once. A provider or child failure is
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
