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
