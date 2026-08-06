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
(* able. That assumption belongs in the open, which is why                  *)
(* EventuallyUninterrupted is a hypothesis of I18 below rather than         *)
(* something the fairness constraints quietly supply.                       *)
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

(* The operator eventually stops interrupting. RequestSuspension is the only
   way into SuspensionRequested, so this permits finitely many suspend/resume
   cycles and forbids infinitely many.

   This is the same KIND of hypothesis as EventuallyRunning and belongs beside
   it: an operator suspending forever is a legitimate thing to do, and under it
   nothing settles. Without this, I18 is false for a reason that is not a
   defect. *)
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
(* acceptance. Stated as a hypothesis about a permanent pause, which is the *)
(* only form in which a drain claim is meaningful.                          *)
(***************************************************************************)
PauseDrainsPositions ==
  ([]paused /\ EventuallyStable) => <>(positions = {})

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
  (EventuallyStable /\ EventuallyRunning /\ EventuallyRoomy
     /\ EventuallyUninterrupted) =>
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

(***************************************************************************)
(* The suspend/resume lasso, isolated.                                     *)
(*                                                                          *)
(* Two explanations compete for it: fairness on a disjunction is too weak,  *)
(* or I18 is missing an environment hypothesis. Three runs separate them,   *)
(* all at one task -- see ./run-liveness.sh --lasso:                        *)
(*                                                                          *)
(*   DisjunctionSpec |= EveryBegunSettlesPlain          VIOLATED            *)
(*   DisjunctionSpec |= EveryBegunSettles               HOLDS               *)
(*   LiveSpec        |= EveryBegunSettlesPlain          HOLDS               *)
(*                                                                          *)
(* The middle row is the answer: weak fairness plus an honest hypothesis is *)
(* enough. The third row holds for the wrong reason -- per-action SF on     *)
(* ReportAccepted assumes away the operator rather than saying so.          *)
(***************************************************************************)

\* Fairness on the disjunction rather than per action.
DisjunctionSpec ==
  /\ Init
  /\ [][Next]_vars
  /\ \A t \in Tasks : SF_vars(Progress(t))
  /\ SF_vars(Recover)

\* I18 without the operator hypothesis: false, and rightly so.
EveryBegunSettlesPlain ==
  (EventuallyStable /\ EventuallyRunning /\ EventuallyRoomy) =>
    \A t \in Tasks : (tickets[t].phase = "Executing") ~> Terminal(t)


Quiescent == ~ENABLED AnyProgress

ReachesQuiescence == EventuallyStable => <>[]Quiescent

=============================================================================
