/* eslint-disable import/no-nodejs-modules -- The protected qualification owns one built Node child. */
/* eslint-disable import-x/no-unused-modules -- Shipped qualification and external test-support consume these boundary contracts outside the production lint graph. */
import nodePath from "node:path"
import nodeProcess from "node:process"
import type { GitCommitSha, RunId } from "@dalph/contracts"
import type { GithubIssueTarget, JournalRecord } from "@dalph/orchestrator"
import { Effect, Redacted, Schema, Stream, type Result, type Scope } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { ChildProcessSpawner } from "effect/unstable/process"
import {
  encodeProductionCliRecord,
  ProductionCliRecord,
  type ProductionConfigurationLocator
} from "../application/production-cli.js"
import { ProductionCodexStateDirectory } from "../application/production-configuration.js"

const canonicalAbsoluteLocator = (subject: string) =>
  Schema.NonEmptyString.check(
    Schema.makeFilter((value) =>
      nodePath.isAbsolute(value) && nodePath.normalize(value) === value
        ? undefined
        : `${subject} must be normalized and absolute`
    )
  )

/** Locates the already-built shipped Dalph entry invoked by the protected controller. */
export const ProductionLiveBuiltEntry = canonicalAbsoluteLocator("live qualification built entry").pipe(
  Schema.brand("ProductionLiveBuiltEntry")
)
export type ProductionLiveBuiltEntry = typeof ProductionLiveBuiltEntry.Type

/** Locates the exact private Codex home made for this qualification invocation. */
export const ProductionLiveCodexHome = ProductionCodexStateDirectory
export type ProductionLiveCodexHome = ProductionCodexStateDirectory

/** Locates the exact Node executable used to start the shipped Dalph entry. */
export const ProductionLiveChildExecutable = canonicalAbsoluteLocator("live qualification child executable").pipe(
  Schema.brand("ProductionLiveChildExecutable")
)
export type ProductionLiveChildExecutable = typeof ProductionLiveChildExecutable.Type

/** Identifies the one positive operating-system process created for the shipped command. */
export const ProductionLiveQualificationProcessId = Schema.Int.check(
  Schema.makeFilter((value) => (value > 0 ? undefined : "process identity must be positive"))
).pipe(Schema.brand("ProductionLiveQualificationProcessId"))
export type ProductionLiveQualificationProcessId = typeof ProductionLiveQualificationProcessId.Type

const qualificationBoundaryOperations = ["Spawn", "ReadStdout", "ReadStderr", "WaitForExit"] as const

/** A sanitized failure while controlling or observing the one shipped child process. */
export class ProductionLiveQualificationBoundaryFailure extends Schema.TaggedError<ProductionLiveQualificationBoundaryFailure>()(
  "ProductionLiveQualificationBoundaryFailure",
  {
    operation: Schema.Literals(qualificationBoundaryOperations),
    reason: Schema.Literals(["Unavailable", "InvalidProcessIdentity"])
  }
) {}

/** A sanitized failure while accepting the shipped child's canonical public records. */
export class ProductionLiveQualificationRecordFailure extends Schema.TaggedError<ProductionLiveQualificationRecordFailure>()(
  "ProductionLiveQualificationRecordFailure",
  {
    reason: Schema.Literals([
      "InvalidUtf8",
      "MissingFinalDelimiter",
      "EmptyFrame",
      "MalformedFrame",
      "NonCanonicalFrame"
    ])
  }
) {}

/** Secrets needed by the one shipped child; no controller result or callback receives these values. */
export interface ProductionLiveQualificationInvocation {
  readonly builtEntry: ProductionLiveBuiltEntry
  readonly codexHome: ProductionLiveCodexHome
  readonly configuration: ProductionConfigurationLocator
  readonly target: GithubIssueTarget
  readonly githubToken: Redacted.Redacted<string>
  readonly codexProviderCredential: Redacted.Redacted<string>
}

/** Exact process request for the one public production command. */
export interface ProductionLiveQualificationChildRequest {
  readonly executable: ProductionLiveChildExecutable
  readonly arguments: ReadonlyArray<string>
  readonly environment: Readonly<Record<string, string>>
}

export interface ProductionLiveQualificationChild {
  readonly pid: ProductionLiveQualificationProcessId
  readonly stdout: Stream.Stream<Uint8Array, ProductionLiveQualificationBoundaryFailure>
  readonly stderr: Stream.Stream<Uint8Array, ProductionLiveQualificationBoundaryFailure>
  readonly exitCode: Effect.Effect<number, ProductionLiveQualificationBoundaryFailure>
}

/** The controller owns spawning; the supplied implementation cannot select a workflow operation. */
export interface ProductionLiveQualificationBoundary {
  readonly spawn: (
    request: ProductionLiveQualificationChildRequest
  ) => Effect.Effect<ProductionLiveQualificationChild, ProductionLiveQualificationBoundaryFailure, Scope.Scope>
}

/** Safe owning-authority observations collected only after the original child has stopped. */
export interface ProductionLiveQualificationFinalFacts {
  readonly applicationServerCount: number
  readonly taskWorktreeCount: number
  readonly integrationTargetCount: number
  readonly journal: ReadonlyArray<JournalRecord>
  readonly github: unknown
  readonly targetHead: GitCommitSha
}

export type ProductionLiveQualificationStage =
  | "Spawn"
  | "ReadOutput"
  | "Process"
  | "GatherFinalFacts"
  | "ValidateComposition"
  | "Publish"

export interface ProductionLiveQualificationCompletion {
  readonly processId: ProductionLiveQualificationProcessId
  readonly processStatus: 0
  readonly runId: RunId
  readonly records: ReadonlyArray<ProductionCliRecord>
  readonly facts: ProductionLiveQualificationFinalFacts
}

export interface ProductionLiveQualificationFailureObservation {
  readonly stage: ProductionLiveQualificationStage
  readonly processId?: ProductionLiveQualificationProcessId
  readonly runId?: RunId
  readonly spawnCount: 0 | 1
}

export interface ProductionLiveQualificationCallbacks<
  EPublish = never,
  EGather = never,
  EValidate = never,
  ERetain = never,
  R = never
> {
  /** Rejects unsafe source atoms before the record enters the accepted transcript. */
  readonly validateRecord: (record: ProductionCliRecord) => Effect.Effect<void, EValidate, R>
  readonly gatherFinalFacts: (
    input: Pick<ProductionLiveQualificationCompletion, "processId" | "processStatus" | "records" | "runId">
  ) => Effect.Effect<ProductionLiveQualificationFinalFacts, EGather, R>
  readonly publish: (completion: ProductionLiveQualificationCompletion) => Effect.Effect<void, EPublish, R>
  /** Reports retained Q resources; it must not start another child or infer cleanup authority. */
  readonly retainAfterFailure: (
    failure: ProductionLiveQualificationFailureObservation
  ) => Effect.Effect<void, ERetain, R>
}

export type ProductionLiveQualificationResult =
  | ({ readonly _tag: "Completed"; readonly spawnCount: 1 } & ProductionLiveQualificationCompletion)
  | ({ readonly _tag: "Failed" } & ProductionLiveQualificationFailureObservation)

export const productionLiveQualificationChildRequest = (
  invocation: ProductionLiveQualificationInvocation
): ProductionLiveQualificationChildRequest => ({
  executable: ProductionLiveChildExecutable.make(nodeProcess.execPath),
  arguments: [
    invocation.builtEntry,
    "run",
    `github:${invocation.target.owner}/${invocation.target.repository}#${invocation.target.issueNumber}`,
    "--production",
    "--config",
    invocation.configuration
  ],
  environment: {
    CODEX_HOME: invocation.codexHome,
    GITHUB_TOKEN: Redacted.value(invocation.githubToken),
    DALPH_CODEX_PROVIDER_CREDENTIAL: Redacted.value(invocation.codexProviderCredential),
    GIT_OPTIONAL_LOCKS: "0"
  }
})

/** Concrete Effect process boundary used by the protected runner. */
export const makeProductionLiveQualificationNodeBoundary = (
  spawner: Pick<ChildProcessSpawner.ChildProcessSpawner["Service"], "spawn">
): ProductionLiveQualificationBoundary => ({
  spawn: (request) =>
    spawner
      .spawn(
        ChildProcess.make(request.executable, request.arguments, {
          env: request.environment,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe"
        })
      )
      .pipe(
        Effect.mapError(
          () => new ProductionLiveQualificationBoundaryFailure({ operation: "Spawn", reason: "Unavailable" })
        ),
        Effect.flatMap((child) =>
          Schema.decodeUnknownEffect(ProductionLiveQualificationProcessId)(child.pid).pipe(
            Effect.mapError(
              () =>
                new ProductionLiveQualificationBoundaryFailure({ operation: "Spawn", reason: "InvalidProcessIdentity" })
            ),
            Effect.map((pid) => ({
              pid,
              stdout: child.stdout.pipe(
                Stream.mapError(
                  () =>
                    new ProductionLiveQualificationBoundaryFailure({ operation: "ReadStdout", reason: "Unavailable" })
                )
              ),
              stderr: child.stderr.pipe(
                Stream.mapError(
                  () =>
                    new ProductionLiveQualificationBoundaryFailure({ operation: "ReadStderr", reason: "Unavailable" })
                )
              ),
              exitCode: child.exitCode.pipe(
                Effect.mapError(
                  () =>
                    new ProductionLiveQualificationBoundaryFailure({ operation: "WaitForExit", reason: "Unavailable" })
                )
              )
            }))
          )
        )
      )
})

const decodeFrame = <EValidate, R>(
  frame: string,
  validate: (record: ProductionCliRecord) => Effect.Effect<void, EValidate, R>
) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(ProductionCliRecord))(frame, {
    reportInput: false,
    onExcessProperty: "error"
  }).pipe(
    Effect.mapError(() => new ProductionLiveQualificationRecordFailure({ reason: "MalformedFrame" })),
    Effect.filterOrFail(
      (record) => frame === encodeProductionCliRecord(record),
      () => new ProductionLiveQualificationRecordFailure({ reason: "NonCanonicalFrame" })
    ),
    Effect.tap(validate)
  )

/** Accepts only complete canonical LF frames and never returns rejected source bytes. */
const readCanonicalRecords = Effect.fn("ProductionLiveQualification.readCanonicalRecords")(function* <EValidate, R>(
  stdout: Stream.Stream<Uint8Array, ProductionLiveQualificationBoundaryFailure>,
  validate: (record: ProductionCliRecord) => Effect.Effect<void, EValidate, R>
) {
  const chunks = yield* stdout.pipe(Stream.runCollect)
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const joined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  const source = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(joined),
    catch: () => new ProductionLiveQualificationRecordFailure({ reason: "InvalidUtf8" })
  })
  if (!source.endsWith("\n"))
    return yield* new ProductionLiveQualificationRecordFailure({ reason: "MissingFinalDelimiter" })
  const finalDelimiterWidth = 1
  const frames = source.slice(0, -finalDelimiterWidth).split("\n")
  if (frames.some((frame) => frame.length === 0))
    return yield* new ProductionLiveQualificationRecordFailure({ reason: "EmptyFrame" })
  return yield* Effect.forEach(frames, (frame) => decodeFrame(frame, validate))
})

const selectedRun = (records: ReadonlyArray<ProductionCliRecord>): RunId | undefined => {
  const selections = records.filter((record) => record._tag === "RunSelected")
  if (selections.length !== 1) return undefined
  return selections[0]?.runId
}

const hasExactCompletedDisposition = (records: ReadonlyArray<ProductionCliRecord>, runId: RunId) =>
  records.filter(
    (record) => record._tag === "RunDisposition" && record.runId === runId && record.disposition === "Completed"
  ).length === 1 && records.every((record) => record._tag !== "ApplicationExitDisposition")

const compositionIsExact = (facts: ProductionLiveQualificationFinalFacts) =>
  facts.applicationServerCount === 1 && facts.taskWorktreeCount === 1 && facts.integrationTargetCount === 1

/** Accepts only the stopped zero-status child transcript for one selected completed Run. */
const exactCompletedRun = (
  process: Result.Result<number, ProductionLiveQualificationBoundaryFailure>,
  records: ReadonlyArray<ProductionCliRecord>,
  runId: RunId | undefined
): RunId | undefined => {
  if (process._tag === "Failure" || process.success !== 0 || runId === undefined) return undefined
  return hasExactCompletedDisposition(records, runId) ? runId : undefined
}

/**
 * Runs one protected live journey. Every post-spawn failure is converted to a
 * safe stage and handed to retention exactly once; no branch can spawn again.
 */
const runProductionLiveQualificationScoped = Effect.fn("ProductionLiveQualification.runScoped")(function* <
  EPublish,
  EGather,
  EValidate,
  ERetain,
  R
>(
  invocation: ProductionLiveQualificationInvocation,
  boundary: ProductionLiveQualificationBoundary,
  callbacks: ProductionLiveQualificationCallbacks<EPublish, EGather, EValidate, ERetain, R>
) {
  let spawnCount: 0 | 1 = 0
  // Mutable only to let the single failure funnel report facts learned after spawn.
  // eslint-disable-next-line prefer-const
  let processId: ProductionLiveQualificationProcessId | undefined
  // eslint-disable-next-line prefer-const
  let runId: RunId | undefined
  const fail = Effect.fn("ProductionLiveQualification.retainFailure")(function* (
    stage: ProductionLiveQualificationStage
  ) {
    const failure: ProductionLiveQualificationFailureObservation = {
      stage,
      spawnCount,
      ...(processId === undefined ? {} : { processId }),
      ...(runId === undefined ? {} : { runId })
    }
    yield* callbacks.retainAfterFailure(failure).pipe(Effect.ignore)
    return { _tag: "Failed" as const, ...failure }
  })

  spawnCount = 1
  const spawned = yield* boundary.spawn(productionLiveQualificationChildRequest(invocation)).pipe(Effect.result)
  if (spawned._tag === "Failure") return yield* fail("Spawn")
  const child = spawned.success
  processId = child.pid
  const [output, stderr, process] = yield* Effect.all(
    [
      readCanonicalRecords(child.stdout, callbacks.validateRecord).pipe(Effect.result),
      child.stderr.pipe(Stream.runDrain, Effect.result),
      child.exitCode.pipe(Effect.result)
    ] as const,
    { concurrency: "unbounded" }
  )
  if (output._tag === "Failure" || stderr._tag === "Failure") return yield* fail("ReadOutput")
  const records = output.success
  runId = selectedRun(records)
  const completedRunId = exactCompletedRun(process, records, runId)
  if (completedRunId === undefined) return yield* fail("Process")
  runId = completedRunId
  const finalInput = { processId, processStatus: 0 as const, records, runId }
  const gathered = yield* callbacks.gatherFinalFacts(finalInput).pipe(Effect.result)
  if (gathered._tag === "Failure") return yield* fail("GatherFinalFacts")
  if (!compositionIsExact(gathered.success)) return yield* fail("ValidateComposition")
  const completion = { ...finalInput, facts: gathered.success }
  const published = yield* callbacks.publish(completion).pipe(Effect.result)
  if (published._tag === "Failure") return yield* fail("Publish")
  return { _tag: "Completed" as const, spawnCount: 1 as const, ...completion }
})

export const runProductionLiveQualification = <EPublish, EGather, EValidate, ERetain, R>(
  invocation: ProductionLiveQualificationInvocation,
  boundary: ProductionLiveQualificationBoundary,
  callbacks: ProductionLiveQualificationCallbacks<EPublish, EGather, EValidate, ERetain, R>
): Effect.Effect<ProductionLiveQualificationResult, never, R> =>
  Effect.scoped(runProductionLiveQualificationScoped(invocation, boundary, callbacks))
