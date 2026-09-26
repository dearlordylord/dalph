import { runFreshDeliveryTarget } from "./run-delivery-repeatability.mjs"

// Every sample checks the complete accepted occurrence order in a fresh process.
// Deep repetition remains available for concurrency/tooling changes and hosted assurance.
await runFreshDeliveryTarget({ iterations: 3 })
