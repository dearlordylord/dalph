# GitHub graph polling without webhooks

Dalph can show already observed tracker facts immediately at its local presentation boundary and check GitHub separately. External changes still require polling. The proposed experiment tests whether focused fact replacement plus bounded relationship reconciliation reduces requests without treating stale, partial, or incomparable knowledge as current authorization.

Research date: 2026-10-07. Source inspected read-only: `/workspace/dalph-dogfood/host-recovery-ci-source`, commit `ab7f6b6e2a5090959ea52bf379e8c2f9fc7d336b`. This note changes no runtime behavior and does not authorize production implementation. Runtime scenarios and acceptance tests must be accepted first.

## Existing seams and missing implementation

Paths below are relative to the inspected commit; links pin that exact source.

- [Tracker architecture](https://github.com/dearlordylord/dalph/blob/ab7f6b6e2a5090959ea52bf379e8c2f9fc7d336b/docs/architecture/tracker-graph-and-claims.md) permits normalized observations and sufficiently complete mutation results. It requires exact subject/family coverage, complete absence evidence, explicit incomparable conflicts, and focused checks before effects. The journal records observed workflow history; GitHub remains task authority.
- [GitHub graph reader](https://github.com/dearlordylord/dalph/blob/ab7f6b6e2a5090959ea52bf379e8c2f9fc7d336b/packages/orchestrator/src/authorities/task-tracker/github/graph-reader.ts) rebuilds one all-or-nothing rooted closure. Its issue/relation maps live inside each `read` invocation, not between polls. It expands grouping descendants of the selected root and transitive prerequisites; grouping descendants of supporting prerequisites are excluded unless separately reached.
- [Batch query](https://github.com/dearlordylord/dalph/blob/ab7f6b6e2a5090959ea52bf379e8c2f9fc7d336b/packages/orchestrator/src/authorities/task-tracker/github/graph-batch-query.ts) requests title, number, lifecycle, repository and parent plus relationship connections. It does not request `updatedAt`. [Read limits](https://github.com/dearlordylord/dalph/blob/ab7f6b6e2a5090959ea52bf379e8c2f9fc7d336b/packages/orchestrator/src/authorities/task-tracker/github/read-limits.ts) bound graphs to 1,000 tasks, each connection to ten pages and batches to 30 selections.
- [Observation schemas](https://github.com/dearlordylord/dalph/blob/ab7f6b6e2a5090959ea52bf379e8c2f9fc7d336b/packages/orchestrator/src/workflow/task-tracker-facts/observation.ts) give complete graph fact families `CompleteTargetClosure` coverage, `PotentiallyMixedTime` consistency and logical-read freshness. Focused specification, claim and completion observations exist, but do not constitute a general incremental graph contract.
- [Graph knowledge reconstruction](https://github.com/dearlordylord/dalph/blob/ab7f6b6e2a5090959ea52bf379e8c2f9fc7d336b/packages/orchestrator/src/coordination/reconstruction/graph-knowledge.ts) admits only `CompleteTaskTrackerFacts` and `UnchangedTaskTrackerFactsReconfirmed` as graph observations. [Graph projection](https://github.com/dearlordylord/dalph/blob/ab7f6b6e2a5090959ea52bf379e8c2f9fc7d336b/packages/orchestrator/src/workflow/task-tracker-facts/graph-projection.ts) projects a complete observation. **Focused observations do not currently merge into the graph.** The architecture's intended family replacement and conflict model must not be presented as already implemented here.

A presentation can consume local reconstructed observations without any new GitHub request. A local execution-state update can likewise render immediately using its own authority. A completion acknowledgement alone cannot render a newly authoritative completed tracker lifecycle or release dependants. New focused graph projection requires new accepted contracts and reducer work; simply wiring the existing focused event into the UI is insufficient.

## GitHub evidence and limits

GitHub documents conditional GETs for endpoints returning validators. An authenticated 304 does not consume primary rate quota. This is not a guarantee that every endpoint supports validators. The individual [sub-issue](https://docs.github.com/en/rest/issues/sub-issues) and [dependency](https://docs.github.com/en/rest/issues/issue-dependencies) endpoint pages do not enumerate 304 responses. Their list APIs are paginated. Sub-issues can be removed or moved with `replace_parent`; dependency edges can be removed. Thus additions-only discovery is insufficient. [Conditional-request guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests).

A minimal read-only probe by the coordinating agent observed both endpoints returning ETags and then 304 on 2026-10-07 at approximately 16:03 UTC:

| Endpoint | Initial response | Conditional response | Primary used counter |
| --- | --- | --- | --- |
| `repos/dearlordylord/dalph/issues/421/sub_issues` | 200, weak ETag | 304 | stayed 3 |
| `repos/dearlordylord/dalph/issues/484/dependencies/blocked_by` | 200, weak ETag | 304 | stayed 4 |

Retained raw header evidence: `/tmp/dalph-graph-conditional-probes.json`. Selected API version was `2022-11-28`. `gh api` exited 1 for each 304; an adapter must distinguish valid conditional responses from failures. This establishes unchanged single-page behavior only. No mutation was performed. Edge addition/removal/move invalidation, changed issue fields, changed permissions, multi-page cache behavior, and other API versions remain unverified. Do not promise 304 for them.

`GET /repos/{owner}/{repo}/issues` supports `state=all`, `sort=updated`, `direction`, and `since`; `since` selects records last updated after its timestamp. It also returns pull requests. It is a useful discovery hint, not a documented graph-edge change log. The documentation does not promise every relationship change updates both endpoint issues or supplies a deletion tombstone. Use overlap and stable identity deduplication, and advance a watermark only after complete pagination. An empty result cannot establish unchanged dependencies. [Repository issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues).

GraphQL documents `Issue.updatedAt`, relationship connections, and timeline event types for adding/removing blockers, sub-issues and parents. Timeline events can help identify subjects to recheck, but the reviewed docs do not provide a complete global CDC contract, graph revision, or transaction snapshot. Nullable related objects and pagination still require handling. REST's issue-event catalog does not list the same relationship event names; REST and GraphQL event coverage must not be conflated. [GraphQL issues](https://docs.github.com/en/graphql/reference/issues), [REST issue-event types](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types), [REST timeline](https://docs.github.com/en/rest/issues/timeline).

The separate repository activity Events API is explicitly unsuitable for real-time use: up to 300 events within 30 days and documented latency of 30 seconds to six hours. Those limits belong to activity events, not the issue timeline endpoint. [Activity events](https://docs.github.com/en/rest/activity/events).

Relationship list bodies embed issue fields, so unrelated edits to a returned issue may change the representation validator even when the edge set is unchanged; this is a cost hypothesis to measure, not an observed invalidation guarantee.

304 still takes a network round trip and is not documented as exempt from secondary limits. GitHub documents shared REST/GraphQL concurrency limits and separate request/CPU/point limits; most REST GETs cost one secondary point, with some undisclosed endpoint costs. Conditional REST polling can reduce primary quota and bytes while increasing HTTP requests relative to existing GraphQL batching. Measure requests, latency, bytes and both quota indicators separately. [REST limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

## Proposed bounded mechanism

1. Bootstrap with one complete current rooted graph. Keep observation coverage and provenance; cache only disposable provider read material and validators. Rebuild derived membership and UI state rather than persisting another authority.
2. Render newly journaled normalized facts locally immediately. Record freshness/unknown/conflict per covered subject and family. A mutation acknowledgement is a pending workflow fact, never inferred tracker completion.
3. Schedule independent background reads with a bounded queue, coalesced subjects, jitter and a fixed request budget. Refresh lifecycle and work-relevant subjects quickly; sweep every tracked task's blocker relation and every root-grouping subject's child relation within a declared reconciliation period. `since` or timeline hints may prioritize reads but never replace the sweep.
4. Replace one relationship only after every page of that relationship succeeds. Complete empty removes its old edges. Partial read, denied access, missing page or 404 preserves uncertainty; 404 alone cannot distinguish missing from inaccessible. A 304 reuses only the cached representation of the exact URL, parameters, media type, API version and credential scope. Without its body and coverage evidence, fetch again.
5. Start the throwaway experiment with conditional reuse limited to proven single-page relations. For multi-page relations, reread all pages unconditionally or use the existing complete reader. First-page 304 does not prove all later pages unchanged. Sequential page reads remain potentially mixed-time; detect contradictions without claiming snapshot isolation.
6. On edge changes, recompute directional reachability from the immutable root. Expand newly reachable nodes and prerequisites before claiming a complete new closure. Remove unreachable membership only from sufficient relationship coverage. A removed grouping child may remain reachable as a prerequisite; moving a child requires reconciliation of old/new parents. Incomparable overlapping observations produce a conflict, not journal-order last-writer-wins.
7. Before planning, claiming-dependent work or completing a task, retain the protocol's focused provider checks. UI freshness and cached sweep completion cannot authorize effects. On restart, cache loss causes reads; retained observations remain historical evidence. On throttling, respect retry information and stop the current bounded poll; do not retry mutations.

Cost model: if N tasks each need one issue and one blocker request, and G grouping subjects need one child request, a naive conditional sweep costs approximately `2N + G` HTTP requests before additional pages. A 300-task all-grouping graph therefore costs about 900 requests per sweep even if unchanged. Existing GraphQL batches fit at most 30 selections per request, subject to traversal and pages. This arithmetic is a planning estimate, not a measured provider comparison. Prefer proving cheaper local presentation first.

## Throwaway logic prototype contract

Question: can local facts update presentation immediately while a bounded no-webhook poller eventually converges to the complete rooted graph and never authorizes an effect from incomplete knowledge?

Build outside production composition. Use a deterministic fake tracker, controllable clock, recorded requests, and a full-closure oracle after quiescence. Model complete family replacement, partial/failure/conflict states, cache identity and scheduling; no browser or GitHub mutations are needed.

| Chronological case | Required observation / falsifier |
| --- | --- |
| Complete baseline, then normalized local lifecycle fact | Presentation updates with zero network calls; any premature dependant release falsifies authorization separation. |
| Complete blocker set, then complete empty set | Old blockers disappear; task-only or partial-empty results must not erase them. |
| Child moves or grouping edge disappears | Membership converges after bounded reconciliation; a child still reachable as prerequisite remains. |
| New blocker has transitive prerequisites | Closure expands fully; no partially discovered graph is called complete. |
| Edge changes while issue timestamps remain unchanged | Relationship sweep discovers it; relying solely on `since` fails deliberately. |
| Page two changes while page one gives 304 | No whole-relation reconfirmation from page one; controlled fallback produces correct closure. |
| Concurrent contradictory observations | Exact family becomes conflicted until resolving read; arrival order cannot silently choose truth. |
| 404, 429, page failure, crash after intent, cache loss | No false absence, bounded requests, retained intent reconciled, and safe bootstrap after cache loss. |

Cheap-first order: (1) prove zero-network local projection and family replacement with controlled facts; (2) compare unchanged and sparse-change workloads against a simulated full-reader baseline at 10/100/1,000 tasks; (3) only if request accounting predicts a benefit, run a separately authorized small live fixture to test validator invalidation and timestamp/timeline behavior for actual add/remove/move operations. Existing read-only probes support experiment (2)'s unchanged single-page case only.

Record every scenario's result, HTTP request count, bytes, primary quota change, delay to convergence and forbidden effect count. Stop immediately on false absence or an effect authorized from incomplete/conflicted evidence. Reject the design if it cannot meet its declared reconciliation interval within its request budget, or if request/latency savings vanish against batched GraphQL. Choose concrete polling intervals and budgets from measured workloads, not from an assumed free-304 model. Before an experiment exceeding one minute, record its expected duration and absolute UTC stop time; stop with retained evidence and the next discriminating question at that deadline.
