import { GitCommitSha } from "@dalph/contracts"
import { Effect, Layer, Schema } from "effect"
import { GitCommand } from "./command.js"
import {
  EndpointMappingUnstable,
  type EndpointResolutionFailure,
  failureReasonForCommand,
  operationDeadline,
  remoteObservationTimeout,
  resolvePinnedEndpoint,
  runBounded,
  type RemoteOperationDeadline
} from "./direct-publication-command.js"
import {
  LocalTargetCatchUpResult,
  RemoteBaselineFailure,
  RemoteBaselineGit,
  RemoteBaselineObservation,
  type RemoteBaselineCorrelation
} from "../../workflow/protocols/direct-publication/baseline-events.js"
import { noMatchingRemoteRefExitCode, parseAdvertisedHead } from "./direct-publication-parser.js"
import { proveLocalCatchUpSafe } from "./local-target-catch-up.js"

const baselineFailure = (
  failure: EndpointResolutionFailure,
  fallback: "AncestryUnavailable" | "TargetUnreadable"
): RemoteBaselineFailure =>
  new RemoteBaselineFailure({
    reason:
      failure instanceof EndpointMappingUnstable ? "EndpointMappingChanged" : failureReasonForCommand(failure, fallback)
  })

const decodeHead = (value: string): Effect.Effect<GitCommitSha, RemoteBaselineFailure> =>
  Schema.decodeUnknownEffect(GitCommitSha)(value.trim()).pipe(
    Effect.mapError(() => new RemoteBaselineFailure({ reason: "TargetUnreadable" }))
  )

/** Real Git authority for the journaled initial remote baseline and local compare-and-set catch-up. */
export const nodeGitRemoteBaselineLayer = Layer.effect(
  RemoteBaselineGit,
  Effect.gen(function* () {
    const commands = yield* GitCommand
    const readLocalHead = Effect.fn("RemoteBaselineGit.Node.readLocalHead")(function* (
      correlation: RemoteBaselineCorrelation,
      deadline: RemoteOperationDeadline
    ) {
      const result = yield* runBounded(
        commands,
        correlation.localTarget.repository,
        ["rev-parse", "--verify", "--quiet", `${correlation.localTarget.ref}^{commit}`],
        deadline
      ).pipe(Effect.mapError((failure) => baselineFailure(failure, "TargetUnreadable")))
      if (result.exitCode !== 0) return yield* new RemoteBaselineFailure({ reason: "TargetUnreadable" })
      return yield* decodeHead(result.stdout)
    })
    const catchUp = Effect.fn("RemoteBaselineGit.Node.catchUp")(function* (
      correlation: RemoteBaselineCorrelation,
      expectedLocalHead: GitCommitSha,
      remoteHead: GitCommitSha
    ) {
      const deadline = yield* operationDeadline(remoteObservationTimeout)
      yield* proveLocalCatchUpSafe(commands, correlation.localTarget, expectedLocalHead, remoteHead, deadline)
      const result = yield* runBounded(
        commands,
        correlation.localTarget.repository,
        ["update-ref", correlation.localTarget.ref, remoteHead, expectedLocalHead],
        deadline
      ).pipe(Effect.mapError((failure) => baselineFailure(failure, "TargetUnreadable")))
      if (result.exitCode === 0) return LocalTargetCatchUpResult.cases.Applied.make({ newHead: remoteHead })
      const observedHead = yield* readLocalHead(correlation, deadline)
      return observedHead === remoteHead
        ? LocalTargetCatchUpResult.cases.AlreadyCurrent.make({ currentHead: observedHead })
        : LocalTargetCatchUpResult.cases.Rejected.make({ observedHead })
    })
    const observe = Effect.fn("RemoteBaselineGit.Node.observe")(function* (correlation: RemoteBaselineCorrelation) {
      const repository = correlation.localTarget.repository
      const deadline = yield* operationDeadline(remoteObservationTimeout)
      const prefix = yield* resolvePinnedEndpoint(commands, repository, correlation.remoteTarget, deadline).pipe(
        Effect.mapError((failure) => baselineFailure(failure, "TargetUnreadable"))
      )
      const advertised = yield* runBounded(
        commands,
        repository,
        [
          ...prefix,
          "ls-remote",
          "--exit-code",
          "--refs",
          "--heads",
          "--",
          correlation.remoteTarget.endpoint,
          correlation.remoteTarget.branch
        ],
        deadline
      ).pipe(Effect.mapError((failure) => baselineFailure(failure, "TargetUnreadable")))
      if (
        advertised.exitCode === noMatchingRemoteRefExitCode &&
        advertised.stdout.trim().length === 0 &&
        advertised.stderr.trim().length === 0
      )
        return RemoteBaselineObservation.cases.RemoteMissing.make({})
      const remoteHead = yield* parseAdvertisedHead(advertised, correlation.remoteTarget).pipe(
        Effect.mapError(() => new RemoteBaselineFailure({ reason: "TargetUnreadable" }))
      )
      const fetched = yield* runBounded(
        commands,
        repository,
        [
          ...prefix,
          "fetch",
          "--no-write-fetch-head",
          "--no-tags",
          "--recurse-submodules=no",
          "--",
          correlation.remoteTarget.endpoint,
          remoteHead
        ],
        deadline
      ).pipe(Effect.mapError((failure) => baselineFailure(failure, "TargetUnreadable")))
      if (fetched.exitCode !== 0) return yield* new RemoteBaselineFailure({ reason: "TargetUnreadable" })
      const localHead = yield* readLocalHead(correlation, deadline)
      if (localHead === remoteHead) return RemoteBaselineObservation.cases.Aligned.make({ localHead, remoteHead })
      const localToRemote = yield* runBounded(
        commands,
        repository,
        ["merge-base", "--is-ancestor", localHead, remoteHead],
        deadline
      ).pipe(Effect.mapError((failure) => baselineFailure(failure, "AncestryUnavailable")))
      if (localToRemote.exitCode === 0) {
        return RemoteBaselineObservation.cases.LocalAncestor.make({ localHead, remoteHead })
      }
      if (localToRemote.exitCode !== 1) return yield* new RemoteBaselineFailure({ reason: "AncestryUnavailable" })
      const remoteToLocal = yield* runBounded(
        commands,
        repository,
        ["merge-base", "--is-ancestor", remoteHead, localHead],
        deadline
      ).pipe(Effect.mapError((failure) => baselineFailure(failure, "AncestryUnavailable")))
      if (remoteToLocal.exitCode === 0) {
        return RemoteBaselineObservation.cases.LocalAhead.make({ localHead, remoteHead })
      }
      if (remoteToLocal.exitCode !== 1) return yield* new RemoteBaselineFailure({ reason: "AncestryUnavailable" })
      const mergeBase = yield* runBounded(commands, repository, ["merge-base", localHead, remoteHead], deadline).pipe(
        Effect.mapError((failure) => baselineFailure(failure, "AncestryUnavailable"))
      )
      if (mergeBase.exitCode !== 0) return yield* new RemoteBaselineFailure({ reason: "AncestryUnavailable" })
      return RemoteBaselineObservation.cases.Diverged.make({ localHead, remoteHead })
    })
    const reconcileCatchUp = Effect.fn("RemoteBaselineGit.Node.reconcileCatchUp")(function* (
      correlation: RemoteBaselineCorrelation,
      expectedLocalHead: GitCommitSha,
      remoteHead: GitCommitSha
    ) {
      const deadline = yield* operationDeadline(remoteObservationTimeout)
      const current = yield* readLocalHead(correlation, deadline)
      if (current === remoteHead) return LocalTargetCatchUpResult.cases.AlreadyCurrent.make({ currentHead: current })
      if (current !== expectedLocalHead) return LocalTargetCatchUpResult.cases.Rejected.make({ observedHead: current })
      return yield* catchUp(correlation, expectedLocalHead, remoteHead)
    })
    return RemoteBaselineGit.of({ catchUp, observe, reconcileCatchUp })
  })
)
