#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- Qualification-only fault controls the native process observation boundary. */
import nodeProcess from "node:process"
import { makeProductionCliApplication } from "../src/application/live-cli.js"
import { runDalphNodeMain } from "../src/application/node-main.js"
import { publicRecoveryGithubLayer } from "./production-public-recovery-github.js"
import { isolatedCodexProcessNativeService } from "../test-support/isolated-codex-process-native.js"

// Qualification-only fault at the actual native procfs read boundary. No
// production CLI option or ownership decision changes.
const processNative =
  nodeProcess.env["DALPH_QUALIFICATION_PROCESS_EACCES"] === "true"
    ? {
        ...isolatedCodexProcessNativeService,
        readFile: (filename: string) => {
          if (
            filename === `/proc/${nodeProcess.pid}/environ` &&
            nodeProcess.env["DALPH_QUALIFICATION_DIRTY_STDOUT"] === "true"
          ) {
            nodeProcess.stdout.write("ERROR CodexAppServerFailure: controlled dirty stdout\n")
          }
          return filename === `/proc/${nodeProcess.pid}/environ`
            ? Promise.reject(
                Object.assign(new Error("controlled unreadable launch token controlled-github-token"), {
                  code: "EACCES",
                  syscall: "open"
                })
              )
            : isolatedCodexProcessNativeService.readFile(filename)
        }
      }
    : isolatedCodexProcessNativeService

// The same CLI, host, SQLite, Git, and executor graph as the shipped binary.
// The qualification owns only its readable process view and controlled GitHub boundary;
// unrelated runner processes cannot be claimed as fixture evidence.
runDalphNodeMain(
  makeProductionCliApplication({ codexProcessNative: processNative, githubClient: () => publicRecoveryGithubLayer })
)
