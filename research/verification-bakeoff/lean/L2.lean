/-
  L2 of ../INVARIANTS.md in Lean 4: the delivery protocol as a transition
  system, with the same actions and invariants as ../quint/deliveryCore.qnt and
  ../tlaplus/Delivery.tla.

  This is the experiment the L1 files could not run. L1 is a total function, so
  a proof assistant is on home ground. L2 is a state machine, which is what
  model checkers are for, and the question is what a proof assistant charges to
  do the same job.

  The answer, in one line: a model checker is *given* the invariant and finds
  the reachable states itself. Lean must be given an invariant that is already
  inductive, and making it inductive is the entire cost. See `Inv` below, where
  `attemptsBounded` is not provable on its own and needs `phaseBoundsAttempts`
  to carry it.

  Self-contained: no Mathlib.
-/

namespace L2

/-- Two tasks. `Bool` rather than `Fin 2` keeps case analysis to `cases`. -/
abbrev TaskId := Bool

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
  | settled
  deriving DecidableEq, Repr

open Phase

/-- A position is held exactly in these two phases. -/
def holdsPosition : Phase → Bool
  | executing | suspensionRequested => true
  | _ => false

structure Ticket where
  phase : Phase
  attempts : Nat
  present : Bool
  isOpen : Bool
  expectedHead : Nat
  deriving Repr

structure St where
  ticket : TaskId → Ticket
  capacity : Nat
  holds : TaskId → Bool
  paused : Bool
  target : Option TaskId
  head : Nat
  crashed : Bool
  /-- History flags. I8 and I13 are transition properties, so a state
      predicate cannot express them and the state must carry the evidence. -/
  admissionOk : Bool
  promotedExact : Bool

/-- Number of held task-work positions. -/
def heldCount (s : St) : Nat :=
  (if s.holds false then 1 else 0) + (if s.holds true then 1 else 0)

/-- Functional update at one task. -/
def upd (f : TaskId → Ticket) (t : TaskId) (v : Ticket) : TaskId → Ticket :=
  fun u => if u = t then v else f u

def updB (f : TaskId → Bool) (t : TaskId) (v : Bool) : TaskId → Bool :=
  fun u => if u = t then v else f u

def init : St :=
  { ticket := fun _ => ⟨noObligation, 0, false, false, 0⟩
    capacity := 1
    holds := fun _ => false
    paused := false
    target := none
    head := 0
    crashed := false
    admissionOk := true
    promotedExact := true }

/-- The transition relation of ../MODEL.md. -/
inductive Step : St → St → Prop where
  | observeGraph (s : St) (t : TaskId) (p o : Bool) :
      Step s { s with ticket := upd s.ticket t ({ s.ticket t with present := p, isOpen := o }) }
  | acquireClaim (s : St) (t : TaskId) :
      s.crashed = false →
      (s.ticket t).phase = noObligation →
      Step s { s with ticket := upd s.ticket t ({ s.ticket t with phase := claimed }) }
  | planAttempt (s : St) (t : TaskId) :
      s.crashed = false →
      (s.ticket t).phase = claimed →
      Step s { s with ticket := upd s.ticket t ({ s.ticket t with phase := planned, attempts := (s.ticket t).attempts + 1 }) }
  | beginWork (s : St) (t : TaskId) :
      s.crashed = false →
      s.paused = false →
      (s.ticket t).phase = planned →
      heldCount s < s.capacity →
      Step s { s with ticket := upd s.ticket t ({ s.ticket t with phase := executing })
                      holds := updB s.holds t true }
  | requestSuspension (s : St) (t : TaskId) :
      s.crashed = false →
      (s.ticket t).phase = executing →
      Step s { s with ticket := upd s.ticket t ({ s.ticket t with phase := suspensionRequested }) }
  | safelySuspend (s : St) (t : TaskId) :
      s.crashed = false →
      (s.ticket t).phase = suspensionRequested →
      Step s { s with ticket := upd s.ticket t ({ s.ticket t with phase := suspended })
                      holds := updB s.holds t false }
  | resumeWork (s : St) (t : TaskId) :
      s.crashed = false →
      s.paused = false →
      (s.ticket t).phase = suspended →
      heldCount s < s.capacity →
      Step s { s with ticket := upd s.ticket t ({ s.ticket t with phase := executing })
                      holds := updB s.holds t true }
  | reportAccepted (s : St) (t : TaskId) :
      s.crashed = false →
      (s.ticket t).phase = executing →
      Step s { s with ticket := upd s.ticket t ({ s.ticket t with phase := accepted })
                      holds := updB s.holds t false }
  | startIntegration (s : St) (t : TaskId) :
      s.crashed = false →
      (s.ticket t).phase = accepted →
      s.target = none →
      Step s { s with ticket := upd s.ticket t ({ s.ticket t with phase := integrating, expectedHead := s.head })
                      target := some t }
  | promote (s : St) (t : TaskId) :
      s.crashed = false →
      (s.ticket t).phase = integrating →
      (s.ticket t).expectedHead = s.head →
      Step s { s with ticket := upd s.ticket t ({ s.ticket t with phase := promoted })
                      target := none
                      head := s.head + 1 }
  | settle (s : St) (t : TaskId) :
      s.crashed = false →
      (s.ticket t).phase = promoted →
      Step s { s with ticket := upd s.ticket t ({ s.ticket t with phase := settled }) }
  | applyPause (s : St) :
      s.crashed = false → Step s { s with paused := true }
  | applyUnpause (s : St) :
      s.crashed = false → Step s { s with paused := false }
  | changeCapacity (s : St) (c : Nat) :
      s.crashed = false → Step s { s with capacity := c }
  | externalTargetAdvance (s : St) :
      Step s { s with head := s.head + 1 }
  | crash (s : St) :
      s.crashed = false →
      Step s { s with crashed := true
                      holds := fun _ => false
                      target := none
                      ticket := fun u =>
                        if (s.ticket u).phase = integrating
                        then ({ s.ticket u with phase := accepted })
                        else s.ticket u }
  | recover (s : St) :
      s.crashed = true →
      Step s { s with crashed := false
                      holds := fun u => holdsPosition (s.ticket u).phase }

/-- Reachability. -/
inductive Reachable : St → Prop where
  | init : Reachable init
  | step {s s' : St} : Reachable s → Step s s' → Reachable s'

/- ------------------------------------------------------------- invariants -/

/-- I7. Conditioned on `crashed`, exactly as in the Quint and TLA+ encodings. -/
def positionDiscipline (s : St) : Prop :=
  s.crashed = true ∨ ∀ t, s.holds t = holdsPosition (s.ticket t).phase

/-- I14. Process loss clears every process-local resource. -/
def processLocalLostOnCrash (s : St) : Prop :=
  s.crashed = false ∨ ((∀ t, s.holds t = false) ∧ s.target = none)

/-- I10. -/
def attemptsBounded (s : St) : Prop := ∀ t, (s.ticket t).attempts ≤ 1

/--
  The strengthening `attemptsBounded` needs and a model checker never asked
  for. A task that has not yet been planned has no attempt, and every phase
  after planning has exactly one. Without this, the `planAttempt` case of the
  induction is unprovable: knowing only `attempts ≤ 1` beforehand permits
  `attempts = 1`, and the action would push it to 2.
-/
def phaseBoundsAttempts (s : St) : Prop :=
  ∀ t, ((s.ticket t).phase = noObligation ∨ (s.ticket t).phase = claimed)
        → (s.ticket t).attempts = 0

/-- I12/I14. -/
def targetMatchesPhase (s : St) : Prop :=
  ∀ t, s.target = some t → (s.ticket t).phase = integrating

/-- The conjunction carried through the induction. -/
structure Inv (s : St) : Prop where
  position : positionDiscipline s
  crashClears : processLocalLostOnCrash s
  attempts : attemptsBounded s
  phaseAttempts : phaseBoundsAttempts s
  targetPhase : targetMatchesPhase s

/- ------------------------------------------------------------------ proofs -/

/-- Pointwise reduction of `upd` at the updated task. -/
theorem upd_pos (f : TaskId → Ticket) (t : TaskId) (v : Ticket) : upd f t v t = v := by
  simp [upd]

/-- Pointwise reduction of `upd` away from the updated task. -/
theorem upd_neg {f : TaskId → Ticket} {t u : TaskId} {v : Ticket} (hu : u ≠ t) :
    upd f t v u = f u := by
  simp [upd, hu]

/-- When the process is live, `positionDiscipline` is the pointwise equation. -/
theorem pos_of_live {s : St} (h : Inv s) (hnc : s.crashed = false) :
    ∀ u, s.holds u = holdsPosition (s.ticket u).phase := by
  rcases h.position with hc | hp
  · simp [hnc] at hc
  · exact hp

/-- `targetMatchesPhase` when the target is unchanged and the touched task is not
    the integrating one. -/
theorem target_upd {s s' : St} (h : Inv s) (t : TaskId) (v : Ticket)
    (ht : s'.ticket = upd s.ticket t v)
    (htar : s'.target = s.target)
    (hne : (s.ticket t).phase ≠ integrating) :
    targetMatchesPhase s' := by
  intro u hu
  rw [htar] at hu
  rw [ht]
  by_cases hu2 : u = t
  · subst hu2; exact absurd (h.targetPhase u hu) hne
  · rw [upd_neg hu2]; exact h.targetPhase u hu

/-- `targetMatchesPhase` when the target is cleared. -/
theorem target_none {s' : St} (htar : s'.target = none) : targetMatchesPhase s' := by
  intro u hu
  rw [htar] at hu
  simp at hu

/-- `targetMatchesPhase` when the target is set to the task just made integrating. -/
theorem target_set {s s' : St} (t : TaskId) (v : Ticket)
    (ht : s'.ticket = upd s.ticket t v)
    (htar : s'.target = some t)
    (hv : v.phase = integrating) :
    targetMatchesPhase s' := by
  intro u hu
  rw [htar] at hu
  have htu : t = u := by injection hu
  subst htu
  rw [ht, upd_pos, hv]

/--
  The workhorse for the live single-task actions: the new state differs from the
  old one in the ticket of `t`, possibly in `holds t`, and nothing else that the
  invariant reads.
-/
theorem inv_upd {s s' : St} (h : Inv s) (t : TaskId) (v : Ticket)
    (ht : s'.ticket = upd s.ticket t v)
    (hh1 : s'.holds t = holdsPosition v.phase)
    (hh2 : ∀ u, u ≠ t → s'.holds u = s.holds u)
    (hpold : ∀ u, s.holds u = holdsPosition (s.ticket u).phase)
    (hcr : s'.crashed = false)
    (hattv : v.attempts ≤ 1)
    (hpav : (v.phase = noObligation ∨ v.phase = claimed) → v.attempts = 0)
    (htg : targetMatchesPhase s') :
    Inv s' := by
  refine ⟨Or.inr ?_, Or.inl hcr, ?_, ?_, htg⟩
  · intro u
    by_cases hu : u = t
    · subst hu; rw [ht, upd_pos]; exact hh1
    · rw [ht, upd_neg hu, hh2 u hu]; exact hpold u
  · intro u
    rw [ht]
    by_cases hu : u = t
    · subst hu; rw [upd_pos]; exact hattv
    · rw [upd_neg hu]; exact h.attempts u
  · intro u hu2
    rw [ht] at hu2 ⊢
    by_cases hu : u = t
    · subst hu; rw [upd_pos] at hu2 ⊢; exact hpav hu2
    · rw [upd_neg hu] at hu2 ⊢; exact h.phaseAttempts u hu2

/--
  The variant for `observeGraph`, which may fire while crashed and which leaves
  the phase (hence every invariant-relevant field) alone.
-/
theorem inv_upd_gen {s s' : St} (h : Inv s) (t : TaskId) (v : Ticket)
    (ht : s'.ticket = upd s.ticket t v)
    (hh : s'.holds = s.holds)
    (hcr : s'.crashed = s.crashed)
    (htar : s'.target = s.target)
    (hphv : v.phase = (s.ticket t).phase)
    (hattv : v.attempts ≤ 1)
    (hpav : (v.phase = noObligation ∨ v.phase = claimed) → v.attempts = 0) :
    Inv s' := by
  refine ⟨?_, ?_, ?_, ?_, ?_⟩
  · rcases h.position with hc | hp
    · exact Or.inl (by rw [hcr]; exact hc)
    · refine Or.inr fun u => ?_
      rw [hh, ht]
      by_cases hu : u = t
      · subst hu; rw [upd_pos, hphv]; exact hp u
      · rw [upd_neg hu]; exact hp u
  · rcases h.crashClears with hc | ⟨h1, h2⟩
    · exact Or.inl (by rw [hcr]; exact hc)
    · exact Or.inr ⟨by rw [hh]; exact h1, by rw [htar]; exact h2⟩
  · intro u
    rw [ht]
    by_cases hu : u = t
    · subst hu; rw [upd_pos]; exact hattv
    · rw [upd_neg hu]; exact h.attempts u
  · intro u hu2
    rw [ht] at hu2 ⊢
    by_cases hu : u = t
    · subst hu; rw [upd_pos] at hu2 ⊢; exact hpav hu2
    · rw [upd_neg hu] at hu2 ⊢; exact h.phaseAttempts u hu2
  · intro u hu
    rw [htar] at hu
    rw [ht]
    by_cases hu2 : u = t
    · subst hu2; rw [upd_pos, hphv]; exact h.targetPhase u hu
    · rw [upd_neg hu2]; exact h.targetPhase u hu

theorem inv_init : Inv init := by
  refine ⟨Or.inr fun _ => rfl, Or.inr ⟨fun _ => rfl, rfl⟩, fun _ => Nat.zero_le 1,
    fun _ _ => rfl, ?_⟩
  intro u hu
  simp [init] at hu

theorem inv_step {s s' : St} (h : Inv s) (hs : Step s s') : Inv s' := by
  cases hs with
  | observeGraph t p o =>
      exact inv_upd_gen h t _ rfl rfl rfl rfl rfl (h.attempts t)
        (fun hx => h.phaseAttempts t hx)
  | acquireClaim t h1 h2 =>
      have hpold := pos_of_live h h1
      exact inv_upd h t _ rfl (by simp [hpold t, h2, holdsPosition])
        (fun _ _ => rfl) hpold h1 (h.attempts t)
        (fun _ => h.phaseAttempts t (Or.inl h2))
        (target_upd h t _ rfl rfl (by simp [h2]))
  | planAttempt t h1 h2 =>
      have hpold := pos_of_live h h1
      exact inv_upd h t _ rfl (by simp [hpold t, h2, holdsPosition])
        (fun _ _ => rfl) hpold h1
        (by simp [h.phaseAttempts t (Or.inr h2)])
        (by simp)
        (target_upd h t _ rfl rfl (by simp [h2]))
  | beginWork t h1 h2 h3 h4 =>
      have hpold := pos_of_live h h1
      exact inv_upd h t _ rfl (by simp [updB, holdsPosition])
        (fun u hu => by simp [updB, hu]) hpold h1 (h.attempts t) (by simp)
        (target_upd h t _ rfl rfl (by simp [h3]))
  | requestSuspension t h1 h2 =>
      have hpold := pos_of_live h h1
      exact inv_upd h t _ rfl (by simp [hpold t, h2, holdsPosition])
        (fun _ _ => rfl) hpold h1 (h.attempts t) (by simp)
        (target_upd h t _ rfl rfl (by simp [h2]))
  | safelySuspend t h1 h2 =>
      have hpold := pos_of_live h h1
      exact inv_upd h t _ rfl (by simp [updB, holdsPosition])
        (fun u hu => by simp [updB, hu]) hpold h1 (h.attempts t) (by simp)
        (target_upd h t _ rfl rfl (by simp [h2]))
  | resumeWork t h1 h2 h3 h4 =>
      have hpold := pos_of_live h h1
      exact inv_upd h t _ rfl (by simp [updB, holdsPosition])
        (fun u hu => by simp [updB, hu]) hpold h1 (h.attempts t) (by simp)
        (target_upd h t _ rfl rfl (by simp [h3]))
  | reportAccepted t h1 h2 =>
      have hpold := pos_of_live h h1
      exact inv_upd h t _ rfl (by simp [updB, holdsPosition])
        (fun u hu => by simp [updB, hu]) hpold h1 (h.attempts t) (by simp)
        (target_upd h t _ rfl rfl (by simp [h2]))
  | startIntegration t h1 h2 h3 =>
      have hpold := pos_of_live h h1
      exact inv_upd h t _ rfl (by simp [hpold t, h2, holdsPosition])
        (fun _ _ => rfl) hpold h1 (h.attempts t) (by simp)
        (target_set t _ rfl rfl rfl)
  | promote t h1 h2 h3 =>
      have hpold := pos_of_live h h1
      exact inv_upd h t _ rfl (by simp [hpold t, h2, holdsPosition])
        (fun _ _ => rfl) hpold h1 (h.attempts t) (by simp) (target_none rfl)
  | settle t h1 h2 =>
      have hpold := pos_of_live h h1
      exact inv_upd h t _ rfl (by simp [hpold t, h2, holdsPosition])
        (fun _ _ => rfl) hpold h1 (h.attempts t) (by simp)
        (target_upd h t _ rfl rfl (by simp [h2]))
  | applyPause h1 =>
      exact ⟨h.position, h.crashClears, h.attempts, h.phaseAttempts, h.targetPhase⟩
  | applyUnpause h1 =>
      exact ⟨h.position, h.crashClears, h.attempts, h.phaseAttempts, h.targetPhase⟩
  | changeCapacity c h1 =>
      exact ⟨h.position, h.crashClears, h.attempts, h.phaseAttempts, h.targetPhase⟩
  | externalTargetAdvance =>
      exact ⟨h.position, h.crashClears, h.attempts, h.phaseAttempts, h.targetPhase⟩
  | crash h1 =>
      refine ⟨Or.inl rfl, Or.inr ⟨fun _ => rfl, rfl⟩, ?_, ?_, target_none rfl⟩
      · intro u
        by_cases hq : (s.ticket u).phase = integrating
        · simpa [hq] using h.attempts u
        · simpa [hq] using h.attempts u
      · intro u hu2
        by_cases hq : (s.ticket u).phase = integrating
        · simp [hq] at hu2
        · simp only [hq, if_false] at hu2 ⊢
          exact h.phaseAttempts u hu2
  | recover h1 =>
      exact ⟨Or.inr fun _ => rfl, Or.inl rfl, h.attempts, h.phaseAttempts, h.targetPhase⟩

theorem inv_reachable {s : St} (h : Reachable s) : Inv s := by
  induction h with
  | init => exact inv_init
  | step _ hst ih => exact inv_step ih hst

/-- I10 as the consumer sees it, discharged through the strengthening. -/
theorem reachable_attempts_le_one {s : St} (h : Reachable s) (t : TaskId) :
    (s.ticket t).attempts ≤ 1 :=
  (inv_reachable h).attempts t


/- ---------------------------------------------------------- vacuity checks -/

/-
  Every theorem above quantifies over reachable states, so all of them hold
  vacuously if nothing interesting is reachable. These are the Lean form of the
  witness refutation that `tlaplus/run.sh --witness` performs, and they are not
  optional.

  The trace is spelled out one state at a time. A model checker would find it;
  here it has to be written, which is itself part of the cost being measured.
-/

abbrev s1 : St :=
  { init with ticket := upd init.ticket false ({ init.ticket false with present := true, isOpen := true }) }

abbrev s2 : St :=
  { s1 with ticket := upd s1.ticket false ({ s1.ticket false with phase := claimed }) }

abbrev s3 : St :=
  { s2 with ticket := upd s2.ticket false ({ s2.ticket false with phase := planned, attempts := (s2.ticket false).attempts + 1 }) }

abbrev s4 : St :=
  { s3 with ticket := upd s3.ticket false ({ s3.ticket false with phase := executing }), holds := updB s3.holds false true }

abbrev s5 : St :=
  { s4 with ticket := upd s4.ticket false ({ s4.ticket false with phase := accepted }), holds := updB s4.holds false false }

abbrev s6 : St :=
  { s5 with ticket := upd s5.ticket false ({ s5.ticket false with phase := integrating, expectedHead := s5.head }), target := some false }

abbrev s7 : St := { s6 with head := s6.head + 1 }

theorem s4_reachable : Reachable s4 :=
  Reachable.step
    (Reachable.step
      (Reachable.step
        (Reachable.step Reachable.init (Step.observeGraph init false true true))
        (Step.acquireClaim s1 false rfl rfl))
      (Step.planAttempt s2 false rfl rfl))
    (Step.beginWork s3 false rfl rfl rfl (by decide))

/-- A task really does reach `executing` while holding a position. -/
theorem executing_is_reachable :
    Reachable s4 ∧ (s4.ticket false).phase = executing ∧ s4.holds false = true :=
  ⟨s4_reachable, rfl, rfl⟩

theorem s7_reachable : Reachable s7 :=
  Reachable.step
    (Reachable.step
      (Reachable.step s4_reachable (Step.reportAccepted s4 false rfl rfl))
      (Step.startIntegration s5 false rfl rfl rfl))
    (Step.externalTargetAdvance s6)

/--
  A stale expected head is reachable, so `promote`'s compare-and-set guard is
  defending against something. This is the exact vacuity that made mutant M6
  undetectable until `externalTargetAdvance` was added to the model.
-/
theorem stale_head_is_reachable :
    Reachable s7 ∧ (s7.ticket false).phase = integrating
      ∧ (s7.ticket false).expectedHead ≠ s7.head :=
  ⟨s7_reachable, rfl, by decide⟩

/--
  `Inv` is not trivially true. Without this, `inv_reachable` could be a proof
  about a predicate that holds of every state.
-/
theorem inv_is_refutable : ∃ s : St, ¬ Inv s := by
  refine ⟨{ init with holds := fun _ => true }, ?_⟩
  intro h
  cases h.position with
  | inl hc => exact Bool.noConfusion hc
  | inr hp => exact Bool.noConfusion (hp false)

end L2
