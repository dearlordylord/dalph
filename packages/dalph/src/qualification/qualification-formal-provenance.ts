import { EvidenceDigest, GitCommitSha } from "@dalph/contracts"
import { Schema } from "effect"

const hostedJobLimitSeconds = 960
const stressedFormalParallelism = 2
const formalCommandCount = 105

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
export const DedicatedFormalCondition = Schema.Struct({
  kind: Schema.Literal("dedicated-hosted-job"),
  runnerLabel: Schema.Literal("ubuntu-24.04-arm"),
  effectiveParallelism: Schema.Int.check(Schema.isGreaterThan(0))
})
/** One measured two-CPU affinity shard below its host capacity establishes stressed evidence. */
export const StressedFormalCondition = Schema.Struct({
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
const DedicatedQualificationFormalProfile = Schema.Struct({
  profileKind: Schema.Literal("dedicated"),
  ...FormalProfileFields
})
const StressedQualificationFormalProfile = Schema.Struct({
  profileKind: Schema.Literal("stressed"),
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
