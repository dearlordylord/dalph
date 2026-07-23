import { NodeServices } from "@effect/platform-node"
import { Context, Crypto, Effect, FileSystem, Layer, Ref, Schema } from "effect"
import type { CoordinatorOwnershipError } from "./coordinator-lock.js"
import type { PlannedTaskAttempt } from "./domain.js"
import { GitCommitSha, OperationId, RunId, TaskId } from "./domain.js"
import { GitCommand } from "./git-command.js"
import type { TaskExecutionOutcome } from "./task-execution.js"

/** Identifies immutable bytes by their lowercase SHA-256 content digest. */
export const EvidenceDigest = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/)
).pipe(Schema.brand("EvidenceDigest"))
export type EvidenceDigest = typeof EvidenceDigest.Type

/** Describes one complete object accepted by the shared EvidenceStore boundary. */
export const EvidenceReference = Schema.Struct({
  byteLength: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  digest: EvidenceDigest
})
export type EvidenceReference = typeof EvidenceReference.Type

/** Evidence storage could not atomically accept or read one complete object. */
export class EvidenceStoreFailure extends Schema.TaggedErrorClass<EvidenceStoreFailure>()(
  "EvidenceStoreFailure",
  { detail: Schema.String, operation: Schema.Literals(["EvidenceStore.put", "EvidenceStore.read"]) }
) {}

export interface EvidenceStoreService {
  readonly put: (bytes: Uint8Array) => Effect.Effect<
    EvidenceReference,
    CoordinatorOwnershipError | EvidenceStoreFailure
  >
  readonly read: (reference: EvidenceReference) => Effect.Effect<Uint8Array, EvidenceStoreFailure>
}

/** Stores complete evidence bytes under immutable content-derived identities. */
export class EvidenceStore extends Context.Service<EvidenceStore, EvidenceStoreService>()(
  "@dalph/EvidenceStore"
) {}

const digestBytes = Effect.fn("EvidenceStore.digestBytes")(function*(
  crypto: Crypto.Crypto,
  bytes: Uint8Array
) {
  const digest = yield* crypto.digest("SHA-256", bytes).pipe(
    Effect.mapError((cause) => new EvidenceStoreFailure({ detail: String(cause), operation: "EvidenceStore.put" }))
  )
  return EvidenceDigest.make(Buffer.from(digest).toString("hex"))
})

/** Deterministic in-memory implementation used by tests and simulated execution. */
export const memoryEvidenceStoreLayer = Layer.effectContext(Effect.gen(function*() {
  const crypto = yield* Crypto.Crypto
  const objects = yield* Ref.make<ReadonlyMap<EvidenceDigest, Uint8Array>>(new Map())
  const put = Effect.fn("EvidenceStore.Memory.put")(function*(bytes: Uint8Array) {
    const digest = yield* digestBytes(crypto, bytes)
    const copy = bytes.slice()
    yield* Ref.update(objects, (current) => new Map([...current, [digest, copy]]))
    return EvidenceReference.make({ byteLength: copy.byteLength, digest })
  })
  const read = Effect.fn("EvidenceStore.Memory.read")(function*(reference: EvidenceReference) {
    const bytes = (yield* Ref.get(objects)).get(reference.digest)
    if (bytes === undefined || bytes.byteLength !== reference.byteLength) {
      return yield* new EvidenceStoreFailure({
        detail: `complete evidence object ${reference.digest} is unavailable`,
        operation: "EvidenceStore.read"
      })
    }
    return bytes.slice()
  })
  const service = EvidenceStore.of({ put, read })
  return Context.empty().pipe(Context.add(EvidenceStore, service))
}))

/** The Git adapter could not produce the completed attempt's exact diff bytes. */
export class ImplementationDiffReadFailure extends Schema.TaggedErrorClass<ImplementationDiffReadFailure>()(
  "ImplementationDiffReadFailure",
  { detail: Schema.String, operationId: OperationId }
) {}

/** Durable history cannot prove the exact successful execution predecessor. */
export class ImplementationEvidenceHistoryContradiction
  extends Schema.TaggedErrorClass<ImplementationEvidenceHistoryContradiction>()(
    "ImplementationEvidenceHistoryContradiction",
    {
      operationId: OperationId,
      reason: Schema.Literals([
        "AttemptMismatch",
        "ExistingEvidenceMismatch",
        "IntentMismatch",
        "MissingExecutionIntent",
        "MissingPredecessor",
        "MultipleExecutionIntents",
        "MultiplePredecessors",
        "MultipleSealingIntents",
        "MultipleSealedOutcomes",
        "OutcomeWithoutIntent",
        "PredecessorMismatch",
        "RunMismatch"
      ])
    }
  )
{}

/** A simulated predecessor cannot authorize durable implementation evidence. */
export class ImplementationEvidenceModeContradiction
  extends Schema.TaggedErrorClass<ImplementationEvidenceModeContradiction>()(
    "ImplementationEvidenceModeContradiction",
    { operationId: OperationId }
  )
{}

export interface ImplementationEvidenceSourceService {
  readonly readDiff: (
    operationId: OperationId,
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<Uint8Array, ImplementationDiffReadFailure>
}

/** Reads stage evidence from Git without owning its durable storage. */
export class ImplementationEvidenceSource extends Context.Service<
  ImplementationEvidenceSource,
  ImplementationEvidenceSourceService
>()("@dalph/ImplementationEvidenceSource") {}

export const unavailableImplementationEvidenceSourceLayer = Layer.succeed(
  ImplementationEvidenceSource,
  ImplementationEvidenceSource.of({
    readDiff: (operationId) =>
      Effect.fail(
        new ImplementationDiffReadFailure({
          detail: "no implementation evidence source is configured",
          operationId
        })
      )
  })
)

export const testImplementationEvidenceServicesLayer = Layer.merge(
  memoryEvidenceStoreLayer,
  unavailableImplementationEvidenceSourceLayer
).pipe(Layer.provide(NodeServices.layer))

const requireSuccessfulGit = <Output>(
  operationId: OperationId,
  result: { readonly exitCode: number; readonly stderr: string; readonly stdout: Output },
  acceptedExitCodes: ReadonlyArray<number> = [0]
): Effect.Effect<Output, ImplementationDiffReadFailure> =>
  acceptedExitCodes.includes(result.exitCode)
    ? Effect.succeed(result.stdout)
    : Effect.fail(
      new ImplementationDiffReadFailure({
        detail: result.stderr.trim() || `git exited ${result.exitCode}`,
        operationId
      })
    )

export const nodeImplementationEvidenceSourceLayer = () =>
  Layer.effect(
    ImplementationEvidenceSource,
    Effect.gen(function*() {
      const git = yield* GitCommand
      const fs = yield* FileSystem.FileSystem
      return ImplementationEvidenceSource.of({
        readDiff: Effect.fn("ImplementationEvidenceSource.Node.readDiff")(
          function*(operationId, plannedAttempt) {
            return yield* Effect.scoped(Effect.gen(function*() {
              const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-evidence-index-" })
              const repositoryObjectsResult = yield* git.runInWorktree(plannedAttempt.worktree, [
                "rev-parse",
                "--path-format=absolute",
                "--git-path",
                "objects"
              ]).pipe(
                Effect.mapError((failure) => new ImplementationDiffReadFailure({ detail: failure.detail, operationId }))
              )
              const repositoryObjects = (yield* requireSuccessfulGit(
                operationId,
                repositoryObjectsResult
              )).trim()
              if (repositoryObjects.length === 0 || repositoryObjects.includes(":")) {
                return yield* new ImplementationDiffReadFailure({
                  detail: "repository object path cannot be represented as one Git alternate",
                  operationId
                })
              }
              const temporaryObjects = `${temporary}/objects`
              yield* fs.makeDirectory(temporaryObjects)
              const environment = {
                GIT_ALTERNATE_OBJECT_DIRECTORIES: repositoryObjects,
                GIT_INDEX_FILE: `${temporary}/index`,
                GIT_OBJECT_DIRECTORY: temporaryObjects
              }
              const run = (args: ReadonlyArray<string>) =>
                git.runBytesInWorktree(plannedAttempt.worktree, args, environment).pipe(
                  Effect.mapError((failure) =>
                    new ImplementationDiffReadFailure({ detail: failure.detail, operationId })
                  ),
                  Effect.flatMap((result) => requireSuccessfulGit(operationId, result))
                )
              yield* run(["read-tree", plannedAttempt.baseSha])
              yield* run(["add", "-A", "--", "."])
              return yield* run(["diff", "--cached", "--binary", plannedAttempt.baseSha])
            })).pipe(
              Effect.mapError((failure) => new ImplementationDiffReadFailure({ detail: String(failure), operationId }))
            )
          }
        )
      })
    })
  )

/** Immutable review input for the implementation stage and its exact predecessor. */
export const ImplementationEvidenceManifest = Schema.Struct({
  diff: EvidenceReference,
  implementationOutput: EvidenceReference,
  plannedBaseSha: GitCommitSha,
  predecessorOperationId: OperationId,
  runId: RunId,
  stage: Schema.Literal("Implementation"),
  taskId: TaskId
})
export type ImplementationEvidenceManifest = typeof ImplementationEvidenceManifest.Type

/** Complete manifest bytes and every referenced evidence object are sealed. */
export const SealedImplementationEvidence = Schema.TaggedStruct(
  "SealedImplementationEvidence",
  { manifest: ImplementationEvidenceManifest, manifestReference: EvidenceReference }
)
export type SealedImplementationEvidence = typeof SealedImplementationEvidence.Type

/** Review may begin only from a complete, schema-validated sealed manifest. */
export const ImplementationReviewAuthorization = Schema.Struct({
  manifestReference: EvidenceReference,
  predecessorOperationId: OperationId,
  stage: Schema.Literal("Implementation")
})
export type ImplementationReviewAuthorization = typeof ImplementationReviewAuthorization.Type

export class ImplementationReviewNotAuthorized extends Schema.TaggedErrorClass<ImplementationReviewNotAuthorized>()(
  "ImplementationReviewNotAuthorized",
  { detail: Schema.String }
) {}

export const authorizeImplementationReview = Effect.fn(
  "ImplementationEvidence.authorizeReview"
)(function*(candidate: unknown) {
  const sealed = yield* Schema.decodeUnknownEffect(SealedImplementationEvidence)(candidate).pipe(
    Effect.mapError((parseError) => new ImplementationReviewNotAuthorized({ detail: String(parseError) }))
  )
  const store = yield* EvidenceStore
  const manifestBytes = yield* store.read(sealed.manifestReference).pipe(
    Effect.mapError((failure) => new ImplementationReviewNotAuthorized({ detail: failure.detail }))
  )
  const persistedManifest = yield* Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder().decode(manifestBytes)),
    catch: (failure) => new ImplementationReviewNotAuthorized({ detail: String(failure) })
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ImplementationEvidenceManifest)),
    Effect.mapError((failure) =>
      failure instanceof ImplementationReviewNotAuthorized
        ? failure
        : new ImplementationReviewNotAuthorized({ detail: String(failure) })
    )
  )
  if (
    JSON.stringify(Schema.encodeUnknownSync(ImplementationEvidenceManifest)(persistedManifest))
      !== JSON.stringify(Schema.encodeUnknownSync(ImplementationEvidenceManifest)(sealed.manifest))
  ) {
    return yield* new ImplementationReviewNotAuthorized({
      detail: "sealed manifest does not match its content-addressed bytes"
    })
  }
  yield* Effect.all([
    store.read(persistedManifest.diff),
    store.read(persistedManifest.implementationOutput)
  ], { discard: true }).pipe(
    Effect.mapError((failure) => new ImplementationReviewNotAuthorized({ detail: failure.detail }))
  )
  return ImplementationReviewAuthorization.make({
    manifestReference: sealed.manifestReference,
    predecessorOperationId: sealed.manifest.predecessorOperationId,
    stage: sealed.manifest.stage
  })
})

/** Dry-run and simulated interpreters project the stage without fabricating durable review authority. */
export const ImplementationEvidenceSealingSimulated = Schema.TaggedStruct(
  "ImplementationEvidenceSealingSimulated",
  { operationId: OperationId, predecessorOperationId: OperationId, stage: Schema.Literal("Implementation") }
)

export const sealImplementationEvidence = Effect.fn("ImplementationEvidence.seal")(function*(
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt,
  predecessorOperationId: OperationId,
  outcome: typeof TaskExecutionOutcome.cases.Succeeded.Type
) {
  const source = yield* ImplementationEvidenceSource
  const store = yield* EvidenceStore
  const outputBytes = new TextEncoder().encode(outcome.output)
  const diffBytes = yield* source.readDiff(operationId, plannedAttempt)
  const implementationOutput = yield* store.put(outputBytes)
  const diff = yield* store.put(diffBytes)
  yield* Effect.all([
    store.read(implementationOutput),
    store.read(diff)
  ], { discard: true })
  const manifest = ImplementationEvidenceManifest.make({
    diff,
    implementationOutput,
    plannedBaseSha: plannedAttempt.baseSha,
    predecessorOperationId,
    runId: plannedAttempt.runId,
    stage: "Implementation",
    taskId: plannedAttempt.taskId
  })
  const encodedManifest = new TextEncoder().encode(
    JSON.stringify(Schema.encodeUnknownSync(ImplementationEvidenceManifest)(manifest))
  )
  const manifestReference = yield* store.put(encodedManifest)
  return SealedImplementationEvidence.make({ manifest, manifestReference })
})
