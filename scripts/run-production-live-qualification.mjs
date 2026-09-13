import { execFile as nodeExecFile, spawn } from "node:child_process"
import { access, constants, lstat } from "node:fs/promises"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

const execFile = promisify(nodeExecFile)

/** The one built controller entry point owned by the production qualification runtime. */
export const productionLiveQualificationBin = "packages/dalph/dist/bin/production-live-qualification.js"
export const productionLiveQualificationEnvironment = "production-live-qualification"
export const productionLiveQualificationOptIn = "DALPH_RUN_PRODUCTION_LIVE_QUALIFICATION"

const exactSha = /^[0-9a-f]{40}$/u
const repository = /^[^\s/]+\/[^\s/]+$/u
const positiveInteger = /^[1-9][0-9]*$/u
const secretEnvironmentNames = new Set(["GITHUB_TOKEN", "DALPH_CODEX_PROVIDER_CREDENTIAL"])
const secretEnvironmentPattern = /(TOKEN|SECRET|CREDENTIAL|PASSWORD|PRIVATE_KEY)/iu

const requiredEnvironmentNames = [
  productionLiveQualificationOptIn,
  "DALPH_CANDIDATE_SHA",
  "DALPH_COVERAGE_BASE_SHA",
  "DALPH_LIVE_QUALIFICATION_SOURCE_SHA",
  "DALPH_LIVE_QUALIFICATION_SOURCE_REPOSITORY",
  "DALPH_LIVE_QUALIFICATION_SOURCE_BASE_SHA",
  "DALPH_LIVE_QUALIFICATION_BUILT_ENTRY",
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
  "GITHUB_TOKEN",
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
  const lockfile = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_LOCKFILE")
  const codexExecutable = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_CODEX_EXECUTABLE")
  const publicationContainer = exactLocator(environment, "DALPH_LIVE_QUALIFICATION_PUBLICATION_CONTAINER")
  if (builtEntry !== nodePath.resolve(sourceRepository, productionLiveQualificationBin)) {
    throw new Error("qualification built entry must be the explicit production-live controller path")
  }
  await requireReadableFile(builtEntry, "built production-live qualification controller")
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
    codexExecutable,
    lockfile,
    publicationContainer,
    sourceRepository
  }
}

const environmentWithoutSecrets = (environment) =>
  Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) =>
        value !== undefined && !secretEnvironmentNames.has(name) && !secretEnvironmentPattern.test(name)
    )
  )

const environmentForLiveChild = (environment) => ({
  ...environmentWithoutSecrets(environment),
  GITHUB_TOKEN: valueOf(environment, "GITHUB_TOKEN"),
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

if (nodeProcess.argv[1] !== undefined && fileURLToPath(import.meta.url) === nodeProcess.argv[1]) {
  runProductionLiveQualification().catch((error) => {
    nodeProcess.stderr.write(`Production live qualification failed: ${error.message}\n`)
    nodeProcess.exitCode = 1
  })
}
