/* eslint-disable import/no-nodejs-modules -- The focused test calls one loopback endpoint. */
import { request } from "node:http"
import { Buffer } from "node:buffer"
import { Effect, Schema } from "effect"
import { expect, it } from "vitest"
import {
  makeProductionLiveResponsesEndpoint,
  ProductionLiveResponsesEndpointLocator,
  ProductionLiveResponsesWorktreeLocator
} from "../src/qualification/live-responses-endpoint.js"

const post = (endpoint: string, input: string) =>
  Effect.tryPromise(
    () =>
      new Promise<{ readonly status: number | undefined; readonly text: string }>((resolve, reject) => {
        const body = JSON.stringify({ input })
        const outgoing = request(
          `${endpoint}/responses`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
          },
          (response) => {
            let text = ""
            response.setEncoding("utf8")
            response.on("data", (chunk: string) => {
              text += chunk
            })
            response.on("end", () => resolve({ status: response.statusCode, text }))
          }
        )
        outgoing.on("error", reject)
        outgoing.end(body)
      })
  )

it("serves one controlled task turn and one controlled Integrator turn without retaining prompts", async () => {
  const head = "2222222222222222222222222222222222222222"
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* makeProductionLiveResponsesEndpoint(() => Effect.succeed(head))
        const taskPrompt = [
          "Dalph immutable attempt facts:",
          "run_id: run-q",
          "attempt_id: attempt-q",
          "worktree: /tmp/q/task"
        ].join("\n")
        const taskCommand = yield* post(endpoint.baseUrl, taskPrompt)
        const taskResult = yield* post(endpoint.baseUrl, taskPrompt)
        const integratorPrompt = [
          "You are the Dalph integration provider.",
          "Accepted commit C: 1111111111111111111111111111111111111111",
          "Candidate worktree: /tmp/q/candidate"
        ].join("\n")
        const integrationCommand = yield* post(endpoint.baseUrl, integratorPrompt)
        const integrationResult = yield* post(endpoint.baseUrl, integratorPrompt)
        return {
          taskCommand,
          taskResult,
          integrationCommand,
          integrationResult,
          observation: yield* endpoint.observation
        }
      })
    )
  )

  expect(result.taskCommand.text).toContain("LIVE-QUALIFICATION.md")
  expect(result.taskResult.text).toContain(`\\"commit\\":\\"${head}\\"`)
  expect(result.taskResult.text).toContain("run-q")
  expect(result.integrationCommand.text).toContain("git merge --no-ff")
  expect(result.integrationResult.text).toContain(`\\"candidate\\":\\"${head}\\"`)
  expect(result.observation).toEqual({
    counts: { executor: 2, integrator: 2, total: 4 },
    orderedTags: [
      "ExecutorRequest",
      "ExecutorRequest",
      "ExecutorGitReadHead",
      "IntegratorRequest",
      "IntegratorRequest",
      "IntegratorGitReadHead"
    ]
  })
  expect(JSON.stringify(result.observation)).not.toContain("/tmp/q")
})

it("rejects malformed worktree and Git head facts before returning an accepted response", async () => {
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* makeProductionLiveResponsesEndpoint(() => Effect.succeed("not-a-git-sha"))
        const malformedWorktree = yield* post(
          endpoint.baseUrl,
          ["Dalph immutable attempt facts:", "run_id: run-q", "attempt_id: attempt-q", "worktree: relative/task"].join(
            "\n"
          )
        )
        const firstValidTurn = yield* post(
          endpoint.baseUrl,
          ["Dalph immutable attempt facts:", "run_id: run-q", "attempt_id: attempt-q", "worktree: /tmp/q/task"].join(
            "\n"
          )
        )
        const invalidHead = yield* post(
          endpoint.baseUrl,
          ["Dalph immutable attempt facts:", "run_id: run-q", "attempt_id: attempt-q", "worktree: /tmp/q/task"].join(
            "\n"
          )
        )
        return { malformedWorktree, firstValidTurn, invalidHead, observation: yield* endpoint.observation }
      })
    )
  )

  expect(result.malformedWorktree.status).toBe(500)
  expect(result.firstValidTurn.status).toBe(200)
  expect(result.invalidHead.status).toBe(500)
  expect(result.invalidHead.text).not.toContain("not-a-git-sha")
  expect(result.observation).toEqual({
    counts: { executor: 2, integrator: 0, total: 2 },
    orderedTags: ["ExecutorRequest", "ExecutorRequest"]
  })
  expect(Schema.is(ProductionLiveResponsesWorktreeLocator)("relative/task")).toBe(false)
  expect(Schema.is(ProductionLiveResponsesEndpointLocator)("http://example.com/v1")).toBe(false)
})
