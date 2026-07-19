#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { runCliFromStdio } from "../src/cli.js"
import { taskExecutionDryRunLayer } from "../src/task-execution.js"
import { traceOutputStdioLayer } from "../src/trace-output.js"
import { trackerGraphReaderFileLayer } from "../src/tracker-graph-reader.js"
import { trackerWorkflowInterpreterLayer, workflowTraceOutputLayer } from "../src/workflow.js"

runCliFromStdio.pipe(
  Effect.provide(workflowTraceOutputLayer),
  Effect.provide(traceOutputStdioLayer),
  Effect.provide(trackerWorkflowInterpreterLayer),
  Effect.provide(taskExecutionDryRunLayer),
  Effect.provide(trackerGraphReaderFileLayer),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
