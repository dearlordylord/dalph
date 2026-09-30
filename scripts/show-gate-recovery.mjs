import { repositoryLocation } from "./gate-custody-records.mjs"
import { readGateRecovery } from "./gate-recovery.mjs"

const recovery = readGateRecovery(repositoryLocation())
console.log(JSON.stringify(recovery ?? { state: "clear", nextAction: "continue-focused-work" }, null, 2))
