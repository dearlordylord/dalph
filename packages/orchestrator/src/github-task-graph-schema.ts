import { Schema } from "effect"
import { GithubCursor, GithubIssueNodeId, GithubRepositoryNodeId } from "./github-graphql-client.js"

const NodeReference = Schema.Struct({ id: GithubIssueNodeId })
const RepositoryReference = Schema.Struct({ id: GithubRepositoryNodeId })
const PageInfo = Schema.Struct({
  endCursor: Schema.NullOr(GithubCursor),
  hasNextPage: Schema.Boolean
})
export const IssueConnection = Schema.Struct({
  nodes: Schema.Array(NodeReference),
  pageInfo: PageInfo
})
export type IssueConnection = typeof IssueConnection.Type

const GraphqlError = Schema.Struct({ message: Schema.String })
export const GraphqlErrorsEnvelope = Schema.Struct({
  errors: Schema.optionalKey(Schema.Array(GraphqlError))
})

export const ResolveIssueResponse = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(Schema.Struct({
      id: GithubRepositoryNodeId,
      issue: Schema.NullOr(NodeReference)
    }))
  })
})

export const ReadIssueResponse = Schema.Struct({
  data: Schema.Struct({
    node: Schema.NullOr(Schema.Struct({
      __typename: Schema.Literal("Issue"),
      id: GithubIssueNodeId,
      parent: Schema.NullOr(NodeReference),
      repository: RepositoryReference,
      state: Schema.Literals(["CLOSED", "OPEN"]),
      stateReason: Schema.NullOr(
        Schema.Literals(["COMPLETED", "DUPLICATE", "NOT_PLANNED", "REOPENED"])
      )
    }))
  })
})

export const SubIssuesResponse = Schema.Struct({
  data: Schema.Struct({
    node: Schema.NullOr(Schema.Struct({
      __typename: Schema.Literal("Issue"),
      id: GithubIssueNodeId,
      subIssues: IssueConnection
    }))
  })
})

export const BlockedByResponse = Schema.Struct({
  data: Schema.Struct({
    node: Schema.NullOr(Schema.Struct({
      __typename: Schema.Literal("Issue"),
      blockedBy: IssueConnection,
      id: GithubIssueNodeId
    }))
  })
})
