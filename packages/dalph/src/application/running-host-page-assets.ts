/* eslint-disable import/no-nodejs-modules -- The HTTP asset adapter reads a fixed packaged allowlist. */
import { readFile } from "node:fs/promises"
import { Effect } from "effect"
import type { RunningHostError } from "./running-host-contract.js"

const assets = {
  "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/dalph/page/graph.js": { file: "graph.js", contentType: "text/javascript; charset=utf-8" },
  "/dalph/page/graph.css": { file: "graph.css", contentType: "text/css; charset=utf-8" }
} as const

export const readRunningHostPageAsset = Effect.fn("RunningHostPage.readAsset")(function* (path: string) {
  const entry = Object.entries(assets).find(([route]) => route === path)?.[1]
  if (entry === undefined) return null
  const bytes = yield* Effect.tryPromise({
    try: () => readFile(new URL(`../browser/${entry.file}`, import.meta.resolve("@dalph/dalph"))),
    catch: (): RunningHostError => ({
      _tag: "ReadFailed",
      causeTag: "PageAssetUnavailable",
      detail: "The packaged page asset is unavailable."
    })
  })
  return { bytes, contentType: entry.contentType }
})
