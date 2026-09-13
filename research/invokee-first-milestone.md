# First invokee milestone

Status: consolidated interview decisions through Q26, with proposed acceptance
seams. This document changes no runtime behavior and is not an implementation
handoff. The interview records acceptance of product scope; the connection
protocol and its retry behavior still need a concrete design before coding.

## Alice uses an agent alongside autonomous Dalph

Alice has started Dalph separately for a repository and one tracker root R.
R's graph contains open tasks A (parser), B (validation), and C (command), with
explicit blockers A and B on C. Tracker grouping determines graph membership,
not implicit blockers. Dalph has established its Run journal and holds the
repository's coordinator lock. For this example capacity is one, A has an exact
claim, planned Base SHA, worktree and executing opaque executor association;
B has no attempt yet. Git and the execution substrate own their respective
current facts. The journal contains the existing workflow intents and
observations; connecting a client creates no replacement Run history.

1. Alice asks her orchestrator agent to inspect delivery. Its MCP process
   connects to the running Dalph application. A CLI client can call the same
   application operations. Neither connection starts another coordinator.
2. The agent reads the current task graph and frontier, including tasks without
   executors and optional opaque executor associations. Alice can inspect the
   same delivery. Reading status does not start work or refresh authorities.
   Updates should be available without making an agent reconstruct the graph
   from its chat history; the exact wire subscription mechanism is undecided.
3. The agent requests work within the existing root-based scope and adjusts
   capacity to two under Alice's instructions. Dalph chooses eligible work;
   the client does not choose an executor or individual task. Existing delivery
   protocols claim B, plan its exact attempt and Git resources, and start its
   executor. The exact meaning of a work request when the Run is already
   progressing, paused, or quiescent must be mapped to existing operations.
4. The agent authors example-data task E and its blocker relationship to C
   through the tracker. It can ask Dalph to refresh the graph or refresh IDs
   [C, E]. That notification carries no authored dependency facts. Dalph reads
   sufficient tracker facts through its owning boundary. Startup and scheduled
   reads remain available; no startup notification is required.
5. Alice closes her agent application, terminating that client's MCP process.
   Dalph continues already-authorized work, including executor observation,
   integration, tracker reflection and exact cleanup. Client disconnection is
   not a Dalph Exit request and does not release task execution positions.
6. A later agent or Alice's CLI connects and sees current delivery. It does not
   need the original chat, an online parent, or returned worker handles.

Visible result: one ongoing delivery, controlled and inspected through either
interface, with ordinary bounded execution and bookkeeping owned by Dalph.
Forbidden results: duplicate coordinator/Run from client attachment; cleanup or
capacity release caused only by client silence; graph facts taken from refresh
payloads; graph inspection starting workflow actions; executor internals
becoming required task-graph structure.

No Dalph crash occurs in this main chronology. The MCP process exit in step 5
is intentional and distinct from the application host stopping. If the actual
Dalph host exits, its existing shutdown/reconstruction rules apply; this
milestone does not promise uninterrupted work through host death.

## Failure and edit variants

- **Response lost after a direction:** Dalph receives a capacity/work direction,
  but the client loses the response and reconnects. The application boundary
  must specify how a caller determines the outcome and safely repeats the
  request. Existing journaled direction mechanisms are candidates to reuse;
  no new request identity or retry protocol has been selected. This is a
  remaining design gap, not permission to blindly repeat workflow effects.
- **Tracker edited in several calls:** a scheduled read sees D before its new
  blockers are authored. The first implementation may start D from that
  observed state (Q17). There is no required edit transaction or readiness
  barrier. Incomplete provider evidence still cannot prove a blocker absent.
- **Two clients:** two agent clients connect to the same running application.
  They share its existing Run, execution capacity and coordinator ownership.
  They do not each instantiate delivery merely because they share operation
  code. Ordering competing control requests needs to follow the existing
  application's accepted direction rules, with any uncovered case designed
  explicitly.

## Scope and sequencing

| Item | Decision |
| --- | --- |
| Invocation direction | Preserve autonomous use and support agents invoking Dalph simultaneously |
| Initial interfaces | MCP and CLI call shared application operations |
| Process lifetime | Start Dalph separately; client/MCP exit leaves accepted work running |
| Run scope | One Run per repository, existing single-root graph |
| Arbitrary task selection | Outside the plan; not a deferred feature |
| Scheduling | Dalph chooses; prioritization/readiness facilities may be considered later |
| Capacity | Existing selector is relevant; startup argument remains a candidate |
| Initial executors | Existing Dalph-managed executor boundary; opaque to generic graph |
| Human worker access | Native provider facilities where available; no custom chat standard selected |
| Caller-launched workers | Separate research/prototype track; launch, registration, observation and release remain distinct questions |
| Unobservable external worker | Retain occupied capacity and show unresolved until verification/intervention |
| Recursive implementer yields for new prerequisites | Accepted later within current planned core Dalph features, including autonomous use |
| Parent/child messaging and handback | Not agreed Dalph requirements; user workflow determines collaboration |

Recursive planning must not be reduced to a task hierarchy rule. An implementer
can author explicit prerequisites; grouping alone does not schedule a parent
or complete it. Preservation of partial Git work and unfinished-attempt
semantics need their own later design.

## Architecture implications, not a selected deployment

Hulymcp demonstrates shared operations behind CLI and MCP adapters
(`../hulymcp/docs/cli-parity-contract.md`). Dnd demonstrates MCP hosting an
application separately from its UI (`../dnd/docs/adr/0008-public-mcp-runs-in-a-provider-neutral-node-container.md`).
Neither establishes shared live scheduling merely by sharing code or storage.

For this milestone, client-facing adapters must reach the already-running
Dalph application. Choose the smallest connection mechanism compatible with
its existing host, coordinator exclusion, status signals and control seams.
Do not create another scheduler, persist a graph/frontier cache as authority,
or make the MCP process lifetime the Run lifetime.

The current glossary defines Operator as a logical human actor. Agent-issued
requests on the user's instructions need an explicit boundary interpretation
before implementation; do not silently redefine Operator or introduce an
identity/authentication system during this documentation consolidation.

## Acceptance seams

These are required future checks, not claims of passing tests or recorded
cassettes. Existing implementation evidence is mapped separately below.

| Scenario | Concrete test outcome |
| --- | --- |
| Agent joins autonomous delivery | Two clients see the same Run and task graph; attachment starts no second coordinator or attempt |
| Passive graph inspection | Snapshot and update subscription create no authority calls or workflow writes |
| Work request and capacity change | Root-based work uses existing admission; increasing capacity permits eligible work without duplicating current attempts |
| Tracker refresh | Full/ID-only hints cause sufficient authority reads; payload supplies no graph facts |
| Intermediate tracker edit | D may start when observed eligible before blockers are authored; incomplete reads do not erase blockers |
| MCP process closes | Existing executor and delivery continue; another client reconnects to the same Run |
| Direction response is lost | Selected direction protocol resolves/repeats safely without duplicated workflow effects |
| Dalph host exits | Existing shutdown and reconstruction remain distinct from client disconnect |

Before implementation, place the resulting concrete protocol chronology under
`docs/scenarios/`, trace its forbidden results to the owning delivery invariants,
and map it to executable acceptance coverage. No runtime code or model changes
are part of this consolidation.

## Existing implementation and remaining gaps

Source inspection is against this isolated worktree's baseline, not the original
workspace's uncommitted source snapshot. Tests below were inspected, not run in
this documentation task. Paths are relative to the repository root.

| Capability | Existing source and test evidence | Remaining milestone work |
| --- | --- | --- |
| Production host and root-based Run | `packages/dalph/src/application/production-host.ts`, `withDecodedProductionRepositoryHost`; `production-host.test.ts` checks that two unfinished Runs fail and name both identities | Add attachment boundary; callback lifetime currently owns host scope |
| Public invocation | `packages/dalph/src/application/live-cli.ts`, `makeProductionCli`, accepts `run <target> --production --config …` | Current invocation owns delivery; it is not an attachable client |
| Passive delivery status | `packages/orchestrator/src/coordination/delivery/delivery-status.ts`, `deliveryStatusOf`, `deliveryStatusSignalOf`, `observeDeliveryStatus`; `delivery-status.test.ts` checks no journal/authority calls and current-first reconnect | Expose snapshot/update operations; a full task graph with edges is not automatically the same projection as delivery status |
| Wake and Unpause | `packages/orchestrator/src/coordination/run/run-reactivation-owner.ts`, `OperatorWake`; `packages/orchestrator/src/workflow/protocols/control-direction-application/operator-control.ts`, `applyOperatorControlDirection`; reactivation tests prove paused restart stays passive and accepted Unpause activates once | Expose command services and distinguish waking an unpaused Run from unpausing it; host observation currently exposes neither |
| Capacity changes | `packages/orchestrator/src/control/task-work-capacity.ts`, `TaskWorkCapacityControl.apply/read`, request includes `runId` and `expectedRevision`; tests cover latest revision after restart, stale revisions and competing writer | Expose existing revision-aware control through adapters; prove lost-response behavior without inventing last-writer policy |
| Refresh | `run-reactivation-owner.ts` has payload-free `TrackerNotification` and `Timer`; `packages/dalph/src/application/production.ts` wires refresh; reactivation tests cover lost notification recovered by timer and coalescing | Expose whole-graph hint; task-ID hints require an extension or explicitly advisory handling, not an assertion of existing support |
| Client loss | `live-cli.ts` routes SIGINT/SIGTERM to application Exit; `production-cli.test.ts` proves lost stdout closes invocation; host closes scope after callback | Separate client lifetime from application host lifetime and test disconnect/reconnect while execution continues |

`ProductionHostObservation` currently exposes current state, history,
termination and application Exit. It does not expose capacity/control/refresh
services. The production host includes Codex executor and Integrator layers;
older claims that only controlled executors exist do not describe this baseline.

Existing capacity revision checks already answer part of concurrent-client
ordering. Reuse those semantics rather than asking the user to choose a new
conflict policy. Source inspection has not established the exact redelivery
contract for every future adapter operation.

## Next bounded design work

1. Define the smallest independently hosted connection boundary around the
   existing production host. Keep its callback alive across client exits;
   retain exclusive coordinator ownership in that host.
2. Map status/graph, work directions, capacity and refresh to shared application
   operations with explicit results and redelivery behavior. Resolve the
   wake-versus-Unpause distinction from accepted workflow intent before coding.
3. Turn the acceptance seams above into protocol scenarios and their concrete
   adapter tests. Targeted refresh must state how sufficient graph coverage is
   obtained, even if its implementation rereads the whole root graph.

This is a design handoff, not an implementation plan. It makes no commitment to
a socket versus HTTP, a background process manager, an authentication system,
or an expanded executor protocol. Caller-launched workers remain on their
separate research/prototype track.
