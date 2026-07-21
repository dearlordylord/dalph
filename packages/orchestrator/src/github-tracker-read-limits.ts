import { Schema } from "effect"

/** Caps distinct tasks admitted to one GitHub tracker target closure. */
const GithubSnapshotTaskLimit = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1)
).pipe(Schema.brand("GithubSnapshotTaskLimit"))

/** Caps pages consumed from one GitHub issue relation connection. */
const GithubConnectionPageLimit = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1)
).pipe(Schema.brand("GithubConnectionPageLimit"))

// Bounded-read policy owner: https://github.com/dearlordylord/dalph/issues/42
const maximumGithubSnapshotTaskCount = 1_000
const maximumGithubConnectionPageCount = 10
export const githubSnapshotTaskLimit = GithubSnapshotTaskLimit.make(
  maximumGithubSnapshotTaskCount
)
export const githubConnectionPageLimit = GithubConnectionPageLimit.make(
  maximumGithubConnectionPageCount
)
