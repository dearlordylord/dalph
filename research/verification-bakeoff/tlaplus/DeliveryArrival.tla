-------------------------- MODULE DeliveryArrival --------------------------
(***************************************************************************)
(* Task arrival, and the hypothesis I19 has always carried.                *)
(*                                                                          *)
(* INVARIANTS.md states I19 as "WITH NO NEW TRACKER FACTS the run reaches   *)
(* quiescence". The base model cannot express new facts at all: TASKS is    *)
(* fixed and a phase never returns to NoObligation, so work is exhaustible  *)
(* by construction and the hypothesis is satisfied silently. That makes a   *)
(* clean I19 verdict weaker than it looks.                                  *)
(*                                                                          *)
(* Arrival is modelled by RECYCLING a finished ticket -- a settled id is    *)
(* reused for a new responsibility -- and SealGraph is "the tracker stops   *)
(* producing facts", made into something a checker can be handed.           *)
(*                                                                          *)
(* THE RESULT IS THAT TLC CANNOT ANSWER THIS, and the reason is worth more  *)
(* than the answer would have been. Every completed responsibility advances *)
(* targetHead, so an endless arrival stream is an endless state space:      *)
(*                                                                          *)
(*   no CONSTRAINT    no verdict in 7 minutes, unbounded targetHead         *)
(*   CONSTRAINT       both properties hold, 5 472 states                    *)
(*                                                                          *)
(* The second row is unsound and is the exact hazard TLC warns about when a *)
(* state constraint is combined with liveness. ReachesQuiescenceUnsealed    *)
(* SHOULD be false -- an endless arrival stream is a legitimate behaviour   *)
(* under which the run never goes quiet -- and it "holds" only because the  *)
(* constraint truncates the recycling loop before it can close.             *)
(*                                                                          *)
(* So the practical answer to "should arrivals be capped?" is yes, and not  *)
(* for realism: an uncapped stream is not checkable here by either route.   *)
(* The cap belongs in the hypothesis, which is what INVARIANTS.md already   *)
(* says with "with no new tracker facts".                                    *)
(*                                                                          *)
(* A separate module because declaring a variable obliges every spec in the *)
(* module to constrain it, and neither Delivery nor DeliveryLiveness should. *)
(***************************************************************************)
EXTENDS DeliveryLiveness

VARIABLE sealed

varsA == << vars, sealed >>

NewTaskArrives(t) ==
  /\ ~sealed
  /\ ~crashed
  /\ tickets[t].phase \in {"Settled", "Abandoned"}
  /\ tickets' = [tickets EXCEPT ![t] = FreshTicket]
  /\ UnchangedRuntime
  /\ UNCHANGED sealed

\* The tracker stops producing facts. This is the "no new tracker facts" of
\* I19, made into something a checker can be handed.
SealGraph ==
  /\ ~sealed
  /\ sealed' = TRUE
  /\ UNCHANGED vars

ArrivalNext ==
  \/ (Next /\ UNCHANGED sealed)
  \/ SealGraph
  \/ \E t \in Tasks : NewTaskArrives(t)

ArrivalSpec ==
  /\ Init
  /\ sealed = FALSE
  /\ [][ArrivalNext]_varsA
  /\ \A t \in Tasks : Fairness(t)
  /\ SF_vars(Recover)


(* I19 with its stated hypothesis, and without it. *)
EventuallySealed == <>[]sealed

ReachesQuiescenceUnderArrival ==
  (EventuallyStable /\ EventuallySealed) => <>[]Quiescent

ReachesQuiescenceUnsealed ==
  EventuallyStable => <>[]Quiescent

=============================================================================
