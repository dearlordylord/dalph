/* eslint-disable import/no-nodejs-modules -- Qualification measures original build and process provenance. */
/* eslint-disable import-x/no-unused-modules -- Qualification schemas are consumed by external test-support outside the production lint graph. */
import nodeProcess from "node:process"
import { existsSync } from "node:fs"
import { arch, platform } from "node:os"
import nodePath from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { EvidenceDigest, GitCommitSha, type GitRepositoryLocator } from "@dalph/contracts"
import { GitCommand } from "@dalph/orchestrator"
import { Crypto, Effect, FileSystem, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import type { parseProfileLog as parseQualificationProfileLog } from "../../../../scripts/generate-quint-profile-evidence.mjs"
import type { assertAcceptedQuintGateCommands as assertQualificationGateCommands } from "../../../../scripts/quint-gate-command-contract.mjs"

type QualificationProfileParser = typeof parseQualificationProfileLog
type QualificationCommandValidator = typeof assertQualificationGateCommands

const hexadecimalRadix = 16
const hexadecimalByteWidth = 2
const hostedJobLimitSeconds = 960
const formalGateLimitSeconds = 750
const stressedFormalParallelism = 2

type QualificationScriptModules = {
  readonly parseProfileLog: QualificationProfileParser
  readonly assertAcceptedQuintGateCommands: QualificationCommandValidator
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null
const QualificationProfileModule = Schema.declare<Pick<QualificationScriptModules, "parseProfileLog">>(
  (value): value is Pick<QualificationScriptModules, "parseProfileLog"> =>
    isRecord(value) && typeof value["parseProfileLog"] === "function"
)
const QualificationCommandModule = Schema.declare<Pick<QualificationScriptModules, "assertAcceptedQuintGateCommands">>(
  (value): value is Pick<QualificationScriptModules, "assertAcceptedQuintGateCommands"> =>
    isRecord(value) && typeof value["assertAcceptedQuintGateCommands"] === "function"
)

/** Loads the workspace-owned formal evidence parsers from either source or emitted package layout. */
const qualificationScriptModules = Effect.fn("Qualification.loadScriptModules")(function* () {
  const moduleFile = fileURLToPath(import.meta.url)
  const moduleDirectory = nodePath.dirname(moduleFile)
  const candidates = [
    nodePath.resolve(nodeProcess.cwd(), "scripts"),
    nodePath.resolve(moduleDirectory, "../../../../scripts"),
    nodePath.resolve(moduleDirectory, "../../../../../scripts")
  ]
  const root = candidates.find((candidate) => existsSync(`${candidate}/generate-quint-profile-evidence.mjs`))
  if (root === undefined) return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
  const [profile, contract] = yield* Effect.all([
    Effect.tryPromise({
      try: () => import(pathToFileURL(`${root}/generate-quint-profile-evidence.mjs`).href),
      catch: () => new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(QualificationProfileModule)),
      Effect.mapError(() => new QualificationEvidenceFailure({ operation: "ValidateProvenance" }))
    ),
    Effect.tryPromise({
      try: () => import(pathToFileURL(`${root}/quint-gate-command-contract.mjs`).href),
      catch: () => new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(QualificationCommandModule)),
      Effect.mapError(() => new QualificationEvidenceFailure({ operation: "ValidateProvenance" }))
    )
  ])
  return {
    parseProfileLog: profile.parseProfileLog,
    assertAcceptedQuintGateCommands: contract.assertAcceptedQuintGateCommands
  } satisfies QualificationScriptModules
})

/** A qualification failure carries no rejected transcript, configuration, provider data or filesystem diagnostic. */
export class QualificationEvidenceFailure extends Schema.TaggedError<QualificationEvidenceFailure>()(
  "QualificationEvidenceFailure",
  {
    operation: Schema.Literals([
      "MeasureBuild",
      "ValidateProvenance",
      "ValidateEvidence",
      "ArtifactLocation",
      "WriteArtifact"
    ])
  }
) {}

/** Content identity of the original measured bytes, not an ownership authorization. */
export const qualificationDigest = Effect.fn("Qualification.digest")(function* (bytes: Uint8Array) {
  const crypto = yield* Crypto.Crypto
  const digest = yield* crypto.digest("SHA-256", bytes)
  return yield* Schema.decodeUnknownEffect(EvidenceDigest)(
    Array.from(digest, (byte) => byte.toString(hexadecimalRadix).padStart(hexadecimalByteWidth, "0")).join("")
  )
})

/** The actual source commit and separately measured binary/configuration/toolchain facts for this invocation. */
export const QualificationBuild = Schema.Struct({
  sourceSha: GitCommitSha,
  sourceBaseSha: GitCommitSha,
  builtEntryDigest: EvidenceDigest,
  lockfileDigest: EvidenceDigest,
  configurationDigest: EvidenceDigest,
  operatingSystem: Schema.Literals([
    "aix",
    "android",
    "darwin",
    "freebsd",
    "haiku",
    "linux",
    "openbsd",
    "sunos",
    "win32",
    "cygwin",
    "netbsd"
  ]),
  architecture: Schema.Literals([
    "arm",
    "arm64",
    "ia32",
    "loong64",
    "mips",
    "mipsel",
    "ppc",
    "ppc64",
    "riscv64",
    "s390",
    "s390x",
    "x64"
  ]),
  nodeVersion: Schema.String.check(Schema.isPattern(/^24\.20\.\d+$/u)),
  pnpmVersion: Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/u))
})
export type QualificationBuild = typeof QualificationBuild.Type

const measuredGit = Effect.fn("Qualification.measuredGit")(function* (
  repository: GitRepositoryLocator,
  arguments_: ReadonlyArray<string>
) {
  const git = yield* GitCommand
  const result = yield* git.runInWorktree(repository, arguments_)
  if (result.exitCode !== 0) return yield* new QualificationEvidenceFailure({ operation: "MeasureBuild" })
  return result.stdout.trim()
})

/** Rejects a dirty source tree: HEAD alone must not attest a different working snapshot. */
export const measureQualificationBuild = Effect.fn("Qualification.measureBuild")(
  function* (
    sourceRepository: GitRepositoryLocator,
    sourceBaseSha: GitCommitSha,
    files: { readonly builtEntry: string; readonly lockfile: string; readonly configuration: string }
  ) {
    const fs = yield* FileSystem.FileSystem
    const processes = yield* ChildProcessSpawner.ChildProcessSpawner
    const sourceSha = yield* measuredGit(sourceRepository, ["rev-parse", "HEAD"])
    const dirty = yield* measuredGit(sourceRepository, [
      "--no-optional-locks",
      "status",
      "--porcelain",
      "--untracked-files=normal"
    ])
    if (dirty.length > 0) return yield* new QualificationEvidenceFailure({ operation: "MeasureBuild" })
    const digestFile = (locator: string) => fs.readFile(locator).pipe(Effect.flatMap(qualificationDigest))
    return yield* Schema.decodeUnknownEffect(QualificationBuild)({
      sourceSha,
      sourceBaseSha,
      builtEntryDigest: yield* digestFile(files.builtEntry),
      lockfileDigest: yield* digestFile(files.lockfile),
      configurationDigest: yield* digestFile(files.configuration),
      operatingSystem: platform(),
      architecture: arch(),
      nodeVersion: nodeProcess.versions.node,
      pnpmVersion: (yield* processes.string(ChildProcess.make("pnpm", ["--version"]))).trim()
    })
  },
  Effect.mapError(() => new QualificationEvidenceFailure({ operation: "MeasureBuild" }))
)

export const QualificationHostedJob = Schema.Struct({
  workflow: Schema.Literal("Production live qualification"),
  runId: Schema.Int.check(Schema.isGreaterThan(0)),
  jobId: Schema.Int.check(Schema.isGreaterThan(0))
})
const ProfileCommand = Schema.Struct({
  kind: Schema.Literals(["typecheck", "test", "sampled-run", "verify"]),
  name: Schema.NonEmptyString,
  durationSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  result: Schema.Literals(["exit:0", "exit:1"])
})
/** An otherwise unconstrained, formal-only hosted job establishes the dedicated reference profile. */
const DedicatedFormalCondition = Schema.Struct({
  kind: Schema.Literal("dedicated-hosted-job"),
  runnerLabel: Schema.Literal("ubuntu-24.04-arm"),
  effectiveParallelism: Schema.Int.check(Schema.isGreaterThan(0))
})
/** A measured two-CPU affinity below the host's available CPUs establishes the stressed profile. */
const StressedFormalCondition = Schema.Struct({
  kind: Schema.Literal("cpu-affinity"),
  runnerLabel: Schema.Literal("ubuntu-latest"),
  cpuList: Schema.Literal("0-1"),
  hostParallelism: Schema.Int.check(Schema.isGreaterThan(stressedFormalParallelism)),
  effectiveParallelism: Schema.Literal(stressedFormalParallelism)
})
const FormalProfileCondition = Schema.Union([DedicatedFormalCondition, StressedFormalCondition])
const FormalProfileFields = {
  sourceSha: GitCommitSha,
  nodeVersion: Schema.NonEmptyString,
  job: QualificationHostedJob,
  logDigest: EvidenceDigest,
  setupInstallSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  formalSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  completeJobSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  remainingHostedSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  hostedLimitSeconds: Schema.Literal(hostedJobLimitSeconds),
  commands: Schema.Array(ProfileCommand),
  negativeControls: Schema.NonEmptyArray(Schema.NonEmptyString)
}
const DedicatedQualificationFormalProfile = Schema.Struct({
  profileKind: Schema.Literal("dedicated"),
  condition: DedicatedFormalCondition,
  ...FormalProfileFields
})
const StressedQualificationFormalProfile = Schema.Struct({
  profileKind: Schema.Literal("stressed"),
  condition: StressedFormalCondition,
  ...FormalProfileFields
})
export const QualificationFormalProfile = Schema.Union([
  DedicatedQualificationFormalProfile,
  StressedQualificationFormalProfile
])
export const QualificationFormalProvenance = Schema.TaggedUnion({
  NotSupplied: { reason: Schema.Literal("LocalHermeticInvocation") },
  DedicatedAndStressed: { dedicated: DedicatedQualificationFormalProfile, stressed: StressedQualificationFormalProfile }
})
export type QualificationFormalProvenance = typeof QualificationFormalProvenance.Type
export const RequiredQualificationFormalProvenance = QualificationFormalProvenance.cases.DedicatedAndStressed
export type RequiredQualificationFormalProvenance = typeof RequiredQualificationFormalProvenance.Type

export interface SuppliedQualificationProfile {
  readonly profileKind: "dedicated" | "stressed"
  readonly condition: typeof FormalProfileCondition.Type
  readonly sourceSha: GitCommitSha
  readonly nodeVersion: string
  readonly job: typeof QualificationHostedJob.Type
  readonly log: string
  readonly setupInstallSeconds: number
  readonly formalSeconds: number
  readonly completeJobSeconds: number
  readonly negativeControls: ReadonlyArray<string>
}

const supportedQualificationNode = (version: string) => /^24\.20\.\d+$/u.test(version)

const profileTimingExceedsBudgets = (
  formalBudgetSeconds: number,
  formalSeconds: number,
  profile: Pick<SuppliedQualificationProfile, "completeJobSeconds" | "setupInstallSeconds">
) =>
  formalBudgetSeconds !== formalGateLimitSeconds ||
  formalSeconds > formalGateLimitSeconds ||
  profile.completeJobSeconds < profile.setupInstallSeconds + formalSeconds ||
  profile.completeJobSeconds >= hostedJobLimitSeconds

const profileConditionMatchesKind = (
  profileKind: "dedicated" | "stressed",
  condition: typeof FormalProfileCondition.Type
) => (profileKind === "dedicated" ? condition.kind === "dedicated-hosted-job" : condition.kind === "cpu-affinity")

const profileMatchesExpectedIdentity = (
  sourceSha: GitCommitSha,
  profileKind: "dedicated" | "stressed",
  profile: SuppliedQualificationProfile
) =>
  profile.profileKind === profileKind &&
  profileConditionMatchesKind(profileKind, profile.condition) &&
  profile.sourceSha === sourceSha &&
  supportedQualificationNode(profile.nodeVersion)

const profileCommandsHaveExpectedResults = (commands: ReadonlyArray<typeof ProfileCommand.Type>) =>
  commands.every(({ name, result }) => result === (name.includes("temporal mutant") ? "exit:1" : "exit:0"))

const parsedNegativeControlNames = (commands: ReadonlyArray<{ readonly name: string }>): ReadonlyArray<string> =>
  commands
    .filter(({ name }) => name.includes("negative mutation profile") || name.includes("temporal mutant"))
    .map(({ name }) => name)

const profileNegativeControlsMatch = (parsedNames: ReadonlyArray<string>, suppliedNames: ReadonlyArray<string>) =>
  parsedNames.length === suppliedNames.length && parsedNames.every((name, index) => name === suppliedNames[index])

const parseSuppliedQualificationProfile = (
  scripts: QualificationScriptModules,
  profile: SuppliedQualificationProfile
) =>
  Effect.try({
    try: () =>
      scripts.parseProfileLog({
        id: String(profile.job.jobId),
        node: profile.nodeVersion,
        repeat: "1",
        installSeconds: String(profile.setupInstallSeconds),
        log: profile.log
      }),
    catch: () => new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
  })

const assertAcceptedQualificationGateCommands = (
  scripts: QualificationScriptModules,
  commands: ReadonlyArray<typeof ProfileCommand.Type>
) =>
  Effect.try({
    try: () => scripts.assertAcceptedQuintGateCommands(commands),
    catch: () => new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
  })

/** Existing inventory parser owns command order/counts; this seam additionally binds actual source/job/negative controls. */
const validateProfile = Effect.fn("Qualification.validateProfile")(
  function* (sourceSha: GitCommitSha, profileKind: "dedicated" | "stressed", profile: SuppliedQualificationProfile) {
    if (!profileMatchesExpectedIdentity(sourceSha, profileKind, profile))
      return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    const scripts = yield* qualificationScriptModules()
    const parsed = yield* parseSuppliedQualificationProfile(scripts, profile)
    const commands = yield* Schema.decodeUnknownEffect(Schema.Array(ProfileCommand))(parsed.commands)
    if (!profileCommandsHaveExpectedResults(commands))
      return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    yield* assertAcceptedQualificationGateCommands(scripts, commands)
    if (!profileNegativeControlsMatch(parsedNegativeControlNames(parsed.commands), profile.negativeControls))
      return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    if (profile.formalSeconds !== parsed.formalSeconds)
      return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    if (profileTimingExceedsBudgets(parsed.budgetSeconds, parsed.formalSeconds, profile))
      return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    return yield* Schema.decodeUnknownEffect(QualificationFormalProfile)({
      profileKind,
      condition: profile.condition,
      sourceSha,
      nodeVersion: profile.nodeVersion,
      job: profile.job,
      logDigest: parsed.source.sha256,
      setupInstallSeconds: profile.setupInstallSeconds,
      formalSeconds: parsed.formalSeconds,
      completeJobSeconds: profile.completeJobSeconds,
      remainingHostedSeconds: hostedJobLimitSeconds - profile.completeJobSeconds,
      hostedLimitSeconds: hostedJobLimitSeconds,
      commands,
      negativeControls: profile.negativeControls
    })
  },
  Effect.mapError(() => new QualificationEvidenceFailure({ operation: "ValidateProvenance" }))
)

export const requiredQualificationFormalProvenance = Effect.fn("Qualification.requiredFormalProvenance")(function* (
  sourceSha: GitCommitSha,
  supplied: { readonly dedicated: SuppliedQualificationProfile; readonly stressed: SuppliedQualificationProfile }
) {
  if (
    supplied.dedicated.job.jobId === supplied.stressed.job.jobId ||
    supplied.dedicated.job.runId !== supplied.stressed.job.runId
  )
    return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
  const dedicated = yield* validateProfile(sourceSha, "dedicated", supplied.dedicated)
  const stressed = yield* validateProfile(sourceSha, "stressed", supplied.stressed)
  if (dedicated.profileKind !== "dedicated" || stressed.profileKind !== "stressed") {
    return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
  }
  const commandIdentity = (profile: typeof QualificationFormalProfile.Type) =>
    profile.commands.map(({ kind, name, result }) => ({ kind, name, result }))
  if (
    JSON.stringify(commandIdentity(dedicated)) !== JSON.stringify(commandIdentity(stressed)) ||
    JSON.stringify(dedicated.negativeControls) !== JSON.stringify(stressed.negativeControls)
  )
    return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
  return RequiredQualificationFormalProvenance.make({ dedicated, stressed })
})

export const qualificationFormalProvenance = Effect.fn("Qualification.formalProvenance")(function* (
  sourceSha: GitCommitSha,
  supplied:
    | { readonly _tag: "LocalHermetic" }
    | {
        readonly _tag: "SuppliedProfiles"
        readonly dedicated: SuppliedQualificationProfile
        readonly stressed: SuppliedQualificationProfile
      }
) {
  if (supplied._tag === "LocalHermetic")
    return QualificationFormalProvenance.cases.NotSupplied.make({ reason: "LocalHermeticInvocation" })
  return yield* requiredQualificationFormalProvenance(sourceSha, supplied)
})

/** Explicitly selected artifact outside the disposable Q container, never a fixture cleanup resource. */
