# Prototype: a separately started host with two invokee clients

This is a bounded, disposable experiment for the invoker/invokee interview. It
changes no Dalph runtime behavior and makes no transport or deployment choice.
The host and clients use Node's local Unix-socket HTTP transport only because it
gives two real OS process boundaries with no provider, network, or dependency
setup. The client is therefore a transport probe, not an MCP implementation.

The experiment starts a host process independently. That process owns one
synthetic Run named `prototype-run`, a two-task graph (`A` is progressing and
`B` is waiting), capacity one at policy revision one, and a 100 ms heartbeat
that advances task progress. Two separately spawned Node client processes read
the host's status and issue capacity directions. The heartbeat is a controlled
work-progress substitute: it proves that the host remains alive and owns work
after a client exits, but it does not prove Dalph scheduling, tracker reads,
Git work, executor observation, or integration.

The host invokes the real exported `TaskWorkCapacityControl` through
`research/prototypes/invokee-hosting/dalph-capacity.mjs`, using one process-owned
`ManagedRuntime` and `liveJournalTestLayer`. That bridge creates an in-memory
accepted Run beginning and owns the capacity journal for the host lifetime.
`source-seams.mjs` repeats the capacity checks and the pure `deliveryStatusOf`
passive status projection as a small source-level smoke. This keeps the
transport probe's synthetic graph and heartbeat from being mistaken for the
production host implementation.

## Scenario: two clients inspect one already-running Run

The maintainer has run `node research/prototypes/invokee-hosting/host.mjs` with a
disposable socket and ready-file path. The host process is alive, has created
one synthetic graph and one in-memory accepted Run beginning through the real
capacity bridge, and has not received a client request. No GitHub task, Git
ref, worktree, executor session, or production Dalph journal exists for this
prototype; the bridge's memory journal is disposable process-local evidence.
There is no person-specific provider action and no live provider call.

The maintainer starts two independent `node client.mjs --command status`
processes. Each client reads the ready file and makes one local socket request
to `GET /status`. The host reads its own current Run state and returns the Run
identity, graph revision, capacity, policy revision, heartbeat count, and task
progress. The clients must observe the same Run identity and policy revision.

The host does not create a second Run, coordinator, graph, or work position as
a result of either read. A status request has no mutation or authority call in
this prototype. A client crash during this read is not retried by the host and
does not alter its state; the bounded harness does not force a read crash.

The visible result is two status responses naming `prototype-run` and revision
one. The host's forbidden result is a second Run or a state change caused by a
passive read.

The executable acceptance check is the two `initialOne` and `initialTwo`
responses in `research/prototypes/invokee-hosting/smoke.mjs`; the check requires equal Run
identities and equal policy revisions.

## Scenario: a capacity direction is applied while its response is lost

The host still owns `prototype-run` at capacity one and policy revision one.
The first client has read those values. Its process sends
`POST /control/capacity` with the exact Run identity, capacity two, and expected
revision one. The request includes the probe-only `dropResponse` flag.

The host checks the Run identity, validates the capacity in the same one
through eight range used by `TaskWorkCapacity`, and passes the direction to the
real `TaskWorkCapacityControl.apply` in its process-owned runtime. It applies
capacity two, advances the revision to two, and then closes the request socket
before sending an HTTP response. The client sees a failed request and has no
outcome response. This models a lost response after the host-side write; it is
not a provider call and does not claim a production transport retry contract.

The client reconnects by making a fresh `GET /status`. It sees capacity two and
revision two. It then replays the exact original request with expected revision
one. The real capacity control returns a revision conflict, and the host's
`journalRecords` count remains two. The visible result is one applied change
discovered by observation after the ambiguous response. The forbidden result
is a second revision increment caused by assuming the lost response meant that
the host did nothing.

The transport check is the `lost`, `afterLost`, `replay`, and `afterReplay`
sequence in `smoke.mjs`. The source check is the `initial`, `applied`, and
`stale` sequence in `source-seams.mjs`, which invokes the same real
`TaskWorkCapacityControl.read` and `.apply` operations over an accepted
in-memory journal prefix.

## Scenario: two clients race with one stale expected revision

The host has capacity two at revision two. Two newly spawned clients each use
the revision-two status they already observed and send a different capacity
(three and four) with the same expected revision. The host handles the two
local requests through its event loop. The first accepted request changes the
capacity and advances the revision to three. The other request compares its
revision-two expectation with the current revision three and returns a typed
`TaskWorkCapacityPolicyRevisionConflict` containing the winning current policy.

The clients do not retry the rejected mutation. One sees HTTP 200 and one sees
HTTP 409; the final state has exactly one new policy revision and one of the two
requested capacities. The forbidden result is accepting both directions,
silently choosing a stale direction, or retrying the conflict without a newly
observed revision.

The acceptance check is the `racingResponses` and `afterRace` assertion in
`smoke.mjs`, which requires exactly one success, one conflict, and journal
record count three (Run beginning plus two applied capacity changes). The source
probe asserts the same stale-revision behavior from
`TaskWorkCapacityControl` and confirms that the conflict carries the current
revision and capacity.

## Scenario: one client exits while controlled work continues and another reconnects

The host is still alive with a progressing task and an active heartbeat. A
third client process opens `GET /events`, receives current-first observations,
and is terminated by the harness with `SIGTERM` after a bounded interval. The
client process lifetime is therefore shorter than the host process lifetime.

The host removes the closed event response but keeps its Run state and
heartbeat. After a bounded wait, another newly spawned client requests
`GET /status`. It must observe the original Run and a heartbeat count greater
than the count read before the first client exited. At least one task's progress
must have advanced. The host must not stop work, release capacity, create a new
Run, or require the original client's process to reconnect.

The acceptance check is the `watcher` termination followed by the `reconnected`
assertions in `smoke.mjs`. This is the key host-lifetime check. The heartbeat is
deliberately called a substitution above; no claim is made that it proves the
real executor's process, Git, tracker, or journal obligations continue.

The same smoke run starts a second host with the deliberate
`--exit-on-client-close true` fault. After its watcher client closes, that
faulty host exits; the good host's post-disconnect progress assertion would fail
if the host lifetime were accidentally coupled to its client. This is a harness
negative control, not a production behavior.

## Scenario: the bounded host is cleaned up exactly

The smoke process owns the disposable socket, ready marker, and temporary
directory. Whether the assertions pass or fail, its `finally` block sends
`SIGTERM` to the exact host child, waits for that child to exit, and removes the
temporary directory. The host closes event subscribers and unlinks its socket
and ready marker before exiting. No live provider, repository, or user data is
used.

The visible result is a completed smoke command with no host child retained.
The forbidden result is an orphaned host process or a reusable socket that
could make a later run attach to the wrong Run. Host crash/restart recovery is
outside this five-to-ten-minute probe; the experiment instead covers the
ambiguous direction response and the client-process exit that the milestone
requires.

The cleanup and exit evidence is the `finally` block in `smoke.mjs` and the
host's `SIGTERM` handler. The current harness has no external process census;
the parent process waits for the exact child exit and removes only its own
temporary paths.

## Scenario-to-check mapping

| Scenario | Concrete check | Executable evidence |
| --- | --- | --- |
| Two clients inspect one Run | Same Run and policy revision from two independent processes | `smoke.mjs`: `initialOne`, `initialTwo` |
| Lost capacity response | Observe applied capacity/revision after failed response; exact replay conflicts without another journal record | `smoke.mjs`: `lost`, `afterLost`, `replay`, `afterReplay`; `source-seams.mjs`: real control read/apply |
| Stale revision race | Exactly one winner, one typed conflict, and one new journal record | `smoke.mjs`: `racingResponses`, `afterRace`; `source-seams.mjs`: `stale` |
| Client exits, host continues | Reconnect sees same Run and later host-owned progress; faulty client-owned host is caught by negative control | `smoke.mjs`: `watcher`, `reconnected`, `badWatcher` |
| Exact cleanup | Wait for host exit and remove disposable paths | `smoke.mjs` `finally`; host `SIGTERM` handler |
| Passive status source | Not-ready status projection remains a read-shaped result | `source-seams.mjs`: `deliveryStatusOf` returns `DeliveryStatusNotReady` |

Run the complete bounded experiment from the repository root with:

```sh
node research/prototypes/invokee-hosting/run.mjs
```

`source-seams.mjs` imports the built `@dalph/orchestrator` package. In a fresh
worktree, build that package with its existing command before running the
probe; the prototype adds no dependency or package-script change.

## Reused APIs and deliberate limits

The host and source probe reuse `makeWorkflowRunBeganRecord` for the exact
beginning record, `liveJournalTestLayer` for the accepted in-memory journal
boundary, `TaskWorkCapacityControl.read` and `.apply` for revision semantics,
`TaskWorkCapacity` for the one-through-eight capacity boundary, and
`deliveryStatusOf` for a pure passive status projection. These are evidence
that the prototype's capacity and status calls use existing seams; they do not
turn the local host into a production `ProductionRepositoryHost`.

The probe does not instantiate `productionRepositoryHostGraph` or the full
`JournaledRunBootstrap.operatorControl`: doing so requires the full repository
host composition, tracker/Git configuration, executor layers, and scoped
application lifecycle. Calling those boundaries in this local experiment would
either require live-provider substitutions at a larger scale or risk claiming
coverage the harness cannot provide. The transport host therefore uses an
explicit synthetic state and only a heartbeat for controlled progress. It does
not prove a production host or coordinator lock, real graph/frontier projection,
accepted-fact reactivation, executor observation or cleanup, pause/unpause,
wake/refresh hints, MCP or CLI protocol, authentication, Git lineage, host
crash reconstruction, or real worker execution. Capacity two does not admit `B`
or change scheduling in this experiment; `B` remains waiting while the
heartbeat advances `A`, so no scheduler claim is being made.
