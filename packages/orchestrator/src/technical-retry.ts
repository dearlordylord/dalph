import { Duration, Effect, Schedule, Schema } from "effect"
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
  "TechnicalRetryPolicyCaptured",
  {
    policy: TechnicalRetryPolicy,
    scope: TechnicalRetryScope,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Makes one failed invocation's exact next eligibility time durable before the schedule waits. */
export const TechnicalRetryScheduledEvent = Schema.TaggedStruct(
  "TechnicalRetryScheduled",
  {
    delayMillis: TechnicalRetryDelayMillis,
    notBefore: TechnicalRetryNotBefore,
    retryOrdinal: TechnicalRetryOrdinal,
    scope: TechnicalRetryScope,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

export const TechnicalRetryJournalEvent = Schema.Union([
  TechnicalRetryPolicyCapturedEvent,
  TechnicalRetryScheduledEvent
])

const scopeOperationId = (scope: TechnicalRetryScope): OperationId => scope.operationId

export const technicalRetryPolicyRecordKey = (scope: TechnicalRetryScope): JournalRecordKey =>
  JournalRecordKey.make(`operation:${scopeOperationId(scope)}:technical-retry-policy`)

export const technicalRetryScheduledRecordKey = (
  scope: TechnicalRetryScope,
  retryOrdinal: TechnicalRetryOrdinal
): JournalRecordKey => JournalRecordKey.make(`operation:${scopeOperationId(scope)}:technical-retry:${retryOrdinal}`)

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
    RetryableError | JournalStoreContradiction | JournalStoreError | TechnicalRetryScheduleOverflow,
    R
  >
}

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
  options: DurableTechnicalRetryOptions<RetryableError>
): Effect.Effect<
  A,
  RetryableError | JournalStoreContradiction | JournalStoreError | TechnicalRetryScheduleOverflow,
  R
> => {
  const policy = options.policy ?? defaultTechnicalRetryPolicy
  const schedule = Schedule.exponential(Duration.millis(policy.initialDelayMillis)).pipe(
    Schedule.modifyDelay(({ duration }) =>
      Effect.succeed(Duration.min(duration, Duration.millis(policy.maximumDelayMillis)))
    ),
    Schedule.upTo({ times: policy.limit }),
    Schedule.while(({ input }) => Effect.succeed(options.isRetryable(input))),
    Schedule.tap(({ attempt, duration, now }) =>
      Effect.gen(function*() {
        const delayMillis = TechnicalRetryDelayMillis.make(Duration.toMillis(duration))
        const retryOrdinal = TechnicalRetryOrdinal.make(attempt)
        const notBefore = yield* calculateTechnicalRetryNotBefore(now, delayMillis, options.scope)
        return yield* options.journal.append(
          options.runId,
          technicalRetryScheduledRecordKey(options.scope, retryOrdinal),
          TechnicalRetryScheduledEvent.make({
            delayMillis,
            notBefore,
            retryOrdinal,
            scope: options.scope,
            version: workflowJournalEventVersion
          })
        )
      })
    )
  )
  return Effect.retry(invocation, schedule)
}

/** Captures one active scope's retry policy before returning its executable schedule. */
export const captureTechnicalRetryPolicy = <RetryableError>(
  options: DurableTechnicalRetryOptions<RetryableError>
): Effect.Effect<
  CapturedTechnicalRetry<RetryableError>,
  JournalStoreContradiction | JournalStoreError
> => {
  const policy = options.policy ?? defaultTechnicalRetryPolicy
  return options.journal.append(
    options.runId,
    technicalRetryPolicyRecordKey(options.scope),
    TechnicalRetryPolicyCapturedEvent.make({
      policy,
      scope: options.scope,
      version: workflowJournalEventVersion
    })
  ).pipe(
    Effect.as({
      run: <A, R>(invocation: Effect.Effect<A, RetryableError, R>) =>
        runScheduledTechnicalInvocation(invocation, options)
    })
  )
}

/** Captures policy and retries typed technical failures under one durable Effect schedule. */
export const retryTechnicalInvocation = <A, RetryableError, R>(
  invocation: Effect.Effect<A, RetryableError, R>,
  options: DurableTechnicalRetryOptions<RetryableError>
): Effect.Effect<
  A,
  RetryableError | JournalStoreContradiction | JournalStoreError | TechnicalRetryScheduleOverflow,
  R
> =>
  Effect.gen(function*() {
    const captured = yield* captureTechnicalRetryPolicy(options)
    return yield* captured.run(invocation)
  })
