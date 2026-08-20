import { type TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import { FixtureTarget } from "./fixture/target.js"
import { GithubIssueTarget } from "./github/target.js"

/** Selects one tracker-native root without turning provider fields into task-domain facts. */
export const TrackerTarget = Schema.Union([FixtureTarget, GithubIssueTarget])
export type TrackerTarget = typeof TrackerTarget.Type

/** Canonical set identity for task IDs; ordering and duplicate-free schema facts are ignored. */
export const exactTaskIdSetKey = (taskIds: ReadonlyArray<TaskId>): string =>
  [...taskIds]
    .sort()
    .map((taskId) => `${taskId.length}:${taskId}`)
    .join("|")

export const factFamilyCoverageMatchesExplicitTaskIds = (
  factFamilies: ReadonlyArray<{ readonly coverage: { readonly explicitlyCoveredTaskIds: ReadonlyArray<TaskId> } }>,
  explicitlyCoveredTaskIds: ReadonlyArray<TaskId>
): boolean =>
  factFamilies.every(
    ({ coverage }) =>
      exactTaskIdSetKey(coverage.explicitlyCoveredTaskIds) === exactTaskIdSetKey(explicitlyCoveredTaskIds)
  )

/** Canonical tracker-target identity used for domain equality and map keys. */
export const taskTrackerTargetKey = (target: TrackerTarget): string => {
  if (typeof target === "string") return `FixtureTarget:${target.length}:${target}`
  return [
    "GithubIssue",
    `${target.owner.length}:${target.owner}`,
    `${target.repository.length}:${target.repository}`,
    String(target.issueNumber)
  ].join("|")
}

export const factFamiliesCoverTarget = (
  factFamilies: ReadonlyArray<{ readonly coverage: { readonly target: TrackerTarget } }>,
  target: TrackerTarget
): boolean =>
  factFamilies.every(({ coverage }) => taskTrackerTargetKey(coverage.target) === taskTrackerTargetKey(target))
