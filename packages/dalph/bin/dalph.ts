#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node"
import { productionCliApplication } from "../src/application/live-cli.js"

NodeRuntime.runMain(productionCliApplication)
