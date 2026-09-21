import { type GitRepositoryLocator, type RemotePublicationTarget } from "@dalph/contracts"
import { Effect, Layer } from "effect"
import { GitCommand } from "./command.js"
import {
  RemotePublicationGit,
  type RemotePublicationAttemptOrdinal,
  RemotePublicationAdmissionObservation,
  RemotePublicationObservationFailure,
  RemotePublicationGitObservation,
  type RemotePublicationGitRequest,
  RemotePublicationPushFailure
} from "../../workflow/protocols/direct-publication/events.js"
import {
  classifyAncestry,
  noMatchingRemoteRefExitCode,
  parseAdvertisedHead,
  parsePushResult
} from "./direct-publication-parser.js"
import {
  failureReasonForCommand,
  observationFailure,
  operationDeadline,
  pushFailure,
  remoteObservationTimeout,
  remotePushTimeout,
  repositoryFromRequest,
  resolvePinnedEndpoint,
  runBounded
} from "./direct-publication-command.js"

export { nodeGitRemoteBaselineLayer } from "./remote-baseline.js"

/**
 * Provider-neutral direct publication Git authority. The optional repository
 * argument is an immutable layer binding for the current protocol revision;
 * once the persisted request carries its repository, the request value is
 * accepted by `repositoryFromRequest` without changing this service surface.
 */
export const nodeGitDirectPublicationLayer = (configuredRepository?: GitRepositoryLocator) =>
  Layer.effect(
    RemotePublicationGit,
    Effect.gen(function* () {
      const commands = yield* GitCommand
      const admit = Effect.fn("RemotePublicationGit.Node.admit")(function* (target: RemotePublicationTarget) {
        if (configuredRepository === undefined) {
          return yield* new RemotePublicationObservationFailure({ reason: "TargetUnreadable", target })
        }
        const deadline = yield* operationDeadline(remoteObservationTimeout)
        const prefix = yield* resolvePinnedEndpoint(commands, configuredRepository, target, deadline).pipe(
          Effect.mapError((failure) => observationFailure(target, failure, "TargetUnreadable"))
        )
        const advertised = yield* runBounded(
          commands,
          configuredRepository,
          [...prefix, "ls-remote", "--exit-code", "--refs", "--heads", "--", target.endpoint, target.branch],
          deadline
        ).pipe(
          Effect.mapError(
            (failure) =>
              new RemotePublicationObservationFailure({
                reason: failureReasonForCommand(failure, "TargetUnreadable"),
                target
              })
          )
        )
        if (
          advertised.exitCode === noMatchingRemoteRefExitCode &&
          advertised.stdout.trim().length === 0 &&
          advertised.stderr.trim().length === 0
        ) {
          return RemotePublicationAdmissionObservation.cases.TargetMissing.make({})
        }
        const remoteHead = yield* parseAdvertisedHead(advertised, target)
        return RemotePublicationAdmissionObservation.cases.ExistingBranch.make({ remoteHead })
      })
      const observe = Effect.fn("RemotePublicationGit.Node.observe")(function* (request: RemotePublicationGitRequest) {
        const repository = repositoryFromRequest(request, configuredRepository)
        if (repository === undefined) {
          return yield* new RemotePublicationObservationFailure({ reason: "TargetUnreadable", target: request.target })
        }
        const deadline = yield* operationDeadline(remoteObservationTimeout)
        const prefix = yield* resolvePinnedEndpoint(commands, repository, request.target, deadline).pipe(
          Effect.mapError((failure) => observationFailure(request.target, failure, "TargetUnreadable"))
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
            request.target.endpoint,
            request.target.branch
          ],
          deadline
        ).pipe(
          Effect.mapError(
            (failure) =>
              new RemotePublicationObservationFailure({
                reason: failureReasonForCommand(failure, "TargetUnreadable"),
                target: request.target
              })
          )
        )
        if (
          advertised.exitCode === noMatchingRemoteRefExitCode &&
          advertised.stdout.trim().length === 0 &&
          advertised.stderr.trim().length === 0
        ) {
          return RemotePublicationGitObservation.cases.TargetMissing.make({})
        }
        const remoteHead = yield* parseAdvertisedHead(advertised, request.target)
        if (remoteHead === request.candidateCommit) {
          return RemotePublicationGitObservation.cases.CandidateCurrent.make({ remoteHead })
        }
        const refreshedPrefix = yield* resolvePinnedEndpoint(commands, repository, request.target, deadline).pipe(
          Effect.mapError((failure) => observationFailure(request.target, failure, "AncestryUnavailable"))
        )
        const fetched = yield* runBounded(
          commands,
          repository,
          [
            ...refreshedPrefix,
            "fetch",
            "--no-write-fetch-head",
            "--no-tags",
            "--recurse-submodules=no",
            "--",
            request.target.endpoint,
            remoteHead
          ],
          deadline
        ).pipe(
          Effect.mapError(
            (failure) =>
              new RemotePublicationObservationFailure({
                reason: failureReasonForCommand(failure, "AncestryUnavailable"),
                target: request.target
              })
          )
        )
        if (fetched.exitCode !== 0) {
          return yield* new RemotePublicationObservationFailure({
            reason: "AncestryUnavailable",
            target: request.target
          })
        }
        const candidateToRemote = yield* runBounded(
          commands,
          repository,
          ["merge-base", "--is-ancestor", request.candidateCommit, remoteHead],
          deadline
        ).pipe(
          Effect.mapError(
            (failure) =>
              new RemotePublicationObservationFailure({
                reason: failureReasonForCommand(failure, "AncestryUnavailable"),
                target: request.target
              })
          )
        )
        if (candidateToRemote.exitCode !== 1) {
          return yield* classifyAncestry(
            candidateToRemote,
            { exitCode: 1, stderr: "", stdout: "" },
            { exitCode: 1, stderr: "", stdout: "" },
            request.candidateCommit,
            remoteHead,
            request.target
          )
        }
        const remoteToCandidate = yield* runBounded(
          commands,
          repository,
          ["merge-base", "--is-ancestor", remoteHead, request.candidateCommit],
          deadline
        ).pipe(
          Effect.mapError(
            (failure) =>
              new RemotePublicationObservationFailure({
                reason: failureReasonForCommand(failure, "AncestryUnavailable"),
                target: request.target
              })
          )
        )
        if (remoteToCandidate.exitCode === 0) {
          return yield* classifyAncestry(
            candidateToRemote,
            remoteToCandidate,
            { exitCode: 1, stderr: "", stdout: "" },
            request.candidateCommit,
            remoteHead,
            request.target
          )
        }
        if (remoteToCandidate.exitCode !== 1) {
          return yield* classifyAncestry(
            candidateToRemote,
            remoteToCandidate,
            { exitCode: 1, stderr: "", stdout: "" },
            request.candidateCommit,
            remoteHead,
            request.target
          )
        }
        const mergeBase = yield* runBounded(
          commands,
          repository,
          ["merge-base", request.candidateCommit, remoteHead],
          deadline
        ).pipe(
          Effect.mapError(
            (failure) =>
              new RemotePublicationObservationFailure({
                reason: failureReasonForCommand(failure, "AncestryUnavailable"),
                target: request.target
              })
          )
        )
        return yield* classifyAncestry(
          candidateToRemote,
          remoteToCandidate,
          mergeBase,
          request.candidateCommit,
          remoteHead,
          request.target
        )
      })
      const push = Effect.fn("RemotePublicationGit.Node.push")(function* (
        request: RemotePublicationGitRequest,
        attemptOrdinal: RemotePublicationAttemptOrdinal
      ) {
        const repository = repositoryFromRequest(request, configuredRepository)
        if (repository === undefined) {
          return yield* new RemotePublicationPushFailure({ reason: "TransportUnavailable", target: request.target })
        }
        const deadline = yield* operationDeadline(remotePushTimeout)
        const prefix = yield* resolvePinnedEndpoint(commands, repository, request.target, deadline).pipe(
          Effect.mapError((failure) => pushFailure(request.target, failure))
        )
        const result = yield* runBounded(
          commands,
          repository,
          [
            ...prefix,
            "push",
            "--porcelain",
            "--no-follow-tags",
            "--recurse-submodules=no",
            "--",
            request.target.endpoint,
            `${request.candidateCommit}:${request.target.branch}`
          ],
          deadline,
          { requestId: request.requestId, attemptOrdinal }
        ).pipe(Effect.mapError((failure) => pushFailure(request.target, failure)))
        return yield* parsePushResult(result, request.candidateCommit, request.target)
      })
      return RemotePublicationGit.of({
        prepareSenderCustody: (request, attemptOrdinal) => {
          const prepare = commands.prepareSenderCustody
          return prepare === undefined
            ? Effect.fail(new RemotePublicationPushFailure({ reason: "SenderStopUnproven", target: request.target }))
            : prepare({ requestId: request.requestId, attemptOrdinal }).pipe(
                Effect.mapError(
                  () => new RemotePublicationPushFailure({ reason: "SenderStopUnproven", target: request.target })
                )
              )
        },
        reconcileSenderCustody: (request, attemptOrdinal) => {
          const reconcile = commands.reconcileSenderCustody
          return reconcile === undefined
            ? Effect.fail(new RemotePublicationPushFailure({ reason: "SenderStopUnproven", target: request.target }))
            : reconcile({ requestId: request.requestId, attemptOrdinal }).pipe(
                Effect.mapError(
                  () => new RemotePublicationPushFailure({ reason: "SenderStopUnproven", target: request.target })
                )
              )
        },
        admit,
        observe,
        push
      })
    })
  )
