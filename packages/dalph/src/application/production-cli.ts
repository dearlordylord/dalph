/* eslint-disable import/no-nodejs-modules -- The public CLI owns absolute configuration-path decoding. */

import nodePath from "node:path"
import { RunId } from "@dalph/contracts"
import {
  ApplicationExitResult,
  type CurrentSignal,
  type GithubIssueTarget,
  type ProductionRunSelection,
  RunTerminationDisposition,
  TraceAtCursor,
  type TraceCursor,
  type TraceReaderError,
  type TraceReaderService,
  type JournalStoreError,
  type TrackerTarget
} from "@dalph/orchestrator"
import { Config, Effect, type Redacted, Schema, Stream } from "effect"
import { decodeCliTarget } from "./cli.js"

export const productionCliWireVersion = 1 as const // eslint-disable-line no-magic-numbers

export class ProductionCliUsageError extends Schema.TaggedError<ProductionCliUsageError>()("ProductionCliUsageError", {
  code: Schema.Literal("usage.invalid"),
  detail: Schema.NonEmptyString
}) {}

export class ProductionCliConfigurationError extends Schema.TaggedError<ProductionCliConfigurationError>()(
  "ProductionCliConfigurationError",
  { code: Schema.Literal("configuration.invalid"), detail: Schema.NonEmptyString, subject: Schema.NonEmptyString }
) {}

/** Process-local command selection; this value is never persisted as Run state. */
export type RunInvocation =
  | { readonly _tag: "DryRun"; readonly target: TrackerTarget }
  | { readonly _tag: "Production"; readonly configuration: string; readonly target: GithubIssueTarget }

export interface RawRunInvocation {
  readonly config: string | undefined
  readonly dry: boolean
  readonly production: boolean
  readonly target: string
}

const usageFailure = (detail: string) => new ProductionCliUsageError({ code: "usage.invalid", detail })

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
  if (!nodePath.isAbsolute(input.config) || nodePath.normalize(input.config) !== input.config) {
    return yield* usageFailure("--config must name a normalized absolute JSON path")
  }
  return { _tag: "Production", configuration: input.config, target } as const
})

const UnknownConfigurationDocument = Schema.Record(Schema.String, Schema.Unknown)
const parseUnknownJson = (source: string): unknown => JSON.parse(source)

export interface LoadedProductionConfiguration extends Record<string, unknown> {
  readonly codexProviderCredential: Redacted.Redacted<string>
  readonly githubToken: Redacted.Redacted<string>
  readonly target: GithubIssueTarget
}

const configurationFailure = (subject: string, detail: string) =>
  new ProductionCliConfigurationError({ code: "configuration.invalid", detail, subject })

/**
 * Reads one non-secret JSON document and combines only the two documented
 * credential environment values. Failures never retain rejected bytes.
 */
export const loadProductionConfiguration = <ERead>(
  locator: string,
  target: GithubIssueTarget,
  readFile: (locator: string) => Effect.Effect<string, ERead>
): Effect.Effect<LoadedProductionConfiguration, ProductionCliConfigurationError, never> =>
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
    return { ...document, codexProviderCredential, githubToken, target }
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
    code: Schema.Literals(["configuration.invalid", "usage.invalid"]),
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
        Stream.runForEach((cursor) =>
          observation.traceReader
            .readAt(cursor)
            .pipe(Effect.flatMap((snapshot) => writeLine(encodeProductionCliRecord(historicalRecord(snapshot)))))
        )
      )
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
export const productionCliFailureRecord = (
  failure: ProductionCliConfigurationError | ProductionCliUsageError
): ProductionCliRecord =>
  ProductionCliRecord.cases.Failure.make({
    code: failure.code,
    detail: failure.detail,
    subject: failure._tag === "ProductionCliConfigurationError" ? failure.subject : "dalph run",
    version: productionCliWireVersion
  })
