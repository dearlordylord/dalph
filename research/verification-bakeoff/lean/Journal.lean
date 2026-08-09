/-
  The I15 journal fold of ../JOURNAL-EVENTS.md in Lean 4, self-contained: no
  Mathlib, so `lean Journal.lean` is the whole build. This is the same fold as
  ../fastcheck/journal.mjs, ported guard for guard, with the interpretation
  decisions of ../fastcheck/NOTES.md taken verbatim (fail-closed sticky
  markers, optimistic intents with reconciling outcomes, the task-local/shared
  guard split, regions as per-task projections).

  The cross-tool contrast, in one paragraph. A coordinator crashes anywhere,
  so the journal is truncated at an arbitrary point and recovery re-folds the
  retained prefix: prefix-totality (P1) and determinism (P4) are the recovery
  obligations. In fast-check both are real properties that need witnesses and
  negative controls, because JavaScript lets a fold throw, read the wall
  clock, or iterate a map in insertion order. Here they are discharged by the
  language: `step` and `fold` are total pure functions, the totality checker
  rejects a missing case, and no pure definition can read a clock. P2, the
  homomorphism `fold (p ++ q) = foldFrom (fold p) q`, was a property worth
  directed witnesses in fast-check (mutant M2 drops held positions on resume
  and only a directed split catches it); here `fold` and `foldFrom` are
  *defined* as `List.foldl` of the same step function, so the homomorphism is
  one library lemma, `List.foldl_append`. The real work is P3, regional
  contradiction: while the Run is live, each task's region is exactly the fold
  of that task's own event subsequence under only the task-local guards. That
  is a simulation between two different folds, and it is proved below
  (`regional_contradiction`), not sampled.

  Two deliberate differences from the bounded fast-check arm, both in the
  direction the prover arm exists for:

  - Task ids, heads, tokens, run ids, attempt ids and capacities are
    unbounded `Nat`. journal.mjs fixes `MAX_CAPACITY = 2` and `MAX_HEAD = 4`
    so the generators stay shallow; those are concessions to enumeration, not
    domain facts (the same point ../NOTES.md makes about TLC's bounds). The
    guards they appeared in (`CapacityRevised` in range, `TargetHeadObserved`
    at most MAX_HEAD, promotion below MAX_HEAD) lose only their artificial
    ceiling here; everything else is guard-for-guard identical.
  - The two history flags of MODEL.md (`admissionRespectedCeiling`,
    `promotedFromExactHead`) are not carried as state fields. journal.mjs
    documents them as definitional — an over-ceiling admission or an off-head
    promotion fails the Run, so the flags can only read true — and here the
    corresponding fact is the absence of a run failure, not a stored boolean.
-/

namespace Journal

/- ------------------------------------------------------------- the alphabet -/

/-- I18's stated retention reasons. Nonempty by construction: a reason-free
    non-convergence cannot be written down. -/
inductive Reason where
  | correctionLimitExhausted
  | continuationLimitExhausted
  | staleTargetHead
  deriving BEq, DecidableEq, Repr

/-- ADR 0002's negative eligibility outcomes. -/
inductive Ineligibility where
  | missingFromTargetClosure
  | notOpen
  | prerequisitesUnsatisfied
  deriving BEq, DecidableEq, Repr

inductive Direction where
  | pause
  | unpause
  deriving BEq, DecidableEq, Repr

inductive WorktreeOutcome where
  | created
  | alreadyExisted
  | missing
  deriving BEq, DecidableEq, Repr

/-- `safelySuspend` and `reportAccepted` of the model, merged into one
    executor occurrence. -/
inductive Report where
  | running
  | safelySuspended
  | terminal (result : Nat)
  deriving BEq, DecidableEq, Repr

/-- One tracker fact about one subject. -/
structure Fact where
  subject : Nat
  present : Bool
  isOpen : Bool
  deriving BEq, DecidableEq, Repr

/--
  The 23 events of ../JOURNAL-EVENTS.md. Actions name an actor (the
  coordinator records its own past-tense doing); non-action occurrences do
  not. The split is structural, not cosmetic: `Event.kind` below must answer
  for every variant, and so must every consumer — Lean's exhaustiveness
  checker is exactly the "adding a variant breaks exhaustive consumers"
  requirement, enforced at compile time rather than by a test.

  No event carries its own position; a position *referenced as evidence* (the
  `contentIdentity` of a tracker observation) is ordinary data.
-/
inductive Event where
  -- Actions
  | claimIntentRecorded (task token : Nat)
  | claimReleaseIntentRecorded (task token : Nat)
  | attemptPlanned (task runId attemptId : Nat)
  | workAdmitted (task attemptId : Nat)
  | suspensionRequested (task attemptId : Nat)
  | resumeRequested (task attemptId : Nat)
  | worktreeIntentRecorded (task attemptId : Nat)
  | integrationSessionOpened (task expectedHead : Nat)
  | promotionIntentRecorded (task expectedHead : Nat)
  | candidateConstructionNonConvergent (task : Nat) (reason : Reason)
  | deliverySettled (task : Nat)
  | workflowRunBegun (runId target : Nat)
  | workflowRunTerminated (runId : Nat)
  | capacityRevised (capacity : Nat)
  | directionApplied (subject : Nat) (direction : Direction)
  -- Non-action occurrences
  | trackerFactsObserved (subjects : List Nat) (facts : List Fact) (complete : Bool) (contentIdentity : Nat)
  | claimRecordRead (task owner token : Nat)
  | claimedTaskEligibilityObserved (task revision : Nat)
  | claimedTaskIneligible (task : Nat) (reason : Ineligibility)
  | worktreeReconciliationObserved (task attemptId : Nat) (outcome : WorktreeOutcome)
  | executorReported (task attemptId : Nat) (report : Report)
  | promotionOutcomeObserved (task head : Nat)
  | targetHeadObserved (head : Nat)
  deriving Repr

inductive EventKind where
  | action
  | occurrence
  deriving BEq, DecidableEq, Repr

/-- The action/occurrence classification, answered for all 23 variants. -/
def Event.kind : Event → EventKind
  | .claimIntentRecorded .. | .claimReleaseIntentRecorded .. | .attemptPlanned ..
  | .workAdmitted .. | .suspensionRequested .. | .resumeRequested ..
  | .worktreeIntentRecorded .. | .integrationSessionOpened .. | .promotionIntentRecorded ..
  | .candidateConstructionNonConvergent .. | .deliverySettled ..
  | .workflowRunBegun .. | .workflowRunTerminated .. | .capacityRevised .. | .directionApplied .. =>
      .action
  | .trackerFactsObserved .. | .claimRecordRead .. | .claimedTaskEligibilityObserved ..
  | .claimedTaskIneligible .. | .worktreeReconciliationObserved .. | .executorReported ..
  | .promotionOutcomeObserved .. | .targetHeadObserved .. =>
      .occurrence

/-- The task an event belongs to, if any. Run-level events have none; this is
    what "xs restricted to region A" filters on. -/
def Event.task? : Event → Option Nat
  | .claimIntentRecorded t _ => some t
  | .claimReleaseIntentRecorded t _ => some t
  | .attemptPlanned t _ _ => some t
  | .workAdmitted t _ => some t
  | .suspensionRequested t _ => some t
  | .resumeRequested t _ => some t
  | .worktreeIntentRecorded t _ => some t
  | .integrationSessionOpened t _ => some t
  | .promotionIntentRecorded t _ => some t
  | .candidateConstructionNonConvergent t _ => some t
  | .deliverySettled t => some t
  | .claimRecordRead t _ _ => some t
  | .claimedTaskEligibilityObserved t _ => some t
  | .claimedTaskIneligible t _ => some t
  | .worktreeReconciliationObserved t _ _ => some t
  | .executorReported t _ _ => some t
  | .promotionOutcomeObserved t _ => some t
  | .workflowRunBegun .. | .workflowRunTerminated _ | .capacityRevised _
  | .directionApplied .. | .trackerFactsObserved .. | .targetHeadObserved _ => none

/- ----------------------------------------------------------------- the state -/

/-- The L2 phases, one per phase name of journal.mjs. -/
inductive Phase where
  | noObligation
  | claimed
  | planned
  | executing
  | suspensionRequested
  | suspended
  | accepted
  | integrating
  | promoted
  | abandoned
  | settled
  deriving BEq, DecidableEq, Repr

/-- One task's ticket: the MODEL.md fields plus the fold-internal
    reconciliation fields (`claimPending`, `worktreePending`,
    `promotionPending`, `retentionReason`) and the sticky failure marker. -/
structure Ticket where
  phase : Phase
  attempts : Nat
  present : Bool
  isOpen : Bool
  expectedHead : Nat
  attemptId : Option Nat
  runId : Option Nat
  claimToken : Option Nat
  claimPending : Bool
  worktreePending : Bool
  promotionPending : Bool
  retentionReason : Option Reason
  failed : Option String
  deriving BEq, DecidableEq, Repr

/-- The per-task projection Proposition 3 quantifies over: the ticket minus
    the tracker-observation fields (`present`, `isOpen`), which shared
    observations may rewrite for any task at any time. -/
structure Region where
  phase : Phase
  attempts : Nat
  expectedHead : Nat
  attemptId : Option Nat
  runId : Option Nat
  claimToken : Option Nat
  claimPending : Bool
  worktreePending : Bool
  promotionPending : Bool
  retentionReason : Option Reason
  failed : Option String
  deriving BEq, DecidableEq, Repr

def Ticket.toRegion (t : Ticket) : Region :=
  { phase := t.phase, attempts := t.attempts, expectedHead := t.expectedHead
    attemptId := t.attemptId, runId := t.runId, claimToken := t.claimToken
    claimPending := t.claimPending, worktreePending := t.worktreePending
    promotionPending := t.promotionPending, retentionReason := t.retentionReason
    failed := t.failed }

/-- The canonical contents of a tracker observation, keyed by logical read
    identity: the same identity carrying two different contents is a shared
    contradiction. -/
structure Observation where
  subjects : List Nat
  facts : List Fact
  complete : Bool
  deriving BEq, DecidableEq, Repr

/-- The fold state. `tickets` is a total function over an explicit task
    universe `tasks` (journal.mjs's fixed `TASKS`), so the same development
    covers any finite universe. -/
structure State where
  tasks : List Nat
  tickets : Nat → Ticket
  capacity : Nat
  positions : List Nat
  paused : Bool
  targetResource : List Nat
  targetHead : Nat
  runBegun : Bool
  runId : Option Nat
  runTarget : Option Nat
  runTerminated : Bool
  runFailed : Option String
  seenObservations : List (Nat × Observation)

def initialTicket : Ticket :=
  { phase := .noObligation, attempts := 0, present := false, isOpen := false
    expectedHead := 0, attemptId := none, runId := none, claimToken := none
    claimPending := false, worktreePending := false, promotionPending := false
    retentionReason := none, failed := none }

def initialState (tasks : List Nat) : State :=
  { tasks := tasks, tickets := fun _ => initialTicket, capacity := 1
    positions := [], paused := false, targetResource := [], targetHead := 0
    runBegun := false, runId := none, runTarget := none, runTerminated := false
    runFailed := none, seenObservations := [] }

def regionOf (s : State) (t : Nat) : Region := (s.tickets t).toRegion

/-- Point-update of a ticket function (Lean core has no `Function.update`). -/
def updateTicketAt (tickets : Nat → Ticket) (t : Nat) (v : Ticket) : Nat → Ticket :=
  fun u => if u = t then v else tickets u

@[simp] theorem updateTicketAt_self (tickets : Nat → Ticket) (t : Nat) (v : Ticket) :
    updateTicketAt tickets t v t = v := by
  simp [updateTicketAt]

@[simp] theorem updateTicketAt_of_ne (tickets : Nat → Ticket) (t : Nat) (v : Ticket) (u : Nat)
    (h : u ≠ t) : updateTicketAt tickets t v u = tickets u := by
  simp [updateTicketAt, h]

def State.updateTicket (s : State) (t : Nat) (f : Ticket → Ticket) : State :=
  { s with tickets := updateTicketAt s.tickets t (f (s.tickets t)) }

/-- Fail closed: a shared-history contradiction fails the whole Run; the state
    stops evolving (`step` checks this first). -/
def failRun (s : State) (reason : String) : State := { s with runFailed := some reason }

/-- Fail closed, contained: a task-local contradiction fails only that task's
    region; the region stops evolving, everything else keeps folding. -/
def failRegion (s : State) (t : Nat) (reason : String) : State :=
  s.updateTicket t fun tk => { tk with failed := some reason }

/-- The bounded selection a claim intent must respect: the tasks the tracker
    observation shows present and open, in universe order, ranked against
    capacity. -/
def eligibleOf (s : State) : List Nat :=
  s.tasks.filter fun id => (s.tickets id).present && (s.tickets id).isOpen

def selected (s : State) (t : Nat) : Bool :=
  let eligible := eligibleOf s
  if t ∈ eligible then decide (eligible.countP (· < t) < s.capacity) else false

/- ----------------------------------------------------------------- the guards -/

/--
  The task-local half of the guard split: reads only the region — the
  ticket's own phase, attempt, and pending-intent fields. This is what
  "xs restricted to region A is consistent" means operationally: the region
  fold evaluates exactly these guards and nothing else. Returns the failure
  reason, or `none` when the event is consistent with the region.
-/
def localGuard (r : Region) : Event → Option String
  | .claimIntentRecorded _ _ =>
      if r.phase == .noObligation then none
      else some "claim intent while obligation exists"
  | .claimReleaseIntentRecorded _ token =>
      if r.phase == .claimed && r.claimToken == some token then none
      else some "release naming a token that is not the current claim"
  | .claimRecordRead _ _ token =>
      if r.claimPending && (r.claimToken == some token || r.phase == .claimed) then none
      else some "claim record read with no unresolved intent, or refuting a claim already built upon"
  | .claimedTaskEligibilityObserved _ _ =>
      if r.phase == .claimed then none
      else some "eligibility observation for a task not Claimed"
  | .claimedTaskIneligible _ _ =>
      -- journal.mjs also checks the reason is inside the alphabet; here the
      -- `Ineligibility` type makes an outside-the-alphabet reason unwriteable.
      if r.phase == .claimed then none
      else some "ineligibility observation for a task not Claimed"
  | .attemptPlanned _ _ _ =>
      if r.phase == .claimed && r.attempts == 0 then none
      else some "attempt planned without a claim, or a second attempt (I10)"
  | .workAdmitted _ attemptId =>
      if r.phase == .planned && r.attemptId == some attemptId then none
      else some "admission without a planned, correlating attempt"
  | .suspensionRequested _ attemptId =>
      if r.phase == .executing && r.attemptId == some attemptId then none
      else some "suspension requested for a task not Executing"
  | .resumeRequested _ attemptId =>
      if r.phase == .suspended && r.attemptId == some attemptId then none
      else some "resume requested for a task not Suspended"
  | .worktreeIntentRecorded _ attemptId =>
      if r.phase == .planned && r.attemptId == some attemptId && !r.worktreePending then none
      else some "worktree intent without a planned attempt, or a second intent (I16)"
  | .worktreeReconciliationObserved _ attemptId _ =>
      if r.worktreePending && r.attemptId == some attemptId then none
      else some "worktree reconciliation with no unresolved intent"
  | .executorReported _ attemptId report =>
      match report with
      | .running =>
          if (r.phase == .executing || r.phase == .suspensionRequested) && r.attemptId == some attemptId then none
          else some "running report for a task without work in flight"
      | .safelySuspended =>
          if r.phase == .suspensionRequested && r.attemptId == some attemptId then none
          else some "safe suspension without a suspension request"
      | .terminal _ =>
          if r.phase == .executing && r.attemptId == some attemptId then none
          else some "terminal report for a task not Executing"
  | .integrationSessionOpened _ _ =>
      if r.phase == .accepted then none
      else some "integration session without an accepted result"
  | .promotionIntentRecorded _ expectedHead =>
      if r.phase == .integrating && r.expectedHead == expectedHead && !r.promotionPending then none
      else some "promotion intent without an open session, a mismatched captured head, or a second intent"
  | .promotionOutcomeObserved _ _ =>
      if r.phase == .integrating && r.promotionPending then none
      else some "promotion outcome with no unresolved intent"
  | .candidateConstructionNonConvergent _ _ =>
      if r.phase == .integrating then none
      else some "non-convergence without an open session"
  | .deliverySettled _ =>
      if r.phase == .promoted then none
      else some "settlement without a promotion"
  | .workflowRunBegun .. | .workflowRunTerminated _ | .capacityRevised _
  | .directionApplied .. | .trackerFactsObserved .. | .targetHeadObserved _ =>
      none -- run-level events never reach the task-local guard

/--
  The shared-history half: reads capacity, positions, pause, target head,
  target resource, and run lifecycle. Only the full fold evaluates these; a
  failure here fails the whole Run. (`promotionOutcomeObserved` and
  `candidateConstructionNonConvergent` also read the ticket, but only to
  compare it against shared state.)
-/
def sharedGuard (s : State) : Event → Option String
  | .claimIntentRecorded t _ =>
      if selected s t then none
      else some "claim intent for a task outside the current selection"
  | .attemptPlanned _ runId _ =>
      if !s.runBegun || s.runId == some runId then none
      else some "attempt planned under a runId that is not this run"
  | .workAdmitted _ _ | .resumeRequested _ _ =>
      if !s.paused && s.positions.length < s.capacity then none
      else some "admission under a pause or over the capacity ceiling"
  | .integrationSessionOpened _ expectedHead =>
      if s.targetResource.isEmpty && expectedHead == s.targetHead then none
      else some "integration session over a held target resource or a head that is not the current target head"
  | .promotionOutcomeObserved t head =>
      -- A failed compare-and-set (head ≠ captured head) is legitimate; landing
      -- at the captured head after the target moved is invalid shared history.
      if head != (s.tickets t).expectedHead || head == s.targetHead then none
      else some "promotion landed at a head that is not the current target head (I13)"
  | .candidateConstructionNonConvergent t reason =>
      if reason != .staleTargetHead || (s.tickets t).expectedHead != s.targetHead then none
      else some "StaleTargetHead recorded while the captured head is still current"
  | .claimReleaseIntentRecorded .. | .suspensionRequested ..
  | .worktreeIntentRecorded .. | .promotionIntentRecorded .. | .deliverySettled _
  | .workflowRunBegun .. | .workflowRunTerminated _ | .capacityRevised _
  | .directionApplied .. | .trackerFactsObserved .. | .claimRecordRead ..
  | .claimedTaskEligibilityObserved .. | .claimedTaskIneligible ..
  | .worktreeReconciliationObserved .. | .executorReported .. | .targetHeadObserved _ => none

/-- The run-level guards, for events no single region owns. -/
def runGuard (s : State) : Event → Option String
  | .trackerFactsObserved subjects facts complete contentIdentity =>
      match s.seenObservations.lookup contentIdentity with
      | none => none
      | some seen =>
          if seen == ⟨subjects, facts, complete⟩ then none
          else some "the same logical read identity carrying two different contents"
  | .targetHeadObserved head =>
      if head == s.targetHead + 1 then none
      else some "target head observation that is not exactly the next head"
  | .capacityRevised capacity =>
      -- journal.mjs also bounds capacity at MAX_CAPACITY = 2; here capacity is
      -- an unbounded Nat (see the header).
      if capacity != s.capacity then none
      else some "capacity revision to the current capacity"
  | .directionApplied _ direction =>
      match direction with
      | .pause =>
          if !s.paused then none
          else some "pause direction that does not change the current pause state"
      | .unpause =>
          if s.paused then none
          else some "pause direction that does not change the current pause state"
  | .workflowRunBegun _ _ =>
      if !s.runBegun then none
      else some "a second WorkflowRunBegun"
  | .workflowRunTerminated runId =>
      if s.runBegun && !s.runTerminated && s.runId == some runId then none
      else some "termination without a begun run, or under a different runId"
  | .claimIntentRecorded .. | .claimReleaseIntentRecorded .. | .attemptPlanned ..
  | .workAdmitted .. | .suspensionRequested .. | .resumeRequested ..
  | .worktreeIntentRecorded .. | .integrationSessionOpened .. | .promotionIntentRecorded ..
  | .candidateConstructionNonConvergent .. | .deliverySettled _ | .claimRecordRead ..
  | .claimedTaskEligibilityObserved .. | .claimedTaskIneligible ..
  | .worktreeReconciliationObserved .. | .executorReported .. | .promotionOutcomeObserved .. =>
      none -- task events never reach the run-level guard

/- ----------------------------------------------------------------- the applys -/

/-- The state update of an accepted task event. The design point P3 rests on:
    every region-field write depends only on the region and the event
    (`stateApply_region` pins this down); shared fields move alongside. -/
def stateApply (t : Nat) (e : Event) (s : State) : State := match e with
  | .claimIntentRecorded _ token =>
      -- The intent applies optimistically: a crash between intent and outcome
      -- must not silently lose the obligation — that is what the intent is
      -- journaled for.
      s.updateTicket t fun tk => { tk with phase := .claimed, claimToken := some token, claimPending := true }
  | .claimReleaseIntentRecorded _ _ =>
      s.updateTicket t fun tk => { tk with phase := .noObligation, claimToken := none, claimPending := false }
  | .claimRecordRead _ _ token =>
      s.updateTicket t fun tk =>
        if tk.claimToken == some token then { tk with claimPending := false }
        -- The reread refutes the intent while the task is still only Claimed:
        -- the ambiguous write did not land, and the region reverts.
        else { tk with phase := .noObligation, claimToken := none, claimPending := false }
  | .claimedTaskEligibilityObserved _ _ => s
  | .claimedTaskIneligible _ _ => s
  | .attemptPlanned _ runId attemptId =>
      s.updateTicket t fun tk =>
        { tk with phase := .planned, attempts := tk.attempts + 1, attemptId := some attemptId, runId := some runId }
  | .workAdmitted _ _ =>
      { (s.updateTicket t fun tk => { tk with phase := .executing }) with positions := s.positions ++ [t] }
  | .suspensionRequested _ _ =>
      s.updateTicket t fun tk => { tk with phase := .suspensionRequested }
  | .resumeRequested _ _ =>
      { (s.updateTicket t fun tk => { tk with phase := .executing }) with positions := s.positions ++ [t] }
  | .worktreeIntentRecorded _ _ =>
      s.updateTicket t fun tk => { tk with worktreePending := true }
  | .worktreeReconciliationObserved _ _ _ =>
      s.updateTicket t fun tk => { tk with worktreePending := false }
  | .executorReported _ _ report =>
      match report with
      | .running => s
      | .safelySuspended =>
          { (s.updateTicket t fun tk => { tk with phase := .suspended }) with
            positions := s.positions.filter (· != t) }
      | .terminal _ =>
          { (s.updateTicket t fun tk => { tk with phase := .accepted }) with
            positions := s.positions.filter (· != t) }
  | .integrationSessionOpened _ expectedHead =>
      { (s.updateTicket t fun tk => { tk with phase := .integrating, expectedHead := expectedHead }) with
        targetResource := [t] }
  | .promotionIntentRecorded _ _ =>
      s.updateTicket t fun tk => { tk with promotionPending := true }
  | .promotionOutcomeObserved _ head =>
      let expected := (s.tickets t).expectedHead
      let s := s.updateTicket t fun tk => { tk with promotionPending := false }
      if head == expected then
        { (s.updateTicket t fun tk => { tk with phase := .promoted }) with
          targetHead := s.targetHead + 1, targetResource := [] }
      -- head ≠ expected: a failed compare-and-set, legitimately journaled. The
      -- task stays Integrating and keeps the integration-target resource.
      else s
  | .candidateConstructionNonConvergent _ reason =>
      { (s.updateTicket t fun tk => { tk with phase := .abandoned, retentionReason := some reason }) with
        targetResource := s.targetResource.filter (· != t) }
  | .deliverySettled _ =>
      s.updateTicket t fun tk => { tk with phase := .settled }
  | .workflowRunBegun .. | .workflowRunTerminated _ | .capacityRevised _
  | .directionApplied .. | .trackerFactsObserved .. | .targetHeadObserved _ =>
      s -- run-level events never reach the task apply

/-- The same updates, projected to the region. This is the function the
    region fold applies; `stateApply_region` proves the two agree. -/
def regionApply (e : Event) (r : Region) : Region := match e with
  | .claimIntentRecorded _ token => { r with phase := .claimed, claimToken := some token, claimPending := true }
  | .claimReleaseIntentRecorded _ _ => { r with phase := .noObligation, claimToken := none, claimPending := false }
  | .claimRecordRead _ _ token =>
      if r.claimToken == some token then { r with claimPending := false }
      else { r with phase := .noObligation, claimToken := none, claimPending := false }
  | .attemptPlanned _ runId attemptId =>
      { r with phase := .planned, attempts := r.attempts + 1, attemptId := some attemptId, runId := some runId }
  | .workAdmitted _ _ | .resumeRequested _ _ => { r with phase := .executing }
  | .suspensionRequested _ _ => { r with phase := .suspensionRequested }
  | .worktreeIntentRecorded _ _ => { r with worktreePending := true }
  | .worktreeReconciliationObserved _ _ _ => { r with worktreePending := false }
  | .executorReported _ _ report =>
      match report with
      | .running => r
      | .safelySuspended => { r with phase := .suspended }
      | .terminal _ => { r with phase := .accepted }
  | .integrationSessionOpened _ expectedHead => { r with phase := .integrating, expectedHead := expectedHead }
  | .promotionIntentRecorded _ _ => { r with promotionPending := true }
  | .promotionOutcomeObserved _ head =>
      let r := { r with promotionPending := false }
      if head == r.expectedHead then { r with phase := .promoted } else r
  | .candidateConstructionNonConvergent _ reason => { r with phase := .abandoned, retentionReason := some reason }
  | .deliverySettled _ => { r with phase := .settled }
  | .claimedTaskEligibilityObserved .. | .claimedTaskIneligible ..
  | .workflowRunBegun .. | .workflowRunTerminated _ | .capacityRevised _
  | .directionApplied .. | .trackerFactsObserved .. | .targetHeadObserved _ => r

/-- The run-level updates. A complete tracker observation proves unlisted
    subjects absent; an incomplete one says nothing about them. -/
def applyObservedFact (tasks : List Nat) (s : State) (fact : Fact) : State :=
  if fact.subject ∈ tasks then
    s.updateTicket fact.subject fun tk =>
      { tk with present := fact.present, isOpen := fact.isOpen }
  else s

def clearUnobservedTask (subjects : List Nat) (s : State) (task : Nat) : State :=
  if task ∈ subjects then s
  else s.updateTicket task fun tk => { tk with present := false, isOpen := false }

def runApply (e : Event) (s : State) : State := match e with
  | .trackerFactsObserved subjects facts complete contentIdentity =>
      let s := { s with seenObservations := (contentIdentity, ⟨subjects, facts, complete⟩) :: s.seenObservations }
      let s := facts.foldl (applyObservedFact s.tasks) s
      if complete then
        s.tasks.foldl (clearUnobservedTask subjects) s
      else s
  | .targetHeadObserved head => { s with targetHead := head }
  | .capacityRevised capacity => { s with capacity := capacity }
  | .directionApplied _ direction => { s with paused := direction == .pause }
  | .workflowRunBegun runId target => { s with runBegun := true, runId := some runId, runTarget := some target }
  | .workflowRunTerminated _ => { s with runTerminated := true }
  | .claimIntentRecorded .. | .claimReleaseIntentRecorded .. | .attemptPlanned ..
  | .workAdmitted .. | .suspensionRequested .. | .resumeRequested ..
  | .worktreeIntentRecorded .. | .integrationSessionOpened .. | .promotionIntentRecorded ..
  | .candidateConstructionNonConvergent .. | .deliverySettled _ | .claimRecordRead ..
  | .claimedTaskEligibilityObserved .. | .claimedTaskIneligible ..
  | .worktreeReconciliationObserved .. | .executorReported .. | .promotionOutcomeObserved .. => s

/- ------------------------------------------------------------------- the fold -/

/--
  The task-event pipeline of journal.mjs's `run` combinator, in the same
  order: a ticket whose region already failed skips the event entirely; a
  task-local guard failure fails only the region; a shared-guard failure
  (checked only by the full fold) fails the whole Run; otherwise the event
  applies.
-/
def taskEventStep (cs : Bool) (s : State) (t : Nat)
    (localResult sharedResult : Option String) (apply : State → State) : State :=
  if (s.tickets t).failed.isSome then s
  else match localResult with
  | some reason => failRegion s t reason
  | none =>
    match if cs then sharedResult else none with
    | some reason => failRun s reason
    | none => apply s

/-- The run-level pipeline: no region to fail, so a guard failure fails the
    Run. -/
def runStep (cs : Bool) (s : State) (guard : Option String) (apply : State → State) : State :=
  match if cs then guard else none with
  | some reason => failRun s reason
  | none => apply s

/--
  One event applied to one state. `cs = false` is the region projection of
  Proposition 3: only task-local guards are evaluated. Fail-closed is
  structural: a failed Run returns the state unchanged (the state stops
  evolving), and any event after `WorkflowRunTerminated` fails the Run —
  termination is the final fact.
-/
def step (cs : Bool) (s : State) (e : Event) : State :=
  if s.runFailed.isSome then s
  else if s.runTerminated then failRun s "event after WorkflowRunTerminated"
  else match e.task? with
  | some t =>
      if t ∈ s.tasks then
        taskEventStep cs s t (localGuard (s.tickets t).toRegion e) (sharedGuard s e) (stateApply t e)
      else failRun s "event names an unknown task"
  | none => runStep cs s (runGuard s e) (runApply e)

/-- I15's reduction: a pure fold of the retained journal, from the origin. -/
def fold (tasks : List Nat) (xs : List Event) : State :=
  xs.foldl (step true) (initialState tasks)

/-- Crash-recovery correctness: resume the fold from a reconstructed state. -/
def foldFrom (s : State) (xs : List Event) : State :=
  xs.foldl (step true) s

/-- One step of the region fold: the task's own events only, under only the
    task-local guards. It is deliberately a function of `Region × Event`, so
    the regional proof cannot accidentally consult shared Run state. -/
def regionStep (t : Nat) (r : Region) (e : Event) : Region :=
  if e.task? = some t then
    if r.failed.isSome then r
    else match localGuard r e with
      | some reason => { r with failed := some reason }
      | none => regionApply e r
  else r

/-- "xs restricted to region A", operationalised: fold only A's own events
    with only the task-local guards, and project the region. -/
def foldRegion (tasks : List Nat) (t : Nat) (xs : List Event) : Region :=
  xs.foldl (regionStep t) (regionOf (initialState tasks) t)

/- ------------------------------------------- P1 and P4: free, and why -/

/-
  P1 (prefix-totality). A crash truncates the journal anywhere, so the fold
  must be defined on every prefix of an arbitrary — possibly contradictory —
  event sequence. Here that is enforced by the language, not tested:
  `step`'s matches are exhaustive (the totality checker rejects a missing
  variant), the fold is structural recursion over `List Event`, and a
  contradiction is a value in the state, so there is no throw to make
  totality a property of the harness. The fast-check arm needed 8000
  arbitrary sequences and mutant M1 (throw on invalid event) to say the same
  thing; the M1 mutant has no Lean counterpart because there is no way to
  write it.

  P4 (determinism). `step`, `fold`, `foldFrom` and `foldRegion` are pure
  functions: the same journal folds to the same state by `rfl`. The
  fast-check arm needed a dynamic property plus a static grep of
  journal.mjs for wall-clock/entropy reads, because JavaScript cannot rule
  them out; a pure Lean definition cannot read either, so there is nothing
  to prove and no theorem below fakes one.
-/

/- ------------------------------------------------- P2: the homomorphism -/

/--
  `fold (p ++ q) = foldFrom (fold p) q`: reconstructing from a truncated
  prefix and replaying the rest equals reconstructing from the whole journal.
  This *is* crash-recovery correctness.

  One line because both sides are `List.foldl` of the same step function —
  the equality is `List.foldl_append`. In fast-check this was a real property
  with directed witnesses, because the fold there is a mutable loop with a
  `structuredClone` on entry: nothing in the language connects "fold the
  whole" to "fold the prefix, then resume", and mutant M2 (drop held
  positions on resume) breaks exactly that connection while passing every
  undirected run that releases its positions before the sequence ends. Here
  there is no entry-side effect for such a mutant to hide in; the M2
  "defect" would simply be a different function, and this proof would not
  go through.
-/
theorem fold_homomorphism (tasks : List Nat) (p q : List Event) :
    fold tasks (p ++ q) = foldFrom (fold tasks p) q :=
  List.foldl_append

/- ------------------------------- P3: regional contradiction (the real work) -/

/-- The apply of a task event moves the named ticket's region exactly as
    `regionApply` says: region-field writes depend only on the region and the
    event, never on shared state. This is the fact the design text calls out
    ("making the promotion phase transition region-local is what makes region
    content independent of interleaved shared events"). -/
theorem stateApply_region (t : Nat) (e : Event) (s : State) :
    ((stateApply t e s).tickets t).toRegion = regionApply e (s.tickets t).toRegion := by
  cases e <;> simp [stateApply, regionApply, State.updateTicket, Ticket.toRegion]
  all_goals split <;> simp

/-- A task event's apply never touches another task's ticket. -/
theorem stateApply_other (h : u ≠ t) (e : Event) (s : State) :
    (stateApply u e s).tickets t = s.tickets t := by
  cases e <;> simp [stateApply, State.updateTicket, Ne.symm h]
  all_goals split <;> simp [Ne.symm h]

/-- Task applies never touch the Run's failure or lifecycle fields. -/
theorem stateApply_runFailed (u : Nat) (e : Event) (s : State) :
    (stateApply u e s).runFailed = s.runFailed := by
  cases e <;> simp [stateApply, State.updateTicket]
  all_goals split <;> simp

theorem stateApply_runTerminated (u : Nat) (e : Event) (s : State) :
    (stateApply u e s).runTerminated = s.runTerminated := by
  cases e <;> simp [stateApply, State.updateTicket]
  all_goals split <;> simp

theorem stateApply_tasks (u : Nat) (e : Event) (s : State) :
    (stateApply u e s).tasks = s.tasks := by
  cases e <;> simp [stateApply, State.updateTicket]
  all_goals split <;> simp

/-- A tracker observation's present/open writes never move a region
    projection — the region deliberately excludes those fields. -/
theorem toRegion_updateTicket_present (s : State) (t u : Nat) (p o : Bool) :
    ((s.updateTicket u fun tk => { tk with present := p, isOpen := o }).tickets t).toRegion =
      (s.tickets t).toRegion := by
  by_cases h : t = u
  · subst h; simp [State.updateTicket, Ticket.toRegion]
  · simp [State.updateTicket, updateTicketAt_of_ne _ _ _ _ h]

@[simp] theorem applyObservedFact_region (tasks : List Nat) (s : State) (fact : Fact) (t : Nat) :
    ((applyObservedFact tasks s fact).tickets t).toRegion = (s.tickets t).toRegion := by
  simp only [applyObservedFact]
  split
  · exact toRegion_updateTicket_present _ _ _ _ _
  · rfl

@[simp] theorem clearUnobservedTask_region (subjects : List Nat) (s : State) (u t : Nat) :
    ((clearUnobservedTask subjects s u).tickets t).toRegion = (s.tickets t).toRegion := by
  simp only [clearUnobservedTask]
  split
  · rfl
  · exact toRegion_updateTicket_present _ _ _ _ _

theorem foldl_region_preserve {α : Type} (t : Nat) (l : List α) (f : State → α → State)
    (hf : ∀ st a, ((f st a).tickets t).toRegion = (st.tickets t).toRegion) (s : State) :
    ((l.foldl f s).tickets t).toRegion = (s.tickets t).toRegion := by
  induction l generalizing s with
  | nil => rfl
  | cons x xs ih => rw [List.foldl_cons, ih (f s x), hf]

/-- A run-level event's apply never moves any region projection. -/
theorem runApply_region (e : Event) (s : State) (t : Nat) :
    ((runApply e s).tickets t).toRegion = (s.tickets t).toRegion := by
  cases e <;> try (simp [runApply]; done)
  simp only [runApply]
  split
  · rw [foldl_region_preserve t _ _ (fun st task => clearUnobservedTask_region _ _ _ _)]
    rw [foldl_region_preserve t _ _ (fun st fact => applyObservedFact_region _ _ _ _)]
  · rw [foldl_region_preserve t _ _ (fun st fact => applyObservedFact_region _ _ _ _)]

theorem foldl_tasks_preserve {α : Type} (l : List α) (f : State → α → State)
    (hf : ∀ st a, (f st a).tasks = st.tasks) (s : State) :
    (l.foldl f s).tasks = s.tasks := by
  induction l generalizing s with
  | nil => rfl
  | cons x xs ih => rw [List.foldl_cons, ih (f s x), hf]

@[simp] theorem applyObservedFact_tasks (tasks : List Nat) (s : State) (fact : Fact) :
    (applyObservedFact tasks s fact).tasks = s.tasks := by
  simp only [applyObservedFact]
  split <;> rfl

@[simp] theorem clearUnobservedTask_tasks (subjects : List Nat) (s : State) (task : Nat) :
    (clearUnobservedTask subjects s task).tasks = s.tasks := by
  simp only [clearUnobservedTask]
  split <;> rfl

theorem runApply_tasks (e : Event) (s : State) : (runApply e s).tasks = s.tasks := by
  cases e <;> try (simp [runApply]; done)
  simp only [runApply]
  split
  · rw [foldl_tasks_preserve _ _ (fun st task => clearUnobservedTask_tasks _ _ _)]
    rw [foldl_tasks_preserve _ _ (fun st fact => applyObservedFact_tasks _ _ _)]
  · rw [foldl_tasks_preserve _ _ (fun st fact => applyObservedFact_tasks _ _ _)]

@[simp] theorem regionOf_failRegion_same (s : State) (task : Nat) (reason : String) :
    regionOf (failRegion s task reason) task =
      { regionOf s task with failed := some reason } := by
  simp [failRegion, State.updateTicket, regionOf, Ticket.toRegion]

@[simp] theorem regionOf_failRegion_other (s : State) (owner task : Nat)
    (different : task ≠ owner) (reason : String) :
    regionOf (failRegion s owner reason) task = regionOf s task := by
  simp [failRegion, State.updateTicket, regionOf, different]

/-- One concrete live journal step projects to exactly one task-local step.
    Shared guards may inspect the full state, as the JavaScript CAS and stale
    head guards do, but they can only fail the Run; they cannot rewrite a
    region. -/
theorem step_region_of_live (s : State) (task : Nat) (event : Event)
    (live : (step true s event).runFailed = none) :
    regionOf (step true s event) task = regionStep task (regionOf s task) event := by
  cases failed : s.runFailed with
  | some reason => simp [step, failed] at live
  | none =>
    cases terminated : s.runTerminated with
    | true => simp [step, failed, terminated, failRun] at live
    | false =>
      cases eventTask : event.task? with
      | none =>
        cases guard : runGuard s event with
        | some reason => simp [step, failed, terminated, eventTask, runStep, guard, failRun] at live
        | none =>
          simpa [step, failed, terminated, eventTask, runStep, guard, regionStep,
            regionOf] using runApply_region event s task
      | some owner =>
        by_cases known : owner ∈ s.tasks
        · cases ownerFailed : (s.tickets owner).failed with
          | some reason =>
            have regionFailed : (regionOf s owner).failed = some reason := by
              simpa [regionOf, Ticket.toRegion] using ownerFailed
            by_cases same : owner = task
            · subst owner
              simp [step, failed, terminated, eventTask, known, taskEventStep,
                ownerFailed, regionStep, regionFailed]
            · have different : some owner ≠ some task := by simp [same]
              simp [step, failed, terminated, eventTask, known, taskEventStep,
                ownerFailed, regionStep, different]
          | none =>
            have regionNotFailed : (regionOf s owner).failed = none := by
              simpa [regionOf, Ticket.toRegion] using ownerFailed
            cases localResult : localGuard (s.tickets owner).toRegion event with
            | some reason =>
              have localRegionResult : localGuard (regionOf s owner) event = some reason := localResult
              by_cases same : owner = task
              · subst owner
                simp [step, failed, terminated, eventTask, known, taskEventStep,
                  ownerFailed, localResult, regionStep, regionNotFailed,
                  localRegionResult]
              · have different : some owner ≠ some task := by simp [same]
                have taskDifferent : task ≠ owner := Ne.symm same
                simp [step, failed, terminated, eventTask, known, taskEventStep,
                  ownerFailed, localResult, regionStep, different, taskDifferent]
            | none =>
              have localRegionResult : localGuard (regionOf s owner) event = none := localResult
              cases sharedResult : sharedGuard s event with
              | some reason =>
                simp [step, failed, terminated, eventTask, known, taskEventStep,
                  ownerFailed, localResult, sharedResult, failRun] at live
              | none =>
                by_cases same : owner = task
                · subst owner
                  have fullStep : step true s event = stateApply task event s := by
                    simp [step, failed, terminated, eventTask, known, taskEventStep,
                      ownerFailed, localResult, sharedResult]
                  rw [fullStep]
                  change ((stateApply task event s).tickets task).toRegion = _
                  rw [stateApply_region]
                  have projectedNotFailed : (s.tickets task).toRegion.failed = none := by
                    simpa [Ticket.toRegion] using ownerFailed
                  simp [regionStep, eventTask, projectedNotFailed, localResult, regionOf]
                · have different : some owner ≠ some task := by simp [same]
                  have fullStep : step true s event = stateApply owner event s := by
                    simp [step, failed, terminated, eventTask, known, taskEventStep,
                      ownerFailed, localResult, sharedResult]
                  rw [fullStep]
                  change ((stateApply owner event s).tickets task).toRegion = _
                  rw [stateApply_other same]
                  simp [regionStep, eventTask, different, regionOf]
        · simp [step, failed, terminated, eventTask, known, failRun] at live

/-- A chronological trace remains shared-valid when every concrete step leaves
    the Run live. Task-local contradictions are allowed and remain sticky. -/
def SharedValid : State → List Event → Prop
  | _, [] => True
  | state, event :: rest =>
      (step true state event).runFailed = none ∧
      SharedValid (step true state event) rest

theorem regional_contradiction_from (state : State) (task : Nat) (events : List Event)
    (valid : SharedValid state events) :
    regionOf (foldFrom state events) task =
      events.foldl (regionStep task) (regionOf state task) := by
  induction events generalizing state with
  | nil => rfl
  | cons event rest ih =>
    rcases valid with ⟨headLive, tailValid⟩
    change regionOf (foldFrom (step true state event) rest) task =
      rest.foldl (regionStep task) (regionStep task (regionOf state task) event)
    rw [ih (step true state event) tailValid]
    exact congrArg (fun region => rest.foldl (regionStep task) region)
      (step_region_of_live state task event headLive)

/-- P3 for the concrete 23-event semantics, over an arbitrary finite task
    universe and an unbounded journal. -/
theorem regional_contradiction (tasks : List Nat) (task : Nat) (events : List Event)
    (valid : SharedValid (initialState tasks) events) :
    regionOf (fold tasks events) task = foldRegion tasks task events :=
  regional_contradiction_from (initialState tasks) task events valid

end Journal
