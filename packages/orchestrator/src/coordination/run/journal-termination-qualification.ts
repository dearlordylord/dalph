import { Context } from "effect"
import type { JournalService } from "../delivery/journal.js"

/**
 * Qualification installs a controlled termination input before the original
 * journal takes its publication lock. It preserves the original accepted
 * append/read operations and delegates finality to the original terminator.
 * Ordinary production has no implementation of this optional capability.
 */
export class JournalTerminationQualification extends Context.Service<
  JournalTerminationQualification,
  {
    readonly decorate: (
      journal: Pick<JournalService, "append" | "read">,
      terminate: JournalService["terminate"]
    ) => JournalService["terminate"]
  }
>()("@dalph/JournalTerminationQualification") {}
