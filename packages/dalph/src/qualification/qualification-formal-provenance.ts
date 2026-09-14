import { EvidenceDigest, GitCommitSha } from "@dalph/contracts"
import { Schema } from "effect"

const hostedJobLimitSeconds = 960
const formalGateLimitSeconds = 750
const stressedFormalParallelism = 2
const formalCommandCount = 105
const millisecondsPerSecond = 1_000

export const QualificationFormalJobId = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("QualificationFormalJobId")
)
export const QualificationFormalRunId = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("QualificationFormalRunId")
)
export const QualificationFormalRunAttempt = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("QualificationFormalRunAttempt")
)
export const QualificationFormalShard = Schema.Literals([0, 1]).pipe(Schema.brand("QualificationFormalShard"))
const QualificationDurationSeconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("QualificationDurationSeconds")
)
const QualificationDurationMilliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("QualificationDurationMilliseconds")
)
const QualificationCommandPosition = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("QualificationCommandPosition")
)
const QualificationCustodyId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
).pipe(Schema.brand("QualificationCustodyId"))
const QualificationObservedTimestamp = Schema.String.check(
  Schema.makeFilter((value) => (Number.isFinite(Date.parse(value)) ? undefined : "expected an Actions timestamp"))
).pipe(Schema.brand("QualificationObservedTimestamp"))

export const QualificationHostedJob = Schema.Struct({
  workflow: Schema.Literal("Production live qualification"),
  runId: QualificationFormalRunId,
  runAttempt: QualificationFormalRunAttempt,
  jobId: QualificationFormalJobId,
  name: Schema.NonEmptyString
})
const ProfileCommandVerdict = Schema.Struct({
  acceptedExitCodes: Schema.NonEmptyArray(Schema.Int),
  witnesses: Schema.Array(Schema.NonEmptyString),
  temporal: Schema.NullOr(Schema.Literals(["clean", "violation"])),
  collectedReplacementTest: Schema.Boolean,
  artifactPreparedAfter: Schema.Boolean
})
const ProfileCommand = Schema.Struct({
  position: QualificationCommandPosition,
  kind: Schema.Literals(["typecheck", "test", "sampled-run", "verify"]),
  name: Schema.NonEmptyString,
  args: Schema.NonEmptyArray(Schema.String),
  verdict: ProfileCommandVerdict,
  result: Schema.Literals(["exit:0", "exit:1"]),
  obligationId: QualificationCustodyId,
  durationMilliseconds: QualificationDurationMilliseconds
})
export const CompleteProfileCommands = Schema.Array(ProfileCommand).check(
  Schema.makeFilter((commands) =>
    commands.length === formalCommandCount && commands.every(({ position }, index) => position === index)
      ? undefined
      : "qualification formal profile must retain positions 0 through 104 exactly once"
  )
)
/** One ARM formal-only shard job establishes half of the dedicated reference profile. */
const DedicatedFormalCondition = Schema.Struct({
  kind: Schema.Literal("dedicated-hosted-job"),
  runnerLabel: Schema.Literal("ubuntu-24.04-arm"),
  effectiveParallelism: Schema.Int.check(Schema.isGreaterThan(0))
})
/** One measured two-CPU affinity shard below its host capacity establishes stressed evidence. */
const StressedFormalCondition = Schema.Struct({
  kind: Schema.Literal("cpu-affinity"),
  runnerLabel: Schema.Literal("ubuntu-latest"),
  cpuList: Schema.Literal("0-1"),
  hostParallelism: Schema.Int.check(Schema.isGreaterThan(stressedFormalParallelism)),
  effectiveParallelism: Schema.Literal(stressedFormalParallelism)
})
export const FormalProfileCondition = Schema.Union([DedicatedFormalCondition, StressedFormalCondition])
export const FormalShardEvidence = Schema.Struct({
  shard: QualificationFormalShard,
  condition: FormalProfileCondition,
  job: QualificationHostedJob,
  reportDigest: EvidenceDigest,
  positions: Schema.NonEmptyArray(QualificationCommandPosition),
  setupInstallSeconds: QualificationDurationSeconds,
  formalSeconds: QualificationDurationSeconds,
  completeJobSeconds: QualificationDurationSeconds,
  remainingHostedSeconds: QualificationDurationSeconds,
  hostedLimitSeconds: Schema.Literal(hostedJobLimitSeconds),
  startedAt: QualificationObservedTimestamp,
  completedAt: QualificationObservedTimestamp
})
const FormalProfileFields = {
  sourceSha: GitCommitSha,
  nodeVersion: Schema.String.check(Schema.isPattern(/^24\.20\.\d+$/u)),
  runId: QualificationFormalRunId,
  runAttempt: QualificationFormalRunAttempt,
  profileDigest: EvidenceDigest,
  formalSeconds: QualificationDurationSeconds,
  completeProfileSeconds: QualificationDurationSeconds,
  shards: Schema.Tuple([FormalShardEvidence, FormalShardEvidence]),
  commands: CompleteProfileCommands,
  negativeControls: Schema.NonEmptyArray(Schema.NonEmptyString)
}
type ProfileKind = "dedicated" | "stressed"

const profileEvidenceIsExact = (profile: {
  readonly profileKind: ProfileKind
  readonly runId: number
  readonly runAttempt: number
  readonly formalSeconds: number
  readonly completeProfileSeconds: number
  readonly shards: ReadonlyArray<typeof FormalShardEvidence.Type>
  readonly commands: ReadonlyArray<typeof ProfileCommand.Type>
}) => {
  const expectedNamePrefix = profile.profileKind === "dedicated" ? "Dedicated" : "Stressed"
  const expectedCondition = profile.profileKind === "dedicated" ? "dedicated-hosted-job" : "cpu-affinity"
  const positions = profile.shards.flatMap(({ positions: shardPositions }) => shardPositions).toSorted((a, b) => a - b)
  const commandPositions = profile.commands.map(({ position }) => position)
  const started = profile.shards.map(({ startedAt }) => Date.parse(startedAt))
  const completed = profile.shards.map(({ completedAt }) => Date.parse(completedAt))
  const shardEvidenceIsExact = profile.shards.every((shard, index) => {
    const startedAt = Date.parse(shard.startedAt)
    const completedAt = Date.parse(shard.completedAt)
    const completeJobSeconds = (completedAt - startedAt) / millisecondsPerSecond
    return (
      shard.shard === index &&
      shard.condition.kind === expectedCondition &&
      shard.job.runId === profile.runId &&
      shard.job.runAttempt === profile.runAttempt &&
      shard.job.name === `${expectedNamePrefix} formal evidence shard ${String(index)}` &&
      Number.isFinite(startedAt) &&
      Number.isFinite(completedAt) &&
      completedAt >= startedAt &&
      shard.completeJobSeconds === completeJobSeconds &&
      shard.completeJobSeconds >= shard.setupInstallSeconds + shard.formalSeconds &&
      shard.completeJobSeconds < hostedJobLimitSeconds &&
      shard.formalSeconds <= formalGateLimitSeconds &&
      shard.remainingHostedSeconds === hostedJobLimitSeconds - shard.completeJobSeconds
    )
  })
  return (
    shardEvidenceIsExact &&
    positions.length === commandPositions.length &&
    positions.every((position, index) => position === commandPositions[index]) &&
    new Set(profile.commands.map(({ obligationId }) => obligationId)).size === profile.commands.length &&
    new Set(profile.shards.map(({ reportDigest }) => reportDigest)).size === profile.shards.length &&
    profile.formalSeconds === Math.max(...profile.shards.map(({ formalSeconds }) => formalSeconds)) &&
    profile.completeProfileSeconds === (Math.max(...completed) - Math.min(...started)) / millisecondsPerSecond
  )
}

const exactProfileFilter = Schema.makeFilter((profile: Parameters<typeof profileEvidenceIsExact>[0]) =>
  profileEvidenceIsExact(profile) ? undefined : "qualification formal profile evidence is not internally exact"
)

const DedicatedQualificationFormalProfile = Schema.Struct({
  profileKind: Schema.Literal("dedicated"),
  ...FormalProfileFields
}).check(exactProfileFilter)
const StressedQualificationFormalProfile = Schema.Struct({
  profileKind: Schema.Literal("stressed"),
  ...FormalProfileFields
}).check(exactProfileFilter)
export const QualificationFormalProfile = Schema.Union([
  DedicatedQualificationFormalProfile,
  StressedQualificationFormalProfile
])
export const QualificationFormalProvenance = Schema.TaggedUnion({
  NotSupplied: { reason: Schema.Literal("LocalHermeticInvocation") },
  DedicatedAndStressed: { dedicated: DedicatedQualificationFormalProfile, stressed: StressedQualificationFormalProfile }
})
export type QualificationFormalProvenance = typeof QualificationFormalProvenance.Type
const commandIdentity = (profile: typeof QualificationFormalProfile.Type) =>
  profile.commands.map(({ args, kind, name, position, result, verdict }) => ({
    args,
    kind,
    name,
    position,
    result,
    verdict
  }))

export const RequiredQualificationFormalProvenance = QualificationFormalProvenance.cases.DedicatedAndStressed.check(
  Schema.makeFilter(({ dedicated, stressed }) => {
    const profiles = [dedicated, stressed]
    const jobs = profiles.flatMap(({ shards }) => shards.map(({ job }) => job.jobId))
    const reports = profiles.flatMap(({ shards }) => shards.map(({ reportDigest }) => reportDigest))
    const obligations = profiles.flatMap(({ commands }) => commands.map(({ obligationId }) => obligationId))
    return dedicated.sourceSha === stressed.sourceSha &&
      dedicated.nodeVersion === stressed.nodeVersion &&
      dedicated.runId === stressed.runId &&
      dedicated.runAttempt === stressed.runAttempt &&
      dedicated.profileDigest === stressed.profileDigest &&
      new Set(jobs).size === jobs.length &&
      new Set(reports).size === reports.length &&
      new Set(obligations).size === obligations.length &&
      JSON.stringify(commandIdentity(dedicated)) === JSON.stringify(commandIdentity(stressed)) &&
      JSON.stringify(dedicated.negativeControls) === JSON.stringify(stressed.negativeControls)
      ? undefined
      : "dedicated and stressed formal profiles must describe one exact independent run attempt"
  })
)
export type RequiredQualificationFormalProvenance = typeof RequiredQualificationFormalProvenance.Type
