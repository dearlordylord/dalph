import type { ScenarioResult } from "./contracts.ts"

export type ScenarioVerification =
  | { readonly _tag: "ScenarioAccepted" }
  | { readonly _tag: "ScenarioRejected"; readonly reason: string }

const rejected = (reason: string): ScenarioVerification => ({ _tag: "ScenarioRejected", reason })

export const verifyAmbiguousClaimScenario = (result: ScenarioResult): ScenarioVerification => {
  if (result.attemptIds.length !== 0) return rejected("a task attempt was established before planning")
  if (result.executionIds.length !== 1) {
    return rejected("a rival Run execution was established")
  }
  const creates = result.providerCalls.filter(({ request }) => request === "GitHub.CreateClaim")
  if (creates.length !== 1) return rejected("the unsafe claim request did not occur exactly once")
  const createOrdinal = creates[0]?.ordinal ?? 0
  if (
    !result.providerCalls.some(
      ({ ordinal, request, result: observed }) =>
        ordinal > createOrdinal && request === "GitHub.ReadClaim" && observed === "Exact"
    )
  ) {
    return rejected("GitHub was not checked after the lost mutation response")
  }
  if (!result.providerCalls.some(({ request }) => request === "GitHub.ReadCurrentTaskFacts")) {
    return rejected("current task facts were not read before the recovered decision")
  }
  const intentIndex = result.canonicalTrace.findIndex(({ _tag }) => _tag === "TaskClaimAcquisitionIntended")
  const requestIndex = result.canonicalTrace.findIndex(({ _tag }) => _tag === "TaskClaimRequestApplied")
  if (intentIndex < 0 || requestIndex < 0 || intentIndex >= requestIndex) {
    return rejected("durable claim intent did not precede the unsafe request")
  }
  return result.recoveredDecision === "ContinueSameRun"
    ? { _tag: "ScenarioAccepted" }
    : rejected("the same Run did not continue")
}
