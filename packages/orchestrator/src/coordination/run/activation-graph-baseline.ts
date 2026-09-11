import { Context } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"

/**
 * The accepted journal boundary captured when this process enters one Run
 * activation. Older tracker observations remain historical evidence, but
 * cannot establish this activation's current tracker view. This is scoped
 * presentation context, not persisted tracker or workflow authority.
 */
export class RunActivationGraphBaseline extends Context.Service<RunActivationGraphBaseline, JournalPosition>()(
  "@dalph/RunActivationGraphBaseline"
) {}
