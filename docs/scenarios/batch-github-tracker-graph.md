# Batch complete GitHub tracker graph reads

The Dalph coordinator reads GitHub through bounded batches when it needs the
current root's grouping descendants and their transitive prerequisites.
[Issue #427](https://github.com/dearlordylord/dalph/issues/427) owns the accepted
chronological scenarios and read-only scope.

## Governing behavior

A complete graph remains the only graph result returned to the workflow.
This preserves [journal-first tracker observations](journal-first-tracker-observations.md)
and the [active-work authority refresh](active-work-authority-refresh.md): one
logical intent and outcome, one shared graph boundary for executing attempts,
and unchanged focused specification and claim checks. The adapter changes
provider requests only; activation cadence, admission, retries, recovery,
normalized fingerprints, and workflow operations retain their existing owners.

## Provider requests and limits

After resolving the root, the adapter collects the currently discovered issues'
identity/lifecycle fields, prerequisite pages, and applicable grouping pages.
It sends at most thirty aliased field selections in one GraphQL request,
normally covering ten tasks. Each connection selects at most 100 endpoints;
there is no nested connection expansion. This conservatively stays below
GitHub's [500,000-node query limit](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api#node-limit).
Query cost remains GitHub-defined; fewer requests do not promise a particular
quota cost.

Each connection retains its own exact cursor. The existing connection reader
rejects duplicate endpoints, missing or repeated cursors, and more than ten
pages. The closure reader retains the 1,000-task limit and parent checks.
New discoveries enter later batches. Prerequisite-only tasks' grouping
connections are not read unless those tasks are also discovered as descendants
of the root. Completed fields are deduplicated only within this logical read.

GraphQL errors anywhere in a batch, missing aliases, null nodes, malformed
fields, wrong identities/repositories, or contradictory parents fail the whole
read. No accumulated graph is returned. Scratch results belong to that read's
Effect invocation; a failed read or process crash cannot transfer them to a
new read. Recovery repeats the existing journaled logical-read protocol.
GitHub still provides no graph-wide transaction or as-of revision.
All scenarios are read-only; mutation retries are inapplicable.

## Acceptance mapping

Test names below are the implementation seams and handoff mapping for each
accepted issue scenario. Graph-reader tests use the production traversal and
pagination validators with a controlled GraphQL client. HTTP tests inspect the
serialized request independently of that controlled client.

| Issue scenario | Observable outcome and acceptance tests |
| --- | --- |
| 1. Small closure | Six tasks, grouping, shared/transitive prerequisite edges, lifecycle, and fewer than sixteen requests: `reads a six-task closure with shared prerequisites in fewer than sixteen provider requests` in [graph-reader.test.ts](../../packages/orchestrator/src/authorities/task-tracker/github/graph-reader.test.ts). The existing `GitHub tracker reader` contract additionally compares exact normalized tasks. |
| 2. New discovery | Subsequent discoveries complete, each required field/page read once, prerequisite descendants excluded: `deduplicates discovered fields and batches exact independent pagination cursors` and `keeps grouping descendants of prerequisite-only tasks outside the target closure` in the graph-reader tests. |
| 3. Pagination and bounds | Every edge and exact cursor survives batching: `projects paginated grouping and transitive prerequisite closure atomically`, `bounds wide closure batches and follows both relation cursors together`, and `accepts a relation that completes on the exact page limit`. Rejected cursors, duplicate endpoints, page/task overflow: `rejects an incomplete pagination response without exposing a snapshot` and `fails closed for inaccessible, contradictory, and unsupported GitHub observations`. |
| 4. Contradictory or partial result | No graph returned: `rejects missing and partial batch fields without returning a graph`, `fails closed for inaccessible, contradictory, and unsupported GitHub observations`, `rejects a cross-repository native relationship without exposing a graph`, and `rejects GraphQL errors and malformed provider payloads as distinct failures`. |
| 5. Changes between reads | Same reader sees changed lifecycle, added prerequisite, and removed grouping edge: `reads changed lifecycle and edges afresh through the same reader`. Content identity remains stable under equivalent edge order: `derives a stable revision from canonical snapshot content`. |
| 6. Transport, throttling, restart | Adapter abandons failed read state without immediate retries: `abandons partial batch state after transport failure and throttling before a fresh read`. Unchanged journal recovery: `a crash before append authorizes no work; restart after append reconstructs facts and only a later observed completion releases B` in [observation.test.ts](../../packages/orchestrator/src/workflow/task-tracker-facts/observation.test.ts). |
| 7. Concurrent active attempts | One shared graph boundary before per-attempt focused reads: `shares one active graph read across Running attempts before their own focused reads` in [active-work-authority-refresh.acceptance.test.ts](../../packages/orchestrator/src/coordination/run/active-work-authority-refresh.acceptance.test.ts). |

`serializes graph fields and independent page cursors into one bounded read-only
request` in [graphql-client.test.ts](../../packages/orchestrator/src/authorities/task-tracker/github/graphql-client.test.ts)
proves the transport query and exact variables. No live-provider bulk fixture is
required; these controlled cases do not measure account-wide quota consumption.
