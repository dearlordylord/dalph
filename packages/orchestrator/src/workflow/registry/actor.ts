import { Schema } from "effect"

/**
 * An actor variant is present only after an accepted production action earns
 * it. V1 has one human Operator and the Dalph coordinator.
 */
export const WorkflowActor = Schema.TaggedUnion({ DalphCoordinator: {}, Operator: {} })
export type WorkflowActor = typeof WorkflowActor.Type
