import { Schema } from "effect"
import { GithubLabelName, GithubLabelNodeId, GithubRepositoryNodeId } from "./graphql-client.js"

/** Complete GitHub repository-label evidence used by task claim adapters. */
const GithubClaimLabel = Schema.Struct({
  description: Schema.NonEmptyString,
  id: GithubLabelNodeId,
  name: GithubLabelName
})

/** GitHub may return GraphQL errors alongside an otherwise HTTP-successful response. */
export const GithubGraphqlErrors = Schema.Struct({
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String })))
})

/** Complete response for one deterministic repository-label lookup. */
export const FindClaimLabelResponse = Schema.Struct({
  data: Schema.Struct({
    node: Schema.NullOr(Schema.Struct({ id: GithubRepositoryNodeId, label: Schema.NullOr(GithubClaimLabel) }))
  })
})

/** Complete response proving GitHub created one repository-label record. */
export const CreateClaimLabelResponse = Schema.Struct({
  data: Schema.Struct({ createLabel: Schema.Struct({ label: GithubClaimLabel }) })
})

/** Complete response acknowledging deletion of one exact repository-label node. */
export const DeleteClaimLabelResponse = Schema.Struct({
  data: Schema.Struct({ deleteLabel: Schema.Struct({ clientMutationId: Schema.NullOr(Schema.String) }) })
})
