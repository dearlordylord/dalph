/*
 * The L2 counterparts of ../MUTANTS.md. Every method here MUST fail to verify.
 * A clean run means the class invariant in DeliveryL2.dfy is too weak to catch
 * anything, which is the Dafny form of a vacuous proof.
 *
 * ./run.sh checks that the expected number of errors is reported.
 */

datatype Phase =
  | NoObligation | Claimed | Planned | Executing | SuspensionRequested
  | Suspended | Accepted | Integrating | Promoted | Settled

datatype Option<T> = None | Some(value: T)

datatype Ticket = Ticket(phase: Phase, attempts: nat, present: bool, isOpen: bool, expectedHead: nat)

predicate HoldsPosition(p: Phase) { p == Executing || p == SuspensionRequested }

/*
 * MUTANT: the invariant WITHOUT the strengthening.
 *
 * This is the whole point of the file. `ValidWeak` keeps `attempts <= 1` and
 * drops the clause relating phase to attempts. It is exactly the invariant TLC
 * discharges without comment, exactly the one Lean and Agda cannot prove, and
 * exactly the one Alloy's `attemptsAloneIsInductive` refutes with a
 * counterexample to induction.
 *
 * Dafny reports it as PlanAttempt failing to re-establish its own class
 * invariant. Same obstruction, a third presentation.
 */
class DeliveryWeak {
  var tickets: map<nat, Ticket>
  var capacity: nat
  var holds: set<nat>
  var crashed: bool

  const Tasks: set<nat> := {0, 1}

  ghost predicate ValidWeak()
    reads this
  {
    && (forall t :: t in Tasks ==> t in tickets)
    && holds <= Tasks
    && (forall t :: t in Tasks ==> tickets[t].attempts <= 1)
    // The phase/attempts clause is deliberately absent.
  }

  constructor()
    ensures ValidWeak()
  {
    tickets := map[0 := Ticket(NoObligation, 0, false, false, 0),
                   1 := Ticket(NoObligation, 0, false, false, 0)];
    capacity := 1;
    holds := {};
    crashed := false;
  }

  // MUST FAIL: nothing in ValidWeak() rules out attempts == 1 while Claimed.
  method PlanAttemptM(t: nat)
    requires ValidWeak() && t in Tasks
    requires !crashed && tickets[t].phase == Claimed
    modifies this
    ensures ValidWeak()
  {
    tickets := tickets[t := tickets[t].(phase := Planned, attempts := tickets[t].attempts + 1)];
  }
}

/*
 * MUTANT M4: the task-work position is released when suspension is requested
 * rather than when the executor proves safe suspension. Breaks I7, which here
 * is the `holds` clause of the class invariant.
 */
class DeliveryM4 {
  var tickets: map<nat, Ticket>
  var holds: set<nat>
  var crashed: bool

  const Tasks: set<nat> := {0, 1}

  ghost predicate Valid()
    reads this
  {
    && (forall t :: t in Tasks ==> t in tickets)
    && holds <= Tasks
    && (crashed || holds == set t | t in Tasks && HoldsPosition(tickets[t].phase))
  }

  constructor()
    ensures Valid()
  {
    tickets := map[0 := Ticket(NoObligation, 0, false, false, 0),
                   1 := Ticket(NoObligation, 0, false, false, 0)];
    holds := {};
    crashed := false;
  }

  // MUST FAIL: SuspensionRequested still holds a position, so dropping it here
  // breaks the invariant.
  method RequestSuspensionM4(t: nat)
    requires Valid() && t in Tasks
    requires !crashed && tickets[t].phase == Executing
    modifies this
    ensures Valid()
  {
    tickets := tickets[t := tickets[t].(phase := SuspensionRequested)];
    holds := holds - {t};
  }
}

/*
 * MUTANT M8: the specification error, not a code defect.
 *
 * Admission respects the ceiling, but the postcondition asserts the ceiling
 * still holds after a capacity contraction. Existing holders continue, so it
 * does not. Dafny points at the postcondition rather than the code, which is a
 * better surfacing than TLC's "the faithful model is violated".
 */
class DeliveryM8 {
  var capacity: nat
  var holds: set<nat>

  constructor()
    ensures |holds| <= capacity
  { capacity := 1; holds := {}; }

  // MUST FAIL.
  method ChangeCapacityM8(c: nat)
    requires |holds| <= capacity
    modifies this
    ensures |holds| <= capacity
  { capacity := c; }
}
