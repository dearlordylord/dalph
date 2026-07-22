import { Clock, Duration, Effect, Ref, Schedule, Schema } from "effect"
import type { RunId } from "./domain.js"
import {
  JournalRecordKey,
  OperationId,
  ReviewerSessionId,
  SemanticReviewRound,
  TechnicalRetryDelayMillis,
  TechnicalRetryLimit,
  TechnicalRetryNotBefore,
  TechnicalRetryOrdinal
} from "./domain.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import type { JournalStoreContradiction, JournalStoreError, JournalStoreService } from "./journal-store.js"
import { technicalRetryEventTag } from "./technical-retry-event-kind.js"

const validDelayRange = Schema.makeFilter<{
  readonly initialDelayMillis: TechnicalRetryDelayMillis
  readonly maximumDelayMillis: TechnicalRetryDelayMillis
}>(({ initialDelayMillis, maximumDelayMillis }) =>
  maximumDelayMillis >= initialDelayMillis
    ? undefined
    : "maximum technical retry delay must be greater than or equal to its initial delay"
)

/** One captured bounded exponential policy for one active technical invocation scope. */
export const TechnicalRetryPolicy = Schema.Struct({
  initialDelayMillis: TechnicalRetryDelayMillis,
  limit: TechnicalRetryLimit,
  maximumDelayMillis: TechnicalRetryDelayMillis
}).check(validDelayRange)
export type TechnicalRetryPolicy = typeof TechnicalRetryPolicy.Type

const defaultInitialDelayMillis = 100
const defaultRetryLimit = 3
const defaultMaximumDelayMillis = 5_000

export const defaultTechnicalRetryPolicy = TechnicalRetryPolicy.make({
  initialDelayMillis: TechnicalRetryDelayMillis.make(defaultInitialDelayMillis),
  limit: TechnicalRetryLimit.make(defaultRetryLimit),
  maximumDelayMillis: TechnicalRetryDelayMillis.make(defaultMaximumDelayMillis)
})

/** Identifies the exact provider invocation whose technical failures consume this retry budget. */
export const TechnicalRetryScope = Schema.TaggedUnion({
  ImplementationReviewInvocation: {
    operationId: OperationId,
    reviewerSessionId: ReviewerSessionId,
    semanticRound: SemanticReviewRound
  },
  ReviewFindingsHandbackInvocation: {
    operationId: OperationId,
    reviewOperationId: OperationId,
    semanticRound: SemanticReviewRound
  }
})
export type TechnicalRetryScope = typeof TechnicalRetryScope.Type

/** The Effect clock and delay cannot produce a representable absolute retry eligibility time. */
export class TechnicalRetryScheduleOverflow extends Schema.TaggedErrorClass<TechnicalRetryScheduleOverflow>()(
  "TechnicalRetryScheduleOverflow",
  {
    clockTime: Schema.String,
    delayMillis: TechnicalRetryDelayMillis,
    scope: TechnicalRetryScope
  }
) {}

/** Captures the positive limit and bounded exponential delays before the active scope is invoked. */
export const TechnicalRetryPolicyCapturedEvent = Schema.TaggedStruct(
  technicalRetryEventTag.policyCaptured,
  {
    policy: TechnicalRetryPolicy,
    scope: TechnicalRetryScope,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Makes one failed invocation's exact next eligibility time durable before the schedule waits. */
export const TechnicalRetryScheduledEvent = Schema.TaggedStruct(
  technicalRetryEventTag.scheduled,
  {
    delayMillis: TechnicalRetryDelayMillis,
    notBefore: TechnicalRetryNotBefore,
    retryOrdinal: TechnicalRetryOrdinal,
    scope: TechnicalRetryScope,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Retires one durable deferral immediately before its exact next provider invocation. */
export const TechnicalRetryDeferralSupersededEvent = Schema.TaggedStruct(
  technicalRetryEventTag.deferralSuperseded,
  {
    retryOrdinal: TechnicalRetryOrdinal,
    scope: TechnicalRetryScope,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

export const TechnicalRetryJournalEvent = Schema.Union([
  TechnicalRetryPolicyCapturedEvent,
  TechnicalRetryScheduledEvent,
  TechnicalRetryDeferralSupersededEvent
])
export type TechnicalRetryJournalEvent = typeof TechnicalRetryJournalEvent.Type

const scopeOperationId = (scope: TechnicalRetryScope): OperationId => scope.operationId

export const technicalRetryPolicyRecordKey = (scope: TechnicalRetryScope): JournalRecordKey =>
  JournalRecordKey.make(`operation:${scopeOperationId(scope)}:technical-retry-policy`)

export const technicalRetryScheduledRecordKey = (
  scope: TechnicalRetryScope,
  retryOrdinal: TechnicalRetryOrdinal
): JournalRecordKey => JournalRecordKey.make(`operation:${scopeOperationId(scope)}:technical-retry:${retryOrdinal}`)

export const technicalRetryDeferralSupersededRecordKey = (
  scope: TechnicalRetryScope,
  retryOrdinal: TechnicalRetryOrdinal
): JournalRecordKey =>
  JournalRecordKey.make(`operation:${scopeOperationId(scope)}:technical-retry:${retryOrdinal}:superseded`)

/** Durable retry facts do not describe one coherent scope and ordinal sequence. */
export class TechnicalRetryHistoryContradiction extends Schema.TaggedErrorClass<TechnicalRetryHistoryContradiction>()(
  "TechnicalRetryHistoryContradiction",
  {
    detail: Schema.String,
    operationId: OperationId
  }
) {}

/** The Effect clock cannot be compared safely with a durable retry deferral. */
export class TechnicalRetryRecoveryClockInvalid extends Schema.TaggedErrorClass<TechnicalRetryRecoveryClockInvalid>()(
  "TechnicalRetryRecoveryClockInvalid",
  {
    clockTime: Schema.String,
    scope: TechnicalRetryScope
  }
) {}

export type TechnicalRetryControlFailure =
  | TechnicalRetryHistoryContradiction
  | TechnicalRetryRecoveryClockInvalid
  | TechnicalRetryScheduleOverflow

interface DurableTechnicalRetryContext {
  readonly journal: JournalStoreService
  readonly policy?: TechnicalRetryPolicy | undefined
  readonly runId: RunId
  readonly scope: TechnicalRetryScope
}

interface TechnicalRetryClassifier<RetryableError> {
  readonly isRetryable: (failure: unknown) => failure is RetryableError
}

export type DurableTechnicalRetryOptions<RetryableError> =
  & DurableTechnicalRetryContext
  & TechnicalRetryClassifier<RetryableError>

export interface CapturedTechnicalRetry<RetryableError> {
  readonly run: <A, R>(
    invocation: Effect.Effect<A, RetryableError, R>
  ) => Effect.Effect<
    A,
    | RetryableError
    | JournalStoreContradiction
    | JournalStoreError
    | TechnicalRetryHistoryContradiction
    | TechnicalRetryRecoveryClockInvalid
    | TechnicalRetryScheduleOverflow,
    R
  >
}

const sameScope = (left: TechnicalRetryScope, right: TechnicalRetryScope): boolean =>
  JSON.stringify(Schema.encodeUnknownSync(TechnicalRetryScope)(left))
    === JSON.stringify(Schema.encodeUnknownSync(TechnicalRetryScope)(right))

export const technicalRetryDelayAt = (
  policy: TechnicalRetryPolicy,
  retryOrdinal: TechnicalRetryOrdinal
): TechnicalRetryDelayMillis => {
  const exponentialBase = 2
  const uncapped = policy.initialDelayMillis * (exponentialBase ** (retryOrdinal - 1))
  return TechnicalRetryDelayMillis.make(Math.min(uncapped, policy.maximumDelayMillis))
}

interface TechnicalRetryProgress {
  readonly activeRetryOrdinal?: TechnicalRetryOrdinal | undefined
  readonly pendingDeferral?: typeof TechnicalRetryScheduledEvent.Type | undefined
}

export interface TechnicalRetryFactIssue {
  readonly _tag: "Identity" | "Semantic"
  readonly detail: string
  readonly factIndex: number
}

export interface TechnicalRetryFactAnalysis {
  readonly issues: ReadonlyArray<TechnicalRetryFactIssue>
  readonly policy?: TechnicalRetryPolicy | undefined
  readonly progress: TechnicalRetryProgress
  readonly scope?: TechnicalRetryScope | undefined
}

/** Totally validates one operation's ordered retry facts and derives only process-local progress. */
export const analyzeTechnicalRetryFacts = (
  facts: ReadonlyArray<TechnicalRetryJournalEvent>,
  expectedScope?: TechnicalRetryScope
): TechnicalRetryFactAnalysis => {
  let issues: ReadonlyArray<TechnicalRetryFactIssue> = []
  let policy: TechnicalRetryPolicy | undefined
  let scope: TechnicalRetryScope | undefined
  let lastScheduled = 0
  let lastSuperseded = 0
  let pendingDeferral: typeof TechnicalRetryScheduledEvent.Type | undefined
  const issue = (factIndex: number, tag: TechnicalRetryFactIssue["_tag"], detail: string) => {
    issues = [...issues, { _tag: tag, detail, factIndex }]
  }

  facts.forEach((fact, factIndex) => {
    if (expectedScope !== undefined && !sameScope(fact.scope, expectedScope)) {
      issue(factIndex, "Identity", "technical retry facts bind a different active scope")
    }
    if (scope === undefined) scope = fact.scope
    else if (!sameScope(fact.scope, scope)) {
      issue(factIndex, "Identity", "technical retry facts cross active scopes")
    }
    if (fact._tag === "TechnicalRetryPolicyCaptured") {
      if (policy === undefined) policy = fact.policy
      else {
        issue(
          factIndex,
          "Semantic",
          JSON.stringify(policy) === JSON.stringify(fact.policy)
            ? "duplicate technical retry policy"
            : "contradictory technical retry policies"
        )
      }
      return
    }
    if (fact._tag === "TechnicalRetryScheduled") {
      if (policy === undefined) {
        issue(factIndex, "Semantic", "technical retry deferral precedes its captured policy")
      } else {
        if (fact.retryOrdinal > policy.limit) {
          issue(factIndex, "Semantic", "technical retry ordinal exceeds the captured limit")
        }
        if (
          fact.delayMillis !== technicalRetryDelayAt(policy, fact.retryOrdinal)
          || fact.notBefore < fact.delayMillis
        ) {
          issue(factIndex, "Semantic", "technical retry schedule contradicts the captured delay policy")
        }
      }
      if (lastScheduled !== lastSuperseded) {
        issue(factIndex, "Semantic", "a later deferral precedes supersession of the active deferral")
      }
      if (fact.retryOrdinal !== lastScheduled + 1) {
        issue(factIndex, "Semantic", "technical retry ordinals are not contiguous")
      }
      lastScheduled = fact.retryOrdinal
      pendingDeferral = fact
      return
    }
    if (policy === undefined) {
      issue(factIndex, "Semantic", "technical retry supersession precedes its captured policy")
    }
    if (fact.retryOrdinal !== lastScheduled || fact.retryOrdinal !== lastSuperseded + 1) {
      issue(factIndex, "Semantic", "technical retry supersession has no exact pending deferral")
    }
    lastSuperseded = fact.retryOrdinal
    pendingDeferral = undefined
  })

  return {
    issues,
    ...(policy === undefined ? {} : { policy }),
    progress: {
      ...(lastSuperseded === 0 ? {} : { activeRetryOrdinal: TechnicalRetryOrdinal.make(lastSuperseded) }),
      ...(pendingDeferral === undefined ? {} : { pendingDeferral })
    },
    ...(scope === undefined ? {} : { scope })
  }
}

const retryHistoryFailure = (scope: TechnicalRetryScope, detail: string) =>
  new TechnicalRetryHistoryContradiction({ detail, operationId: scope.operationId })

const readTechnicalRetryProgress = Effect.fn("TechnicalRetry.readProgress")(
  function*(options: DurableTechnicalRetryOptions<unknown>, policy: TechnicalRetryPolicy) {
    const records = yield* options.journal.read(options.runId)
    const facts = records.flatMap(({ event }) =>
      event._tag === "TechnicalRetryPolicyCaptured"
        || event._tag === "TechnicalRetryScheduled"
        || event._tag === "TechnicalRetryDeferralSuperseded"
        ? event.scope.operationId === options.scope.operationId
          ? [event]
          : []
        : []
    )
    const analysis = analyzeTechnicalRetryFacts(facts, options.scope)
    const firstIssue = analysis.issues[0]
    if (firstIssue !== undefined) return yield* retryHistoryFailure(options.scope, firstIssue.detail)
    if (analysis.policy === undefined || JSON.stringify(analysis.policy) !== JSON.stringify(policy)) {
      return yield* retryHistoryFailure(options.scope, "captured technical retry policy changed during recovery")
    }
    return analysis.progress
  }
)

/** Converts virtual-clock time plus a positive delay into a safe absolute eligibility time. */
export const calculateTechnicalRetryNotBefore = (
  clockTime: number,
  delayMillis: TechnicalRetryDelayMillis,
  scope: TechnicalRetryScope
): Effect.Effect<TechnicalRetryNotBefore, TechnicalRetryScheduleOverflow> => {
  const notBefore = clockTime + delayMillis
  return Number.isSafeInteger(clockTime)
      && clockTime >= 0
      && Number.isSafeInteger(notBefore)
      && notBefore >= 0
    ? Effect.succeed(TechnicalRetryNotBefore.make(notBefore))
    : Effect.fail(
      new TechnicalRetryScheduleOverflow({
        clockTime: String(clockTime),
        delayMillis,
        scope
      })
    )
}

const runScheduledTechnicalInvocation = <A, RetryableError, R>(
  invocation: Effect.Effect<A, RetryableError, R>,
  options: DurableTechnicalRetryOptions<RetryableError>,
  policy: TechnicalRetryPolicy
): Effect.Effect<
  A,
  | RetryableError
  | JournalStoreContradiction
  | JournalStoreError
  | TechnicalRetryHistoryContradiction
  | TechnicalRetryRecoveryClockInvalid
  | TechnicalRetryScheduleOverflow,
  R
> =>
  Effect.gen(function*() {
    const progress = yield* readTechnicalRetryProgress(options, policy)
    const startOrdinal = progress.pendingDeferral?.retryOrdinal ?? progress.activeRetryOrdinal ?? 0
    const pendingSupersession = yield* Ref.make(progress.pendingDeferral)
    if (progress.pendingDeferral !== undefined) {
      const now = yield* Clock.currentTimeMillis
      if (!Number.isSafeInteger(now) || now < 0) {
        return yield* new TechnicalRetryRecoveryClockInvalid({
          clockTime: String(now),
          scope: options.scope
        })
      }
      yield* Effect.sleep(Duration.millis(Math.max(0, progress.pendingDeferral.notBefore - now)))
    }

    const invoke = Effect.gen(function*() {
      const deferral = yield* Ref.getAndSet(pendingSupersession, undefined)
      if (deferral !== undefined) {
        yield* options.journal.append(
          options.runId,
          technicalRetryDeferralSupersededRecordKey(options.scope, deferral.retryOrdinal),
          TechnicalRetryDeferralSupersededEvent.make({
            retryOrdinal: deferral.retryOrdinal,
            scope: options.scope,
            version: workflowJournalEventVersion
          })
        )
      }
      return yield* invocation
    })

    const remainingRetries = policy.limit - startOrdinal
    if (remainingRetries === 0) return yield* invoke
    const firstRemainingOrdinal = TechnicalRetryOrdinal.make(startOrdinal + 1)
    const schedule = Schedule.exponential(Duration.millis(technicalRetryDelayAt(policy, firstRemainingOrdinal))).pipe(
      Schedule.modifyDelay(({ duration }) =>
        Effect.succeed(Duration.min(duration, Duration.millis(policy.maximumDelayMillis)))
      ),
      Schedule.upTo({ times: remainingRetries }),
      Schedule.while(({ input }) => Effect.succeed(options.isRetryable(input))),
      Schedule.tap(({ attempt, duration, now }) =>
        Effect.gen(function*() {
          const delayMillis = TechnicalRetryDelayMillis.make(Duration.toMillis(duration))
          const retryOrdinal = TechnicalRetryOrdinal.make(startOrdinal + attempt)
          const notBefore = yield* calculateTechnicalRetryNotBefore(now, delayMillis, options.scope)
          const scheduled = TechnicalRetryScheduledEvent.make({
            delayMillis,
            notBefore,
            retryOrdinal,
            scope: options.scope,
            version: workflowJournalEventVersion
          })
          yield* options.journal.append(
            options.runId,
            technicalRetryScheduledRecordKey(options.scope, retryOrdinal),
            scheduled
          )
          yield* Ref.set(pendingSupersession, scheduled)
        })
      )
    )
    return yield* Effect.retry(invoke, schedule)
  })

/** Captures one active scope's retry policy before returning its executable schedule. */
export const captureTechnicalRetryPolicy = <RetryableError>(
  options: DurableTechnicalRetryOptions<RetryableError>
): Effect.Effect<
  CapturedTechnicalRetry<RetryableError>,
  JournalStoreContradiction | JournalStoreError | TechnicalRetryHistoryContradiction
> =>
  Effect.gen(function*() {
    const records = yield* options.journal.read(options.runId)
    const facts = records.flatMap(({ event }) =>
      (event._tag === "TechnicalRetryPolicyCaptured"
          || event._tag === "TechnicalRetryScheduled"
          || event._tag === "TechnicalRetryDeferralSuperseded")
        && event.scope.operationId === options.scope.operationId
        ? [event]
        : []
    )
    const analysis = analyzeTechnicalRetryFacts(facts, options.scope)
    const firstIssue = analysis.issues[0]
    if (firstIssue !== undefined) return yield* retryHistoryFailure(options.scope, firstIssue.detail)
    const policy = analysis.policy ?? options.policy ?? defaultTechnicalRetryPolicy
    if (analysis.policy === undefined) {
      yield* options.journal.append(
        options.runId,
        technicalRetryPolicyRecordKey(options.scope),
        TechnicalRetryPolicyCapturedEvent.make({
          policy,
          scope: options.scope,
          version: workflowJournalEventVersion
        })
      )
    }
    return {
      run: <A, R>(invocation: Effect.Effect<A, RetryableError, R>) =>
        runScheduledTechnicalInvocation(invocation, options, policy)
    }
  })

/** Captures policy and retries typed technical failures under one durable Effect schedule. */
export const retryTechnicalInvocation = <A, RetryableError, R>(
  invocation: Effect.Effect<A, RetryableError, R>,
  options: DurableTechnicalRetryOptions<RetryableError>
): Effect.Effect<
  A,
  | RetryableError
  | JournalStoreContradiction
  | JournalStoreError
  | TechnicalRetryHistoryContradiction
  | TechnicalRetryRecoveryClockInvalid
  | TechnicalRetryScheduleOverflow,
  R
> =>
  Effect.gen(function*() {
    const captured = yield* captureTechnicalRetryPolicy(options)
    return yield* captured.run(invocation)
  })
