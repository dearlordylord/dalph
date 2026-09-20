/* eslint-disable import/no-nodejs-modules -- The public CLI owns absolute configuration-path decoding. */
/* eslint-disable max-lines -- The public CLI keeps one exhaustive versioned wire and failure mapper auditable. */

import nodePath from "node:path"
import { RunId } from "@dalph/contracts"
import {
  type ApplicationExitResult,
  CoordinatorLockHeld,
  CoordinatorLockObservationContradiction,
  CoordinatorLockUnavailable,
  CoordinatorOwnershipLost,
  type CurrentSignal,
  type CurrentDeliveryStatus,
  type DeliveryRuntimeObservationState,
  DeliveryStatusProjectionConflict,
  type DeliveryStatusProjectionError,
  DeliveryStatusRunIdentityUnavailable,
  DeliveryStatusRunMismatch,
  DeliveryStatusSubject,
  deliveryStatusSignalOf,
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
  TraceOutputError,
  TraceProjectionInvalid,
  TraceRunNotFound,
  type TraceReaderError,
  type TraceReaderService,
  type JournalStoreError,
  OperationId,
  TaskTrackerMutationOperation,
  TaskTrackerMutationThrottled,
  TaskTrackerThrottleTimingEvidence,
  type TrackerTarget
} from "@dalph/orchestrator"
import {
  Cause,
  Clock,
  Config,
  Duration,
  Effect,
  Exit,
  Fiber,
  Option,
  Queue,
  Redacted,
  Ref,
  Schema,
  Semaphore,
  Stream
} from "effect"
import { decodeCliTarget } from "./cli.js"
import {
  decodeProductionRepositoryHostConfiguration,
  type ProductionRepositoryHostConfiguration
} from "./production-configuration.js"
import { ProductionCliCurrentDeliveryStatus, publicDeliveryStatusOf } from "./production-cli-status-schema.js"
import { ProductionCancellationRunNotFound } from "./production-host.js"
import { ProductionCancellationBlocked } from "./production.js"

export const productionCliWireVersion = 1 as const // eslint-disable-line no-magic-numbers

export class ProductionCliUsageError extends Schema.TaggedError<ProductionCliUsageError>()("ProductionCliUsageError", {
  code: Schema.Literal("usage.invalid"),
  detail: Schema.NonEmptyString,
  subject: Schema.Literals(["dalph run", "dalph cancel"])
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
      "startup.run_not_found",
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

/** Safe identity and timing evidence for the one tracker mutation rejected by its provider. */
export const ProductionCliDeliveryFailureSubject = Schema.TaggedStruct("TaskTrackerMutation", {
  operation: TaskTrackerMutationOperation,
  operationId: OperationId,
  retry: Schema.NullOr(TaskTrackerThrottleTimingEvidence),
  runId: RunId
})
export type ProductionCliDeliveryFailureSubject = typeof ProductionCliDeliveryFailureSubject.Type

/** One provider throttle remains a delivery failure and never becomes startup or graceful Exit. */
export class ProductionCliDeliveryError extends Schema.TaggedError<ProductionCliDeliveryError>()(
  "ProductionCliDeliveryError",
  {
    code: Schema.Literal("delivery.provider_throttled"),
    detail: Schema.Literal("the task tracker throttled a production delivery mutation"),
    subject: ProductionCliDeliveryFailureSubject
  }
) {}

/** Safe public form of the exact cancellation precondition that remained unsettled. */
export class ProductionCliCancellationError extends Schema.TaggedError<ProductionCliCancellationError>()(
  "ProductionCliCancellationError",
  { code: Schema.Literal("cancellation.blocked"), detail: Schema.NonEmptyString, subject: RunId }
) {}

const productionCliStatusFailureCodes = [
  "status.projection_conflict",
  "status.projection_invalid",
  "status.run_identity_unavailable",
  "status.run_mismatch"
] as const

export class ProductionCliStatusError extends Schema.TaggedError<ProductionCliStatusError>()(
  "ProductionCliStatusError",
  { code: Schema.Literals(productionCliStatusFailureCodes), detail: Schema.NonEmptyString, subject: RunId }
) {}

/** A public output boundary failure retains no rejected bytes or private transport diagnostic. */
export class ProductionCliOutputError extends Schema.TaggedError<ProductionCliOutputError>()(
  "ProductionCliOutputError",
  {
    code: Schema.Literal("output.write_failed"),
    detail: Schema.Literal("production stdout could not be written"),
    subject: Schema.Literal("production stdout")
  }
) {}

const productionCliLifecycleFailureCodes = ["lifecycle.exit_failed", "lifecycle.exit_timed_out"] as const

/** A non-graceful application Exit result that must keep the public process status nonzero. */
export class ProductionCliLifecycleError extends Schema.TaggedError<ProductionCliLifecycleError>()(
  "ProductionCliLifecycleError",
  { code: Schema.Literals(productionCliLifecycleFailureCodes), detail: Schema.NonEmptyString, subject: RunId }
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

export interface RawCancelInvocation {
  readonly config: string | undefined
  readonly production: boolean
  readonly target: string
}

const usageFailure = (detail: string, subject: "dalph run" | "dalph cancel" = "dalph run") =>
  new ProductionCliUsageError({ code: "usage.invalid", detail, subject })

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

/** Alice selects the offline production cancellation adapter before any live authority is acquired. */
export const decodeCancelInvocation = Effect.fn("ProductionCli.decodeCancelInvocation")(function* (
  input: RawCancelInvocation
) {
  if (!input.production) return yield* usageFailure("cancel requires --production", "dalph cancel")
  const target = yield* decodeCliTarget(input.target).pipe(
    Effect.mapError(() => usageFailure("cancel requires github:OWNER/REPOSITORY#ISSUE", "dalph cancel"))
  )
  if (typeof target === "string")
    return yield* usageFailure("cancel requires github:OWNER/REPOSITORY#ISSUE", "dalph cancel")
  if (input.config === undefined)
    return yield* usageFailure("cancel requires --config <absolute-json-path>", "dalph cancel")
  return {
    _tag: "CancelProduction" as const,
    configuration: yield* decodeProductionConfigurationLocator(input.config).pipe(
      Effect.mapError(
        (failure) =>
          new ProductionCliUsageError({ code: failure.code, detail: failure.detail, subject: "dalph cancel" })
      )
    ),
    target
  }
})

const UnknownConfigurationDocument = Schema.Record(Schema.String, Schema.Unknown)
const parseUnknownJson = (source: string): unknown => JSON.parse(source)

const configurationFailure = (subject: string, detail: string) =>
  new ProductionCliConfigurationError({ code: "configuration.invalid", detail, subject })

/**
 * Reads one non-secret JSON document and combines only the task tracker's
 * documented credential environment value. Codex owns its ambient CLI
 * authentication. Failures never retain rejected bytes.
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
    return yield* decodeProductionRepositoryHostConfiguration({
      ...document,
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

/** Public Exit disposition retains the exact result and status without exposing private drain diagnostics. */
export const ProductionCliApplicationExitDisposition = Schema.TaggedUnion({
  Failed: { requestedStatus: Schema.Literal(1) },
  Succeeded: { requestedStatus: Schema.Literal(0) },
  TimedOut: { requestedStatus: Schema.Literal(1) }
})
export type ProductionCliApplicationExitDisposition = typeof ProductionCliApplicationExitDisposition.Type

/** Version-one public records keep selection, history, and dispositions distinct. */
const PublicRunTerminationDisposition: Schema.Codec<RunTerminationDisposition, unknown, never, never> =
  RunTerminationDisposition
const PublicTraceAtCursor: Schema.Codec<TraceAtCursor, unknown, never, never> = TraceAtCursor

const ProductionCliNonFailureRecord = Schema.TaggedUnion({
  ApplicationExitDisposition: {
    disposition: ProductionCliApplicationExitDisposition,
    runId: RunId,
    version: Schema.Literal(productionCliWireVersion)
  },
  HistoricalSnapshot: { snapshot: PublicTraceAtCursor, version: Schema.Literal(productionCliWireVersion) },
  CurrentStatus: { status: ProductionCliCurrentDeliveryStatus, version: Schema.Literal(productionCliWireVersion) },
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

const ProductionCliOrdinaryFailureRecord = Schema.TaggedStruct("Failure", {
  code: Schema.Literals([
    "configuration.invalid",
    "cancellation.blocked",
    ...productionCliJournalFailureCodes,
    ...productionCliLifecycleFailureCodes,
    "startup.ownership_conflict",
    "startup.ownership_contradiction",
    "startup.ownership_lost",
    "startup.ownership_unavailable",
    "startup.recovery_blocked",
    "startup.run_not_found",
    "startup.run_selection_conflict",
    "output.write_failed",
    ...productionCliStatusFailureCodes,
    "usage.invalid"
  ]),
  detail: Schema.NonEmptyString,
  subject: Schema.NonEmptyString,
  version: Schema.Literal(productionCliWireVersion)
})

const ProductionCliDeliveryFailureRecord = Schema.TaggedStruct("Failure", {
  code: Schema.Literal("delivery.provider_throttled"),
  detail: Schema.Literal("the task tracker throttled a production delivery mutation"),
  subject: ProductionCliDeliveryFailureSubject,
  version: Schema.Literal(productionCliWireVersion)
})

/** Failure codes, detail, and subjects remain correlated at the decoded public boundary. */
export const ProductionCliRecord = Schema.Union([
  ProductionCliNonFailureRecord,
  ProductionCliOrdinaryFailureRecord,
  ProductionCliDeliveryFailureRecord
])
export type ProductionCliRecord = typeof ProductionCliRecord.Type

export const encodeProductionCliRecord = (record: ProductionCliRecord): string =>
  JSON.stringify(Schema.encodeUnknownSync(ProductionCliRecord)(record))

/** The exact read-only subset the shipped production CLI consumes from one established host. */
export interface ProductionCliHostObservation {
  readonly acceptedHistory: CurrentSignal<TraceCursor>
  readonly current: CurrentSignal<DeliveryRuntimeObservationState, DeliveryStatusProjectionError>
  readonly runTermination: JournaledRunTerminationSource
  readonly selection: ProductionRunSelection
  readonly traceReader: Pick<TraceReaderService, "readAt">
}

const selectedRecord = (selection: ProductionRunSelection): ProductionCliRecord => ({
  _tag: "RunSelected",
  runId: selection.runId,
  selection: selection._tag,
  version: productionCliWireVersion
})

const historicalRecord = (snapshot: TraceAtCursor): ProductionCliRecord => ({
  _tag: "HistoricalSnapshot",
  snapshot,
  version: productionCliWireVersion
})

/** Encodes one complete #217 status value without deriving presentation-owned order or classifications. */
export const currentDeliveryStatusRecord = (status: CurrentDeliveryStatus): ProductionCliRecord => ({
  _tag: "CurrentStatus",
  status: Schema.decodeUnknownSync(ProductionCliCurrentDeliveryStatus)(publicDeliveryStatusOf(status)),
  version: productionCliWireVersion
})

/** Passive output is rate-limited independently from workflow and authority calls. */
const productionCliPublicationWindow = Duration.seconds(1)
const sameTraceCursor = (left: TraceCursor, right: TraceCursor): boolean =>
  left.runId === right.runId && left.position === right.position

/**
 * Keeps only the newest pending passive value. The attached current value is
 * published before this worker starts, so the first later publication waits
 * one window; after an idle window a newly arriving value is immediately
 * eligible. Duplicate values do not consume a publication window.
 */
const runCoalescedLatest = <A, E, R, EOutput, ROutput>(
  changes: Stream.Stream<A, E, R>,
  publish: (value: A) => Effect.Effect<boolean, EOutput, ROutput>,
  firstPublicationEligible = false
): Effect.Effect<void, E | EOutput, R | ROutput> =>
  Effect.scoped(
    Effect.gen(function* () {
      const pending = yield* Queue.sliding<A>(1)
      const produce = changes.pipe(
        Stream.runForEach((value) => Queue.offer(pending, value)),
        Effect.andThen(Effect.never)
      )
      const windowMillis = Duration.toMillis(productionCliPublicationWindow)
      const nextEligibleAt = yield* Ref.make(
        (yield* Clock.currentTimeMillis) + (firstPublicationEligible ? 0 : windowMillis)
      )
      const publishNext = Effect.gen(function* () {
        const firstPending = yield* Queue.take(pending)
        const waitMillis = Math.max(0, (yield* Ref.get(nextEligibleAt)) - (yield* Clock.currentTimeMillis))
        yield* Effect.sleep(Duration.millis(waitMillis))
        const newestPending = yield* Queue.poll(pending)
        const published = yield* publish(Option.getOrElse(newestPending, () => firstPending))
        if (published) yield* Ref.set(nextEligibleAt, (yield* Clock.currentTimeMillis) + windowMillis)
      })
      const consume = Effect.forever(publishNext)
      return yield* Effect.raceFirst(produce, consume)
    })
  )

export type ProductionCliApplicationExitObservation<EOutput> = {
  readonly awaitRequest: Effect.Effect<void>
  readonly awaitResult: Effect.Effect<ApplicationExitResult>
} & {
  readonly presentResult: (result: ApplicationExitResult) => Effect.Effect<void, EOutput | ProductionCliLifecycleError>
}

/**
 * Writes the already-established Run first, attaches the passive status source
 * current-first, and keeps later status, history, and disposition facts distinct.
 * No current-status or disposition fact is inferred from historical snapshots.
 */
export const presentSelectedProductionRun = <EOutput>(
  observation: ProductionCliHostObservation,
  writeLine: (line: string) => Effect.Effect<void, EOutput>,
  onSelected: Effect.Effect<void> = Effect.void,
  applicationExit?: ProductionCliApplicationExitObservation<EOutput>
): Effect.Effect<
  void,
  EOutput | TraceReaderError | JournalStoreError | ProductionCliLifecycleError | ProductionCliStatusError
> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* writeLine(encodeProductionCliRecord(selectedRecord(observation.selection)))
      yield* onSelected

      const subject = DeliveryStatusSubject.cases.Run.make({ runId: observation.selection.runId })
      const status = yield* deliveryStatusSignalOf(observation.current, subject).pipe(
        Effect.mapError(() => historicalProjectionFailure(observation.selection.runId))
      )
      const attachedStatus = yield* status.attach.pipe(Effect.mapError(currentStatusProjectionFailure))
      const publishedStatusLine = yield* Ref.make<string | undefined>(undefined)
      const publicationGate = yield* Semaphore.make(1)
      const ordinaryPublicationOpen = yield* Ref.make(true)
      const writeStatus = (current: CurrentDeliveryStatus, terminal = false) =>
        publicationGate.withPermit(
          Effect.gen(function* () {
            if (!terminal && !(yield* Ref.get(ordinaryPublicationOpen))) return false
            const line = encodeProductionCliRecord(currentDeliveryStatusRecord(current))
            if ((yield* Ref.get(publishedStatusLine)) === line) return false
            yield* writeLine(line)
            yield* Ref.set(publishedStatusLine, line)
            return true
          })
        )
      yield* writeStatus(attachedStatus.current)

      const latestObservedStatus = yield* Ref.make<Option.Option<CurrentDeliveryStatus>>(Option.none())
      const presentStatusChanges = runCoalescedLatest(
        attachedStatus.changes.pipe(
          Stream.mapError(currentStatusProjectionFailure),
          Stream.tap((current) => Ref.set(latestObservedStatus, Option.some(current)))
        ),
        writeStatus
      )
      const publishedHistoryCursor = yield* Ref.make<TraceCursor | undefined>(undefined)
      const writeHistory = (cursor: TraceCursor, terminal = false) =>
        publicationGate.withPermit(
          Effect.gen(function* () {
            if (!terminal && !(yield* Ref.get(ordinaryPublicationOpen))) return false
            const published = yield* Ref.get(publishedHistoryCursor)
            if (published !== undefined && sameTraceCursor(published, cursor)) return false
            const snapshot = yield* observation.traceReader.readAt(cursor)
            yield* writeLine(encodeProductionCliRecord(historicalRecord(snapshot)))
            yield* Ref.set(publishedHistoryCursor, cursor)
            return true
          })
        )
      const presentHistory = runCoalescedLatest(
        observation.acceptedHistory.changes.pipe(
          Stream.takeUntilEffect((cursor) =>
            observation.runTermination.poll.pipe(
              Effect.map(
                Option.exists(
                  ({ terminatedAt }) => terminatedAt.runId === cursor.runId && terminatedAt.position <= cursor.position
                )
              )
            )
          )
        ),
        writeHistory,
        true
      )
      const presenters = yield* Effect.all([presentStatusChanges, presentHistory], {
        concurrency: "unbounded",
        discard: true
      }).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      const stopOrdinaryPresenters = Effect.gen(function* () {
        yield* publicationGate.withPermit(Ref.set(ordinaryPublicationOpen, false))
        yield* Fiber.interrupt(presenters)
        const stopped = yield* Fiber.await(presenters)
        if (Exit.isFailure(stopped) && !Cause.hasInterruptsOnly(stopped.cause)) {
          return yield* Effect.failCause(stopped.cause)
        }
      })
      const presenterFailure = Fiber.join(presenters).pipe(Effect.andThen(Effect.never))
      const ordinaryCompletion = Effect.raceFirst(
        observation.runTermination.await.pipe(
          Effect.map(({ disposition, terminatedAt }) => ({ _tag: "RunTerminated" as const, disposition, terminatedAt }))
        ),
        presenterFailure
      )
      const completion = yield* applicationExit === undefined
        ? ordinaryCompletion
        : Effect.raceFirst(
            applicationExit.awaitRequest.pipe(Effect.as({ _tag: "ApplicationExitRequested" as const })),
            ordinaryCompletion
          )

      if (completion._tag === "ApplicationExitRequested") {
        if (applicationExit === undefined) return yield* Effect.die("application Exit observation is unavailable")
        yield* stopOrdinaryPresenters
        const result = yield* applicationExit.awaitResult
        if (result._tag !== "Succeeded") return yield* applicationExit.presentResult(result)
        const synchronizedStatus = yield* status.get.pipe(Effect.mapError(currentStatusProjectionFailure))
        if (synchronizedStatus._tag !== "DeliveryStatusClosed") {
          return yield* new ProductionCliStatusError({
            code: "status.projection_invalid",
            detail: "application Exit completed without an authoritative closed current status",
            subject: observation.selection.runId
          })
        }
        yield* writeStatus(synchronizedStatus, true)
        return yield* applicationExit.presentResult(result)
      }

      yield* stopOrdinaryPresenters
      yield* Option.match(yield* Ref.get(latestObservedStatus), {
        onNone: () => Effect.void,
        onSome: (current) => writeStatus(current, true).pipe(Effect.asVoid)
      })
      const synchronizedStatus = yield* status.get.pipe(Effect.mapError(currentStatusProjectionFailure))
      const synchronizedStatusLine = encodeProductionCliRecord(currentDeliveryStatusRecord(synchronizedStatus))
      if (
        synchronizedStatus._tag === "DeliveryStatusClosed" &&
        (yield* Ref.get(publishedStatusLine)) !== synchronizedStatusLine
      ) {
        yield* writeStatus(synchronizedStatus, true)
      }
      yield* writeHistory(yield* observation.acceptedHistory.get, true)
      yield* publicationGate.withPermit(
        writeLine(encodeProductionCliRecord(runDispositionRecord(observation.selection.runId, completion.disposition)))
      )
    })
  )

/** Explicit helper for later lifecycle transport; status closure never creates this record. */
export const runDispositionRecord = (runId: RunId, disposition: RunTerminationDisposition): ProductionCliRecord => ({
  _tag: "RunDisposition",
  disposition,
  runId,
  version: productionCliWireVersion
})

/** Explicit helper for later OS-signal transport; ordinary scope closure never creates this record. */
export const applicationExitDispositionRecord = (
  runId: RunId,
  disposition: ApplicationExitResult
): ProductionCliRecord => {
  const publicDisposition: ProductionCliApplicationExitDisposition = (() => {
    switch (disposition._tag) {
      case "Failed":
        return ProductionCliApplicationExitDisposition.cases.Failed.make({
          requestedStatus: disposition.requestedStatus
        })
      case "Succeeded":
        return ProductionCliApplicationExitDisposition.cases.Succeeded.make({
          requestedStatus: disposition.requestedStatus
        })
      case "TimedOut":
        return ProductionCliApplicationExitDisposition.cases.TimedOut.make({
          requestedStatus: disposition.requestedStatus
        })
    }
  })()
  return {
    _tag: "ApplicationExitDisposition",
    disposition: publicDisposition,
    runId,
    version: productionCliWireVersion
  }
}

const lifecycleFailure = (
  runId: RunId,
  disposition: Exclude<ApplicationExitResult, { readonly _tag: "Succeeded" }>
): ProductionCliLifecycleError =>
  disposition._tag === "Failed"
    ? new ProductionCliLifecycleError({
        code: "lifecycle.exit_failed",
        detail: "graceful application Exit failed before reaching a recoverable boundary",
        subject: runId
      })
    : new ProductionCliLifecycleError({
        code: "lifecycle.exit_timed_out",
        detail: "graceful application Exit did not reach a recoverable boundary within five seconds",
        subject: runId
      })

/** Writes the exact redacted lifecycle disposition before selecting command success or failure. */
export const presentApplicationExitResult = Effect.fn("ProductionCli.presentApplicationExitResult")(function* <EOutput>(
  runId: RunId,
  disposition: ApplicationExitResult,
  writeLine: (line: string) => Effect.Effect<void, EOutput>
) {
  yield* writeLine(encodeProductionCliRecord(applicationExitDispositionRecord(runId, disposition)))
  if (disposition._tag === "Succeeded") return
  return yield* lifecycleFailure(runId, disposition)
})

/** Safe public form of a known command/configuration failure. */
export const productionCliFailureRecord = (failure: ProductionCliKnownFailure): ProductionCliRecord =>
  failure._tag === "ProductionCliDeliveryError"
    ? {
        _tag: "Failure",
        code: failure.code,
        detail: failure.detail,
        subject: failure.subject,
        version: productionCliWireVersion
      }
    : {
        _tag: "Failure",
        code: failure.code,
        detail: failure.detail,
        subject: failure.subject,
        version: productionCliWireVersion
      }

export type ProductionCliKnownFailure =
  | ProductionCliCancellationError
  | ProductionCliConfigurationError
  | ProductionCliDeliveryError
  | ProductionCliJournalError
  | ProductionCliLifecycleError
  | ProductionCliOutputError
  | ProductionCliStartupError
  | ProductionCliStatusError
  | ProductionCliUsageError

type ProductionCliBoundaryFailure =
  | CoordinatorLockHeld
  | CoordinatorLockObservationContradiction
  | CoordinatorLockUnavailable
  | CoordinatorOwnershipLost
  | DeliveryStatusProjectionError
  | JournalStoreError
  | ProductionCliConfigurationError
  | ProductionCliLifecycleError
  | ProductionCliOutputError
  | TraceOutputError
  | ProductionCliStatusError
  | ProductionCliUsageError
  | ProductionCancellationBlocked
  | ProductionRunSelectionConflict
  | ProductionCancellationRunNotFound
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
    DeliveryStatusProjectionConflict,
    DeliveryStatusRunIdentityUnavailable,
    DeliveryStatusRunMismatch,
    JournalDataCorruption,
    JournalHistoryCorruption,
    JournalPartitionContradiction,
    JournalSchemaIncompatible,
    JournalStorageAccessDenied,
    JournalStorageCapacityExhausted,
    JournalStorageLocked,
    JournalStorageUnavailable,
    ProductionCliConfigurationError,
    ProductionCliLifecycleError,
    ProductionCliOutputError,
    ProductionCliStatusError,
    ProductionCliUsageError,
    ProductionCancellationBlocked,
    ProductionRunSelectionConflict,
    ProductionCancellationRunNotFound,
    StartupRecoveryBlocked,
    TraceCausalPredecessorContradiction,
    TraceCausalPredecessorMissing,
    TraceCausalPredecessorNotProjected,
    TraceCursorNotCommitted,
    TraceJournalPrefixInvalid,
    TraceOutputError,
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

const currentStatusProjectionFailure = (failure: DeliveryStatusProjectionError): ProductionCliStatusError => {
  switch (failure._tag) {
    case "DeliveryStatusRunMismatch":
      return new ProductionCliStatusError({
        code: "status.run_mismatch",
        detail: "the passive status source describes another Run",
        subject: failure.requestedRunId
      })
    case "DeliveryStatusRunIdentityUnavailable":
      return new ProductionCliStatusError({
        code: "status.run_identity_unavailable",
        detail: "the passive status source has no exact Run identity",
        subject: failure.subject.runId
      })
    case "DeliveryStatusProjectionConflict":
      return new ProductionCliStatusError({
        code: "status.projection_conflict",
        detail: "the passive status source contains incompatible exact evidence",
        subject: failure.subject.runId
      })
  }
}

const mapProductionCliBoundaryFailure = (failure: ProductionCliBoundaryFailure): ProductionCliKnownFailure => {
  switch (failure._tag) {
    case "ProductionCliConfigurationError":
    case "ProductionCliLifecycleError":
    case "ProductionCliOutputError":
    case "ProductionCliStatusError":
    case "ProductionCliUsageError":
      return failure
    case "ProductionCancellationBlocked":
      return new ProductionCliCancellationError({
        code: "cancellation.blocked",
        detail: `cancellation could not prove ${failure.blocker}`,
        subject: failure.runId
      })
    case "TraceOutput.TraceOutputError":
      return new ProductionCliOutputError({
        code: "output.write_failed",
        detail: "production stdout could not be written",
        subject: "production stdout"
      })
    case "DeliveryStatusProjectionConflict":
    case "DeliveryStatusRunIdentityUnavailable":
    case "DeliveryStatusRunMismatch":
      return currentStatusProjectionFailure(failure)
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
    case "ProductionCancellationRunNotFound":
      return new ProductionCliStartupError({
        code: "startup.run_not_found",
        detail: "the production Journal has no unfinished Run for this target",
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
    /* v8 ignore next -- @preserve schema decoding admits only the exhaustive boundary-failure union above. */
    default: {
      const exhaustive: never = failure
      return exhaustive
    }
  }
}

/** Maps accepted typed failures that do not depend on an already selected Run. */
export const knownProductionCliFailure = (failure: unknown): ProductionCliKnownFailure | undefined =>
  Option.map(Schema.decodeUnknownOption(ProductionCliBoundaryFailure)(failure), mapProductionCliBoundaryFailure).pipe(
    Option.getOrUndefined
  )

/** Maps a provider throttle only while the exact selected Run remains in scope. */
export const productionCliFailureForSelectedRun = (
  failure: unknown,
  runId: RunId
): ProductionCliKnownFailure | undefined => {
  const throttled = Schema.decodeUnknownOption(TaskTrackerMutationThrottled)(failure)
  if (Option.isNone(throttled)) return knownProductionCliFailure(failure)
  return new ProductionCliDeliveryError({
    code: "delivery.provider_throttled",
    detail: "the task tracker throttled a production delivery mutation",
    subject: ProductionCliDeliveryFailureSubject.make({
      operation: throttled.value.operation,
      operationId: throttled.value.operationId,
      retry: throttled.value.retry,
      runId
    })
  })
}
