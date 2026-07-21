import * as fc from "fast-check"
import { expect, it } from "vitest"
import { GithubIssueNodeId, GithubRepositoryNodeId } from "./github-graphql-client.js"
import { githubTaskIdFor } from "./github-task-identity.js"

const githubNodeId = fc.stringMatching(/^[A-Za-z0-9_-]{1,80}$/)
const opaqueTaskIdPrefix = "t1."

it("roundtrips opaque GitHub task identity across bounded provider IDs", () => {
  fc.assert(
    fc.property(githubNodeId, githubNodeId, (repositoryNodeId, issueNodeId) => {
      const taskId = githubTaskIdFor(
        GithubRepositoryNodeId.make(repositoryNodeId),
        GithubIssueNodeId.make(issueNodeId)
      )
      expect(taskId.startsWith(opaqueTaskIdPrefix)).toBe(true)
      const decoded = JSON.parse(
        Buffer.from(taskId.slice(opaqueTaskIdPrefix.length), "base64url").toString("utf8")
      )

      expect(decoded).toEqual([repositoryNodeId, issueNodeId])
    }),
    { numRuns: 100 }
  )
})
