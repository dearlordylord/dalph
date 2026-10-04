import { type Request, tagged } from "effect/Request"
import { githubGraphBatchSize } from "./read-limits.js"
import { Effect, Exit, RequestResolver, Schema } from "effect"
import { type TrackerAdapterReadError } from "../graph-reader.js"
import { type GithubGraphFieldRead, GithubGraphqlRequest, type GithubGraphqlResponse } from "./graphql-client.js"
import { decodeResponse, incomplete, type GithubTrackerGraphReadRequest } from "./read-boundary.js"

interface GraphFieldRequest extends Request<GithubGraphqlResponse, TrackerAdapterReadError> {
  readonly _tag: "GraphFieldRequest"
  readonly read: GithubGraphFieldRead
}
const GraphFieldRequest = tagged<GraphFieldRequest>("GraphFieldRequest")
const BatchResponse = Schema.Struct({ data: Schema.Record(Schema.String, Schema.Unknown) })

/** One resolver per logical read. Its results never survive a failed or completed observation. */
export const makeGraphBatchExecute = (
  execute: (request: GithubTrackerGraphReadRequest) => Effect.Effect<GithubGraphqlResponse, TrackerAdapterReadError>
) => {
  const resolver = RequestResolver.make<GraphFieldRequest>((entries) =>
    Effect.gen(function* () {
      const response = yield* execute(
        GithubGraphqlRequest.cases.ReadGraphBatch.make({ reads: entries.map(({ request }) => request.read) })
      )
      // Reject errors anywhere in the batch before completing even one field.
      const decoded = yield* decodeResponse(BatchResponse, "GithubTrackerGraphReader.readIssue", response)
      for (const [index] of entries.entries()) {
        if (!Object.hasOwn(decoded.data, `field${index}`)) {
          return yield* incomplete("GithubTrackerGraphReader.readIssue", `GitHub omitted requested batch field${index}`)
        }
      }
      for (const [index, entry] of entries.entries()) {
        entry.completeUnsafe(Exit.succeed({ body: { data: { node: decoded.data[`field${index}`] } } }))
      }
    })
  ).pipe(RequestResolver.batchN(githubGraphBatchSize))
  return (read: GithubGraphFieldRead) => Effect.request(GraphFieldRequest({ read }), resolver)
}
