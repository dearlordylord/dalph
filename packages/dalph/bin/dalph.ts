#!/usr/bin/env node
import { productionCliApplication } from "../src/application/live-cli.js"
import { runDalphNodeMain } from "../src/application/node-main.js"

runDalphNodeMain(productionCliApplication)
