/*
 * The seeded defects of ../MUTANTS.md, each stated with the postcondition the
 * faithful version carries. Every one of these MUST fail to verify. A clean
 * run of this file means the specifications in Delivery.dfy are too weak to
 * catch anything, which is the Dafny form of a vacuous proof.
 *
 * ./run.sh checks that the expected number of errors is reported.
 */

/* M1: the off-by-one bound, claiming the faithful postcondition. */
function SelectM1(capacity: nat, eligible: seq<nat>): seq<nat>
  ensures |SelectM1(capacity, eligible)| <= capacity
{
  if |eligible| == 0 then []
  else if capacity == 0 then [eligible[0]]
  else [eligible[0]] + SelectM1(capacity - 1, eligible[1..])
}

/* M2: deliveries drop everything not currently selected, while still claiming
 * that an obligation is retained. */
function DeliveriesM2(selected: seq<nat>, obligated: seq<nat>): seq<nat>
  ensures forall t :: t in obligated ==> t in DeliveriesM2(selected, obligated)
{
  selected
}

/* M8: the specification error. Admission respects the ceiling, but the
 * postcondition asserts the ceiling still holds after a contraction. */
method AdmitThenContractM8(candidates: seq<nat>, capacity: nat, newCapacity: nat)
  returns (positions: seq<nat>, finalCapacity: nat)
  ensures |positions| <= finalCapacity
{
  positions := [];
  var i := 0;
  while i < |candidates|
    invariant 0 <= i <= |candidates|
    invariant |positions| <= capacity
  {
    if |positions| < capacity {
      positions := positions + [candidates[i]];
    }
    i := i + 1;
  }
  // Existing holders continue across a policy revision.
  finalCapacity := newCapacity;
}
