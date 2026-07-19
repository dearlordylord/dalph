#!/usr/bin/env node
import { NodeRuntime, NodeStdio } from "@effect/platform-node"
import { Effect } from "effect"
import { dryRunCliApplication } from "../src/dry-run-application.js"

dryRunCliApplication.pipe(
  Effect.provide(NodeStdio.layer),
  NodeRuntime.runMain
)
