import { directExecutor } from "./direct-executor.js"
import { makeExecutorActivationKernel } from "./executor-protocol.js"
import { reviewCapableExecutor } from "./review-capable-executor.js"

const selectableExecutors = new Map([
  [directExecutor.name, directExecutor],
  [reviewCapableExecutor.name, reviewCapableExecutor]
])

const selectExecutor = (configuredName: string) => {
  const executor = selectableExecutors.get(configuredName)
  if (executor === undefined) {
    return { _tag: "UnknownExecutor" as const, configuredName }
  }
  return {
    _tag: "ExecutorSelected" as const,
    kernel: makeExecutorActivationKernel(executor)
  }
}

const direct = selectExecutor("direct")
const reviewed = selectExecutor("review-capable")

if (direct._tag !== "ExecutorSelected" || reviewed._tag !== "ExecutorSelected") {
  throw new Error("prototype executor registry is incomplete")
}

process.stdout.write(JSON.stringify({
  direct: direct.kernel.protocolName,
  genericKernelKeys: Object.keys(direct.kernel).sort(),
  reviewCapable: reviewed.kernel.protocolName
}, null, 2))
