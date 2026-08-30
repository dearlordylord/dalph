# Define control-plane latency and responsiveness budgets

Issue: [Define control-plane latency and responsiveness budgets](https://github.com/dearlordylord/dalph/issues/104)

Status: accepted chronological scenarios for issue #104. These scenarios define
which waits Dalph may bound and which timings remain targets or measurements;
they do not promise hard real-time behavior.

The maintainer is the affected person when a timing choice changes what an
operator can observe. GitHub, the local Git filesystem, the Dalph Journal, and
the executor are the relevant systems. A tracker request, Git command, or
executor session may take longer than any local computation; the timing of
those outside systems is never substituted with a deterministic local delay.

## A maintainer classifies one control-plane path before production composition

### Starting situation

The maintainer is reviewing a production composition that reads an
authoritative issue graph from GitHub, validates the local DAG, derives a
frontier, admits a task claim, starts an executor session, and holds an
operating-system lock for one Git common directory. The Journal contains no
latency policy of its own. Existing source includes a one-second local
ownership observation cadence, a five-second application Exit drain, bounded
tracker page/task reads, and bounded claim/executor command attempts.

No task tracker, Git, or executor boundary is called by this review. The
maintainer is deciding how to describe existing behavior and what a future
boundary may promise; there is no production request whose result needs
reconciliation.

### Trigger and chronological behavior

1. The maintainer follows one concrete path from a complete tracker snapshot
   through local graph validation/frontier derivation, claim admission, an
   executor start/stop observation, and coordinator ownership checks.
2. For each path, the maintainer names the actor, the owning system, and the
   result that can be known. Local graph work receives a measurement target
   only. GitHub and the executor retain their remote/substrate latency; Dalph
   does not turn that latency into a local timeout in a deterministic test.
3. Tracker snapshot freshness is expressed as a fresh complete logical read,
   not as permission to use a cached snapshot for a fixed wall-clock interval.
   Recovery/reconciliation is bounded by each owning protocol's read or
   command limit and records an exhausted result; it has no invented global
   deadline.
4. Claim and mutation admission retain intent-before-effect and
   reconcile-before-retry. A retry limit is a count of complete attempts, not
   a claim that GitHub will respond within a local duration. Execution start
   and stop use exact correlated reports; an absent or slow report remains
   unresolved rather than becoming `ExecutorWorkSafelySuspended`.
5. The maintainer records the decisions in the focused control-plane budget
   document linked from the architecture map. The document distinguishes
   targets, hard timeouts, retry/backoff policies, observation/cancellation
   bounds, and metrics-only measurements.

The review does not crash because it performs no boundary call. A later
production request may crash or lose a response, but this review does not
create a new recovery path. Repeating the review changes neither the Journal
nor any outside authority.

### Visible result and forbidden result

The maintainer sees one table that explains why a local DAG calculation has a
measurement target while a five-second application drain has a hard limit.
The table does not report a fabricated end-to-end latency or an ETA for an
agent session. Dalph must not use one number for all boundaries, infer
freshness from elapsed process time, or turn a metrics target into a timeout.

### Acceptance-test mapping

- `names every accepted boundary and its timing policy` checks all seven
  boundary/policy rows, and `keeps the accepted scenarios discoverable from
  the scenario and architecture maps` checks both documentation links.
- `material local timing values decode as finite positive branded durations`
  checks the two existing local timing values at the Schema boundary.
- Existing `interrupts every affected mutation after a contradictory
  observation` and application Exit `TestClock` scenarios prove that
  remote/substrate latency is not encoded as a local deterministic delay.

## An operator requests Exit while a local ownership check and executor work are active

### Starting situation

The operator runs Dalph against one Git common directory. Dalph holds the
local filesystem lock and has started a background descriptor/path comparison.
One admitted executor reports `ExecutorWorkExecuting`; no new forward-progress owner is
accepted after the Exit request. The executor, GitHub, and any target
repository verification process are outside the local timing contract.

### Trigger and chronological behavior

1. The operator requests graceful application Exit. The application closes
   forward-progress admission and starts one drain measured from that cutoff.
2. The local ownership observer continues at its one-second interval, measured
   from completion of the previous comparison. A state-changing mutation also
   performs one synchronous ownership comparison immediately before crossing
   its boundary. The cadence is local-filesystem observation, not a remote
   lease expiry and not a distributed fencing promise.
3. Dalph asks already-running executor work for its exact safe suspension and
   flushes already-produced Journal writes and local resources. It does not
   wait for the executor's internal session, GitHub, or a new reconciliation
   request to finish.
4. If all admitted work reaches its ordinary safe boundary, Dalph reports
   graceful success. If a useful local drain remains unresolved at five
   seconds from the original cutoff, Dalph reports timeout and requests
   forced nonzero process termination. A repeated Exit request joins the same
   drain and cannot reset its deadline.

If the local ownership comparison contradicts the held descriptor, Dalph
interrupts the affected mutation and rejects later mutations. If the
coordinator dies, the process-local observer disappears; no synthetic Journal
event claims that ownership was lost. A later process reacquires the exact
local filesystem lock before mutating.

The operator sees either graceful completion or a typed timeout/failure
diagnostic. The operator does not see a promise that a remote executor stopped
within five seconds; the five seconds bound only the application lifecycle
drain.

### Acceptance-test mapping

- `material local timing values decode as finite positive branded durations`
  proves the one-second ownership interval and five-second Exit duration.
- `coalesces repeated Exit requests without resetting the fixed five-second
  deadline` and `uses no fresh drain time when driver start is delayed beyond
  the original fifth second` use `TestClock` and prove that the drain is a
  hard application-lifecycle bound.
- Existing coordinator ownership tests prove synchronous contradiction
  handling and local descriptor/path observation. The Node adapter takes its
  one-second interval from the branded value; the controlled contradiction
  test does not pretend to wait for a filesystem or remote response.

## A coordinator loses an ambiguous remote result and resumes later

### Starting situation

The coordinator has read a complete tracker snapshot and selected task A. It
has recorded the exact claim intent before asking GitHub to create the claim.
GitHub may have applied the label, but the response is lost. Separately, an
executor start or stop request may have returned no report. The Journal keeps
the exact intent and planned-attempt correlation; no local elapsed duration
proves either outside result.

### Trigger and chronological behavior

1. The coordinator process exits or loses the response after the external call.
   The person does not receive a claim-success or safe-suspension result.
2. On restart, Dalph reconstructs the exact unfinished responsibility. It
   rereads GitHub for the exact claim and the execution substrate for the
   exact planned-attempt report before repeating anything.
3. If GitHub reports the exact claim, Dalph records that observation and sends
   no second claim request. If GitHub reports an authoritative absence, the
   existing bounded acquisition protocol may retry. An unreadable response or
   conflicting claim remains a typed constraint.
4. If the executor reports `ExecutorWorkSafelySuspended` or a terminal result for the exact
   correlation, Dalph may release that task-work position. A slow, missing, or
   foreign report does not release it. Recovery continues only while the
   owning protocol's bounded observations or commands remain available.

The recovery path has no global wall-clock timeout because the tracker and
execution substrate own their response times. Repeating the activation
reuses the durable operation identity and exact payload; it does not reset a
timer or create a second claim/executor identity.

The person sees a recoverable wait, a typed conflict, or the exact reconciled
result. Dalph must not treat a timeout, process loss, missing session, or lost
response as proof of absence, safe suspension, claim release, or mutation
failure.

### Acceptance-test mapping

- `rereads tracker authority after an ambiguously applied acquisition` and
  `returns typed non-convergence after bounded unknown outcomes` prove the
  bounded retry and authoritative reread behavior.
- `journals a contradictory executor response and reconciles its exact command
  before retry`, `requires exact command reconciliation before a generic
  executor-state observation`, and `releases capacity only after the planned
  attempt is safely suspended` prove exact correlation, reconciliation, and
  no timeout-derived quiescence.
- `names every accepted boundary and its timing policy` checks that recovery
  remains boundary-specific and has no global deadline.

## Scenario-to-test mapping required for implementation

The implementation handoff must map every chronology above to the named
document seam and passing focused tests. No Quint model changes are required:
these scenarios classify existing timing and freshness behavior without
changing a modeled frontier, admission, pause, executor, or recovery decision.
The one-second ownership cadence and five-second application Exit drain remain
local process contracts; tracker and executor latency remain external facts.
