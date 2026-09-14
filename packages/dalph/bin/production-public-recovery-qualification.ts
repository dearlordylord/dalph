#!/usr/bin/env node
import { makeProductionCliApplication } from "../src/application/live-cli.js"
import { runDalphNodeMain } from "../src/application/node-main.js"
import { publicRecoveryGithubLayer } from "./production-public-recovery-github.js"
import { isolatedCodexProcessNativeService } from "../test-support/isolated-codex-process-native.js"

// The same CLI, host, SQLite, Git, and executor graph as the shipped binary.
// The qualification owns only its readable process view and controlled GitHub boundary;
// unrelated runner processes cannot be claimed as fixture evidence.
runDalphNodeMain(
  makeProductionCliApplication({
    codexProcessNative: isolatedCodexProcessNativeService,
    githubClient: () => publicRecoveryGithubLayer
  })
)
