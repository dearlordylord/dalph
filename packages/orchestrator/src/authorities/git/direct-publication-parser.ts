import { GitCommitSha, type RemotePublicationTarget } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import {
  RemotePublicationGitObservation,
  RemotePublicationObservationFailure,
  RemotePublicationPushFailure,
  RemotePublicationPushResult
} from "../../workflow/protocols/direct-publication/events.js"
import type { GitCommandResult } from "./command.js"

export const noMatchingRemoteRefExitCode = 2

const gitShaPattern = /^[0-9a-f]{40}$/u
const remoteAdvertisementFieldCount = 2

export const parseAdvertisedHead = (
  result: GitCommandResult,
  target: RemotePublicationTarget
): Effect.Effect<GitCommitSha, RemotePublicationObservationFailure> => {
  if (
    result.exitCode === noMatchingRemoteRefExitCode &&
    result.stdout.trim().length === 0 &&
    result.stderr.trim().length === 0
  ) {
    return Effect.fail(new RemotePublicationObservationFailure({ reason: "TargetUnreadable", target }))
  }
  if (result.exitCode !== 0) {
    return Effect.fail(new RemotePublicationObservationFailure({ reason: "TargetUnreadable", target }))
  }
  const lines = result.stdout.split(/\r?\n/u).filter((line) => line.length > 0)
  if (lines.length !== 1) {
    return Effect.fail(new RemotePublicationObservationFailure({ reason: "TargetUnreadable", target }))
  }
  const line = lines[0]
  /* v8 ignore next -- @preserve Filtering non-empty lines makes an absent first line unreachable. */
  if (line === undefined) {
    return Effect.fail(new RemotePublicationObservationFailure({ reason: "TargetUnreadable", target }))
  }
  const fields = line.split("\t")
  const [sha, ref] = fields
  if (
    fields.length !== remoteAdvertisementFieldCount ||
    sha === undefined ||
    ref !== target.branch ||
    !gitShaPattern.test(sha)
  ) {
    return Effect.fail(new RemotePublicationObservationFailure({ reason: "TargetUnreadable", target }))
  }
  return Schema.decodeUnknownEffect(GitCommitSha)(sha).pipe(
    Effect.mapError(() => new RemotePublicationObservationFailure({ reason: "TargetUnreadable", target }))
  )
}

export const classifyAncestry = (
  candidateToRemote: GitCommandResult,
  remoteToCandidate: GitCommandResult,
  mergeBase: GitCommandResult,
  candidateCommit: GitCommitSha,
  remoteHead: GitCommitSha,
  target: RemotePublicationTarget
): Effect.Effect<RemotePublicationGitObservation, RemotePublicationObservationFailure> => {
  if (remoteHead === candidateCommit) {
    return Effect.succeed(RemotePublicationGitObservation.cases.CandidateCurrent.make({ remoteHead }))
  }
  if (candidateToRemote.exitCode === 0) {
    return Effect.succeed(RemotePublicationGitObservation.cases.CandidateAncestor.make({ remoteHead }))
  }
  if (candidateToRemote.exitCode !== 1) {
    return Effect.fail(new RemotePublicationObservationFailure({ reason: "AncestryUnavailable", target }))
  }
  if (remoteToCandidate.exitCode === 0) {
    return Effect.succeed(RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({ remoteHead }))
  }
  if (remoteToCandidate.exitCode !== 1) {
    return Effect.fail(new RemotePublicationObservationFailure({ reason: "AncestryUnavailable", target }))
  }
  if (mergeBase.exitCode === 0) {
    const lines = mergeBase.stdout.split(/\r?\n/u).filter((line) => line.length > 0)
    const [mergeBaseSha] = lines
    if (
      lines.length !== 1 ||
      mergeBaseSha === undefined ||
      !gitShaPattern.test(mergeBaseSha) ||
      mergeBase.stderr.length > 0
    ) {
      return Effect.fail(new RemotePublicationObservationFailure({ reason: "AncestryUnavailable", target }))
    }
    return Effect.succeed(
      RemotePublicationGitObservation.cases.CompatibleCompetingHead.make({
        mergeBase: GitCommitSha.make(mergeBaseSha),
        remoteHead
      })
    )
  }
  if (mergeBase.exitCode === 1 && mergeBase.stdout.trim().length === 0 && mergeBase.stderr.trim().length === 0) {
    return Effect.succeed(RemotePublicationGitObservation.cases.IncompatibleLineage.make({ remoteHead }))
  }
  return Effect.fail(new RemotePublicationObservationFailure({ reason: "AncestryUnavailable", target }))
}

const safeText = (value: string): string => value.toLowerCase()

const isAuthenticationFailure = (value: string): boolean =>
  /authentication failed|permission denied|could not read username|access denied|repository not found/u.test(
    safeText(value)
  )

const isThrottleFailure = (value: string): boolean =>
  /rate limit|too many requests|temporarily unavailable|try again later|secondary rate/u.test(safeText(value))

export const parsePushResult = (
  result: GitCommandResult,
  candidateCommit: GitCommitSha,
  target: RemotePublicationTarget
): Effect.Effect<RemotePublicationPushResult, RemotePublicationPushFailure> => {
  const diagnostics = `${result.stdout}\n${result.stderr}`
  const lines = result.stdout.split(/\r?\n/u).filter((line) => line.length > 0)
  const statuses: Array<{ readonly flag: string; readonly refspec: string; readonly summary: string }> = []
  for (const line of lines) {
    if (line === "Done" || line.startsWith("To ")) continue
    const match = /^([* =!+-])\t([^\t]+)\t(.*)$/u.exec(line)
    if (match === null) {
      return Effect.fail(new RemotePublicationPushFailure({ reason: "TransportUnavailable", target }))
    }
    const [, flag, refspec, summary] = match
    if (flag === undefined || refspec === undefined || summary === undefined) {
      return Effect.fail(new RemotePublicationPushFailure({ reason: "TransportUnavailable", target }))
    }
    statuses.push({ flag, refspec, summary })
  }
  const expectedRefspec = `${candidateCommit}:${target.branch}`
  const status = statuses[0]
  if (status === undefined || statuses.length !== 1 || status.refspec !== expectedRefspec) {
    if (isThrottleFailure(diagnostics)) return Effect.succeed(RemotePublicationPushResult.cases.Throttled.make({}))
    if (isAuthenticationFailure(diagnostics)) {
      return Effect.succeed(RemotePublicationPushResult.cases.RejectedDefinite.make({ cause: "Authentication" }))
    }
    return Effect.fail(new RemotePublicationPushFailure({ reason: "TransportUnavailable", target }))
  }
  if (status.flag === "*" || status.flag === " ") {
    if (result.exitCode !== 0) {
      return Effect.fail(new RemotePublicationPushFailure({ reason: "TransportUnavailable", target }))
    }
    return Effect.succeed(RemotePublicationPushResult.cases.Applied.make({ remoteHead: candidateCommit }))
  }
  if (status.flag === "=") {
    if (result.exitCode !== 0) {
      return Effect.fail(new RemotePublicationPushFailure({ reason: "TransportUnavailable", target }))
    }
    return Effect.succeed(RemotePublicationPushResult.cases.UpToDate.make({ remoteHead: candidateCommit }))
  }
  if (status.flag !== "!") {
    return Effect.fail(new RemotePublicationPushFailure({ reason: "TransportUnavailable", target }))
  }
  const summary = safeText(status.summary)
  if (summary.includes("non-fast-forward") || summary.includes("fetch first")) {
    return Effect.succeed(RemotePublicationPushResult.cases.RejectedNonFastForward.make({}))
  }
  if (isThrottleFailure(`${status.summary}\n${result.stderr}`)) {
    return Effect.succeed(RemotePublicationPushResult.cases.Throttled.make({}))
  }
  if (summary.includes("[remote rejected]")) {
    return Effect.succeed(RemotePublicationPushResult.cases.RejectedDefinite.make({ cause: "Policy" }))
  }
  if (isAuthenticationFailure(`${status.summary}\n${result.stderr}`)) {
    return Effect.succeed(RemotePublicationPushResult.cases.RejectedDefinite.make({ cause: "Authentication" }))
  }
  return Effect.succeed(RemotePublicationPushResult.cases.RejectedDefinite.make({ cause: "Other" }))
}
