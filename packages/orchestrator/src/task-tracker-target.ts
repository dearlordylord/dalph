import { Schema } from "effect"
import { type TaskId, TrackerTarget } from "./domain.js"

export const exactTaskIdSetKey = (taskIds: ReadonlyArray<TaskId>): string => JSON.stringify([...taskIds].sort())

export const factFamilyCoverageMatchesExplicitTaskIds = (
  factFamilies: ReadonlyArray<{ readonly coverage: { readonly explicitlyCoveredTaskIds: ReadonlyArray<TaskId> } }>,
  explicitlyCoveredTaskIds: ReadonlyArray<TaskId>
): boolean =>
  factFamilies.every(
    ({ coverage }) =>
      exactTaskIdSetKey(coverage.explicitlyCoveredTaskIds) === exactTaskIdSetKey(explicitlyCoveredTaskIds)
  )

export const taskTrackerTargetKey = (target: typeof TrackerTarget.Type): string =>
  JSON.stringify(Schema.encodeUnknownSync(TrackerTarget)(target))

export const factFamiliesCoverTarget = (
  factFamilies: ReadonlyArray<{ readonly coverage: { readonly target: typeof TrackerTarget.Type } }>,
  target: typeof TrackerTarget.Type
): boolean =>
  factFamilies.every(({ coverage }) => taskTrackerTargetKey(coverage.target) === taskTrackerTargetKey(target))
