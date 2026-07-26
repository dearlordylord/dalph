import { Effect } from "effect"
import { FixtureTarget, OperationId, RunId, TaskId, TrackerRevision } from "../../src/domain.js"
import {
  FrontierRecoveryConformanceIssue,
  FrontierRecoveryModelOperationId,
  FrontierRecoveryModelRevision,
  FrontierRecoveryModelTaskId
} from "./frontier-recovery-conformance.js"

export const frontierRecoveryRunId = RunId.make(
  "frontier-recovery-reconstruction-run"
)
export const frontierRecoveryTarget = FixtureTarget.make(
  "frontier-recovery-reconstruction-target"
)

/* eslint-disable no-magic-numbers -- Closed M2 identities are the versioned conformance manifest. */
export const modelTaskA = FrontierRecoveryModelTaskId.make(0n)
export const modelTaskB = FrontierRecoveryModelTaskId.make(1n)
export const modelTaskC = FrontierRecoveryModelTaskId.make(2n)
export const modelTaskD = FrontierRecoveryModelTaskId.make(3n)
export const initialGraphOperationIdentity = FrontierRecoveryModelOperationId.make(0n)
export const firstClaimOperationIdentity = FrontierRecoveryModelOperationId.make(1n)
export const targetClosureReplacementOperationIdentity = FrontierRecoveryModelOperationId.make(2n)
export const secondClaimOperationIdentity = FrontierRecoveryModelOperationId.make(3n)
export const initialModelRevision = FrontierRecoveryModelRevision.make(0n)
export const replacementModelRevision = FrontierRecoveryModelRevision.make(1n)
/* eslint-enable no-magic-numbers */

export const frontierRecoveryTaskEntries = [
  {
    branded: TaskId.make("frontier-recovery-task-A"),
    model: modelTaskA
  },
  {
    branded: TaskId.make("frontier-recovery-task-B"),
    model: modelTaskB
  },
  {
    branded: TaskId.make("frontier-recovery-task-C"),
    model: modelTaskC
  },
  {
    branded: TaskId.make("frontier-recovery-task-D"),
    model: modelTaskD
  }
] as const

export const initialGraphOperationId = OperationId.make(
  "frontier-recovery-graph-observation-0"
)

export const frontierRecoveryClaimOperationEntries = [
  {
    branded: OperationId.make("frontier-recovery-claim-operation-1"),
    model: firstClaimOperationIdentity
  },
  {
    branded: OperationId.make("frontier-recovery-claim-operation-3"),
    model: secondClaimOperationIdentity
  }
] as const

export const frontierRecoveryGraphObservationEntries = [
  initialGraphOperationIdentity,
  targetClosureReplacementOperationIdentity
].map((model) => ({
  branded: OperationId.make(`frontier-recovery-graph-observation-${model}`),
  model
}))

const trackerRevisionEntries = [
  {
    branded: TrackerRevision.make("frontier-recovery-revision-0"),
    model: initialModelRevision
  },
  {
    branded: TrackerRevision.make("frontier-recovery-revision-1"),
    model: replacementModelRevision
  }
] as const
const trackerRevisionByModel = new Map(
  trackerRevisionEntries.map(({ branded, model }) => [model, branded])
)
const modelRevisionByTracker = new Map(
  trackerRevisionEntries.map(({ branded, model }) => [branded, model])
)

const fixtureRevisionIssue = (revision: bigint | TrackerRevision) =>
  new FrontierRecoveryConformanceIssue({
    detail: `M2 reconstruction has no tracker revision mapping for ${revision}`,
    reason: "UnknownModelIdentity"
  })

export const trackerRevisionFromModel = (
  revision: FrontierRecoveryModelRevision
) => {
  const mapped = trackerRevisionByModel.get(revision)
  return mapped === undefined
    ? Effect.fail(fixtureRevisionIssue(revision))
    : Effect.succeed(mapped)
}

export const modelRevisionFromTracker = (revision: TrackerRevision) => {
  const mapped = modelRevisionByTracker.get(revision)
  return mapped === undefined
    ? Effect.fail(fixtureRevisionIssue(revision))
    : Effect.succeed(mapped)
}
