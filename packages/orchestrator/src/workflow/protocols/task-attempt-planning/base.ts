import { GitCommitSha, GitRepositoryLocator, IntegrationTarget } from "@dalph/contracts"
import { Schema } from "effect"

/** Run-owned selection rule; Git remains the authority for each selected commit. */
export const AttemptBasePolicy = Schema.TaggedUnion({
  QualifiedCurrentIntegrationHead: {
    executionRepository: GitRepositoryLocator,
    integrationTarget: IntegrationTarget,
    lineageAnchor: GitCommitSha
  },
  /** Explicit controlled-fixture policy, never selected by production configuration. */
  ExplicitFixedBase: { baseSha: GitCommitSha }
})
export type AttemptBasePolicy = typeof AttemptBasePolicy.Type

/** One read's closed result, including which Git boundary refused qualification. */
export const TaskAttemptBaseObservation = Schema.TaggedUnion({
  Qualified: { baseSha: GitCommitSha },
  Refused: { boundary: Schema.Literals(["TargetHead", "AnchorAncestry", "ExecutionCommit"]), detail: Schema.String }
})
export type TaskAttemptBaseObservation = typeof TaskAttemptBaseObservation.Type
