import { GithubGraphqlRequest } from "@dalph/orchestrator"
import { Effect, Schema } from "effect"

const GraphqlBody = Schema.Struct({
  query: Schema.NonEmptyString,
  variables: Schema.Record(Schema.String, Schema.Unknown)
})

/** Decodes the actual serialized graph aliases as well as single named fixture requests. */
export const decodeHermeticGraphqlRequest = Effect.fn("HermeticProvider.decodeGraphqlRequest")(function* (
  input: unknown
) {
  const body = yield* Schema.decodeUnknownEffect(GraphqlBody)(input)
  const operation = /^(?:query|mutation) ([A-Za-z]+)\(/u.exec(body.query)?.[1]
  return yield* Schema.decodeUnknownEffect(GithubGraphqlRequest)(
    operation === "ResolveIssue"
      ? { _tag: operation, target: { ...body.variables, _tag: "GithubIssue" } }
      : operation === "ReadGraphBatch" && body.variables["reads"] === undefined
        ? {
            _tag: operation,
            reads: [
              ...body.query.matchAll(/field(\d+): node\(id: \$id\d+\) \{ \.\.\. on Issue \{ __typename id ([^}]+)/gu)
            ].map((match) => {
              const index = match[1]
              const fields = match[2] ?? ""
              return {
                _tag: /\bstateReason\(/u.test(fields)
                  ? "ReadIssue"
                  : fields.startsWith("blockedBy(")
                    ? "ReadBlockedBy"
                    : "ReadSubIssues",
                issueNodeId: body.variables[`id${index}`],
                cursor: body.variables[`cursor${index}`] ?? null
              }
            })
          }
        : { ...body.variables, _tag: operation }
  )
})
