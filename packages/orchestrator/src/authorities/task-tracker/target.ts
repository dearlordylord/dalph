import { type TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import { FixtureTarget } from "./fixture/target.js"
import { GithubIssueTarget } from "./github/target.js"

/** Selects one tracker-native root without turning provider fields into task-domain facts. */
export const TrackerTarget = Schema.Union([FixtureTarget, GithubIssueTarget])
export type TrackerTarget = typeof TrackerTarget.Type

export const exactTaskIdSetKey = (taskIds: ReadonlyArray<TaskId>): string => JSON.stringify([...taskIds].sort())

export const factFamilyCoverageMatchesExplicitTaskIds = (
  factFamilies: ReadonlyArray<{ readonly coverage: { readonly explicitlyCoveredTaskIds: ReadonlyArray<TaskId> } }>,
  explicitlyCoveredTaskIds: ReadonlyArray<TaskId>
): boolean =>
  factFamilies.every(
    ({ coverage }) =>
      exactTaskIdSetKey(coverage.explicitlyCoveredTaskIds) === exactTaskIdSetKey(explicitlyCoveredTaskIds)
  )

const taskTrackerObjectTargetKeysByIdentity = new WeakMap<object, string>()

/** Encoded target identity is immutable for one journal/recovery prefix. */
export const taskTrackerTargetKey = (target: TrackerTarget): string => {
  if (typeof target === "object") {
    const cached = taskTrackerObjectTargetKeysByIdentity.get(target)
    if (cached !== undefined) return cached
    const key = JSON.stringify(Schema.encodeUnknownSync(TrackerTarget)(target))
    taskTrackerObjectTargetKeysByIdentity.set(target, key)
    return key
  }
  // Fixture targets are primitive strings and may be unbounded across runs;
  // encoding them on demand avoids retaining every historical target forever.
  return JSON.stringify(Schema.encodeUnknownSync(TrackerTarget)(target))
}

export const factFamiliesCoverTarget = (
  factFamilies: ReadonlyArray<{ readonly coverage: { readonly target: TrackerTarget } }>,
  target: TrackerTarget
): boolean =>
  factFamilies.every(({ coverage }) => taskTrackerTargetKey(coverage.target) === taskTrackerTargetKey(target))
