import {
  GitCommitSha,
  RemotePublicationBranchRef,
  RemotePublicationEndpoint,
  RemotePublicationTarget
} from "@dalph/contracts"
import { Effect, Layer } from "effect"
import {
  RemotePublicationAdmissionObservation,
  RemotePublicationGit,
  RemotePublicationGitObservation,
  RemotePublicationPushResult
} from "../../src/workflow/protocols/direct-publication/events.js"
import {
  LocalTargetCatchUpResult,
  RemoteBaselineGit,
  RemoteBaselineObservation
} from "../../src/workflow/protocols/direct-publication/baseline-events.js"

const gitShaHexLength = 40

/** Explicit simulated destination used by journal fixtures; production code supplies the real Run pin. */
export const remotePublicationTargetForTest = RemotePublicationTarget.make({
  branch: RemotePublicationBranchRef.make("refs/heads/main"),
  endpoint: RemotePublicationEndpoint.make("ssh://git@example.invalid/repository.git")
})

/** Controlled Git authority for fixtures that only need deterministic admission and proof. */
export const remotePublicationGitLayerForTest = Layer.succeed(
  RemotePublicationGit,
  RemotePublicationGit.of({
    admit: () =>
      Effect.succeed(
        RemotePublicationAdmissionObservation.cases.ExistingBranch.make({
          remoteHead: GitCommitSha.make("0".repeat(gitShaHexLength))
        })
      ),
    observe: ({ candidateCommit }) =>
      Effect.succeed(RemotePublicationGitObservation.cases.CandidateCurrent.make({ remoteHead: candidateCommit })),
    prepareSenderCustody: () => Effect.void,
    reconcileSenderCustody: () => Effect.void,
    push: ({ candidateCommit }) =>
      Effect.succeed(RemotePublicationPushResult.cases.UpToDate.make({ remoteHead: candidateCommit }))
  })
)

/** Service layer alias for production-boundary tests that replace the live direct-publication authority. */
export const remotePublicationGitLayerForProductionTest = remotePublicationGitLayerForTest

/** Deterministic already-aligned baseline authority for runtime tests unrelated to baseline divergence. */
export const remoteBaselineGitLayerForTest = Layer.succeed(
  RemoteBaselineGit,
  RemoteBaselineGit.of({
    catchUp: (_correlation, _expectedLocalHead, remoteHead) =>
      Effect.succeed(LocalTargetCatchUpResult.cases.AlreadyCurrent.make({ currentHead: remoteHead })),
    observe: () => {
      const head = GitCommitSha.make("0".repeat(gitShaHexLength))
      return Effect.succeed(RemoteBaselineObservation.cases.Aligned.make({ localHead: head, remoteHead: head }))
    },
    reconcileCatchUp: (_correlation, _expectedLocalHead, remoteHead) =>
      Effect.succeed(LocalTargetCatchUpResult.cases.AlreadyCurrent.make({ currentHead: remoteHead }))
  })
)
