/* eslint-disable import/no-nodejs-modules -- Recovery must observe a physically exited controller, not just a closed Effect scope. */
import { spawn } from "node:child_process"
import nodeProcess from "node:process"
import { fileURLToPath } from "node:url"
import { realpathSync } from "node:fs"
import { it } from "@effect/vitest"
import { NodeServices } from "@effect/platform-node"
import { Effect, FileSystem, Schema } from "effect"
import { expect } from "vitest"

class NativeCustodyControllerFailure extends Schema.TaggedError<NativeCustodyControllerFailure>()(
  "NativeCustodyControllerFailure",
  { cause: Schema.Unknown }
) {}

const vitestEntry = fileURLToPath(new URL("../../../../node_modules/vitest/vitest.mjs", import.meta.url))
const driver = "packages/dalph/src/application/codex-tool-continuation-driver.test.ts"
const runController = (directory: string, disposition: "Started" | "LimitReached", phase: "seed" | "recover") =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<{ readonly code: number | null; readonly signal: string | null; readonly output: string }>(
        (resolve, reject) => {
          const child = spawn(nodeProcess.execPath, [vitestEntry, "run", driver, "--maxWorkers=1"], {
            signal,
            env: {
              ...nodeProcess.env,
              DALPH_TOOL_CUSTODY_FIXTURE_PHASE: phase,
              DALPH_TOOL_CUSTODY_FIXTURE_DISPOSITION: disposition,
              DALPH_TOOL_CUSTODY_FIXTURE_DIRECTORY: directory
            },
            stdio: ["ignore", "pipe", "pipe"]
          })
          let output = ""
          child.stdout.on("data", (chunk) => {
            output += String(chunk)
          })
          child.stderr.on("data", (chunk) => {
            output += String(chunk)
          })
          child.once("error", reject)
          child.once("close", (code, exitSignal) => resolve({ code, signal: exitSignal, output }))
        }
      ),
    catch: (cause) => new NativeCustodyControllerFailure({ cause })
  })

for (const disposition of ["Started", "LimitReached"] as const) {
  it.live(
    `reopens native ${disposition} original item and aborted continuation through owning Suspend and Resume`,
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        // Preserve the native store and launch fences on failure. Remove only after
        // both controllers exit successfully with their exact containment stopped.
        const directory = realpathSync(yield* fs.makeTempDirectory({ prefix: "dalph-native-tool-continuation-" }))
        for (const phase of ["seed", "recover"] as const) {
          const result = yield* runController(directory, disposition, phase)
          expect(result, `${phase} native evidence retained at ${directory}: ${result.output}`).toMatchObject({
            code: 0,
            signal: null
          })
        }
        yield* fs.remove(directory, { recursive: true })
      }).pipe(Effect.provide(NodeServices.layer)),
    90_000
  )
}
