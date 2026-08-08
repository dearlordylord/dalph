/* #199: rerun the established L2 safety and liveness questions at exactly
 * three tasks. This module adds no alternate transitions; it reuses
 * DeliveryL2.als and DeliveryLiveness.als verbatim and changes only scope. */
module deliveryThree

open deliveryLiveness

check invAlwaysHoldsThree {
  trace => always Inv
} for exactly 3 Task, 5 Int, 1..14 steps

check invIsInductiveThree {
  (Inv and step) => after Inv
} for exactly 3 Task, 5 Int, 2 steps

check pauseDrainsPositionsThree {
  (liveTrace and eventually always (Sys in Paused) and eventuallyStable)
    implies eventually always (no Holds)
} for exactly 3 Task, 5 Int, 1..12 steps

check everyBegunSettlesThree {
  (liveTrace and eventuallyStable and eventuallyRunning and eventuallyRoomy)
    implies (all t : Task |
      always (t.phase = Executing implies eventually t.phase in Settled + Abandoned))
} for exactly 3 Task, 5 Int, 1..12 steps

check reachesQuiescenceThree {
  (liveTrace and eventuallyStable) implies eventually always quiescent
} for exactly 3 Task, 5 Int, 1..12 steps

run threeTaskFairTraceExists {
  liveTrace and eventuallyStable and eventuallyRunning
  eventually (some t : Task | t.phase = Settled)
} for exactly 3 Task, 5 Int, 1..12 steps
