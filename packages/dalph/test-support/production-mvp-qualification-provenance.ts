/* eslint-disable import/no-nodejs-modules -- Qualification measures original build and process provenance. */
import nodeProcess from "node:process"
import { arch, platform } from "node:os"
import { EvidenceDigest, GitCommitSha, type GitRepositoryLocator } from "@dalph/contracts"
import { GitCommand } from "@dalph/orchestrator"
import { Crypto, Effect, FileSystem, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { parseProfileLog } from "../../../scripts/generate-quint-profile-evidence.mjs"
import { assertAcceptedQuintGateCommands } from "../../../scripts/quint-gate-command-contract.mjs"

const hexadecimalRadix = 16
const hexadecimalByteWidth = 2
const hostedJobLimitSeconds = 960
const formalGateLimitSeconds = 750

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

const HostedJob = Schema.Struct({
  workflow: Schema.Literals(["CI", "Candidate qualification"]),
  runId: Schema.Int.check(Schema.isGreaterThan(0)),
  jobId: Schema.Int.check(Schema.isGreaterThan(0))
})
const ProfileCommand = Schema.Struct({
  kind: Schema.Literals(["typecheck", "test", "sampled-run", "verify"]),
  name: Schema.NonEmptyString,
  durationSeconds: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  result: Schema.Literals(["exit:0", "exit:1"])
})
const FormalProfile = Schema.Struct({
  sourceSha: GitCommitSha,
  nodeVersion: Schema.NonEmptyString,
  job: HostedJob,
  logDigest: EvidenceDigest,
  setupInstallSeconds: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  formalSeconds: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  completeJobSeconds: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  remainingHostedSeconds: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  hostedLimitSeconds: Schema.Literal(hostedJobLimitSeconds),
  commands: Schema.Array(ProfileCommand),
  negativeControls: Schema.NonEmptyArray(Schema.NonEmptyString)
})
export const QualificationFormalProvenance = Schema.TaggedUnion({
  NotSupplied: { reason: Schema.Literal("LocalHermeticInvocation") },
  DedicatedAndStressed: { dedicated: FormalProfile, stressed: FormalProfile }
})
export type QualificationFormalProvenance = typeof QualificationFormalProvenance.Type

export interface SuppliedQualificationProfile {
  readonly sourceSha: GitCommitSha
  readonly nodeVersion: string
  readonly job: typeof HostedJob.Type
  readonly log: string
  readonly setupInstallSeconds: number
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
  profile.completeJobSeconds > hostedJobLimitSeconds

/** Existing inventory parser owns command order/counts; this seam additionally binds actual source/job/negative controls. */
const validateProfile = Effect.fn("Qualification.validateProfile")(
  function* (sourceSha: GitCommitSha, profile: SuppliedQualificationProfile) {
    if (profile.sourceSha !== sourceSha || !supportedQualificationNode(profile.nodeVersion))
      return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    const parsed = yield* Effect.try({
      try: () =>
        parseProfileLog({
          id: String(profile.job.jobId),
          node: profile.nodeVersion,
          repeat: "1",
          installSeconds: String(profile.setupInstallSeconds),
          log: profile.log
        }),
      catch: () => new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    })
    const commands = yield* Schema.decodeUnknownEffect(Schema.Array(ProfileCommand))(parsed.commands)
    if (commands.some(({ name, result }) => result !== (name.includes("temporal mutant") ? "exit:1" : "exit:0")))
      return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    yield* Effect.try({
      try: () => assertAcceptedQuintGateCommands(commands),
      catch: () => new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    })
    const negativeNames = parsed.commands
      .filter(({ name }) => name.includes("negative mutation profile") || name.includes("temporal mutant"))
      .map(({ name }) => name)
    if (
      negativeNames.length !== profile.negativeControls.length ||
      negativeNames.some((name, index) => name !== profile.negativeControls[index])
    )
      return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    if (profileTimingExceedsBudgets(parsed.budgetSeconds, parsed.formalSeconds, profile))
      return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    return yield* Schema.decodeUnknownEffect(FormalProfile)({
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
  if (supplied.dedicated.job.jobId === supplied.stressed.job.jobId)
    return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
  return QualificationFormalProvenance.cases.DedicatedAndStressed.make({
    dedicated: yield* validateProfile(sourceSha, supplied.dedicated),
    stressed: yield* validateProfile(sourceSha, supplied.stressed)
  })
})

/** Explicitly selected artifact outside the disposable Q container, never a fixture cleanup resource. */
