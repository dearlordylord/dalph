------------------------- MODULE DeliveryLiveness -------------------------
(***************************************************************************)
(* I17-I19 of ../INVARIANTS.md: the temporal half of the specification.     *)
(*                                                                          *)
(* This extends Delivery rather than editing it, because liveness needs a   *)
(* DIFFERENT SPEC, not just extra properties. Two things change:            *)
(*                                                                          *)
(*   1. Fairness moves from `WF_vars(Next)` to per-action strong fairness.  *)
(*      `WF_vars(Next)` says only "some step keeps happening", which is     *)
(*      satisfied by a machine that observes the graph forever and never    *)
(*      touches a ticket. It is enough for safety and useless for liveness. *)
(*                                                                          *)
(*   2. The properties carry environment assumptions. Every one of I17-I19  *)
(*      is false without them, because the environment can crash, pause, or *)
(*      contract capacity forever. Safety properties needed no such         *)
(*      hypotheses. This is the first place in the bake-off where the       *)
(*      SPECIFICATION, not the tool, has to grow.                           *)
(***************************************************************************)
EXTENDS Delivery

(***************************************************************************)
(* Progress vs environment                                                 *)
(*                                                                          *)
(* Progress is what Dalph does; the rest is what the world does to it.      *)
(* Only Progress gets fairness. RequestSuspension is deliberately outside   *)
(* it: asking to suspend is an operator decision, not an obligation, and    *)
(* the system must reach quiescence whether or not it is ever asked.        *)
(***************************************************************************)

Progress(t) ==
  \/ AcquireClaim(t) \/ PlanAttempt(t) \/ BeginWork(t)
  \/ SafelySuspend(t) \/ ResumeWork(t) \/ ReportAccepted(t)
  \/ StartIntegration(t) \/ Promote(t) \/ Settle(t)
  \/ AbandonIntegration(t)

AnyProgress == (\E t \in Tasks : Progress(t)) \/ Recover

(***************************************************************************)
(* Strong, not weak.                                                       *)
(*                                                                          *)
(* With two tasks Accepted, the integration resource is exclusive, so each  *)
(* task's StartIntegration is repeatedly enabled and repeatedly disabled.   *)
(* WF permits starving one of them forever; SF does not. Same for BeginWork *)
(* under a fluctuating capacity. That is the real argument for SF here.     *)
(*                                                                          *)
(* Per action rather than SF_vars(Progress(t)) is a WEAKER claim than it    *)
(* looks, and it is worth knowing exactly what it buys. Fairness on a       *)
(* disjunction is discharged by taking any disjunct infinitely often, so    *)
(* under SF_vars(Progress(t)) a ticket may cycle                            *)
(* Executing -> SuspensionRequested -> Suspended -> Executing forever with  *)
(* ReportAccepted enabled at every pass and never chosen.                   *)
(*                                                                          *)
(* Naming the actions separately removes that lasso -- but not because the  *)
(* lasso was a fairness defect. An operator is entitled to request          *)
(* suspension forever, and under that behaviour the work genuinely never    *)
(* finishes. SF_vars(ReportAccepted(t)) removes the lasso by ASSUMING the   *)
(* executor outruns the operator: work is atomic in this model, so "enabled *)
(* infinitely often" and "given long enough to finish" are indistinguish-   *)
(* able. docs/CONTEXT.md settles which reading is right: safe suspension    *)
(* preserves what is needed to resume, so the cycle progresses and the      *)
(* lasso is a modelling artifact. Per-action SF is therefore the faithful   *)
(* abstraction, not a dodge, and I18 needs no operator hypothesis.          *)
(*                                                                          *)
(* DisjunctionSpec at the bottom of this file makes the difference          *)
(* checkable rather than arguable.                                          *)
(***************************************************************************)
Fairness(t) ==
  /\ SF_vars(AcquireClaim(t))
  /\ SF_vars(PlanAttempt(t))
  /\ SF_vars(BeginWork(t))
  /\ SF_vars(SafelySuspend(t))
  /\ SF_vars(ResumeWork(t))
  /\ SF_vars(ReportAccepted(t))
  /\ SF_vars(StartIntegration(t))
  /\ SF_vars(Promote(t))
  /\ SF_vars(AbandonIntegration(t))
  /\ SF_vars(Settle(t))

LiveSpec ==
  /\ Init
  /\ [][Next]_vars
  /\ \A t \in Tasks : Fairness(t)
  /\ SF_vars(Recover)

(***************************************************************************)
(* Environment assumptions.                                                *)
(*                                                                          *)
(* Not fairness constraints -- hypotheses inside the property. A property   *)
(* of the form `Assumption => Guarantee` is checkable without weakening the *)
(* spec, and it documents exactly which parts of I17-I19 are conditional.   *)
(***************************************************************************)

EventuallyStable  == <>[](~crashed)
EventuallyRunning == <>[](~paused)
EventuallyRoomy   == <>[](capacity > 0)

(* The operator eventually stops interrupting.

   NOT a hypothesis of I18, and the reason is a domain fact rather than a
   modelling preference. docs/CONTEXT.md defines planned-attempt executor-work
   suspension as the executor's proof that its work "is safely stopped, HAS
   PRESERVED WHAT IT NEEDS TO RESUME the same attempt, and has no
   executor-owned activity still running". Progress survives a suspend/resume
   cycle, so an operator suspending forever does not prevent completion.

   Used only by EveryBegunSettlesUninterrupted below, to show what assuming it
   would buy. *)
EventuallyUninterrupted ==
  <>[](\A t \in Tasks : tickets[t].phase # "SuspensionRequested")

(***************************************************************************)
(* I17 Pause.                                                              *)
(*                                                                          *)
(* "After an applied pause, no admission occurs; existing holders           *)
(* eventually reach safe suspension."                                       *)
(*                                                                          *)
(* Under a pause that stays applied, BeginWork and ResumeWork are disabled  *)
(* by their `~paused` guards -- that half is already safety. The temporal   *)
(* half is the drain: held positions must empty out, by suspension or by    *)
(* acceptance, and stay empty because nothing can be admitted.              *)
(*                                                                          *)
(* The hypothesis is `<>[]paused`, NOT `[]paused`. Init sets paused = FALSE *)
(* (Delivery.tla), so no behaviour satisfies `[]paused` and that form makes *)
(* the whole property vacuously true -- a clean verdict over an empty set   *)
(* of behaviours. PauseIsSustainable below refutes the vacuity directly.    *)
(***************************************************************************)
PauseDrainsPositions ==
  (<>[]paused /\ EventuallyStable) => <>[](positions = {})

\* Witness. TLC is asked to refute this, so a reported violation means a
\* behaviour with a permanently applied pause EXISTS and the hypothesis of
\* PauseDrainsPositions is satisfiable.
PauseIsSustainable == []<>(~paused)

(***************************************************************************)
(* I18 No silent drop.                                                     *)
(*                                                                          *)
(* "Every begun responsibility eventually settles or is retained together   *)
(* with an exact stated reason."                                            *)
(*                                                                          *)
(* The leads-to operator is the whole statement. Note what the assumptions  *)
(* have to exclude: perpetual crashing, perpetual pause, and a capacity     *)
(* pinned at zero. Each was harmless for safety.                            *)
(*                                                                          *)
(* The disjunction in Terminal is load-bearing. Stated as `~> Settled` the  *)
(* property is FALSE, with a counterexample that parks a ticket in          *)
(* Integrating behind a stale head forever. Both halves of I18 have to be   *)
(* present: the invariant says "settles OR is retained with an exact stated *)
(* reason", and Abandoned is that second disjunct.                          *)
(*                                                                          *)
(* Four hypotheses, and every one of them is a thing an operator or the     *)
(* world is entitled to do forever. None of the nine safety invariants      *)
(* needed a single one.                                                     *)
(***************************************************************************)
Terminal(t) == tickets[t].phase \in {"Settled", "Abandoned"}

EveryBegunSettles ==
  (EventuallyStable /\ EventuallyRunning /\ EventuallyRoomy) =>
    \A t \in Tasks :
      (tickets[t].phase = "Executing") ~> Terminal(t)

(***************************************************************************)
(* I19 Quiescence.                                                         *)
(*                                                                          *)
(* "With no new tracker facts the run reaches quiescence. Quiescence proves *)
(* no currently executable action, not completion."                         *)
(*                                                                          *)
(* That distinction is literal here: `~ENABLED AnyProgress` is exactly "no  *)
(* currently executable action", and it says nothing about phases. A run    *)
(* parked at Planned with capacity 0 forever is quiescent and has completed *)
(* nothing. So I19 is strictly weaker than I18, and reading the two TLC     *)
(* verdicts side by side is the point of stating both.                      *)
(*                                                                          *)
(* No "no new tracker facts" hypothesis is needed: ObserveGraph can only    *)
(* re-enable progress for a ticket in NoObligation, and settled tickets     *)
(* never return there.                                                      *)
(***************************************************************************)
OneTask == {0}
ThreeTasks == {0, 1, 2}

(***************************************************************************)
(* The suspend/resume lasso, isolated.                                     *)
(*                                                                          *)
(* Two explanations compete for it: fairness on a disjunction is too weak,  *)
(* or I18 is missing an environment hypothesis. Three runs separate them,   *)
(* all at one task -- see ./run-liveness.sh --lasso:                        *)
(*                                                                          *)
(*   DisjunctionSpec |= EveryBegunSettles                VIOLATED           *)
(*   DisjunctionSpec |= EveryBegunSettlesUninterrupted   HOLDS              *)
(*   LiveSpec        |= EveryBegunSettles                HOLDS              *)
(*                                                                          *)
(* Row 3 is the answer. docs/CONTEXT.md defines safe suspension as          *)
(* preserving what is needed to resume, so the cycle makes progress and the *)
(* lasso is an artifact of work being atomic here. Row 2 buys the same      *)
(* verdict by assuming the operator away, and states an I18 weaker than the *)
(* system actually provides.                                                *)
(***************************************************************************)

\* Fairness on the disjunction rather than per action.
DisjunctionSpec ==
  /\ Init
  /\ [][Next]_vars
  /\ \A t \in Tasks : SF_vars(Progress(t))
  /\ SF_vars(Recover)

\* I18 with the operator hypothesis added. Not the primary form: the domain
\* does not need it, because safe suspension preserves progress.
EveryBegunSettlesUninterrupted ==
  (EventuallyStable /\ EventuallyRunning /\ EventuallyRoomy
     /\ EventuallyUninterrupted) =>
    \A t \in Tasks : (tickets[t].phase = "Executing") ~> Terminal(t)


Quiescent == ~ENABLED AnyProgress

ReachesQuiescence == EventuallyStable => <>[]Quiescent

=============================================================================
