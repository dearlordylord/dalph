import { Effect, Layer, Stream } from "effect"
import {
  CodexAppServer,
  codexOwnedActivityCensusLayer,
  controlledCodexOwnedActivityCensusLayer,
  type CodexAppServerService
} from "../../src/application/codex-app-server.js"
import { CodexServerIncarnation } from "../../src/application/codex-attempt-store.js"
import {
  nodeCodexProcessNativeService,
  type CodexProcessNativeService
} from "../../src/application/codex-process-native.js"
import { codexOwnedActivityCensusContract } from "./codex-owned-activity-census-contract.js"

const absentCensusLayer = controlledCodexOwnedActivityCensusLayer({
  observe: () => Effect.succeed({ _tag: "Absent" }),
  terminateDescendants: () => Effect.void
})

const unusedAppServerOperation = () => Effect.die("the owned-activity contract does not call the app-server transport")

const contractAppServer: CodexAppServerService = {
  incarnation: CodexServerIncarnation.make("contract-incarnation"),
  attachOwnedActivityHints: Effect.succeed(Stream.empty),
  attachTurnCompletedHints: Effect.succeed(Stream.empty),
  startThread: unusedAppServerOperation,
  readThread: unusedAppServerOperation,
  resumeThread: unusedAppServerOperation,
  startTurn: unusedAppServerOperation,
  interruptTurn: unusedAppServerOperation,
  listBackgroundTerminals: unusedAppServerOperation,
  terminateBackgroundTerminal: unusedAppServerOperation,
  close: Effect.void
}

const emptyLinuxProcessView: CodexProcessNativeService = {
  ...nodeCodexProcessNativeService,
  platform: "linux",
  readdir: async () => []
}

codexOwnedActivityCensusContract({ layer: absentCensusLayer, name: "controlled" })
codexOwnedActivityCensusContract({
  layer: codexOwnedActivityCensusLayer(emptyLinuxProcessView).pipe(
    Layer.provide(Layer.succeed(CodexAppServer, contractAppServer))
  ),
  name: "node"
})
