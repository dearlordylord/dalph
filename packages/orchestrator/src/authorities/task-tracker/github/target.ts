import { Schema } from "effect"

/** Identifies one GitHub issue ordinal within a repository, not its stable task identity. */
export const GithubIssueNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("GithubIssueNumber")
)
export type GithubIssueNumber = typeof GithubIssueNumber.Type

/** Identifies a GitHub repository owner only at the adapter target boundary. */
export const GithubRepositoryOwner = Schema.NonEmptyString.pipe(Schema.brand("GithubRepositoryOwner"))
export type GithubRepositoryOwner = typeof GithubRepositoryOwner.Type

/** Identifies a GitHub repository name only at the adapter target boundary. */
export const GithubRepositoryName = Schema.NonEmptyString.pipe(Schema.brand("GithubRepositoryName"))
export type GithubRepositoryName = typeof GithubRepositoryName.Type

/** Names one GitHub issue-root query; it is interpreted only by the GitHub tracker adapter. */
export const GithubIssueTarget = Schema.TaggedStruct("GithubIssue", {
  issueNumber: GithubIssueNumber,
  owner: GithubRepositoryOwner,
  repository: GithubRepositoryName
})
export type GithubIssueTarget = typeof GithubIssueTarget.Type
