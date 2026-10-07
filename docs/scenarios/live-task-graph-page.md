# Alice inspects the running host's complete task graph

This refines the accepted scope of
[#432](https://github.com/dearlordylord/dalph/issues/432). The scenarios below
name implementation obligations, not completed qualification.

## Governing behavior

Preserve the rooted closure and normalized observation rules in
[tracker graph and claims](../architecture/tracker-graph-and-claims.md#run-root-task-and-run-task-graph).
Inspection uses the existing reader and introduces no scheduling authority.
Preserve the bounded transport and ownership rules in
[running-host clients](running-host-clients.md) and the accepted diagnostics in
[actionable failure diagnostics](actionable-failure-diagnostics.md).
The same-origin read-only page refines the browser-Origin refusal for its
observation routes; browser control requests remain refused. Existing Run
activation/finality laws and [delivery invariants](../DELIVERY-INVARIANTS.md)
still govern workflow effects. This presentation does not change those effects.

## P1 — Open the supplied root's graph

Alice has started the existing production host with one GitHub root. The root has grouping descendants and transitive prerequisites, including tasks outside the selected Run. Existing claims, Git worktrees and executor sessions may already exist. Alice opens the host's configured HTTP origin. The host reads through its already composed TrackerGraphReader and presents the complete normalized closure through the shared DeliveryGraphProjection and dalph-delivery-graph renderer. Prerequisite-only nodes do not recursively add grouping descendants. The page overlays actual Run observations, showing outside-Run lifecycle facts without granting scheduling permission. Opening and filtering the page performs no claim, worktree or coordinator-control effects. Restart discards inspection cache and rebuilds from authorities; an initially unavailable graph is not an empty complete graph.

Acceptance seams: graph-reader/contract existing closure tests plus production host inspection tests proving the same reader instance and zero mutation/control effects; common widget projection and real-host browser test for prerequisite/grouping edges and actual Run diagnostics.

## P2 — Shared refresh and browser reconnect

The first inspection read or watch starts one host-scoped observation owner; descriptor, assets and existing CLI/MCP operations alone do not start graph polling. This preserves the existing paused-client scenarios. Two browsers are connected to that one host. At the host's 30-second refresh boundary, or Alice's manual inspection refresh, the host owns one read and shares concurrent requests. Neither browser calls GitHub. An in-flight inspection read coalesces; workflow-required fresh authority reads retain their existing semantics. Bounded watch transports new inspection observations and accepted Run status. Browser reconnect handshakes the current host instance and receives current state, without replaying cassette history or issuing a scheduling refresh. If the host crashes during the read, no complete observation is published; a restarted host rebuilds it. Repeated page/manual reads may repeat read-only observation after the in-flight read ends, but never mutate tasks or restart executors.

Acceptance seams: controlled TestClock/Deferred host refresh tests, watch contract/shutdown tests, two-browser real-host test. Fake clocks prove cadence; browser test proves actual shared host transport and widget use, not GitHub timing.

## P3 — Failure, incomplete graph and source freshness

A complete graph has been observed at time T. The next reader call fails, times out or cannot prove completeness. The host retains that complete graph and T, reporting refresh failure and stale age. It does not replace the graph with an empty or truncated success. A successful later read replaces it completely and clears the failure. When the first read fails there is no complete graph to retain, and the page reports unavailable. Run publication and graph observations have separate freshness; a joined presentation makes no atomic snapshot claim. A crash loses this process-local cache; retained workflow history does not turn into durable UI graph state.

Acceptance seams: controlled host failure/incomplete/recovery tests and widget stale/unavailable rendering tests, browser restart/reconnect test. No mutations exist to retry; only safe reads repeat.

## P4 — Exact origin and read-only boundary

For an ordinary HTTP IPv4 origin, the browser may expose `getRandomValues`
without `randomUUID`. After reading the descriptor, the page creates a UUIDv4
request identity using that available cryptographic primitive, then reads the
inspection snapshot and attaches its watch. The graph becomes visible with
the same correlation and read-only guards; unavailable `randomUUID` must not
leave the page permanently connecting. No mutation, crash or ambiguous retry
is introduced by local identity generation. The controlled
`browser-request-id.test.ts` covers this capability boundary; the existing
real-host browser scenario owns end-to-end connection evidence.

The host listens on an already supported literal IPv4 origin. Alice loads its page and assets, then reads descriptor/snapshot/watch from that exact origin. The host checks exact Host and, when present, exact same Origin. Cross-origin and mismatching authorities are rejected before dispatch. Browser-origin control operations remain rejected; the page has no scheduling controls. Asset paths are a fixed allowlist and never expose arbitrary repository files. Existing CLI/MCP no-Origin behavior remains compatible. HTTP disconnect affects only that browser's observation resources, and host Exit closes refresh and bounded watches through existing custody. No new authentication, hostname grammar, Docker requirement or authority source is introduced.

Acceptance seams: running-host HTTP authority and route tests, asset allowlist tests, actual browser same-origin and cross-origin refusal, host Exit/watch resource cleanup tests. Browser retries re-handshake the descriptor and cannot acquire command authority.

## Acceptance owner mapping

Existing tests remain governing regressions; these named tests must be added
at their production boundary before claiming implementation complete.

| Scenario | New test and owner |
| --- | --- |
| P1 | `running-host-inspection.test.ts`: “inspection selects the exact composed reader and never constructs a fallback”; `running-host-inspection-composed.acceptance.test.ts`: “uses the composed reader and supplied root without workflow effects and exposes actual Run diagnostics”, “inspection preserves paused history without scheduling or mutation effects”; GitHub `github/graph-reader.test.ts`: “projects paginated grouping and transitive prerequisite closure atomically”, “keeps grouping descendants of prerequisite-only tasks outside the target closure”; `running-host-page.browser.test.ts`: common widget, task facts and both relationship kinds through the actual host. |
| P2 | `running-host-inspection.test.ts`: “coalesces manual reads and owns one thirty-second refresh”; `running-host-inspection-watch.test.ts`: “publishes inspection changes through bounded watch and reconnects to current state”; the browser test connects two pages and re-handshakes a replacement host at the same origin. |
| P3 | `running-host-inspection.test.ts`: “retains the last complete graph on failed refresh and reports initial failure as unavailable”, “restart reconstructs without durable inspection state”; `running-host-page-projection.test.ts`: “keeps graph and Run freshness distinct and never derives Dalph settlement from tracker completion”; browser test retains stale tasks and clears the old graph after a restarted host reports unavailable. |
| P4 | `running-host-page-http.test.ts`: exact origin, controls refused, fixed packaged assets and lazy inspection startup; browser test proves same-origin reads and foreign-origin refusal; `running-host-inspection-exit.acceptance.test.ts`: “Exit drains an in-flight production inspection read and its bounded watcher”. Existing watch shutdown tests retain the original Snapshot/Closed transport proof. |

Inspection performs only reads. An interrupted read produces no complete
publication; there is no ambiguous mutation to reconcile or retry. Graph refresh
state and viewport/filter state are process-local presentation observations,
never journal facts, claims, task membership or workflow frontier.
