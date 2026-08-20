import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  idleRunCancellationAuthoredCassette,
  integrationRunCancellationAuthoredCassette,
  runAuthoredScenarioCassette,
  runningAttemptRunCancellationForeignClaimAuthoredCassette,
  runningAttemptRunCancellationAuthoredCassette
} from "../../src/cassettes/index.js"

/** Scenario mapping: Alice's idle CancelRun chronology uses the authored runner's production operator boundary. */
it.effect("cancels an idle Run after the durable direction and fresh graph read", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(idleRunCancellationAuthoredCassette)
    expect(run.records.filter(({ event }) => event._tag === "RunCancellationApplied")).toHaveLength(1)
    expect(run.records.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Cancelled" })
    expect(run.observedBehavior.protocolEvidence).toEqual([{ _tag: "RunCancellationApplied" }])
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("cancels a running exact attempt through suspension, claim release, and fresh classification", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runningAttemptRunCancellationAuthoredCassette)
    const eventTags = run.records.map(({ event }) => event._tag)
    expect(eventTags.filter((tag) => tag === "RunCancellationApplied")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(2)
    expect(eventTags.filter((tag) => tag === "CancelledAttemptImplementationResponsibilityRelinquished")).toHaveLength(
      1
    )
    expect(eventTags.filter((tag) => tag === "TaskClaimReleaseIntended")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "TaskClaimReleased")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "TaskWorktreeReady")).toHaveLength(1)
    expect(run.records.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Cancelled" })
    expect(eventTags).not.toContain("AttemptImplementationAbandoned")
    expect(eventTags).not.toContain("PlannedAttemptReplaced")
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("cancels after admitted integration settles without rollback or replacement", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(integrationRunCancellationAuthoredCassette)
    const eventTags = run.records.map(({ event }) => event._tag)
    expect(eventTags.filter((tag) => tag === "RunCancellationApplied")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "IntegrationResponsibilityBegan")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "IntegrationStarted")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "CompletionClaimDeleted")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "TaskClaimAcquired")).toHaveLength(1)
    expect(eventTags).not.toContain("AttemptImplementationAbandoned")
    expect(eventTags).not.toContain("PlannedAttemptReplaced")
    expect(eventTags).not.toContain("IntegrationRollbackStarted")
    expect(run.records.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Cancelled" })
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("cancels a running exact attempt without releasing a foreign claim", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runningAttemptRunCancellationForeignClaimAuthoredCassette)
    const eventTags = run.records.map(({ event }) => event._tag)
    expect(eventTags.filter((tag) => tag === "CancelledAttemptImplementationResponsibilityRelinquished")).toHaveLength(
      1
    )
    expect(eventTags.filter((tag) => tag === "CancelledAttemptClaimNoReleaseObserved")).toHaveLength(1)
    expect(eventTags).not.toContain("TaskClaimReleaseIntended")
    expect(eventTags).not.toContain("TaskClaimReleased")
    expect(eventTags).not.toContain("AttemptImplementationAbandoned")
    expect(eventTags).not.toContain("PlannedAttemptReplaced")
    expect(run.records.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Cancelled" })
  }).pipe(Effect.provide(NodeCrypto.layer))
)
