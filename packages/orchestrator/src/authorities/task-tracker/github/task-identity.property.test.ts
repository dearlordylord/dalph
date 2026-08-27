import * as fc from "fast-check"
import { Effect, Encoding } from "effect"
import { expect, it } from "vitest"
import { TaskId } from "@dalph/contracts"
import { GithubIssueNodeId, GithubRepositoryNodeId } from "./graphql-client.js"
import { decodeGithubTaskId, githubTaskIdFor } from "./task-identity.js"

const githubNodeId = fc.stringMatching(/^[A-Za-z0-9_-]{1,80}$/)
const opaqueTaskIdPrefix = "t1."

it("roundtrips opaque GitHub task identity across bounded provider IDs", () => {
  fc.assert(
    fc.property(githubNodeId, githubNodeId, (repositoryNodeId, issueNodeId) => {
      const taskId = githubTaskIdFor(GithubRepositoryNodeId.make(repositoryNodeId), GithubIssueNodeId.make(issueNodeId))
      expect(taskId.startsWith(opaqueTaskIdPrefix)).toBe(true)
      const decoded = Effect.runSync(decodeGithubTaskId(taskId))

      expect(decoded).toEqual({ issueNodeId, repositoryNodeId })
    }),
    { numRuns: 100 }
  )
})

it("rejects noncanonical and excess GitHub authority coordinates", () => {
  fc.assert(
    fc.property(githubNodeId, githubNodeId, (repositoryNodeId, issueNodeId) => {
      const canonical = githubTaskIdFor(
        GithubRepositoryNodeId.make(repositoryNodeId),
        GithubIssueNodeId.make(issueNodeId)
      )
      const excess = TaskId.make(
        `${opaqueTaskIdPrefix}${Encoding.encodeBase64Url(JSON.stringify([repositoryNodeId, issueNodeId, "excess"]))}`
      )

      expect(Effect.runSync(Effect.exit(decodeGithubTaskId(TaskId.make(`${canonical}=`))))._tag).toBe("Failure")
      expect(Effect.runSync(Effect.exit(decodeGithubTaskId(excess)))._tag).toBe("Failure")
    }),
    { numRuns: 100 }
  )
})
