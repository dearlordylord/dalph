import { Effect, Option, Schema } from "effect"
import {
  GithubGraphqlClient,
  type GithubGraphqlRequest,
  type GithubGraphqlRequestError,
  type GithubGraphqlResponse,
  type GithubGraphqlThrottled
} from "./graphql-client.js"
import { GithubGraphqlReadOperation, type GithubGraphqlReadThrottled } from "./graphql-read-throttle.js"

type GithubGraphqlReadRequest = Extract<GithubGraphqlRequest, { readonly _tag: GithubGraphqlReadOperation }>
type GithubGraphqlMutationRequest = Exclude<GithubGraphqlRequest, GithubGraphqlReadRequest>
type GithubGraphqlTestFailure = GithubGraphqlRequestError | GithubGraphqlReadThrottled | GithubGraphqlThrottled

const readOperation = Schema.decodeUnknownOption(GithubGraphqlReadOperation)
const isReadRequest = (request: GithubGraphqlRequest): request is GithubGraphqlReadRequest =>
  Option.isSome(readOperation(request._tag))

/** Keeps broad controlled interpreters honest at the production read/mutation error boundary. */
export const githubGraphqlTestClient = (
  interpret: (request: GithubGraphqlRequest) => Effect.Effect<GithubGraphqlResponse, GithubGraphqlTestFailure>
): GithubGraphqlClient["Service"] => {
  const executeRead = (request: GithubGraphqlReadRequest) =>
    interpret(request).pipe(
      Effect.catchTag("GithubGraphqlClient.Throttled", () =>
        Effect.die("GitHub GraphQL test interpreter emitted a mutation throttle for a read request")
      )
    )
  const executeMutation = (request: GithubGraphqlMutationRequest) =>
    interpret(request).pipe(
      Effect.catchTag("GithubGraphqlClient.ReadThrottled", () =>
        Effect.die("GitHub GraphQL test interpreter emitted a read throttle for a mutation request")
      )
    )

  function execute(
    request: GithubGraphqlReadRequest
  ): Effect.Effect<GithubGraphqlResponse, GithubGraphqlRequestError | GithubGraphqlReadThrottled>
  function execute(
    request: GithubGraphqlMutationRequest
  ): Effect.Effect<GithubGraphqlResponse, GithubGraphqlRequestError | GithubGraphqlThrottled>
  function execute(request: GithubGraphqlRequest): Effect.Effect<GithubGraphqlResponse, GithubGraphqlTestFailure>
  function execute(request: GithubGraphqlRequest) {
    return isReadRequest(request) ? executeRead(request) : executeMutation(request)
  }

  return GithubGraphqlClient.of({ execute })
}

const FieldEnvelope = Schema.Struct({
  data: Schema.optionalKey(Schema.NullOr(Schema.Struct({ node: Schema.Unknown }))),
  errors: Schema.optionalKey(Schema.Array(Schema.Unknown))
})

/** Controlled providers interpret each batch field against their existing independent task facts. */
export const interpretGithubGraphBatch = <E>(
  request: Extract<GithubGraphqlRequest, { readonly _tag: "ReadGraphBatch" }>,
  interpret: (request: GithubGraphqlRequest) => Effect.Effect<GithubGraphqlResponse, E>
): Effect.Effect<GithubGraphqlResponse, E> =>
  Effect.gen(function* () {
    const fields = yield* Effect.forEach(request.reads, (read) =>
      interpret(read).pipe(
        Effect.flatMap((response) => Schema.decodeUnknownEffect(FieldEnvelope)(response.body).pipe(Effect.orDie))
      )
    )
    return {
      body: {
        data: Object.fromEntries(fields.map((field, index) => [`field${index}`, field.data?.node ?? null])),
        errors: fields.flatMap((field) => field.errors ?? [])
      }
    }
  })

/** Explicit batch-capable provider for tests whose facts are defined one field at a time. */
export const githubGraphqlBatchTestClient = (
  interpret: (request: GithubGraphqlRequest) => Effect.Effect<GithubGraphqlResponse, GithubGraphqlTestFailure>
): GithubGraphqlClient["Service"] =>
  githubGraphqlTestClient((request) =>
    request._tag === "ReadGraphBatch" ? interpretGithubGraphBatch(request, interpret) : interpret(request)
  )
