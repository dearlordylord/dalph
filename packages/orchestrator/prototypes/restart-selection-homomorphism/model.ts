/**
 * PROTOTYPE QUESTION:
 * Given identical durable history and fresh authority observations, must
 * uninterrupted and restarted coordination select the same next operation?
 */

export interface Scenario {
  readonly capacityAvailable: boolean
  readonly claim: "Exact" | "Foreign" | "Missing"
  readonly claimIntentRecorded: boolean
  readonly paused: boolean
  readonly prerequisitesComplete: boolean
  readonly taskOpen: boolean
}

interface ReconstructedState extends Scenario {
  readonly responsibleForTaskA: boolean
}

export type NextOperation =
  | "IsolateTaskA:ForeignClaim"
  | "NoOperation:NoResponsibility"
  | "ReconcileTaskA:MissingClaim"
  | "SettleTaskA:TaskClosed"
  | "StartTaskA"
  | "WaitTaskA:CapacityFull"
  | "WaitTaskA:Paused"
  | "WaitTaskA:PrerequisiteIncomplete"

export interface Comparison {
  readonly completeRestart: NextOperation
  readonly currentIssue144Restart: "StopsAfterReconstruction"
  readonly homomorphic: boolean
  readonly uninterrupted: NextOperation
}

export const initialScenario: Scenario = {
  capacityAvailable: true,
  claim: "Exact",
  claimIntentRecorded: true,
  paused: false,
  prerequisitesComplete: true,
  taskOpen: true
}

const reconstruct = (scenario: Scenario): ReconstructedState => ({
  ...scenario,
  responsibleForTaskA: scenario.claimIntentRecorded
})

const selectNextOperation = (
  state: ReconstructedState
): NextOperation => {
  if (!state.responsibleForTaskA) return "NoOperation:NoResponsibility"
  if (state.paused) return "WaitTaskA:Paused"
  if (!state.taskOpen) return "SettleTaskA:TaskClosed"
  if (state.claim === "Foreign") return "IsolateTaskA:ForeignClaim"
  if (state.claim === "Missing") return "ReconcileTaskA:MissingClaim"
  if (!state.prerequisitesComplete) {
    return "WaitTaskA:PrerequisiteIncomplete"
  }
  if (!state.capacityAvailable) return "WaitTaskA:CapacityFull"
  return "StartTaskA"
}

export const comparePaths = (scenario: Scenario): Comparison => {
  const uninterruptedState = reconstruct(scenario)

  // A restart discards the process-local projection and rebuilds it from the
  // same journal facts plus the same fresh authority observations.
  const restartedState = reconstruct(structuredClone(scenario))
  const uninterrupted = selectNextOperation(uninterruptedState)
  const completeRestart = selectNextOperation(restartedState)

  return {
    completeRestart,
    currentIssue144Restart: "StopsAfterReconstruction",
    homomorphic: uninterrupted === completeRestart,
    uninterrupted
  }
}
