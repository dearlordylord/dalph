/* eslint-disable import/no-nodejs-modules -- The public CLI owns absolute configuration-path decoding. */

import nodePath from "node:path"
import { RunId } from "@dalph/contracts"
import {
  ApplicationExitResult,
  CoordinatorLockHeld,
  CoordinatorLockObservationContradiction,
  CoordinatorLockUnavailable,
  CoordinatorOwnershipLost,
  type CurrentSignal,
  type GithubIssueTarget,
  type JournaledRunTerminationSource,
  JournalDataCorruption,
  JournalHistoryCorruption,
  JournalPartitionContradiction,
  JournalSchemaIncompatible,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  type ProductionRunSelection,
  ProductionRunSelectionConflict,
  RunTerminationDisposition,
  StartupRecoveryBlocked,
  TraceAtCursor,
  TraceCausalPredecessorContradiction,
  TraceCausalPredecessorMissing,
  TraceCausalPredecessorNotProjected,
  type TraceCursor,
  TraceCursorNotCommitted,
  TraceJournalPrefixInvalid,
  TraceProjectionInvalid,
  TraceRunNotFound,
  type TraceReaderError,
  type TraceReaderService,
  type JournalStoreError,
  type TrackerTarget
} from "@dalph/orchestrator"
import { Config, Effect, Option, Redacted, Schema, Stream } from "effect"
import { decodeCliTarget } from "./cli.js"
import {
  decodeProductionRepositoryHostConfiguration,
  type ProductionRepositoryHostConfiguration
} from "./production-configuration.js"

export const productionCliWireVersion = 1 as const // eslint-disable-line no-magic-numbers

export class ProductionCliUsageError extends Schema.TaggedError<ProductionCliUsageError>()("ProductionCliUsageError", {
  code: Schema.Literal("usage.invalid"),
  detail: Schema.NonEmptyString
}) {}

export class ProductionCliConfigurationError extends Schema.TaggedError<ProductionCliConfigurationError>()(
  "ProductionCliConfigurationError",
  { code: Schema.Literal("configuration.invalid"), detail: Schema.NonEmptyString, subject: Schema.NonEmptyString }
) {}

export class ProductionCliStartupError extends Schema.TaggedError<ProductionCliStartupError>()(
  "ProductionCliStartupError",
  {
    code: Schema.Literals([
      "startup.ownership_conflict",
      "startup.ownership_contradiction",
      "startup.ownership_lost",
      "startup.ownership_unavailable",
      "startup.recovery_blocked",
      "startup.run_selection_conflict"
    ]),
    detail: Schema.NonEmptyString,
    subject: Schema.NonEmptyString
  }
) {}

const productionCliJournalFailureCodes = [
  "journal.data_corruption",
  "journal.history_corruption",
  "journal.partition_contradiction",
  "journal.schema_incompatible",
  "journal.storage_access_denied",
  "journal.storage_capacity_exhausted",
  "journal.storage_locked",
  "journal.storage_unavailable"
] as const

export class ProductionCliJournalError extends Schema.TaggedError<ProductionCliJournalError>()(
  "ProductionCliJournalError",
  {
    code: Schema.Literals(productionCliJournalFailureCodes),
    detail: Schema.NonEmptyString,
    subject: Schema.Literal("production Journal")
  }
) {}

export class ProductionCliStatusError extends Schema.TaggedError<ProductionCliStatusError>()(
  "ProductionCliStatusError",
  { code: Schema.Literal("status.projection_invalid"), detail: Schema.NonEmptyString, subject: RunId }
) {}

/** Normalized absolute locator for Alice's non-secret production JSON document. */
export const ProductionConfigurationLocator = Schema.NonEmptyString.check(
  Schema.makeFilter((value) =>
    nodePath.isAbsolute(value) && nodePath.normalize(value) === value
      ? undefined
      : "production configuration locator must be normalized and absolute"
  )
).pipe(Schema.brand("ProductionConfigurationLocator"))
export type ProductionConfigurationLocator = typeof ProductionConfigurationLocator.Type

/** Process-local command selection; this value is never persisted as Run state. */
export type RunInvocation =
  | { readonly _tag: "DryRun"; readonly target: TrackerTarget }
  | {
      readonly _tag: "Production"
      readonly configuration: ProductionConfigurationLocator
      readonly target: GithubIssueTarget
    }

export interface RawRunInvocation {
  readonly config: string | undefined
  readonly dry: boolean
  readonly production: boolean
  readonly target: string
}

const usageFailure = (detail: string) => new ProductionCliUsageError({ code: "usage.invalid", detail })

export const decodeProductionConfigurationLocator = Effect.fn("ProductionCli.decodeConfigurationLocator")(
  (input: string) =>
    Schema.decodeUnknownEffect(ProductionConfigurationLocator)(input).pipe(
      Effect.mapError(() => usageFailure("--config must name a normalized absolute JSON path"))
    )
)

/**
 * Alice selects exactly one command interpreter before any production host can
 * be acquired. Production accepts only one GitHub issue and one canonical
 * absolute configuration-file locator.
 */
export const decodeRunInvocation = Effect.fn("ProductionCli.decodeRunInvocation")(function* (input: RawRunInvocation) {
  if (input.dry === input.production) {
    return yield* usageFailure("exactly one of --dry or --production is required")
  }
  const target = yield* decodeCliTarget(input.target).pipe(
    Effect.mapError(() => usageFailure("the target is invalid for the selected command mode"))
  )
  if (input.dry) {
    if (input.config !== undefined) return yield* usageFailure("--config is available only with --production")
    return { _tag: "DryRun", target } as const
  }
  if (typeof target === "string") {
    return yield* usageFailure("--production requires github:OWNER/REPOSITORY#ISSUE")
  }
  if (input.config === undefined) return yield* usageFailure("--production requires --config <absolute-json-path>")
  const configuration = yield* decodeProductionConfigurationLocator(input.config)
  return { _tag: "Production", configuration, target } as const
})

const UnknownConfigurationDocument = Schema.Record(Schema.String, Schema.Unknown)
const parseUnknownJson = (source: string): unknown => JSON.parse(source)

const configurationFailure = (subject: string, detail: string) =>
  new ProductionCliConfigurationError({ code: "configuration.invalid", detail, subject })

/**
 * Reads one non-secret JSON document and combines only the two documented
 * credential environment values. Failures never retain rejected bytes.
 */
export const loadProductionConfiguration = <ERead>(
  locator: ProductionConfigurationLocator,
  target: GithubIssueTarget,
  readFile: (locator: string) => Effect.Effect<string, ERead>
): Effect.Effect<ProductionRepositoryHostConfiguration, ProductionCliConfigurationError, never> =>
  Effect.gen(function* () {
    const source = yield* readFile(locator).pipe(
      Effect.mapError(() => configurationFailure("production configuration file", "could not be read"))
    )
    const parsed = yield* Effect.try({
      catch: () => configurationFailure("production configuration file", "must contain one JSON object"),
      try: () => parseUnknownJson(source)
    })
    const document = yield* Schema.decodeUnknownEffect(UnknownConfigurationDocument)(parsed, {
      onExcessProperty: "error",
      reportInput: false
    }).pipe(
      Effect.mapError(() => configurationFailure("production configuration file", "must contain one JSON object"))
    )
    const githubToken = yield* Config.redacted("GITHUB_TOKEN").pipe(
      Effect.mapError(() => configurationFailure("GITHUB_TOKEN", "required credential is unavailable"))
    )
    const codexProviderCredential = yield* Config.redacted("DALPH_CODEX_PROVIDER_CREDENTIAL").pipe(
      Effect.mapError(() =>
        configurationFailure("DALPH_CODEX_PROVIDER_CREDENTIAL", "required credential is unavailable")
      )
    )
    return yield* decodeProductionRepositoryHostConfiguration({
      ...document,
      codexProviderCredential: Redacted.value(codexProviderCredential),
      githubToken: Redacted.value(githubToken),
      target
    }).pipe(
      Effect.mapError(
        (failure) =>
          new ProductionCliConfigurationError({
            code: "configuration.invalid",
            detail: failure.detail,
            subject: failure.subject
          })
      )
    )
  })

/** Version-one public records keep selection, history, and dispositions distinct. */
const PublicApplicationExitResult: Schema.Codec<ApplicationExitResult, unknown, never, never> = ApplicationExitResult
const PublicRunTerminationDisposition: Schema.Codec<RunTerminationDisposition, unknown, never, never> =
  RunTerminationDisposition
const PublicTraceAtCursor: Schema.Codec<TraceAtCursor, unknown, never, never> = TraceAtCursor

export const ProductionCliRecord = Schema.TaggedUnion({
  ApplicationExitDisposition: {
    disposition: PublicApplicationExitResult,
    runId: RunId,
    version: Schema.Literal(productionCliWireVersion)
  },
  HistoricalSnapshot: { snapshot: PublicTraceAtCursor, version: Schema.Literal(productionCliWireVersion) },
  Failure: {
    code: Schema.Literals([
      "configuration.invalid",
      ...productionCliJournalFailureCodes,
      "startup.ownership_conflict",
      "startup.ownership_contradiction",
      "startup.ownership_lost",
      "startup.ownership_unavailable",
      "startup.recovery_blocked",
      "startup.run_selection_conflict",
      "status.projection_invalid",
      "usage.invalid"
    ]),
    detail: Schema.NonEmptyString,
    subject: Schema.NonEmptyString,
    version: Schema.Literal(productionCliWireVersion)
  },
  RunDisposition: {
    disposition: PublicRunTerminationDisposition,
    runId: RunId,
    version: Schema.Literal(productionCliWireVersion)
  },
  RunSelected: {
    runId: RunId,
    selection: Schema.Literals(["Allocated", "Recovered"]),
    version: Schema.Literal(productionCliWireVersion)
  }
})
export type ProductionCliRecord = typeof ProductionCliRecord.Type

export const encodeProductionCliRecord = (record: ProductionCliRecord): string =>
  JSON.stringify(Schema.encodeUnknownSync(ProductionCliRecord)(record))

/** The exact read-only subset #298 consumes from one established production host. */
export interface ProductionCliHostObservation {
  readonly acceptedHistory: CurrentSignal<TraceCursor>
  readonly runTermination: JournaledRunTerminationSource
  readonly selection: ProductionRunSelection
  readonly traceReader: Pick<TraceReaderService, "readAt">
}

const selectedRecord = (selection: ProductionRunSelection): ProductionCliRecord =>
  ProductionCliRecord.cases.RunSelected.make({
    runId: selection.runId,
    selection: selection._tag,
    version: productionCliWireVersion
  })

const historicalRecord = (snapshot: TraceAtCursor): ProductionCliRecord =>
  ProductionCliRecord.cases.HistoricalSnapshot.make({ snapshot, version: productionCliWireVersion })

/**
 * Writes the already-established Run first, then converts each acknowledged
 * cursor into one complete immutable historical snapshot. No current-status
 * or disposition fact is inferred from this stream.
 */
export const presentSelectedProductionRun = <EOutput>(
  observation: ProductionCliHostObservation,
  writeLine: (line: string) => Effect.Effect<void, EOutput>,
  onObservation: Effect.Effect<void> = Effect.void
): Effect.Effect<void, EOutput | TraceReaderError | JournalStoreError> =>
  onObservation.pipe(
    Effect.andThen(writeLine(encodeProductionCliRecord(selectedRecord(observation.selection)))),
    Effect.andThen(
      observation.acceptedHistory.changes.pipe(
        Stream.takeUntilEffect((cursor) =>
          observation.runTermination.poll.pipe(
            Effect.map(
              Option.exists(
                ({ terminatedAt }) => terminatedAt.runId === cursor.runId && terminatedAt.position <= cursor.position
              )
            )
          )
        ),
        Stream.runForEach((cursor) =>
          observation.traceReader
            .readAt(cursor)
            .pipe(Effect.flatMap((snapshot) => writeLine(encodeProductionCliRecord(historicalRecord(snapshot)))))
        )
      )
    ),
    Effect.andThen(observation.runTermination.await),
    Effect.flatMap(({ disposition }) =>
      writeLine(encodeProductionCliRecord(runDispositionRecord(observation.selection.runId, disposition)))
    )
  )

/** Explicit helper for later lifecycle transport; status closure never creates this record. */
export const runDispositionRecord = (runId: RunId, disposition: RunTerminationDisposition): ProductionCliRecord =>
  ProductionCliRecord.cases.RunDisposition.make({ disposition, runId, version: productionCliWireVersion })

/** Explicit helper for later OS-signal transport; ordinary scope closure never creates this record. */
export const applicationExitDispositionRecord = (
  runId: RunId,
  disposition: ApplicationExitResult
): ProductionCliRecord =>
  ProductionCliRecord.cases.ApplicationExitDisposition.make({ disposition, runId, version: productionCliWireVersion })

/** Safe public form of a known command/configuration failure. */
export const productionCliFailureRecord = (failure: ProductionCliKnownFailure): ProductionCliRecord =>
  ProductionCliRecord.cases.Failure.make({
    code: failure.code,
    detail: failure.detail,
    subject: failure._tag === "ProductionCliUsageError" ? "dalph run" : failure.subject,
    version: productionCliWireVersion
  })

export type ProductionCliKnownFailure =
  | ProductionCliConfigurationError
  | ProductionCliJournalError
  | ProductionCliStartupError
  | ProductionCliStatusError
  | ProductionCliUsageError

type ProductionCliBoundaryFailure =
  | CoordinatorLockHeld
  | CoordinatorLockObservationContradiction
  | CoordinatorLockUnavailable
  | CoordinatorOwnershipLost
  | JournalStoreError
  | ProductionCliConfigurationError
  | ProductionCliUsageError
  | ProductionRunSelectionConflict
  | StartupRecoveryBlocked
  | TraceReaderError

/** Exact schema for every accepted CLI boundary failure and its exhaustive mapper. */
const exactProductionCliBoundaryFailure = <S extends Schema.Top>(
  schema: S &
    ([ProductionCliBoundaryFailure] extends [S["Type"]]
      ? [S["Type"]] extends [ProductionCliBoundaryFailure]
        ? unknown
        : never
      : never)
): S => schema

const ProductionCliBoundaryFailure = exactProductionCliBoundaryFailure(
  Schema.Union([
    CoordinatorLockHeld,
    CoordinatorLockObservationContradiction,
    CoordinatorLockUnavailable,
    CoordinatorOwnershipLost,
    JournalDataCorruption,
    JournalHistoryCorruption,
    JournalPartitionContradiction,
    JournalSchemaIncompatible,
    JournalStorageAccessDenied,
    JournalStorageCapacityExhausted,
    JournalStorageLocked,
    JournalStorageUnavailable,
    ProductionCliConfigurationError,
    ProductionCliUsageError,
    ProductionRunSelectionConflict,
    StartupRecoveryBlocked,
    TraceCausalPredecessorContradiction,
    TraceCausalPredecessorMissing,
    TraceCausalPredecessorNotProjected,
    TraceCursorNotCommitted,
    TraceJournalPrefixInvalid,
    TraceProjectionInvalid,
    TraceRunNotFound
  ])
)

const journalFailure = (code: ProductionCliJournalError["code"], detail: string): ProductionCliJournalError =>
  new ProductionCliJournalError({ code, detail, subject: "production Journal" })

const historicalProjectionFailure = (runId: RunId): ProductionCliStatusError =>
  new ProductionCliStatusError({
    code: "status.projection_invalid",
    detail: "the selected Run's historical projection is invalid",
    subject: runId
  })

const mapProductionCliBoundaryFailure = (failure: ProductionCliBoundaryFailure): ProductionCliKnownFailure => {
  switch (failure._tag) {
    case "ProductionCliConfigurationError":
    case "ProductionCliUsageError":
      return failure
    case "CoordinatorLockHeld":
      return new ProductionCliStartupError({
        code: "startup.ownership_conflict",
        detail: "another coordinator already owns the production repository",
        subject: "production repository"
      })
    case "CoordinatorLockObservationContradiction":
      return new ProductionCliStartupError({
        code: "startup.ownership_contradiction",
        detail: "coordinator ownership no longer matches the production repository",
        subject: "production repository"
      })
    case "CoordinatorOwnershipLost":
      return new ProductionCliStartupError({
        code: "startup.ownership_lost",
        detail: "coordinator ownership ended before the production operation completed",
        subject: "production repository"
      })
    case "CoordinatorLockUnavailable":
      return new ProductionCliStartupError({
        code: "startup.ownership_unavailable",
        detail: "coordinator ownership could not be acquired",
        subject: "production repository"
      })
    case "StartupRecoveryBlocked":
      return new ProductionCliStartupError({
        code: "startup.recovery_blocked",
        detail: "the production Journal cannot be recovered safely",
        subject: "production repository"
      })
    case "ProductionRunSelectionConflict":
      return new ProductionCliStartupError({
        code: "startup.run_selection_conflict",
        detail: "the production Journal does not identify one safe Run",
        subject: "production repository"
      })
    case "JournalDataCorruption":
      return journalFailure("journal.data_corruption", "the production Journal contains invalid data")
    case "JournalHistoryCorruption":
      return journalFailure("journal.history_corruption", "the production Journal contains an invalid Run history")
    case "JournalPartitionContradiction":
      return journalFailure("journal.partition_contradiction", "the production Journal contains conflicting Run copies")
    case "JournalSchemaIncompatible":
      return journalFailure("journal.schema_incompatible", "the production Journal schema is incompatible")
    case "JournalStorageAccessDenied":
      return journalFailure("journal.storage_access_denied", "access to the production Journal was denied")
    case "JournalStorageCapacityExhausted":
      return journalFailure("journal.storage_capacity_exhausted", "the production Journal has exhausted its capacity")
    case "JournalStorageLocked":
      return journalFailure("journal.storage_locked", "the production Journal is locked")
    case "JournalStorageUnavailable":
      return journalFailure("journal.storage_unavailable", "the production Journal is unavailable")
    case "TraceCausalPredecessorContradiction":
    case "TraceCausalPredecessorMissing":
    case "TraceCausalPredecessorNotProjected":
    case "TraceJournalPrefixInvalid":
    case "TraceProjectionInvalid":
    case "TraceRunNotFound":
      return historicalProjectionFailure(failure.runId)
    case "TraceCursorNotCommitted":
      return historicalProjectionFailure(failure.cursor.runId)
    default: {
      const exhaustive: never = failure
      return exhaustive
    }
  }
}

/** Maps only accepted typed failures; unexpected defects remain on the runtime failure channel. */
export const knownProductionCliFailure = (failure: unknown): ProductionCliKnownFailure | undefined =>
  Option.map(Schema.decodeUnknownOption(ProductionCliBoundaryFailure)(failure), mapProductionCliBoundaryFailure).pipe(
    Option.getOrUndefined
  )
