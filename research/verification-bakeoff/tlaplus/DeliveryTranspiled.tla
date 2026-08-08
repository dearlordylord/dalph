------------------------------- MODULE delivery -------------------------------

EXTENDS Integers, Sequences, FiniteSets, TLC, Apalache, Variants

VARIABLE
  (*
    @type: (Int -> { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool });
  *)
  delivery_deliveryCore_tickets

(*
  @type: (() => Set(Int));
*)
delivery_deliveryCore_TASKS == { 0, 1 }

(*
  @type: (() => Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }));
*)
delivery_deliveryCore_NoObligation == Variant("NoObligation", [tag |-> "UNIT"])

VARIABLE
  (*
    @type: Int;
  *)
  delivery_deliveryCore_capacity

VARIABLE
  (*
    @type: Set(Int);
  *)
  delivery_deliveryCore_positions

VARIABLE
  (*
    @type: Bool;
  *)
  delivery_deliveryCore_paused

VARIABLE
  (*
    @type: Set(Int);
  *)
  delivery_deliveryCore_targetResource

VARIABLE
  (*
    @type: Int;
  *)
  delivery_deliveryCore_targetHead

VARIABLE
  (*
    @type: Bool;
  *)
  delivery_deliveryCore_crashed

VARIABLE
  (*
    @type: Bool;
  *)
  delivery_deliveryCore_admissionRespectedCeiling

VARIABLE
  (*
    @type: Bool;
  *)
  delivery_deliveryCore_promotedFromExactHead

(*
  @type: (() => Int);
*)
delivery_deliveryCore_MAX_CAPACITY == 2

(*
  @type: (() => Int);
*)
delivery_deliveryCore_MUTANT == 0

(*
  @type: (() => Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }));
*)
delivery_deliveryCore_Claimed == Variant("Claimed", [tag |-> "UNIT"])

(*
  @type: (() => Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }));
*)
delivery_deliveryCore_Planned == Variant("Planned", [tag |-> "UNIT"])

(*
  @type: (() => Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }));
*)
delivery_deliveryCore_Executing == Variant("Executing", [tag |-> "UNIT"])

(*
  @type: (() => Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }));
*)
delivery_deliveryCore_SuspensionRequested ==
  Variant("SuspensionRequested", [tag |-> "UNIT"])

(*
  @type: (() => Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }));
*)
delivery_deliveryCore_Suspended == Variant("Suspended", [tag |-> "UNIT"])

(*
  @type: (() => Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }));
*)
delivery_deliveryCore_Accepted == Variant("Accepted", [tag |-> "UNIT"])

(*
  @type: (() => Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }));
*)
delivery_deliveryCore_Integrating == Variant("Integrating", [tag |-> "UNIT"])

(*
  @type: (() => Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }));
*)
delivery_deliveryCore_Promoted == Variant("Promoted", [tag |-> "UNIT"])

(*
  @type: (() => Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }));
*)
delivery_deliveryCore_Settled == Variant("Settled", [tag |-> "UNIT"])

(*
  @type: (() => { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool });
*)
delivery_deliveryCore_freshTicket ==
  [phase |-> delivery_deliveryCore_NoObligation,
    attempts |-> 0,
    present |-> FALSE,
    open |-> FALSE,
    expectedHead |-> 0]

(*
  @type: (((Int -> { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool })) => Bool);
*)
delivery_deliveryCore_onlyTickets(delivery_deliveryCore_updated_496) ==
  delivery_deliveryCore_tickets' := delivery_deliveryCore_updated_496
    /\ delivery_deliveryCore_capacity' := delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_positions' := delivery_deliveryCore_positions
    /\ delivery_deliveryCore_paused' := delivery_deliveryCore_paused
    /\ delivery_deliveryCore_targetResource'
      := delivery_deliveryCore_targetResource
    /\ delivery_deliveryCore_targetHead' := delivery_deliveryCore_targetHead
    /\ delivery_deliveryCore_crashed' := delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_admissionRespectedCeiling'
      := delivery_deliveryCore_admissionRespectedCeiling
    /\ delivery_deliveryCore_promotedFromExactHead'
      := delivery_deliveryCore_promotedFromExactHead

(*
  @type: (() => Set(Int));
*)
delivery_deliveryCore_eligible ==
  {
    delivery_deliveryCore_id_122 \in delivery_deliveryCore_TASKS:
      delivery_deliveryCore_tickets[delivery_deliveryCore_id_122]["present"]
        /\ delivery_deliveryCore_tickets[delivery_deliveryCore_id_122]["open"]
  }

(*
  @type: ((Int) => Bool);
*)
delivery_deliveryCore_beginWork(delivery_deliveryCore_id_644) ==
  ~delivery_deliveryCore_crashed
    /\ ~delivery_deliveryCore_paused
    /\ delivery_deliveryCore_tickets[delivery_deliveryCore_id_644]["phase"]
      = delivery_deliveryCore_Planned
    /\ Cardinality(delivery_deliveryCore_positions)
      < delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_tickets'
      := LET (*
        @type: (() => (Int -> { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }));
      *)
      __quint_var3 == delivery_deliveryCore_tickets
      IN
      [
        (__quint_var3) EXCEPT
          ![delivery_deliveryCore_id_644] =
            LET (*
              @type: (({ attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }) => { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool });
            *)
            __QUINT_LAMBDA3(delivery_deliveryCore_t_605) ==
              [
                delivery_deliveryCore_t_605 EXCEPT
                  !["phase"] = delivery_deliveryCore_Executing
              ]
            IN
            __QUINT_LAMBDA3((__quint_var3)[delivery_deliveryCore_id_644])
      ]
    /\ delivery_deliveryCore_positions'
      := (delivery_deliveryCore_positions \union {delivery_deliveryCore_id_644})
    /\ delivery_deliveryCore_admissionRespectedCeiling'
      := (delivery_deliveryCore_admissionRespectedCeiling
        /\ Cardinality(delivery_deliveryCore_positions) + 1
          <= delivery_deliveryCore_capacity)
    /\ delivery_deliveryCore_capacity' := delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_paused' := delivery_deliveryCore_paused
    /\ delivery_deliveryCore_targetResource'
      := delivery_deliveryCore_targetResource
    /\ delivery_deliveryCore_targetHead' := delivery_deliveryCore_targetHead
    /\ delivery_deliveryCore_crashed' := delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_promotedFromExactHead'
      := delivery_deliveryCore_promotedFromExactHead

(*
  @type: ((Int) => Bool);
*)
delivery_deliveryCore_requestSuspension(delivery_deliveryCore_id_702) ==
  ~delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_tickets[delivery_deliveryCore_id_702]["phase"]
      = delivery_deliveryCore_Executing
    /\ delivery_deliveryCore_tickets'
      := LET (*
        @type: (() => (Int -> { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }));
      *)
      __quint_var4 == delivery_deliveryCore_tickets
      IN
      [
        (__quint_var4) EXCEPT
          ![delivery_deliveryCore_id_702] =
            LET (*
              @type: (({ attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }) => { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool });
            *)
            __QUINT_LAMBDA4(delivery_deliveryCore_t_665) ==
              [
                delivery_deliveryCore_t_665 EXCEPT
                  !["phase"] = delivery_deliveryCore_SuspensionRequested
              ]
            IN
            __QUINT_LAMBDA4((__quint_var4)[delivery_deliveryCore_id_702])
      ]
    /\ delivery_deliveryCore_positions'
      := (IF delivery_deliveryCore_MUTANT = 4
      THEN delivery_deliveryCore_positions \ {delivery_deliveryCore_id_702}
      ELSE delivery_deliveryCore_positions)
    /\ delivery_deliveryCore_capacity' := delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_paused' := delivery_deliveryCore_paused
    /\ delivery_deliveryCore_targetResource'
      := delivery_deliveryCore_targetResource
    /\ delivery_deliveryCore_targetHead' := delivery_deliveryCore_targetHead
    /\ delivery_deliveryCore_crashed' := delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_admissionRespectedCeiling'
      := delivery_deliveryCore_admissionRespectedCeiling
    /\ delivery_deliveryCore_promotedFromExactHead'
      := delivery_deliveryCore_promotedFromExactHead

(*
  @type: ((Int, Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str })) => Bool);
*)
delivery_deliveryCore_releasePosition(delivery_deliveryCore_id_748, delivery_deliveryCore_nextPhase_748) ==
  delivery_deliveryCore_tickets'
      := LET (*
        @type: (() => (Int -> { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }));
      *)
      __quint_var5 == delivery_deliveryCore_tickets
      IN
      [
        (__quint_var5) EXCEPT
          ![delivery_deliveryCore_id_748] =
            LET (*
              @type: (({ attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }) => { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool });
            *)
            __QUINT_LAMBDA5(delivery_deliveryCore_t_716) ==
              [
                delivery_deliveryCore_t_716 EXCEPT
                  !["phase"] = delivery_deliveryCore_nextPhase_748
              ]
            IN
            __QUINT_LAMBDA5((__quint_var5)[delivery_deliveryCore_id_748])
      ]
    /\ delivery_deliveryCore_positions'
      := (delivery_deliveryCore_positions \ {delivery_deliveryCore_id_748})
    /\ delivery_deliveryCore_capacity' := delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_paused' := delivery_deliveryCore_paused
    /\ delivery_deliveryCore_targetResource'
      := delivery_deliveryCore_targetResource
    /\ delivery_deliveryCore_targetHead' := delivery_deliveryCore_targetHead
    /\ delivery_deliveryCore_crashed' := delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_admissionRespectedCeiling'
      := delivery_deliveryCore_admissionRespectedCeiling
    /\ delivery_deliveryCore_promotedFromExactHead'
      := delivery_deliveryCore_promotedFromExactHead

(*
  @type: ((Int) => Bool);
*)
delivery_deliveryCore_resumeWork(delivery_deliveryCore_id_832) ==
  ~delivery_deliveryCore_crashed
    /\ ~delivery_deliveryCore_paused
    /\ delivery_deliveryCore_tickets[delivery_deliveryCore_id_832]["phase"]
      = delivery_deliveryCore_Suspended
    /\ Cardinality(delivery_deliveryCore_positions)
      < delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_tickets'
      := LET (*
        @type: (() => (Int -> { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }));
      *)
      __quint_var6 == delivery_deliveryCore_tickets
      IN
      [
        (__quint_var6) EXCEPT
          ![delivery_deliveryCore_id_832] =
            LET (*
              @type: (({ attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }) => { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool });
            *)
            __QUINT_LAMBDA6(delivery_deliveryCore_t_793) ==
              [
                delivery_deliveryCore_t_793 EXCEPT
                  !["phase"] = delivery_deliveryCore_Executing
              ]
            IN
            __QUINT_LAMBDA6((__quint_var6)[delivery_deliveryCore_id_832])
      ]
    /\ delivery_deliveryCore_positions'
      := (delivery_deliveryCore_positions \union {delivery_deliveryCore_id_832})
    /\ delivery_deliveryCore_admissionRespectedCeiling'
      := (delivery_deliveryCore_admissionRespectedCeiling
        /\ Cardinality(delivery_deliveryCore_positions) + 1
          <= delivery_deliveryCore_capacity)
    /\ delivery_deliveryCore_capacity' := delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_paused' := delivery_deliveryCore_paused
    /\ delivery_deliveryCore_targetResource'
      := delivery_deliveryCore_targetResource
    /\ delivery_deliveryCore_targetHead' := delivery_deliveryCore_targetHead
    /\ delivery_deliveryCore_crashed' := delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_promotedFromExactHead'
      := delivery_deliveryCore_promotedFromExactHead

(*
  @type: ((Int) => Bool);
*)
delivery_deliveryCore_startIntegration(delivery_deliveryCore_id_907) ==
  ~delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_tickets[delivery_deliveryCore_id_907]["phase"]
      = delivery_deliveryCore_Accepted
    /\ delivery_deliveryCore_targetResource = {}
    /\ delivery_deliveryCore_tickets'
      := LET (*
        @type: (() => (Int -> { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }));
      *)
      __quint_var7 == delivery_deliveryCore_tickets
      IN
      [
        (__quint_var7) EXCEPT
          ![delivery_deliveryCore_id_907] =
            LET (*
              @type: (({ attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }) => { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool });
            *)
            __QUINT_LAMBDA7(delivery_deliveryCore_t_877) ==
              [
                [
                  delivery_deliveryCore_t_877 EXCEPT
                    !["phase"] = delivery_deliveryCore_Integrating
                ] EXCEPT
                  !["expectedHead"] = delivery_deliveryCore_targetHead
              ]
            IN
            __QUINT_LAMBDA7((__quint_var7)[delivery_deliveryCore_id_907])
      ]
    /\ delivery_deliveryCore_targetResource' := {delivery_deliveryCore_id_907}
    /\ delivery_deliveryCore_positions' := delivery_deliveryCore_positions
    /\ delivery_deliveryCore_capacity' := delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_paused' := delivery_deliveryCore_paused
    /\ delivery_deliveryCore_targetHead' := delivery_deliveryCore_targetHead
    /\ delivery_deliveryCore_crashed' := delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_admissionRespectedCeiling'
      := delivery_deliveryCore_admissionRespectedCeiling
    /\ delivery_deliveryCore_promotedFromExactHead'
      := delivery_deliveryCore_promotedFromExactHead

(*
  @type: ((Int) => Bool);
*)
delivery_deliveryCore_promote(delivery_deliveryCore_id_978) ==
  ~delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_tickets[delivery_deliveryCore_id_978]["phase"]
      = delivery_deliveryCore_Integrating
    /\ (delivery_deliveryCore_MUTANT = 6
      \/ delivery_deliveryCore_tickets[delivery_deliveryCore_id_978][
        "expectedHead"
      ]
        = delivery_deliveryCore_targetHead)
    /\ delivery_deliveryCore_tickets'
      := LET (*
        @type: (() => (Int -> { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }));
      *)
      __quint_var8 == delivery_deliveryCore_tickets
      IN
      [
        (__quint_var8) EXCEPT
          ![delivery_deliveryCore_id_978] =
            LET (*
              @type: (({ attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }) => { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool });
            *)
            __QUINT_LAMBDA8(delivery_deliveryCore_t_939) ==
              [
                delivery_deliveryCore_t_939 EXCEPT
                  !["phase"] = delivery_deliveryCore_Promoted
              ]
            IN
            __QUINT_LAMBDA8((__quint_var8)[delivery_deliveryCore_id_978])
      ]
    /\ delivery_deliveryCore_targetHead'
      := (delivery_deliveryCore_targetHead + 1)
    /\ delivery_deliveryCore_targetResource' := {}
    /\ delivery_deliveryCore_promotedFromExactHead'
      := (delivery_deliveryCore_promotedFromExactHead
        /\ delivery_deliveryCore_tickets[delivery_deliveryCore_id_978][
          "expectedHead"
        ]
          = delivery_deliveryCore_targetHead)
    /\ delivery_deliveryCore_positions' := delivery_deliveryCore_positions
    /\ delivery_deliveryCore_capacity' := delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_paused' := delivery_deliveryCore_paused
    /\ delivery_deliveryCore_crashed' := delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_admissionRespectedCeiling'
      := delivery_deliveryCore_admissionRespectedCeiling

(*
  @type: (() => Bool);
*)
delivery_deliveryCore_applyPause ==
  ~delivery_deliveryCore_crashed
    /\ ~delivery_deliveryCore_paused
    /\ delivery_deliveryCore_paused' := TRUE
    /\ delivery_deliveryCore_tickets' := delivery_deliveryCore_tickets
    /\ delivery_deliveryCore_capacity' := delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_positions' := delivery_deliveryCore_positions
    /\ delivery_deliveryCore_targetResource'
      := delivery_deliveryCore_targetResource
    /\ delivery_deliveryCore_targetHead' := delivery_deliveryCore_targetHead
    /\ delivery_deliveryCore_crashed' := delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_admissionRespectedCeiling'
      := delivery_deliveryCore_admissionRespectedCeiling
    /\ delivery_deliveryCore_promotedFromExactHead'
      := delivery_deliveryCore_promotedFromExactHead

(*
  @type: (() => Bool);
*)
delivery_deliveryCore_applyUnpause ==
  ~delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_paused
    /\ delivery_deliveryCore_paused' := FALSE
    /\ delivery_deliveryCore_tickets' := delivery_deliveryCore_tickets
    /\ delivery_deliveryCore_capacity' := delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_positions' := delivery_deliveryCore_positions
    /\ delivery_deliveryCore_targetResource'
      := delivery_deliveryCore_targetResource
    /\ delivery_deliveryCore_targetHead' := delivery_deliveryCore_targetHead
    /\ delivery_deliveryCore_crashed' := delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_admissionRespectedCeiling'
      := delivery_deliveryCore_admissionRespectedCeiling
    /\ delivery_deliveryCore_promotedFromExactHead'
      := delivery_deliveryCore_promotedFromExactHead

(*
  @type: ((Int) => Bool);
*)
delivery_deliveryCore_changeCapacity(delivery_deliveryCore_target_1114) ==
  ~delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_target_1114 >= 0
    /\ delivery_deliveryCore_target_1114 <= delivery_deliveryCore_MAX_CAPACITY
    /\ delivery_deliveryCore_target_1114 /= delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_capacity' := delivery_deliveryCore_target_1114
    /\ delivery_deliveryCore_tickets' := delivery_deliveryCore_tickets
    /\ delivery_deliveryCore_positions' := delivery_deliveryCore_positions
    /\ delivery_deliveryCore_paused' := delivery_deliveryCore_paused
    /\ delivery_deliveryCore_targetResource'
      := delivery_deliveryCore_targetResource
    /\ delivery_deliveryCore_targetHead' := delivery_deliveryCore_targetHead
    /\ delivery_deliveryCore_crashed' := delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_admissionRespectedCeiling'
      := delivery_deliveryCore_admissionRespectedCeiling
    /\ delivery_deliveryCore_promotedFromExactHead'
      := delivery_deliveryCore_promotedFromExactHead

(*
  @type: (() => Bool);
*)
delivery_deliveryCore_externalTargetAdvance ==
  delivery_deliveryCore_targetHead < 2
    /\ delivery_deliveryCore_targetHead'
      := (delivery_deliveryCore_targetHead + 1)
    /\ delivery_deliveryCore_tickets' := delivery_deliveryCore_tickets
    /\ delivery_deliveryCore_capacity' := delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_positions' := delivery_deliveryCore_positions
    /\ delivery_deliveryCore_paused' := delivery_deliveryCore_paused
    /\ delivery_deliveryCore_targetResource'
      := delivery_deliveryCore_targetResource
    /\ delivery_deliveryCore_crashed' := delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_admissionRespectedCeiling'
      := delivery_deliveryCore_admissionRespectedCeiling
    /\ delivery_deliveryCore_promotedFromExactHead'
      := delivery_deliveryCore_promotedFromExactHead

(*
  @type: (() => Bool);
*)
delivery_deliveryCore_crash ==
  ~delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_crashed' := TRUE
    /\ delivery_deliveryCore_positions' := {}
    /\ delivery_deliveryCore_targetResource' := {}
    /\ delivery_deliveryCore_tickets'
      := [
        delivery_deliveryCore_id_1182 \in delivery_deliveryCore_TASKS |->
          IF delivery_deliveryCore_tickets[delivery_deliveryCore_id_1182][
            "phase"
          ]
            = delivery_deliveryCore_Integrating
          THEN [
            delivery_deliveryCore_tickets[delivery_deliveryCore_id_1182] EXCEPT
              !["phase"] = delivery_deliveryCore_Accepted
          ]
          ELSE delivery_deliveryCore_tickets[delivery_deliveryCore_id_1182]
      ]
    /\ delivery_deliveryCore_capacity' := delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_paused' := delivery_deliveryCore_paused
    /\ delivery_deliveryCore_targetHead' := delivery_deliveryCore_targetHead
    /\ delivery_deliveryCore_admissionRespectedCeiling'
      := delivery_deliveryCore_admissionRespectedCeiling
    /\ delivery_deliveryCore_promotedFromExactHead'
      := delivery_deliveryCore_promotedFromExactHead

(*
  @type: ((Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str })) => Bool);
*)
delivery_deliveryCore_holdsPosition(delivery_deliveryCore_phase_105) ==
  delivery_deliveryCore_phase_105 = delivery_deliveryCore_Executing
    \/ delivery_deliveryCore_phase_105
      = delivery_deliveryCore_SuspensionRequested

(*
  @type: (() => Bool);
*)
delivery_deliveryCore_init ==
  delivery_deliveryCore_tickets
      = [
        delivery_deliveryCore___433 \in delivery_deliveryCore_TASKS |->
          delivery_deliveryCore_freshTicket
      ]
    /\ delivery_deliveryCore_capacity = 1
    /\ delivery_deliveryCore_positions = {}
    /\ delivery_deliveryCore_paused = FALSE
    /\ delivery_deliveryCore_targetResource = {}
    /\ delivery_deliveryCore_targetHead = 0
    /\ delivery_deliveryCore_crashed = FALSE
    /\ delivery_deliveryCore_admissionRespectedCeiling = TRUE
    /\ delivery_deliveryCore_promotedFromExactHead = TRUE

(*
  @type: ((Int, Bool, Bool) => Bool);
*)
delivery_deliveryCore_observeGraph(delivery_deliveryCore_id_518, delivery_deliveryCore_nowPresent_518,
delivery_deliveryCore_nowOpen_518) ==
  LET (*
    @type: (() => (Int -> { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }));
  *)
  __quint_var0 == delivery_deliveryCore_tickets
  IN
  delivery_deliveryCore_onlyTickets([
    (__quint_var0) EXCEPT
      ![delivery_deliveryCore_id_518] =
        LET (*
          @type: (({ attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }) => { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool });
        *)
        __QUINT_LAMBDA0(delivery_deliveryCore_t_515) ==
          [
            [
              delivery_deliveryCore_t_515 EXCEPT
                !["present"] = delivery_deliveryCore_nowPresent_518
            ] EXCEPT
              !["open"] = delivery_deliveryCore_nowOpen_518
          ]
        IN
        __QUINT_LAMBDA0((__quint_var0)[delivery_deliveryCore_id_518])
  ])

(*
  @type: ((Int) => Int);
*)
delivery_deliveryCore_rankOf(delivery_deliveryCore_id_136) ==
  Cardinality({
    delivery_deliveryCore_other_133 \in delivery_deliveryCore_eligible:
      delivery_deliveryCore_other_133 < delivery_deliveryCore_id_136
  })

(*
  @type: ((Int) => Bool);
*)
delivery_deliveryCore_planAttempt(delivery_deliveryCore_id_578) ==
  ~delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_tickets[delivery_deliveryCore_id_578]["phase"]
      = delivery_deliveryCore_Claimed
    /\ LET (*
      @type: (() => (Int -> { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }));
    *)
    __quint_var2 == delivery_deliveryCore_tickets
    IN
    delivery_deliveryCore_onlyTickets([
      (__quint_var2) EXCEPT
        ![delivery_deliveryCore_id_578] =
          LET (*
            @type: (({ attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }) => { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool });
          *)
          __QUINT_LAMBDA2(delivery_deliveryCore_t_574) ==
            [
              [
                delivery_deliveryCore_t_574 EXCEPT
                  !["phase"] = delivery_deliveryCore_Planned
              ] EXCEPT
                !["attempts"] = delivery_deliveryCore_t_574["attempts"] + 1
            ]
          IN
          __QUINT_LAMBDA2((__quint_var2)[delivery_deliveryCore_id_578])
    ])

(*
  @type: ((Int) => Bool);
*)
delivery_deliveryCore_safelySuspend(delivery_deliveryCore_id_766) ==
  ~delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_tickets[delivery_deliveryCore_id_766]["phase"]
      = delivery_deliveryCore_SuspensionRequested
    /\ delivery_deliveryCore_releasePosition(delivery_deliveryCore_id_766, (delivery_deliveryCore_Suspended))

(*
  @type: ((Int) => Bool);
*)
delivery_deliveryCore_reportAccepted(delivery_deliveryCore_id_850) ==
  ~delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_tickets[delivery_deliveryCore_id_850]["phase"]
      = delivery_deliveryCore_Executing
    /\ delivery_deliveryCore_releasePosition(delivery_deliveryCore_id_850, (delivery_deliveryCore_Accepted))

(*
  @type: ((Int) => Bool);
*)
delivery_deliveryCore_settle(delivery_deliveryCore_id_1003) ==
  ~delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_tickets[delivery_deliveryCore_id_1003]["phase"]
      = delivery_deliveryCore_Promoted
    /\ LET (*
      @type: (() => (Int -> { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }));
    *)
    __quint_var9 == delivery_deliveryCore_tickets
    IN
    delivery_deliveryCore_onlyTickets([
      (__quint_var9) EXCEPT
        ![delivery_deliveryCore_id_1003] =
          LET (*
            @type: (({ attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }) => { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool });
          *)
          __QUINT_LAMBDA9(delivery_deliveryCore_t_999) ==
            [
              delivery_deliveryCore_t_999 EXCEPT
                !["phase"] = delivery_deliveryCore_Settled
            ]
          IN
          __QUINT_LAMBDA9((__quint_var9)[delivery_deliveryCore_id_1003])
    ])

(*
  @type: (() => Bool);
*)
delivery_deliveryCore_recover ==
  delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_crashed' := FALSE
    /\ delivery_deliveryCore_positions'
      := {
        delivery_deliveryCore_id_1216 \in delivery_deliveryCore_TASKS:
          delivery_deliveryCore_holdsPosition(delivery_deliveryCore_tickets[
            delivery_deliveryCore_id_1216
          ][
            "phase"
          ])
      }
    /\ delivery_deliveryCore_tickets'
      := (IF delivery_deliveryCore_MUTANT = 5
      THEN [
        delivery_deliveryCore_id_1247 \in delivery_deliveryCore_TASKS |->
          IF delivery_deliveryCore_holdsPosition(delivery_deliveryCore_tickets[
            delivery_deliveryCore_id_1247
          ][
            "phase"
          ])
          THEN [
            delivery_deliveryCore_tickets[delivery_deliveryCore_id_1247] EXCEPT
              !["attempts"] =
                delivery_deliveryCore_tickets[delivery_deliveryCore_id_1247][
                  "attempts"
                ]
                  + 1
          ]
          ELSE delivery_deliveryCore_tickets[delivery_deliveryCore_id_1247]
      ]
      ELSE delivery_deliveryCore_tickets)
    /\ delivery_deliveryCore_capacity' := delivery_deliveryCore_capacity
    /\ delivery_deliveryCore_paused' := delivery_deliveryCore_paused
    /\ delivery_deliveryCore_targetResource'
      := delivery_deliveryCore_targetResource
    /\ delivery_deliveryCore_targetHead' := delivery_deliveryCore_targetHead
    /\ delivery_deliveryCore_admissionRespectedCeiling'
      := delivery_deliveryCore_admissionRespectedCeiling
    /\ delivery_deliveryCore_promotedFromExactHead'
      := delivery_deliveryCore_promotedFromExactHead

(*
  @type: (() => Bool);
*)
q_init == delivery_deliveryCore_init

(*
  @type: (() => Set(Int));
*)
delivery_deliveryCore_selected ==
  IF delivery_deliveryCore_MUTANT = 1
  THEN {
    delivery_deliveryCore_id_149 \in delivery_deliveryCore_eligible:
      delivery_deliveryCore_rankOf(delivery_deliveryCore_id_149)
        <= delivery_deliveryCore_capacity
  }
  ELSE {
    delivery_deliveryCore_id_157 \in delivery_deliveryCore_eligible:
      delivery_deliveryCore_rankOf(delivery_deliveryCore_id_157)
        < delivery_deliveryCore_capacity
  }

(*
  @type: ((Int) => Bool);
*)
delivery_deliveryCore_acquireClaim(delivery_deliveryCore_id_546) ==
  ~delivery_deliveryCore_crashed
    /\ delivery_deliveryCore_tickets[delivery_deliveryCore_id_546]["phase"]
      = delivery_deliveryCore_NoObligation
    /\ delivery_deliveryCore_id_546 \in delivery_deliveryCore_selected
    /\ LET (*
      @type: (() => (Int -> { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }));
    *)
    __quint_var1 == delivery_deliveryCore_tickets
    IN
    delivery_deliveryCore_onlyTickets([
      (__quint_var1) EXCEPT
        ![delivery_deliveryCore_id_546] =
          LET (*
            @type: (({ attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool }) => { attempts: Int, expectedHead: Int, open: Bool, phase: Accepted({ tag: Str }) | Claimed({ tag: Str }) | Executing({ tag: Str }) | Integrating({ tag: Str }) | NoObligation({ tag: Str }) | Planned({ tag: Str }) | Promoted({ tag: Str }) | Settled({ tag: Str }) | Suspended({ tag: Str }) | SuspensionRequested({ tag: Str }), present: Bool });
          *)
          __QUINT_LAMBDA1(delivery_deliveryCore_t_542) ==
            [
              delivery_deliveryCore_t_542 EXCEPT
                !["phase"] = delivery_deliveryCore_Claimed
            ]
          IN
          __QUINT_LAMBDA1((__quint_var1)[delivery_deliveryCore_id_546])
    ])

(*
  @type: (() => Bool);
*)
delivery_deliveryCore_step ==
  \E delivery_deliveryCore_id \in delivery_deliveryCore_TASKS:
    \E delivery_deliveryCore_nextCapacity \in 0
      .. delivery_deliveryCore_MAX_CAPACITY:
      \E delivery_deliveryCore_nowPresent \in { FALSE, TRUE }:
        \E delivery_deliveryCore_nowOpen \in { FALSE, TRUE }:
          delivery_deliveryCore_observeGraph(delivery_deliveryCore_id, delivery_deliveryCore_nowPresent,
            delivery_deliveryCore_nowOpen)
            \/ delivery_deliveryCore_acquireClaim(delivery_deliveryCore_id)
            \/ delivery_deliveryCore_planAttempt(delivery_deliveryCore_id)
            \/ delivery_deliveryCore_beginWork(delivery_deliveryCore_id)
            \/ delivery_deliveryCore_requestSuspension(delivery_deliveryCore_id)
            \/ delivery_deliveryCore_safelySuspend(delivery_deliveryCore_id)
            \/ delivery_deliveryCore_resumeWork(delivery_deliveryCore_id)
            \/ delivery_deliveryCore_reportAccepted(delivery_deliveryCore_id)
            \/ delivery_deliveryCore_startIntegration(delivery_deliveryCore_id)
            \/ delivery_deliveryCore_promote(delivery_deliveryCore_id)
            \/ delivery_deliveryCore_settle(delivery_deliveryCore_id)
            \/ delivery_deliveryCore_applyPause
            \/ delivery_deliveryCore_applyUnpause
            \/ delivery_deliveryCore_changeCapacity(delivery_deliveryCore_nextCapacity)
            \/ delivery_deliveryCore_externalTargetAdvance
            \/ delivery_deliveryCore_crash
            \/ delivery_deliveryCore_recover

(*
  @type: (() => Bool);
*)
q_step == delivery_deliveryCore_step

================================================================================
