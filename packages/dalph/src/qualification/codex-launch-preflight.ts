/* eslint-disable import/no-nodejs-modules -- Qualification retains one local, redacted process observation. */
import { writeFile } from "node:fs/promises"
import nodePath from "node:path"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer, Schema } from "effect"
import {
  CodexAppServer,
  codexAppServerLaunchArguments,
  codexAppServerNodeLayer,
  launchExecutableMatches,
  readLaunchCommandLine,
  validateLaunchedProcessObservation
} from "../application/codex-app-server.js"
import { CodexServerLaunchRecord, nodeCodexAttemptStoreLayer } from "../application/codex-attempt-store.js"

const visibleArgvPrefixLength = 2

/** A launch observation cannot authorize a task when its executable differs or has no PID. */
export class CodexLaunchPreflightFailure extends Schema.TaggedError<CodexLaunchPreflightFailure>()(
  "CodexLaunchPreflightFailure",
  {
    reason: Schema.Literals([
      "MissingProcessIdentity",
      "CommandLineUnreadable",
      "ObservationWriteFailed",
      "ExecutableMismatch",
      "LaunchIdentityUnproved"
    ])
  }
) {}

/** The opt-in qualification uses the production app-server owner to prove launch and exact close. */
export const codexLaunchPreflight = (input: {
  readonly executable: string
  readonly codexHome: string
  readonly observationPath: string
  readonly stateDirectory: string
  readonly environment?: Readonly<Record<string, string>>
  readonly inheritEnvironment?: boolean
}) => {
  const app = codexAppServerNodeLayer({
    executable: input.executable,
    environment: { ...input.environment, CODEX_HOME: input.codexHome },
    extendEnvironment: input.inheritEnvironment ?? true
  }).pipe(
    Layer.provideMerge(nodeCodexAttemptStoreLayer({ stateDirectory: input.stateDirectory })),
    Layer.provideMerge(NodeServices.layer)
  )

  return Effect.scoped(
    Effect.gen(function* () {
      const server = yield* CodexAppServer
      const pid = server.serverPid
      if (pid === undefined) {
        if (server.unattendedPolicyAdmission !== undefined) yield* server.unattendedPolicyAdmission
        return yield* new CodexLaunchPreflightFailure({ reason: "MissingProcessIdentity" })
      }
      const commandLine = yield* Effect.tryPromise({
        try: () => readLaunchCommandLine(pid),
        catch: () => new CodexLaunchPreflightFailure({ reason: "CommandLineUnreadable" })
      })
      const matchesConfiguredExecutable = launchExecutableMatches(input.executable, commandLine)
      const ownership = yield* Effect.tryPromise({
        try: () =>
          validateLaunchedProcessObservation(
            CodexServerLaunchRecord.make({
              command: [input.executable, ...codexAppServerLaunchArguments],
              incarnation: server.incarnation,
              phase: "Live",
              pid
            }),
            pid,
            { expectedExecutable: input.executable, expectedMode: "app-server" },
            commandLine
          ),
        catch: () => new CodexLaunchPreflightFailure({ reason: "LaunchIdentityUnproved" })
      }).pipe(Effect.catch(() => Effect.succeed({ _tag: "Unreadable" as const })))
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
        matchesConfiguredExecutable,
        launchOwnership: ownership._tag
      }
      yield* Effect.tryPromise({
        try: () => writeFile(input.observationPath, `${JSON.stringify(observation)}\n`, { flag: "wx", mode: 0o600 }),
        catch: () => new CodexLaunchPreflightFailure({ reason: "ObservationWriteFailed" })
      })
      if (!matchesConfiguredExecutable) return yield* new CodexLaunchPreflightFailure({ reason: "ExecutableMismatch" })
      if (ownership._tag !== "ExactLive")
        return yield* new CodexLaunchPreflightFailure({ reason: "LaunchIdentityUnproved" })
      yield* server.close
      return { pid, incarnation: server.incarnation }
    }).pipe(Effect.provide(app))
  )
}
