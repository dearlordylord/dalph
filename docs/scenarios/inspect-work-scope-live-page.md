# Alice inspects declared work outside the selected Run

Alice selects an explicit tracker work scope and opens Dalph's native page at
the running host's Docker IPv4 origin. The host displays complete inspection
facts alongside the selected Run's observations without scheduling the inspected
tasks. [Issue #432](https://github.com/dearlordylord/dalph/issues/432) owns this
proposed design. This documentation edit adds no page, route, reader or runtime
behavior; detailed scope and browser decisions need maintainer acceptance.

## Governing behavior

Preserve [native running-host ownership](running-host-clients.md#governing-behavior-and-current-seams),
[explicit IPv4 binding](running-host-docker-ip.md),
[journal-first scheduling evidence](journal-first-tracker-observations.md), and
[D9's complete eligibility facts](../DELIVERY-INVARIANTS.md#graph-and-selection).
The [runActivation model](../../specs/runActivation.qnt) laws
`onlyExactEstablishedRunActivates` and `terminationRequiresExactFreshGraphEvidence`
continue to govern the selected Run. An inspection graph is never a witness
for either law. The page/stream security boundary needs transport tests, not
a claim that the scheduling model proves browser behavior.

[Issue #372](https://github.com/dearlordylord/dalph/issues/372) owns bounded watch
transport and truthful closure and remains open. Page live delivery depends on
it; specification/read-only inspection design can proceed first.
[#427 batching](batch-github-tracker-graph.md) owns request optimization, not
work scope. [#430](https://github.com/dearlordylord/dalph/issues/430) owns common
compact failure/outcome projection; reuse it rather than inventing page state.

## Proposed inspection scope and coverage

- Define `DeclaredWorkScope` as a nonempty bounded list of explicit root issue
  identities in one repository (proposed maximum sixteen roots). Include each
  root, all native grouping descendants, and all transitive prerequisites of
  those tasks. As with Run reads, prerequisite-only tasks do not expand their
  grouping descendants. Duplicate identities/edges across overlapping root
  closures are normalized after consistency checks. Repeated endpoints within
  one provider connection still fail the observation; root overlap never
  weakens pagination validation.
- The maintainer selected this explicit-root scope in the design session. Limits
  and the remaining protocol details are proposed. A repository-wide
  inventory would be a different selector and reader with lifecycle, paging,
  completeness and volume decisions; do not silently substitute one for the
  other. Textual Parent/prerequisite references never become native edges.
- Use an inspection reader separate from `TrackerGraphReader`'s Run workflow
  operation. Reuse typed GitHub fields, pagination validation and request
  batching. Aggregate limits remain 1,000 unique tasks and ten pages per
  connection, not multiplied by root count. Overlapping roots must compare
  identity/lifecycle/parent facts; contradictions fail the whole observation.
- Return the selector/repository, exact coverage rule, observation identity,
  start/end times, normalized tasks/edges and known unsupported relationships.
  Explicitly state that GitHub offers no graph-wide transaction. No partial
  prefix is Complete; cursor or task bounds yield typed Incomplete without
  replacing the last complete graph.
- Overlay selected Run membership, exact attempts, current execution/integration
  and sanitized retained failures by task identity from existing host facts.
  Give each source its own observation identity and freshness. Different
  tracker/Run revisions remain visibly mixed observations, not an atomic view.
- Show scheduling's runnable frontier only for the selected Run and label it
  with its actual observation. Outside-Run tasks have no admitted/runnable
  permission. Optional dependency-ready inspection styling must not say Dalph
  will execute them or infer claim/specification/Git authorization.

## Host observation and refresh policy

The operator configures the inspection scope for the host explicitly, separate
from its selected Run target. The host owns one bounded inspection read per
scope and publishes a process-local latest observation. Inspection refresh
never enters delivery planning, changes claims, allocates worktrees, or appends
workflow scheduling evidence. Read-only inspection is not a durable workflow
effect; provider failures have no mutation to reconcile.

Proposed refresh policy: one shared host refresh on explicit scope establishment
and refresh, then at most one background read every thirty seconds while the
inspection service is enabled. Coalesce concurrent refresh triggers; never
overlap reads or let each browser create a tracker loop. Throttling keeps the
previous complete observation with an explicit unavailable/stale state and
respects the actual read boundary's cooldown. No invented retry timestamp.

The page consumes host snapshots and #372's bounded watch. It does not call
GitHub, poll APIs per task, interpret cassettes as live data, or own a second
frontier. Layout, filters and view position may be browser preferences; no task
facts/resources/frontier become persisted UI authority. Reconnect obtains a
current-first snapshot and a new bounded subscription, not a supposedly durable
browser cursor. Inspection facts are reread after host restart.

## Proposed native page and browser boundary

Serve a read-only page and its owned static assets at `/dalph/` from the exact
configured literal IPv4 HTTP origin. Display scope/coverage and connection
freshness first, then tasks by grouping with dependency edges, issue titles,
tracker lifecycle and selected-Run phase/failure overlays. A task detail panel
explains observations and available native actions without executing them.
No raw provider text, authored secrets, credentials or private transcript routes.

Existing native clients reject browser Origin headers. Amend that rule narrowly:
allow only exact same-origin browser reads/watch for the page, with matching
Host authority, protocol/host/Run identity, explicit declared scope and bounded
payload/subscription limits. Cross-origin, null Origin, foreign Host, scope
substitution, redirects and unsupported authorities remain rejected. Routes
without Origin must satisfy the existing explicit native client rules; browser
navigation/asset requests use their separately bounded passive route handlers.

Add no CORS relaxation or remote authentication scheme. This retains the
explicit trusted-network deployment boundary; same-origin validation is not
authentication. Browser access to mutating controls remains unavailable in this
first slice. Use text rendering for tracker content, locally served assets and
a restrictive content-security policy; no remote scripts or HTML from tasks.
Test same-origin POST watch semantics as well as static navigation rather than
assuming the current CLI transport automatically works in a browser.

## Chronologies and acceptance mapping

All named tests below are additions required at existing seams, not passing
evidence. Each row preserves its starting facts, trigger, boundary calls,
visible result and forbidden consequences.

| Issue scenario | Chronology, crash/retry and forbidden result | Acceptance seam |
| --- | --- | --- |
| 1: Tasks outside Run | Scope S contains A/B while selected Run contains only A. Alice requests S; the bounded tracker inspection reader follows native closure and publishes complete facts. Restart rereads S; read failure publishes unavailable/old coverage, never partial Complete or new membership. | `Alice sees B in declared scope while only A remains in Run scheduling` in inspection-reader and host-projection tests |
| 2: Native Docker page | Host owns exact Docker origin and ready observations. Alice opens its page; static route and bounded same-origin subscription render live host facts. A lost read is safely repeated, creates no task or separate provider poll, and never loads cassette playback. | `Docker IPv4 native page renders the real host's declared scope without activating work` in real-host/browser tests |
| 3: Changes/disconnect | Host refresh observes changed edges/lifecycle and Run overlay. Watch emits coherent source identities and bounded updates. Disconnect/stale/incomplete state retains labeled last-complete facts; reconnect snapshots current state. Missing updates never hide a task as completed. | `scope changes and reconnect expose source freshness without fabricated completion` in controlled watch/projection plus browser tests |
| 4: Unsupported/native edges | A's text mentions Parent B but tracker has no edge, or S exceeds bounds. Reader reports native facts/coverage or typed Incomplete; retry does not promote text or a partial graph to authority. | `inspection reports unsupported edges and bounded incomplete scope honestly` in reader tests |
| 5: Browser authority | Foreign Origin/Host/null Origin or substituted identity/scope requests navigation/read/watch. Guards reject before dispatch; no new subscription/control/provider request follows. Same-origin page traffic follows explicit read-only routes. | `native page allows exact same-origin reads and denies cross-origin controls` in HTTP/security and browser tests |
| 6: Restart/Exit | Host closes admission, bounded watches report #372 closure and inspection readers stop. Unresolved process custody follows existing Exit rules. Restart reconstructs Run through journal/tracker/Git owners and independently rereads S. Page opening makes no mutation or stored UI authority. | `host restart and Exit replace inspection observations without changing Run authority` in host/reconstruction/watch tests |

## Delivery slices and remaining decisions

First accept the explicit selector, aggregate limits, refresh cadence and
same-origin trusted-network/read-only boundary. Then implement the inspection
reader and source-aware common projection independently of a UI. Next extend
#372 watch with typed inspection publication and bounded coverage states; do
not close this slice while that dependency is unimplemented. Finally serve the
native page and qualify one supported real Docker/IPv4 browser composition.

Browser controls, arbitrary repository inventories, remote authentication and
operator guidance are separate work. Model changes are necessary only if an
implementation alters workflow/control authority; this design forbids that.
Update the existing Docker/browser rejection scenarios with the accepted narrow
page amendment and preserve their native client tests as negative controls.
