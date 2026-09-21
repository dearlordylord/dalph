/* eslint-disable import/no-nodejs-modules -- disposable host used to prove sender ownership after SIGKILL. */
import nodeProcess from "node:process"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import {
  GitCommand,
  GitCommandCustodySubject,
  nodeGitCommandLayer,
  RemotePublicationAttemptOrdinal,
  RemotePublicationRequestId
} from "@dalph/orchestrator"
import { Effect, Layer } from "effect"
import { fileGitSenderCustodyLayer } from "../src/application/git-sender-custody.js"

const directory = nodeProcess.argv[2]
if (directory === undefined) throw new Error("fixture directory missing")
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const subject = GitCommandCustodySubject.make({
  requestId: RemotePublicationRequestId.make("real-host-sigkill-publication"),
  attemptOrdinal: RemotePublicationAttemptOrdinal.make(1)
})
const commandLayer = nodeGitCommandLayer.pipe(
  Layer.provide(fileGitSenderCustodyLayer(directory)),
  Layer.provide(NodeServices.layer)
)
await Effect.runPromise(
  Effect.gen(function* () {
    const command = yield* GitCommand
    if (command.prepareSenderCustody === undefined || command.runBoundedInRepository === undefined) {
      return yield* Effect.die("production sender custody boundary missing")
    }
    yield* command.prepareSenderCustody(subject)
    yield* command.runBoundedInRepository(
      directory,
      [
        "-c",
        `alias.dalph-custody=!exec ${quote(nodeProcess.execPath)} ${quote(join(directory, "launcher.cjs"))}`,
        "dalph-custody"
      ],
      "120 seconds",
      subject
    )
  }).pipe(Effect.provide(commandLayer))
)
