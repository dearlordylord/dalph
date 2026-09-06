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

type CoordinatorFinalityExpectation =
  (typeof AuthoredCassetteStoryItem.cases.CoordinatorActivationReturned.Type)["decision"]

const activeReturnCassette = (name: string, firstDecision: CoordinatorFinalityExpectation) => {
  let replaced = false
  return Schema.decodeUnknownSync(AuthoredScenarioCassette)({
    ...changedAttemptStopReleaseResponseLostAuthoredCassette,
    name,
    story: changedAttemptStopReleaseResponseLostAuthoredCassette.story.map((item) => {
      if (!replaced && item._tag === "CoordinatorActivationReturned" && item.decision._tag === "RunMustRemainActive") {
        replaced = true
        return AuthoredCassetteStoryItem.cases.CoordinatorActivationReturned.make({ decision: firstDecision })
      }
      return item._tag === "CoordinatorActivationReturned" && item.decision._tag === "RunMustRemainActive"
        ? AuthoredCassetteStoryItem.cases.CoordinatorActivationReturned.make({
            decision: { _tag: "RunMustRemainActiveReasonUnasserted" }
          })
        : item
    })
  })
}

const firstActiveReasonUnassertedCassette = () =>
  activeReturnCassette("active coordinator return without a diagnostic reason assertion", {
    _tag: "RunMustRemainActiveReasonUnasserted"
  })

const firstActiveTerminalCassette = () =>
  activeReturnCassette("active coordinator return incorrectly claims termination", { _tag: "RunMayTerminate" })

const firstActiveExactReasonCassette = (
  reason: Extract<CoordinatorFinalityExpectation, { readonly _tag: "RunMustRemainActive" }>["reason"]
) =>
  activeReturnCassette(`active coordinator return asserting exact diagnostic reason ${reason}`, {
    _tag: "RunMustRemainActive",
    reason
  })

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
    const exactReasons = ["RunnableTransition", "TrackerTargetUnsettled", "UnsettledResponsibility"] as const
    const results = yield* Effect.forEach(exactReasons, (reason) =>
      Effect.exit(runAuthored(firstActiveExactReasonCassette(reason)))
    )

    expect(results.filter(Exit.isSuccess)).toHaveLength(1)
    expect(results.filter(Exit.isFailure)).toHaveLength(2)
  })
)
