/* eslint-disable import/no-nodejs-modules -- The focused test calls one loopback endpoint. */
import { request } from "node:http"
import { Buffer } from "node:buffer"
import { Effect } from "effect"
import { expect, it } from "vitest"
import { makeProductionLiveResponsesEndpoint } from "./production-live-responses-endpoint.js"

const post = (endpoint: string, input: string) =>
  Effect.tryPromise(
    () =>
      new Promise<string>((resolve, reject) => {
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
            response.on("end", () => resolve(text))
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
        return { taskCommand, taskResult, integrationCommand, integrationResult, counts: endpoint.counts }
      })
    )
  )

  expect(result.taskCommand).toContain("LIVE-QUALIFICATION.md")
  expect(result.taskResult).toContain(`\\"commit\\":\\"${head}\\"`)
  expect(result.taskResult).toContain("run-q")
  expect(result.integrationCommand).toContain("git merge --no-ff")
  expect(result.integrationResult).toContain(`\\"candidate\\":\\"${head}\\"`)
  expect(result.counts()).toEqual({ executor: 2, integrator: 2, total: 4 })
  expect(JSON.stringify(result.counts())).not.toContain("/tmp/q")
})
