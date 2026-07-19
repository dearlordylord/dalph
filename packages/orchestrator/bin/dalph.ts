#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { capabilityAuditLayer } from "../src/capability-audit.js"
import { runCliFromStdio } from "../src/cli.js"
import { traceOutputStdioLayer } from "../src/trace-output.js"
import { trackerGraphReaderFileLayer } from "../src/tracker-graph-reader.js"
import { dryRunWorkflowInterpreterLayer, workflowTraceOutputLayer } from "../src/workflow.js"

runCliFromStdio.pipe(
  Effect.provide(workflowTraceOutputLayer),
  Effect.provide(traceOutputStdioLayer),
  Effect.provide(dryRunWorkflowInterpreterLayer),
  Effect.provide(capabilityAuditLayer),
  Effect.provide(trackerGraphReaderFileLayer),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
