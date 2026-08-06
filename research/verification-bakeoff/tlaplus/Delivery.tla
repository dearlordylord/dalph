---------------------------- MODULE Delivery ----------------------------
(***************************************************************************)
(* The shared benchmark of ../MODEL.md, hand-authored for TLC.             *)
(*                                                                          *)
(* This is deliberately not the machine-generated DeliveryTranspiled.tla.   *)
(* Comparing the two is the point: one is what Quint desugars to, this is   *)
(* what an engineer writes, and TLC only runs the second one comfortably.   *)
(*                                                                          *)
(* MUTANT selects a seeded defect from ../MUTANTS.md. 0 is faithful.        *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANT MUTANT

Tasks == {0, 1}
MaxCapacity == 2
MaxExternalAdvance == 2
MaxAttempts == 3

VARIABLES
  tickets,                    \* [Tasks -> ticket record]
  capacity,
  positions,                  \* process-local
  paused,
  targetResource,             \* process-local, at most one task
  targetHead,
  crashed,
  admissionRespectedCeiling,  \* history flag for I8
  promotedFromExactHead       \* history flag for I13

vars == << tickets, capacity, positions, paused, targetResource, targetHead,
           crashed, admissionRespectedCeiling, promotedFromExactHead >>

Phases == {"NoObligation", "Claimed", "Planned", "Executing",
           "SuspensionRequested", "Suspended", "Accepted", "Integrating",
           "Promoted", "Settled", "Abandoned"}

HoldsPosition(p) == p \in {"Executing", "SuspensionRequested"}

(***************************************************************************)
(* L1 derivation                                                           *)
(***************************************************************************)

Eligible == { t \in Tasks : tickets[t].present /\ tickets[t].open }

RankOf(t) == Cardinality({ o \in Eligible : o < t })

Selected ==
  IF MUTANT = 1 THEN { t \in Eligible : RankOf(t) <= capacity }
                ELSE { t \in Eligible : RankOf(t) <  capacity }

HasObligation(t) ==
  /\ tickets[t].phase # "NoObligation"
  /\ tickets[t].phase # "Settled"

Deliveries ==
  IF MUTANT = 2 THEN Selected
                ELSE Selected \cup { t \in Tasks : HasObligation(t) }

(***************************************************************************)
(* Invariants of ../INVARIANTS.md                                          *)
(***************************************************************************)

TypeOK ==
  /\ tickets \in [Tasks -> [phase: Phases, attempts: 0..MaxAttempts,
                            present: BOOLEAN, open: BOOLEAN,
                            expectedHead: 0..(MaxExternalAdvance + 2)]]
  /\ capacity \in 0..MaxCapacity
  /\ positions \subseteq Tasks
  /\ targetResource \subseteq Tasks

BoundRespected           == Cardinality(Selected) <= capacity
RetentionHolds           == \A t \in Tasks : HasObligation(t) => t \in Deliveries
SettlementDropped        == \A t \in Tasks : tickets[t].phase = "Settled" => ~HasObligation(t)
PositionDiscipline       == crashed \/ positions = { t \in Tasks : HoldsPosition(tickets[t].phase) }
AdmissionRule            == admissionRespectedCeiling
OneAttemptPerTask        == \A t \in Tasks : tickets[t].attempts <= 1
TargetResourceExclusive  == Cardinality(targetResource) <= 1
PromotionUsedExactHead   == promotedFromExactHead
ProcessLocalLostOnCrash  == ~crashed \/ (positions = {} /\ targetResource = {})

\* M8 of ../MUTANTS.md: the seeded specification error. Reads correct, is not.
CeilingOverHeldPositions == Cardinality(positions) <= capacity

AllInvariants ==
  /\ BoundRespected
  /\ RetentionHolds
  /\ SettlementDropped
  /\ PositionDiscipline
  /\ AdmissionRule
  /\ OneAttemptPerTask
  /\ TargetResourceExclusive
  /\ PromotionUsedExactHead
  /\ ProcessLocalLostOnCrash

(***************************************************************************)
(* Witnesses. TLC is asked to refute them, so a reported violation means    *)
(* the state is reachable. Without these, I13 holds vacuously.              *)
(***************************************************************************)

NoSettledReached   == \A t \in Tasks : tickets[t].phase # "Settled"
NoStaleHeadReached == \A t \in Tasks : tickets[t].phase # "Integrating"
                                       \/ tickets[t].expectedHead = targetHead

(***************************************************************************)
(* Actions                                                                 *)
(***************************************************************************)

FreshTicket == [phase |-> "NoObligation", attempts |-> 0, present |-> FALSE,
                open |-> FALSE, expectedHead |-> 0]

Init ==
  /\ tickets = [t \in Tasks |-> FreshTicket]
  /\ capacity = 1
  /\ positions = {}
  /\ paused = FALSE
  /\ targetResource = {}
  /\ targetHead = 0
  /\ crashed = FALSE
  /\ admissionRespectedCeiling = TRUE
  /\ promotedFromExactHead = TRUE

UnchangedRuntime ==
  UNCHANGED << capacity, positions, paused, targetResource, targetHead,
               crashed, admissionRespectedCeiling, promotedFromExactHead >>

ObserveGraph(t, p, o) ==
  /\ tickets' = [tickets EXCEPT ![t].present = p, ![t].open = o]
  /\ UnchangedRuntime

AcquireClaim(t) ==
  /\ ~crashed
  /\ tickets[t].phase = "NoObligation"
  /\ t \in Selected
  /\ tickets' = [tickets EXCEPT ![t].phase = "Claimed"]
  /\ UnchangedRuntime

PlanAttempt(t) ==
  /\ ~crashed
  /\ tickets[t].phase = "Claimed"
  /\ tickets' = [tickets EXCEPT ![t].phase = "Planned",
                                ![t].attempts = tickets[t].attempts + 1]
  /\ UnchangedRuntime

BeginWork(t) ==
  /\ ~crashed
  /\ ~paused
  /\ tickets[t].phase = "Planned"
  /\ Cardinality(positions) < capacity
  /\ tickets' = [tickets EXCEPT ![t].phase = "Executing"]
  /\ positions' = positions \cup {t}
  /\ admissionRespectedCeiling' =
       (admissionRespectedCeiling /\ Cardinality(positions \cup {t}) <= capacity)
  /\ UNCHANGED << capacity, paused, targetResource, targetHead, crashed,
                  promotedFromExactHead >>

RequestSuspension(t) ==
  /\ ~crashed
  /\ tickets[t].phase = "Executing"
  /\ tickets' = [tickets EXCEPT ![t].phase = "SuspensionRequested"]
  \* MUTANT 4 releases the position at the request instead of at the proof.
  /\ positions' = IF MUTANT = 4 THEN positions \ {t} ELSE positions
  /\ UNCHANGED << capacity, paused, targetResource, targetHead, crashed,
                  admissionRespectedCeiling, promotedFromExactHead >>

SafelySuspend(t) ==
  /\ ~crashed
  /\ tickets[t].phase = "SuspensionRequested"
  /\ tickets' = [tickets EXCEPT ![t].phase = "Suspended"]
  /\ positions' = positions \ {t}
  /\ UNCHANGED << capacity, paused, targetResource, targetHead, crashed,
                  admissionRespectedCeiling, promotedFromExactHead >>

ResumeWork(t) ==
  /\ ~crashed
  /\ ~paused
  /\ tickets[t].phase = "Suspended"
  /\ Cardinality(positions) < capacity
  /\ tickets' = [tickets EXCEPT ![t].phase = "Executing"]
  /\ positions' = positions \cup {t}
  /\ admissionRespectedCeiling' =
       (admissionRespectedCeiling /\ Cardinality(positions \cup {t}) <= capacity)
  /\ UNCHANGED << capacity, paused, targetResource, targetHead, crashed,
                  promotedFromExactHead >>

ReportAccepted(t) ==
  /\ ~crashed
  /\ tickets[t].phase = "Executing"
  /\ tickets' = [tickets EXCEPT ![t].phase = "Accepted"]
  /\ positions' = positions \ {t}
  /\ UNCHANGED << capacity, paused, targetResource, targetHead, crashed,
                  admissionRespectedCeiling, promotedFromExactHead >>

StartIntegration(t) ==
  /\ ~crashed
  /\ tickets[t].phase = "Accepted"
  /\ targetResource = {}
  /\ tickets' = [tickets EXCEPT ![t].phase = "Integrating",
                                ![t].expectedHead = targetHead]
  /\ targetResource' = {t}
  /\ UNCHANGED << capacity, positions, paused, targetHead, crashed,
                  admissionRespectedCeiling, promotedFromExactHead >>

Promote(t) ==
  /\ ~crashed
  /\ tickets[t].phase = "Integrating"
  \* MUTANT 6 drops the compare-and-set guard against the exact expected head.
  /\ \/ MUTANT = 6
     \/ tickets[t].expectedHead = targetHead
  /\ tickets' = [tickets EXCEPT ![t].phase = "Promoted"]
  /\ targetHead' = targetHead + 1
  /\ targetResource' = {}
  /\ promotedFromExactHead' =
       (promotedFromExactHead /\ tickets[t].expectedHead = targetHead)
  /\ UNCHANGED << capacity, positions, paused, crashed, admissionRespectedCeiling >>

(***************************************************************************)
(* The escape from a stale integration head, and the only action in this   *)
(* module that liveness checking demanded. Safety never needed it: a run    *)
(* parked in Integrating forever violates nothing.                          *)
(*                                                                          *)
(* It corresponds to CorrectionLimitReached in                              *)
(* specs/acceptedResultIntegration.qnt -- a terminal state that is retained *)
(* rather than settled, which is why HasObligation stays true here and      *)
(* Abandoned is not treated like Settled.                                   *)
(***************************************************************************)
AbandonIntegration(t) ==
  /\ ~crashed
  /\ tickets[t].phase = "Integrating"
  /\ tickets[t].expectedHead # targetHead
  /\ tickets' = [tickets EXCEPT ![t].phase = "Abandoned"]
  /\ targetResource' = {}
  /\ UNCHANGED << capacity, positions, paused, targetHead, crashed,
                  admissionRespectedCeiling, promotedFromExactHead >>

Settle(t) ==
  /\ ~crashed
  /\ tickets[t].phase = "Promoted"
  /\ tickets' = [tickets EXCEPT ![t].phase = "Settled"]
  /\ UnchangedRuntime

ApplyPause ==
  /\ ~crashed /\ ~paused
  /\ paused' = TRUE
  /\ UNCHANGED << tickets, capacity, positions, targetResource, targetHead,
                  crashed, admissionRespectedCeiling, promotedFromExactHead >>

ApplyUnpause ==
  /\ ~crashed /\ paused
  /\ paused' = FALSE
  /\ UNCHANGED << tickets, capacity, positions, targetResource, targetHead,
                  crashed, admissionRespectedCeiling, promotedFromExactHead >>

ChangeCapacity(c) ==
  /\ ~crashed
  /\ c # capacity
  /\ capacity' = c
  /\ UNCHANGED << tickets, positions, paused, targetResource, targetHead,
                  crashed, admissionRespectedCeiling, promotedFromExactHead >>

ExternalTargetAdvance ==
  /\ targetHead < MaxExternalAdvance
  /\ targetHead' = targetHead + 1
  /\ UNCHANGED << tickets, capacity, positions, paused, targetResource,
                  crashed, admissionRespectedCeiling, promotedFromExactHead >>

Crash ==
  /\ ~crashed
  /\ crashed' = TRUE
  /\ positions' = {}
  /\ targetResource' = {}
  /\ tickets' = [t \in Tasks |->
       IF tickets[t].phase = "Integrating"
       THEN [tickets[t] EXCEPT !.phase = "Accepted"]
       ELSE tickets[t]]
  /\ UNCHANGED << capacity, paused, targetHead, admissionRespectedCeiling,
                  promotedFromExactHead >>

Recover ==
  /\ crashed
  /\ crashed' = FALSE
  /\ positions' = { t \in Tasks : HoldsPosition(tickets[t].phase) }
  \* MUTANT 5 treats process loss as a reason to plan a second attempt.
  /\ tickets' = IF MUTANT = 5
                THEN [t \in Tasks |->
                       IF HoldsPosition(tickets[t].phase)
                          /\ tickets[t].attempts < MaxAttempts
                       THEN [tickets[t] EXCEPT !.attempts = @ + 1]
                       ELSE tickets[t]]
                ELSE tickets
  /\ UNCHANGED << capacity, paused, targetResource, targetHead,
                  admissionRespectedCeiling, promotedFromExactHead >>

Next ==
  \/ \E t \in Tasks, p \in BOOLEAN, o \in BOOLEAN : ObserveGraph(t, p, o)
  \/ \E t \in Tasks :
       \/ AcquireClaim(t) \/ PlanAttempt(t) \/ BeginWork(t)
       \/ RequestSuspension(t) \/ SafelySuspend(t) \/ ResumeWork(t)
       \/ ReportAccepted(t) \/ StartIntegration(t) \/ Promote(t) \/ Settle(t)
       \/ AbandonIntegration(t)
  \/ ApplyPause \/ ApplyUnpause
  \/ \E c \in 0..MaxCapacity : ChangeCapacity(c)
  \/ ExternalTargetAdvance
  \/ Crash \/ Recover

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

(***************************************************************************)
(* Bounds the otherwise unbounded integration head.                         *)
(***************************************************************************)
StateConstraint == targetHead <= MaxExternalAdvance + 2

=============================================================================
