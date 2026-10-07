# Alice views the running host's observed task graph

The user accepted this change on 2026-10-07: the dashboard must reuse the
running Dalph Run's observations and must not start separate GitHub polling.
This supersedes the dashboard's independent-reader behavior in
[#432](https://github.com/dearlordylord/dalph/issues/432).

## Governing behavior

The page preserves [passive running-host snapshot/watch](running-host-clients.md),
[rooted tracker closure](../architecture/tracker-graph-and-claims.md#run-root-task-and-run-task-graph),
and [journal-first observations](journal-first-tracker-observations.md#a-graph-read-cannot-authorize-work-before-the-journal-append).
It renders the complete graph already published by the Run, including grouping
and transitive prerequisites; execution eligibility remains separate. The
existing workflow timer and focused checks retain their owners. This change
adds no workflow operation, journal fact, tracker mutation, claim, Git effect or
execution permission. D9 and D21–D23 in [delivery invariants](../DELIVERY-INVARIANTS.md)
remain governing; `activeRefreshUnreadableAuthorizesNoExecutorAction` in
[taskFactReconciliation.qnt](../../specs/taskFactReconciliation.qnt) remains
unchanged. Explicit inspection APIs are outside this dashboard change.

## P1 — Alice opens the graph already observed by the Run

The host has one established GitHub-root Run and a complete journaled tracker
observation containing a root, grouping child and transitive prerequisite.
Claims, worktrees and sessions may exist, but viewing them cannot modify them.
Alice opens the supplied HTTP origin. The browser reads the descriptor, then
`ReadSnapshot`, then `WatchSnapshots`. The host projects its current Run
publication without calling TrackerGraphReader. The page renders all tasks and
both edge families through the existing shared widget, together with actual Run
diagnostics. Tracker completion alone is not Dalph settlement. Opening a second
browser, filtering, selecting a task or closing the page causes no GitHub read,
inspection-owner startup, scheduling refresh, claim or executor action.

Acceptance: `running-host-page.browser.test.ts`: “shows Run graph updates in two
browsers without starting inspection or commands”; `running-host-page-projection.test.ts`:
“renders the complete Run graph without deriving settlement from tracker completion”.

## P2 — The Run publishes a later graph or local execution status

Alice has two pages open at the same host. A workflow-owned tracker read records
and publishes a changed complete graph; alternatively a local execution change
publishes new diagnostics without changing tracker facts. WatchSnapshots sends
the new Run publication, and both pages repaint without a new tracker request.
A stale prior graph must not replace the later watch publication. The page has
no manual tracker-refresh control and no independent graph timer. Losing a
browser connection only ends that browser's resources. Reconnect reads a fresh
descriptor and receives the current Run publication, without replaying commands.

Acceptance: the P1 browser test observes a later graph publication and diagnostic
change; existing `running-host-watch-http.test.ts` owns bounded transport.

## P3 — Alice views a paused Run or a Run without observed graph facts

A paused Run has a last observed complete graph. Alice opens the page while a
GitHub edit remains unobserved by the Run. The page shows the Run's last observed
graph, explicitly explaining that tracker changes appear when the Run reads
GitHub. Browser reads/watch and elapsed time do not unpause, activate or poll the
tracker. A retained graph after a workflow read failure remains last observed
facts; existing tracker-wait diagnostics explain that failure. Publication
journal position is not a graph wall-clock timestamp or proof of current GitHub.

If the host has no Run publication or its graph is GraphNotEstablished, the page
shows that the Run has not observed a graph; it cannot fabricate an empty
complete graph or invoke inspection as a fallback. After a host crash, reconnect
uses the replacement descriptor and replaces all old page facts with the new
host's current publication. If no graph has yet been published, old tasks and
selected-task details disappear. Closed with a final publication displays that
publication; Closed without one has no graph. No mutation retry applies because
the page performs only passive reads.

Acceptance: `running-host-page-projection.test.ts`: “has no graph before Run
observation and retains only the Run final publication”; the P1 browser test
covers replacement-host NotReady and clearing selected task facts. Existing
paused-read/refresh scenarios in running-host-clients remain regression owners;
the page issues no refresh operation.

## P4 — Alice connects through the exact read-only origin

The host uses an ordinary HTTP IPv4 origin. The browser creates a UUIDv4 request
identity with its available cryptographic primitive, then reads/watches Run
snapshots. Exact Host and same-Origin guards still apply; foreign origins and
browser control operations are refused before dispatch. Assets remain a fixed
allowlist. Host Exit drains bounded watches; browser disconnect cannot create
workflow effects. Lost read responses repeat only descriptor/read/watch.

Acceptance: `running-host-page-http.test.ts`: “allows only exact same-origin
observation routes, refuses browser controls and serves only fixed packaged
assets”; the P1 browser test proves actual page transport and foreign-origin
refusal; `browser-request-id.test.ts` retains the crypto capability boundary.

Tests are controlled boundary evidence, not live GitHub timing. Each browser
asserts that the supplied inspection capability was never started. The full
workflow's authority-read and crash-reconciliation tests retain their existing
scope; this presentation introduces no new mutation or durable fact.
