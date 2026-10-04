import type { GithubGraphqlRequest } from "./graphql-client.js"

export const graphBatchRequestBody = (
  request: Extract<GithubGraphqlRequest, { readonly _tag: "ReadGraphBatch" }>,
  connectionPageSize: number
) => ({
  query: `query ReadGraphBatch(${request.reads
    .map((read, index) => `$id${index}: ID!${read._tag === "ReadIssue" ? "" : `, $cursor${index}: String`}`)
    .join(", ")}${request.reads.some((read) => read._tag !== "ReadIssue") ? ", $pageSize: Int!" : ""}) { ${request.reads
    .map((read, index) => {
      const fields =
        read._tag === "ReadIssue"
          ? "state stateReason(enableDuplicate: true) repository { id } parent { id }"
          : `${read._tag === "ReadBlockedBy" ? "blockedBy" : "subIssues"}(first: $pageSize, after: $cursor${index}) { nodes { id } pageInfo { hasNextPage endCursor } }`
      return `field${index}: node(id: $id${index}) { ... on Issue { __typename id ${fields} } }`
    })
    .join(" ")} }`,
  variables: Object.fromEntries([
    ...(request.reads.some((read) => read._tag !== "ReadIssue") ? [["pageSize", connectionPageSize]] : []),
    ...request.reads.flatMap((read, index) => [
      [`id${index}`, read.issueNodeId],
      ...(read._tag === "ReadIssue" ? [] : [[`cursor${index}`, read.cursor]])
    ])
  ])
})
