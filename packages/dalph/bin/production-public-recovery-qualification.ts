#!/usr/bin/env node
import { makeProductionCliApplication } from "../src/application/live-cli.js"
import { runDalphNodeMain } from "../src/application/node-main.js"
import { publicRecoveryGithubLayer } from "./production-public-recovery-github.js"

// The same CLI, host, SQLite, Git, and executor graph as the shipped binary;
// only the GitHub network boundary is replaced by a controlled service Layer.
runDalphNodeMain(makeProductionCliApplication({ githubClient: () => publicRecoveryGithubLayer }))
