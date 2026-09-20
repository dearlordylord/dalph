import { Schema } from "effect"

/** Identifies one exact Git commit used as a planned task attempt's base. */
export const GitCommitSha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)).pipe(Schema.brand("GitCommitSha"))
export type GitCommitSha = typeof GitCommitSha.Type

/** Locates the one exact worktree reserved for a planned task attempt. */
export const WorktreeLocator = Schema.NonEmptyString.pipe(Schema.brand("WorktreeLocator"))
export type WorktreeLocator = typeof WorktreeLocator.Type

/** Locates the exact Git branch ref reserved for a planned task attempt. */
const hasInvalidTaskBranchShape = (ref: string): boolean =>
  ref.includes("..") || ref.includes("//") || ref.includes("@{") || ref.endsWith("/") || ref.endsWith(".")

const isValidTaskBranchComponent = (component: string): boolean =>
  !component.startsWith(".") && !component.endsWith(".lock")

const isValidTaskBranchRef = (ref: string): boolean => {
  if (!ref.startsWith("refs/heads/") || ref === "refs/heads/") return false
  if (hasInvalidTaskBranchShape(ref)) return false
  // oxlint-disable-next-line no-control-regex -- Git ref syntax rejects ASCII control characters.
  if (/[\u0000-\u0020\u007f~^:?*[\\]/.test(ref)) return false
  return ref.split("/").every(isValidTaskBranchComponent)
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

const hasInvalidRemotePublicationEndpointShape = (endpoint: string): boolean => {
  if (endpoint.trim().length === 0 || endpoint.startsWith("-")) return true
  // oxlint-disable-next-line no-control-regex -- Git endpoints reject ASCII control characters.
  if (/[\u0000-\u001f\u007f]/.test(endpoint)) return true
  // SCP-like SSH syntax has no URL parser branch; reject a password-bearing
  // userinfo prefix before it can be interpreted as a remote destination.
  if (/^[^@/\s:]+:[^@\s]*@[^:/\s]+:/u.test(endpoint)) return true

  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(endpoint)?.[0]?.replace(/:$/u, "").toLowerCase()
  if (scheme === "ext") return true

  try {
    const parsed = new URL(endpoint)
    if (parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) return true
    // HTTP(S) userinfo is commonly where access tokens are embedded. SSH's
    // ordinary public login name is allowed; password-bearing authority is not.
    if ((scheme === "http" || scheme === "https") && parsed.username.length > 0) return true
  } catch {
    // SCP-like SSH endpoints and canonical local paths are validated by the
    // configuration adapter after this credential-free boundary.
  }
  return false
}

/**
 * Identifies one resolved remote Git endpoint without embedded credentials.
 * Remote-name resolution and URL rewrite stability remain admission checks;
 * this boundary rejects secret-bearing URL components before persistence.
 */
export const RemotePublicationEndpoint = Schema.String.check(
  Schema.makeFilter((endpoint) =>
    hasInvalidRemotePublicationEndpointShape(endpoint) ? "must be a credential-free Git endpoint" : undefined
  )
).pipe(Schema.brand("RemotePublicationEndpoint"))
export type RemotePublicationEndpoint = typeof RemotePublicationEndpoint.Type

/** Names the exact fully qualified branch ref receiving one direct publication. */
export const RemotePublicationBranchRef = Schema.String.check(
  Schema.makeFilter((ref) => (isValidTaskBranchRef(ref) ? undefined : "must be a valid refs/heads Git ref"))
).pipe(Schema.brand("RemotePublicationBranchRef"))
export type RemotePublicationBranchRef = typeof RemotePublicationBranchRef.Type

/** Binds one credential-free remote endpoint to its exact publication branch. */
export const RemotePublicationTarget = Schema.Struct({
  branch: RemotePublicationBranchRef,
  endpoint: RemotePublicationEndpoint
})
export type RemotePublicationTarget = typeof RemotePublicationTarget.Type
