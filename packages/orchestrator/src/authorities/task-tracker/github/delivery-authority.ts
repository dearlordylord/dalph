import { type Crypto, Layer } from "effect"
import type { TrackerMutation } from "../claim-mutation.js"
import type { TrackerGraphReader } from "../graph-reader.js"
import type { CompletionClaimBoundary } from "../../../workflow/protocols/integration-finality/completion-claim.js"
import type { CompletionTaskBoundary } from "../../../workflow/protocols/integration-finality/events.js"
import { githubTrackerMutationLayer } from "./claim-mutation.js"
import { githubCompletionClaimBoundaryLayer } from "./completion-claim.js"
import { githubCompletionTaskBoundaryLayer } from "./completion-task.js"
import { githubTrackerGraphReaderLayer } from "./graph-reader.js"
import type { GithubGraphqlClient } from "./graphql-client.js"

const githubCompletionAuthorityLayer = githubCompletionTaskBoundaryLayer.pipe(
  Layer.provideMerge(githubCompletionClaimBoundaryLayer)
)

/**
 * Supplies GitHub's complete delivery-time tracker authority from one already-built
 * GraphQL client. Workflow intent, retry, confirmation, and cleanup order remain in
 * the provider-neutral protocols that consume these four capabilities.
 */
export const githubDeliveryAuthorityLayer: Layer.Layer<
  TrackerGraphReader | TrackerMutation | CompletionClaimBoundary | CompletionTaskBoundary,
  never,
  GithubGraphqlClient | Crypto.Crypto
> = Layer.mergeAll(githubTrackerGraphReaderLayer, githubTrackerMutationLayer, githubCompletionAuthorityLayer)
