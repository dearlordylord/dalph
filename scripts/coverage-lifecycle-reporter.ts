/* eslint-disable import/no-nodejs-modules -- Reporter paths identify repository owners in deep worktrees. */
import { relative } from "node:path"
import process from "node:process"
import type { Reporter, TestCase, TestModule } from "vitest/node"
import { writeCoverageLifecycle } from "./coverage-lifecycle.js"

/** Coverage-only reporter: start/end edges survive an interrupted test process. */
export default class CoverageLifecycleReporter implements Reporter {
  onTestModuleQueued(module: TestModule): void {
    writeCoverageLifecycle({ phase: "ModuleQueued", owner: relative(process.cwd(), module.moduleId) })
  }
  onTestModuleStart(module: TestModule): void {
    writeCoverageLifecycle({ phase: "ModuleStarted", owner: relative(process.cwd(), module.moduleId) })
  }
  onTestModuleEnd(module: TestModule): void {
    writeCoverageLifecycle({
      phase: "ModuleFinished",
      owner: relative(process.cwd(), module.moduleId),
      outcome: module.state()
    })
  }
  onTestCaseReady(test: TestCase): void {
    writeCoverageLifecycle({
      phase: "TestStarted",
      owner: test.fullName,
      testId: test.id,
      file: relative(process.cwd(), test.module.moduleId)
    })
  }
  onTestCaseResult(test: TestCase): void {
    writeCoverageLifecycle({
      phase: "TestFinished",
      owner: test.fullName,
      testId: test.id,
      file: relative(process.cwd(), test.module.moduleId),
      outcome: test.result().state
    })
  }
}
