/* eslint-disable import/no-nodejs-modules -- The focused test owns one local upstream. */
import { createServer, request } from "node:http"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeProductionLiveGithubForwarder } from "../src/qualification/live-github-forwarder.js"

describe("#307 live GitHub forwarding observer", () => {
  it("returns the upstream bytes and records only the decoded label node receipt", async () => {
    const responseText = JSON.stringify({
      data: { createLabel: { label: { id: "label-node-307", name: "claim", description: "private-description" } } }
    })
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json", "x-ratelimit-remaining": "4999" })
      response.end(responseText)
    })
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
    const address = upstream.address()
    if (address === null || typeof address === "string") throw new Error("upstream did not bind")
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const observer = yield* makeProductionLiveGithubForwarder(`http://127.0.0.1:${address.port}/graphql`)
            const body = JSON.stringify({ query: "mutation CreateClaimLabel { createLabel { label { id } } }" })
            const forwarded = yield* Effect.tryPromise(
              () =>
                new Promise<{ readonly rateLimit: string | undefined; readonly text: string }>((resolve, reject) => {
                  const outgoing = request(
                    observer.endpoint,
                    {
                      method: "POST",
                      headers: { authorization: "Bearer secret-307", "content-type": "application/json" }
                    },
                    (response) => {
                      let text = ""
                      response.setEncoding("utf8")
                      response.on("data", (chunk: string) => {
                        text += chunk
                      })
                      response.on("end", () => {
                        const value = response.headers["x-ratelimit-remaining"]
                        resolve({ rateLimit: Array.isArray(value) ? value[0] : value, text })
                      })
                    }
                  )
                  outgoing.on("error", reject)
                  outgoing.end(body)
                })
            )
            expect(forwarded).toEqual({ rateLimit: "4999", text: responseText })
            const observation = yield* observer.observation
            expect(observation).toMatchObject({
              requestCount: 1,
              createdLabels: [{ nodeId: "label-node-307", name: "claim" }]
            })
            expect(observation.createdLabels[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/u)
            expect(JSON.stringify(observation)).not.toContain("secret-307")
            expect(JSON.stringify(observation)).not.toContain("private-description")
            expect(JSON.stringify(observation)).not.toContain(body)
          })
        )
      )
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  })
})
