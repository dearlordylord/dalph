/* eslint-disable import/no-nodejs-modules -- Qualification retains one local, redacted process observation. */
import { writeFile } from "node:fs/promises"
import nodePath from "node:path"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import {
  CodexAppServer,
  codexAppServerNodeLayer,
  launchExecutableMatches,
  readLaunchCommandLine
} from "../application/codex-app-server.js"
import { nodeCodexAttemptStoreLayer } from "../application/codex-attempt-store.js"

const visibleArgvPrefixLength = 2

/** The opt-in qualification uses the production app-server owner to prove launch and exact close. */
export const codexLaunchPreflight = (input: {
  readonly executable: string
  readonly codexHome: string
  readonly observationPath: string
  readonly stateDirectory: string
}) => {
  const app = codexAppServerNodeLayer({
    executable: input.executable,
    environment: { CODEX_HOME: input.codexHome }
  }).pipe(
    Layer.provideMerge(nodeCodexAttemptStoreLayer({ stateDirectory: input.stateDirectory })),
    Layer.provideMerge(NodeServices.layer)
  )

  return Effect.scoped(
    Effect.gen(function* () {
      const server = yield* CodexAppServer
      const pid = server.serverPid
      if (pid === undefined) return yield* Effect.fail(new Error("Codex launch preflight has no process identity"))
      const commandLine = yield* Effect.promise(() => readLaunchCommandLine(pid))
      const observation = {
        configuredExecutable: input.executable,
        pid,
        incarnation: server.incarnation,
        effectiveArgv: commandLine.map((argument, index) =>
          index < visibleArgvPrefixLength
            ? nodePath.basename(argument)
            : argument === "app-server"
              ? argument
              : "<redacted>"
        ),
        matchesConfiguredExecutable: launchExecutableMatches(input.executable, commandLine)
      }
      yield* Effect.promise(() =>
        writeFile(input.observationPath, `${JSON.stringify(observation)}\n`, { flag: "wx", mode: 0o600 })
      )
      yield* server.close
      return { pid, incarnation: server.incarnation }
    }).pipe(Effect.provide(app))
  )
}
