/* eslint-disable import/no-nodejs-modules -- Qualification measures original build and process provenance. */
/* eslint-disable import-x/no-unused-modules -- Qualification schemas are consumed by external test-support outside the production lint graph. */
import nodeProcess from "node:process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { arch, platform } from "node:os"
import nodePath from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { EvidenceDigest, GitCommitSha, type GitRepositoryLocator } from "@dalph/contracts"
import { GitCommand } from "@dalph/orchestrator"
import { Crypto, Effect, FileSystem, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import type { aggregateHostedFormalShards as aggregateQualificationShards } from "../../../../scripts/aggregate-hosted-formal-shards.mjs"
import {
  CompleteProfileCommands,
  type FormalProfileCondition,
  FormalShardEvidence,
  QualificationFormalProfile,
  QualificationFormalProvenance,
  RequiredQualificationFormalProvenance
} from "./qualification-formal-provenance.js"

export {
  QualificationFormalJobId,
  QualificationFormalProfile,
  QualificationFormalProvenance,
  QualificationFormalRunAttempt,
  QualificationFormalRunId,
  QualificationFormalShard,
  QualificationHostedJob,
  RequiredQualificationFormalProvenance
} from "./qualification-formal-provenance.js"
type QualificationShardAggregator = typeof aggregateQualificationShards

const hexadecimalRadix = 16
const hexadecimalByteWidth = 2
const hostedJobLimitSeconds = 960
const formalGateLimitSeconds = 750
const millisecondsPerSecond = 1_000
const qualificationFormalShardCount = 2
const qualificationFormalJobCount = 4

type QualificationScriptModules = { readonly aggregateHostedFormalShards: QualificationShardAggregator }

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null
const QualificationAggregateModule = Schema.declare<QualificationScriptModules>(
  (value): value is QualificationScriptModules =>
    isRecord(value) && typeof value["aggregateHostedFormalShards"] === "function"
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
  const root = candidates.find((candidate) => existsSync(`${candidate}/aggregate-hosted-formal-shards.mjs`))
  if (root === undefined) return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
  return yield* Effect.tryPromise({
    try: () => import(pathToFileURL(`${root}/aggregate-hosted-formal-shards.mjs`).href),
    catch: () => new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(QualificationAggregateModule)),
    Effect.mapError(() => new QualificationEvidenceFailure({ operation: "ValidateProvenance" }))
  )
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

export interface SuppliedQualificationProfile {
  readonly profileKind: "dedicated" | "stressed"
  readonly sourceSha: GitCommitSha
  readonly nodeVersion: string
  readonly runId: number
  readonly runAttempt: number
  readonly shards: ReadonlyArray<{
    readonly shard: number
    readonly condition: typeof FormalProfileCondition.Type
    readonly job: {
      readonly workflow: "Production live qualification"
      readonly runId: number
      readonly runAttempt: number
      readonly jobId: number
      readonly name: string
    }
    readonly reportSource: string
    readonly setupInstallSeconds: number
    readonly formalSeconds: number
    readonly completeJobSeconds: number
    readonly startedAt: string
    readonly completedAt: string
  }>
}

const supportedQualificationNode = (version: string) => /^24\.20\.\d+$/u.test(version)

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
  profile.sourceSha === sourceSha &&
  supportedQualificationNode(profile.nodeVersion)

const parsedShardReport = (source: string) =>
  Effect.try({
    try: () => JSON.parse(source),
    catch: () => new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
  })

const shardReportDigest = (source: string) =>
  Schema.decodeUnknownEffect(EvidenceDigest)(createHash("sha256").update(source).digest("hex"))

const aggregateProfile = (
  scripts: QualificationScriptModules,
  profile: SuppliedQualificationProfile,
  envelopes: Array<unknown>
) =>
  Effect.try({
    try: () =>
      scripts.aggregateHostedFormalShards({
        binding: {
          runId: String(profile.runId),
          runAttempt: String(profile.runAttempt),
          commitSha: profile.sourceSha,
          nodeVersion: profile.nodeVersion
        },
        envelopes
      }),
    catch: () => new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
  })

/** Existing inventory parser owns command order/counts; this seam additionally binds actual source/job/negative controls. */
const validateProfile = Effect.fn("Qualification.validateProfile")(
  function* (sourceSha: GitCommitSha, profileKind: "dedicated" | "stressed", profile: SuppliedQualificationProfile) {
    if (!profileMatchesExpectedIdentity(sourceSha, profileKind, profile))
      return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    if (profile.shards.length !== qualificationFormalShardCount)
      return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    const scripts = yield* qualificationScriptModules()
    const envelopes = yield* Effect.all(profile.shards.map(({ reportSource }) => parsedShardReport(reportSource)))
    const aggregate = yield* aggregateProfile(scripts, profile, envelopes)
    const commands = yield* Schema.decodeUnknownEffect(CompleteProfileCommands)(aggregate.commandEvidence)
    const negativeControls = yield* Schema.decodeUnknownEffect(Schema.NonEmptyArray(Schema.NonEmptyString))(
      aggregate.negativeControls
    )
    const shards = yield* Effect.all(
      profile.shards.map((shard) =>
        Effect.gen(function* () {
          const envelope = envelopes.find((value) => isRecord(value) && value["shard"] === shard.shard)
          if (!isRecord(envelope) || !isRecord(envelope["report"]))
            return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
          const report = envelope["report"]
          const positions = isRecord(report["shard"]) ? report["shard"]["positions"] : undefined
          const elapsedMilliseconds = report["elapsedMilliseconds"]
          const started = Date.parse(shard.startedAt)
          const completed = Date.parse(shard.completedAt)
          if (
            ![0, 1].includes(shard.shard) ||
            !profileConditionMatchesKind(profileKind, shard.condition) ||
            shard.job.runId !== profile.runId ||
            shard.job.runAttempt !== profile.runAttempt ||
            shard.job.name !==
              `${profileKind === "dedicated" ? "Dedicated" : "Stressed"} formal evidence shard ${shard.shard}` ||
            !Array.isArray(positions) ||
            !Number.isFinite(elapsedMilliseconds) ||
            shard.formalSeconds !== Number(elapsedMilliseconds) / millisecondsPerSecond ||
            !Number.isFinite(started) ||
            !Number.isFinite(completed) ||
            completed < started ||
            shard.completeJobSeconds !== (completed - started) / millisecondsPerSecond ||
            shard.completeJobSeconds < shard.setupInstallSeconds + shard.formalSeconds ||
            shard.completeJobSeconds >= hostedJobLimitSeconds ||
            shard.formalSeconds > formalGateLimitSeconds
          )
            return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
          return yield* Schema.decodeUnknownEffect(FormalShardEvidence)({
            shard: shard.shard,
            condition: shard.condition,
            job: shard.job,
            reportDigest: yield* shardReportDigest(shard.reportSource),
            positions,
            setupInstallSeconds: shard.setupInstallSeconds,
            formalSeconds: shard.formalSeconds,
            completeJobSeconds: shard.completeJobSeconds,
            remainingHostedSeconds: hostedJobLimitSeconds - shard.completeJobSeconds,
            hostedLimitSeconds: hostedJobLimitSeconds,
            startedAt: shard.startedAt,
            completedAt: shard.completedAt
          })
        })
      )
    )
    if (shards[0]?.shard !== 0 || shards[1]?.shard !== 1 || shards[0].job.jobId === shards[1].job.jobId)
      return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
    const formalSeconds = Math.max(...shards.map((shard) => shard.formalSeconds))
    const completeProfileSeconds =
      (Math.max(...shards.map((shard) => Date.parse(shard.completedAt))) -
        Math.min(...shards.map((shard) => Date.parse(shard.startedAt)))) /
      millisecondsPerSecond
    return yield* Schema.decodeUnknownEffect(QualificationFormalProfile)({
      profileKind,
      sourceSha,
      nodeVersion: profile.nodeVersion,
      runId: profile.runId,
      runAttempt: profile.runAttempt,
      profileDigest: aggregate.profileDigest,
      formalSeconds,
      completeProfileSeconds,
      shards,
      commands,
      negativeControls
    })
  },
  Effect.mapError(() => new QualificationEvidenceFailure({ operation: "ValidateProvenance" }))
)

export const requiredQualificationFormalProvenance = Effect.fn("Qualification.requiredFormalProvenance")(function* (
  sourceSha: GitCommitSha,
  supplied: { readonly dedicated: SuppliedQualificationProfile; readonly stressed: SuppliedQualificationProfile }
) {
  if (
    supplied.dedicated.runId !== supplied.stressed.runId ||
    supplied.dedicated.runAttempt !== supplied.stressed.runAttempt
  )
    return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
  const dedicated = yield* validateProfile(sourceSha, "dedicated", supplied.dedicated)
  const stressed = yield* validateProfile(sourceSha, "stressed", supplied.stressed)
  if (dedicated.profileKind !== "dedicated" || stressed.profileKind !== "stressed") {
    return yield* new QualificationEvidenceFailure({ operation: "ValidateProvenance" })
  }
  const commandIdentity = (profile: typeof QualificationFormalProfile.Type) =>
    profile.commands.map(({ args, kind, name, position, result, verdict }) => ({
      args,
      kind,
      name,
      position,
      result,
      verdict
    }))
  const jobIds = [dedicated, stressed].flatMap(({ shards }) => shards.map(({ job }) => job.jobId))
  if (
    new Set(jobIds).size !== qualificationFormalJobCount ||
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
