import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Exit, Schema } from "effect"
import { expect } from "vitest"
import {
  AuthoredCassetteStoryItem,
  AuthoredScenarioCassette,
  changedAttemptStopReleaseResponseLostAuthoredCassette,
  runAuthoredScenarioCassette
} from "../../src/cassettes/index.js"

const firstActiveReasonUnassertedCassette = () => {
  let replaced = false
  return Schema.decodeUnknownSync(AuthoredScenarioCassette)({
    ...changedAttemptStopReleaseResponseLostAuthoredCassette,
    name: "active coordinator return without a diagnostic reason assertion",
    story: changedAttemptStopReleaseResponseLostAuthoredCassette.story.map((item) => {
      if (!replaced && item._tag === "CoordinatorActivationReturned" && item.decision._tag === "RunMustRemainActive") {
        replaced = true
        return AuthoredCassetteStoryItem.cases.CoordinatorActivationReturned.make({
          decision: { _tag: "RunMustRemainActiveReasonUnasserted" }
        })
      }
      return item
    })
  })
}

const firstActiveTerminalCassette = () => {
  let replaced = false
  return Schema.decodeUnknownSync(AuthoredScenarioCassette)({
    ...changedAttemptStopReleaseResponseLostAuthoredCassette,
    name: "active coordinator return incorrectly claims termination",
    story: changedAttemptStopReleaseResponseLostAuthoredCassette.story.map((item) => {
      if (!replaced && item._tag === "CoordinatorActivationReturned" && item.decision._tag === "RunMustRemainActive") {
        replaced = true
        return AuthoredCassetteStoryItem.cases.CoordinatorActivationReturned.make({
          decision: { _tag: "RunMayTerminate" }
        })
      }
      return item
    })
  })
}

const firstActiveWrongReasonCassette = () => {
  let replaced = false
  return Schema.decodeUnknownSync(AuthoredScenarioCassette)({
    ...changedAttemptStopReleaseResponseLostAuthoredCassette,
    name: "active coordinator return with the wrong diagnostic reason",
    story: changedAttemptStopReleaseResponseLostAuthoredCassette.story.map((item) => {
      if (!replaced && item._tag === "CoordinatorActivationReturned" && item.decision._tag === "RunMustRemainActive") {
        replaced = true
        return AuthoredCassetteStoryItem.cases.CoordinatorActivationReturned.make({
          decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
        })
      }
      return item
    })
  })
}

const runAuthored = (input: unknown) => runAuthoredScenarioCassette(input).pipe(Effect.provide(NodeCrypto.layer))

it.effect("accepts RunMustRemainActive without asserting its diagnostic reason", () =>
  Effect.gen(function* () {
    const run = yield* runAuthored(firstActiveReasonUnassertedCassette())
    expect(run.activationOrdinals.length).toBeGreaterThan(0)
  })
)

it.effect("still requires RunMustRemainActive when an active return is reason-unasserted", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(runAuthored(firstActiveTerminalCassette()))
    expect(Exit.isFailure(result)).toBe(true)
  })
)

it.effect("keeps exact diagnostic reasons exact for ordinary active-return assertions", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(runAuthored(firstActiveWrongReasonCassette()))
    expect(Exit.isFailure(result)).toBe(true)
  })
)
