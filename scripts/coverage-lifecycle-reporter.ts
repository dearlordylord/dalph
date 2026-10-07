import type { Reporter, TestCase, TestModule } from "vitest/node"
import { writeCoverageLifecycle } from "./coverage-lifecycle.js"

/** Coverage-only reporter: start/end edges survive an interrupted test process. */
export default class CoverageLifecycleReporter implements Reporter {
  onTestModuleQueued(module: TestModule): void {
    writeCoverageLifecycle({ phase: "ModuleQueued", owner: module.moduleId })
  }
  onTestModuleStart(module: TestModule): void {
    writeCoverageLifecycle({ phase: "ModuleStarted", owner: module.moduleId })
  }
  onTestModuleEnd(module: TestModule): void {
    writeCoverageLifecycle({ phase: "ModuleFinished", owner: module.moduleId, outcome: module.state() })
  }
  onTestCaseReady(test: TestCase): void {
    writeCoverageLifecycle({ phase: "TestStarted", owner: test.fullName, testId: test.id, file: test.module.moduleId })
  }
  onTestCaseResult(test: TestCase): void {
    writeCoverageLifecycle({
      phase: "TestFinished",
      owner: test.fullName,
      testId: test.id,
      file: test.module.moduleId,
      outcome: test.result().state
    })
  }
}
