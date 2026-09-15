import { makeSixTaskDeliveryFacts } from "./six-task-delivery-facts.js"

export const { baseSha, capacity, graph, integrationTarget, runId, target, taskFacts, taskFactsById, tasks } =
  makeSixTaskDeliveryFacts("issue-276")
