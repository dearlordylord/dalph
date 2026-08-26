# Concurrent controlled Runs keep one activation's services together

This scenario covers a tooling-controlled authored-cassette isolation
invariant and the negative control that rejects a cross-Run journal splice. It
does not add a new tracker, Git, executor, or journal protocol. The production
invariant is that one Run activation evaluates its delivery relations, admits
actions, creates execution leases, and interprets workflow operations using
services captured for that same Run. A controlled harness may replace outside
boundaries, but it must not weaken that isolation.

## Two maintainers exercise independent Runs concurrently through recovery

### Actors and starting facts

Two Dalph maintainers independently start two authored cassette Runs, A and B,
in the same test process. The test runner executes them concurrently; neither
maintainer acts inside the other's Run. Each Run has its own allocated
`RunId`, logically partitioned journal history, authored story cursor, tracker
responses, operation-ID allocator, recovery projection, and controlled
executor. Both stories use the same logical tracker target only to reproduce
normal service composition pressure; target equality does not make their
workflow histories or process-local activation services shared authority.

Before process loss, each Run has recorded only records carrying its own
`RunId`. Each has accepted a tracker graph, planned its own attempt, received
its controlled executor report, and entered its independently authored
integration chronology. Run A's operation identities contain A's `RunId`; Run
B's operation identities contain B's `RunId`. GitHub and real Git providers
are not involved because the cassette supplies deterministic controlled
tracker, Git, executor, and journal boundaries.

### Trigger and ordered boundary calls

The authored stories each reach `CoordinatorProcessDies`. The test harness
disposes that Run's activation scope without recording a crash event. It then
starts activation 3 for the same exact Run and, independently for A and B:

1. reads and validates that Run's journal prefix;
2. reconstructs that Run's recovery projection;
3. builds the current tracker/Git/executor boundary services declared by that
   Run's story;
4. derives and publishes current delivery relations from that Run's prefix;
5. admits a graph-read action using that Run's operation-ID allocator and the
   predecessor accepted in that Run;
6. gives the action a process-local execution lease created by the same Run
   activation; and
7. records the graph-read intent and observation in that Run's journal.

The two activation-3 executions may interleave at every Effect scheduling
boundary. Neither is serialized behind the other.

### Process death, retry, and outside events

Process death is the explicitly authored cut between activation 2 and
activation 3. It records no workflow occurrence. Activation 3 is ordinary Run
re-establishment: it reuses accepted records and predecessor identities from
that same Run and allocates only the genuinely new operation identity. There
is no ambiguous real-provider mutation to retry; controlled boundaries return
their declared observations. Re-running the whole test creates two new Runs
and fresh logically partitioned histories rather than reusing either prior
result.

### Visible and forbidden results

Each maintainer sees their own authored story complete or fail against its own
journal. Every record envelope, operation identity, causal predecessor,
planned-attempt correlation, tracker observation, and recovery fact returned
for A belongs to A, and the same is true for B.

Dalph must not combine B's derived proposal or allocator with A's action lease,
append B's operation identity or tracker observation to A's journal, accept a
predecessor absent from the receiving Run, or hide the mix behind Layer
memoization. Equal tracker targets do not authorize any of those outcomes.

### Acceptance-test mapping

- `keeps an unfinished Integrator session dormant when a blocker appears after process loss`
  first runs the two authored recovery stories concurrently without
  serialization and checks every tracker-read operation identity against its
  own `RunId`, including activation 3.
- The same test's blocker-history setup must use blocker evidence authored in
  the receiving Run, or canonically rebuild the copied operation and its
  predecessor graph for that Run. Relabeling only a Run B record envelope as
  Run A is a negative control: `reduceWorkflowJournalHistory` must reject the
  absent B predecessor rather than accept the cross-Run splice.
