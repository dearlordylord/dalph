import type { GithubGraphqlRequest } from "@dalph/orchestrator"

/** Translate the controlled tracker request into the maintained hermetic provider operation. */
export const runningHostProviderBody = (request: GithubGraphqlRequest) => {
  if (request._tag === "ResolveIssue")
    return {
      query: "query ResolveIssue($fixture: String!) { fixture }",
      variables: {
        owner: request.target.owner,
        repository: request.target.repository,
        issueNumber: request.target.issueNumber
      }
    }
  const { _tag, ...variables } = request
  return { query: `query ${_tag}($fixture: String!) { fixture }`, variables }
}
