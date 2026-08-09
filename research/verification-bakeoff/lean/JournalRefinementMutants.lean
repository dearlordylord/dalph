import JournalRefinement

/- Seeded false claims for #200. This file must not compile; `run.sh` checks
   that each theorem is rejected independently. -/

open JournalRefinement

/-- Resetting reconstruction at the crash loses the pending claim intent. -/
theorem resetPendingAtCrashMutant :
    (claimAfterIntent.tickets 0).claimPending = false := by
  decide

/-- A task-local contradiction must not write B's failure field. -/
theorem crossRegionFailureWriteMutant :
    ((Journal.fold [0, 1] regionalTrace).tickets 1).failed ≠ none := by
  decide

/-- The completed claim emission reconstructs s2, not its pre-transition s1. -/
theorem completedEmissionKeepsSourceMutant :
    StateRefines L2.s1 claimAfterOutcome = true := by
  decide
