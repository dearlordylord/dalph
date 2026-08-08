import { Schema } from "effect"

/** Identifies one exact Git commit used as a planned task attempt's base. */
export const GitCommitSha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)).pipe(Schema.brand("GitCommitSha"))
export type GitCommitSha = typeof GitCommitSha.Type

/** Locates the one exact worktree reserved for a planned task attempt. */
export const WorktreeLocator = Schema.NonEmptyString.pipe(Schema.brand("WorktreeLocator"))
export type WorktreeLocator = typeof WorktreeLocator.Type

/** Locates the exact Git branch ref reserved for a planned task attempt. */
const isValidTaskBranchRef = (ref: string): boolean => {
  if (!ref.startsWith("refs/heads/") || ref === "refs/heads/") return false
  if (
    ref.includes("..") ||
    ref.includes("//") ||
    ref.includes("@{") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    // oxlint-disable-next-line no-control-regex -- Git ref syntax rejects ASCII control characters.
    /[\u0000-\u0020\u007f~^:?*[\\]/.test(ref)
  )
    return false
  return ref.split("/").every((component) => !component.startsWith(".") && !component.endsWith(".lock"))
}

export const TaskBranchRef = Schema.String.check(
  Schema.makeFilter((ref) => (isValidTaskBranchRef(ref) ? undefined : "must be a valid refs/heads Git ref"))
).pipe(Schema.brand("TaskBranchRef"))
export type TaskBranchRef = typeof TaskBranchRef.Type

/** Locates one Git repository authority, not a task worktree or tracker target. */
export const GitRepositoryLocator = Schema.NonEmptyString.pipe(Schema.brand("GitRepositoryLocator"))
export type GitRepositoryLocator = typeof GitRepositoryLocator.Type

/** Names the exact Git branch ref to which one accepted-result stream is integrated. */
export const IntegrationTargetRef = Schema.String.check(
  Schema.makeFilter((ref) => (isValidTaskBranchRef(ref) ? undefined : "must be a valid refs/heads Git ref"))
).pipe(Schema.brand("IntegrationTargetRef"))
export type IntegrationTargetRef = typeof IntegrationTargetRef.Type

/** Binds one serialized integration stream to its exact repository and Git ref. */
export const IntegrationTarget = Schema.Struct({ repository: GitRepositoryLocator, ref: IntegrationTargetRef })
export type IntegrationTarget = typeof IntegrationTarget.Type
