#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { runCliFromStdio } from "../src/cli.js"
import { traceOutputStdioLayer } from "../src/trace-output.js"
import { trackerGraphReaderFileLayer } from "../src/tracker-graph-reader.js"
import { trackerWorkflowInterpreterLayer } from "../src/workflow.js"

runCliFromStdio.pipe(
  Effect.provide(traceOutputStdioLayer),
  Effect.provide(trackerWorkflowInterpreterLayer),
  Effect.provide(trackerGraphReaderFileLayer),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
