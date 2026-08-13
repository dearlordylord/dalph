# Issue #71: qualify real GitHub graph, membership, and claim behavior

Issue: [Qualify GitHub graph, membership, and claim behavior](https://github.com/dearlordylord/dalph/issues/71)

These scenarios qualify the already accepted provider-neutral tracker contracts
from #42, #43, #53, #164, and #167 against GitHub's native Issues GraphQL
behavior. GitHub owns issue node identity, issue state, sub-issue grouping,
blocked-by relationships, live membership, and repository labels used as
claims. Dalph owns only the normalized observation and workflow history; the
fixture never becomes a second task tracker or a source of provider-shaped
workflow events.

The qualification is opt-in because it needs a token, network access, and a
dedicated disposable repository. It is one serialized lane. A failure to create
or remove a fixture is a typed lane failure and retains the exact repository
and issue locators needed for repair; it is never converted into a passing
skip or a destructive best effort.

The live test is enabled only with
`DALPH_GITHUB_QUALIFICATION=1`,
`DALPH_GITHUB_QUALIFICATION_REPOSITORY=owner/repository`, and a
`GITHUB_TOKEN` supplied by the test environment. The optional
`DALPH_GITHUB_QUALIFICATION_BLOCKERS` value must be exactly 2 or omitted. The
native fixture proves GitHub's identity, grouping, dependency, lifecycle,
membership, and claim behavior with the smallest useful dependency closure.
Controlled provider tests prove generic multi-page traversal, repeated-cursor,
and incomplete-page behavior without creating dozens of remote issues. A maintainer
runs the focused test file with those variables; the token is never included in
the test output or retained fixture locators.

## GitHub returns one complete native closure assembled from pages

### Starting situation

No person directly triggers this qualification. A maintainer has configured a
dedicated disposable GitHub repository and a token with issue write access.
The repository has no fixture issues or Dalph claim labels. GitHub is the only
outside authority involved; no Git worktree, executor session, or workflow
journal responsibility exists for the fixture.

### Trigger and chronological behavior

1. The qualification lane obtains its process-local serialization guard and
   creates one uniquely named root issue plus native sub-issues and
   same-repository blocked-by issues. It records each created repository and
   issue locator before creating the next relationship. The selected child has
   two dependency endpoints, which proves native relationship decoding without
   a mutation-heavy fixture; grouping
   uses GitHub's native parent/sub-issue relation, not title text or labels.
2. The lane asks the real `TrackerGraphReader` to read the root target. The
   adapter resolves the owner/name/issue-number target to GitHub's opaque
   repository and issue node IDs and rereads each discovered issue. The same
   production reader's controlled tests follow every `subIssues` and
   `blockedBy` cursor and reject any page that is
   incomplete, repeats a cursor, returns a different node, or crosses the root
   repository.
3. The complete native result is projected through the provider-neutral read
   protocol. The five fact families name the same normalized task subjects and
   target coverage, `completeness: Complete`,
   `consistency: PotentiallyMixedTime`, the logical read operation as
   freshness, and one normalized content identity. Cursors, issue numbers,
   repository names, and GraphQL response shapes do not enter the result.
4. The lane checks that grouping descendants of the selected root are in the
   target closure, transitive prerequisites are present, and grouping
   descendants of a prerequisite-only issue are absent. Stable opaque task IDs
   decode only inside the GitHub adapter and remain unrelated to presentation
   numbers.

If a page response or issue read is malformed, inaccessible, contradictory, or
truncated, the adapter returns a typed failure before returning any snapshot;
the read protocol cannot create an unchanged reconfirmation or schedulable
graph from it. A concurrent GitHub edit between requests may remain
undetectable; the successful result says potentially mixed-time rather than
claiming a transaction-wide revision. The configured GitHub target remains the
operation's target locator, but issue numbers, cursors, and GraphQL response
shapes do not become task identity, lifecycle, grouping, prerequisite, or
membership fields.

There is no state-changing Dalph effect after graph setup, so a read retry
uses a new logical read identity and does not create a second fixture relation.
A process crash during setup has no safe automatic retry: the process-local
resource ledger is lost with the process, so the lane does not claim cleanup
success or guess which issue was created. While the process remains alive, each
successful create is recorded before the next relationship and normal failure
cleanup uses those exact locators.

The maintainer sees one complete normalized observation or a precise typed
qualification failure. Dalph must not publish partial pages, infer missing
blockers, leak GitHub cursors or issue numbers into normalized task facts,
derive grouping from dependency edges, or accept a cross-repository
prerequisite.

### Acceptance test

`qualifies a complete native GitHub closure, reconfirms unchanged and changed
facts, and reconciles competing claims` runs the real reader, provider-neutral
normalizer, and claim adapter against the disposable fixture.
`projects paginated grouping and transitive prerequisite closure atomically`
proves multi-page traversal through the same production reader with a controlled
provider and no remote content creation.

## A comparable read reconfirms unchanged facts and a changed read replaces them

### Starting situation

The fixture from the preceding scenario remains live, with its exact root
target and issue locators retained. One complete normalized graph observation
has been produced, but no task claim, worktree, executor, or completion
mutation exists.

### Trigger and chronological behavior

1. The coordinator performs a second complete root read through the same real
   adapter after the first result. The normalized graph content is unchanged.
2. The read protocol records a compact unchanged `TaskTrackerFactsObserved`
   reconfirmation that refers to the earlier full observation. It carries fresh
   per-family coverage and freshness and retains potentially mixed-time truth;
   it does not invent a GitHub graph-wide revision or copy provider pages.
3. The fixture mutator then closes one issue as completed or removes one native
   sub-issue from the selected root. The coordinator performs a later complete
   read. The changed normalized content is recorded as complete facts for its
   covered target, not as a false reconfirmation. A removed responsible task
   is absent from target membership and is handled by the provider-neutral
   task-local membership constraint.

If Dalph crashes before the reconfirmation append, restart may repeat the read;
if it crashes after the append, restart reuses the earlier full payload. A
failed or incomplete changed read leaves the previously recorded facts intact
but authorizes no new graph decision. The maintainer sees unchanged facts
reconfirmed compactly and later membership/lifecycle change as fresh normalized
facts. Dalph must not accept a reconfirmation without an earlier matching full
observation, treat journal order as GitHub freshness, or turn a missing page
into proof that a task left membership.

### Acceptance test

`qualifies a complete paginated native GitHub closure, reconfirms unchanged
and changed facts, and reconciles competing claims` exercises the same public
reader and observation normalizer twice before and after native lifecycle and
membership edits.

## Competing GitHub claim creations produce one exact owner

### Starting situation

The fixture contains one open issue in the selected repository and no label
whose deterministic name represents its Dalph claim. Two coordinator attempts
have different operation IDs, owners, and tokens. No worktree or executor has
started.

### Trigger and chronological behavior

1. The qualification starts both `TrackerMutation.acquireTaskClaim` calls
   through the shared claim-acquisition protocol. Each call reads the exact
   repository label first, records its intent at the workflow boundary, and
   asks GitHub to create the same deterministic label name with its own
   description.
2. GitHub's repository label uniqueness lets exactly one create win. The
   losing call rereads the label and receives a typed exact-owner conflict; it
   does not delete or overwrite the winner. A repeated acquisition for the
   winner's exact operation, owner, task, and token returns the same current
   claim.
3. The winner releases by rereading ownership and deleting the exact label
   node ID. A delayed release naming the old label node cannot delete a later
   replacement claim with another node ID.

To qualify ambiguity, one transport wrapper applies one native create and loses
the response before returning it. The shared protocol rereads GitHub before
another create; it discovers the exact claim and sends no duplicate mutation.
If the reread is unreadable, it returns typed non-convergence while preserving
the acquisition intent and claim fixture locator.

A crash before the create response loses only process memory; recovery reads
the exact GitHub label before retrying. A crash after create leaves one native
label. The maintainer sees one owner, a foreign conflict, or a typed
non-convergence. Dalph must not create two labels, reuse a stale token, release
a later owner's node, infer ownership from a mutation acknowledgement, or
print the token.

### Acceptance test

`qualifies a complete paginated native GitHub closure, reconfirms unchanged
and changed facts, and reconciles competing claims` runs the real mutation
adapter concurrently and uses a response-losing transport wrapper for the
reconciliation case.

## Exact fixture cleanup is fail-closed

### Starting situation

The qualification lane has a list of exact repository and issue locators for
every resource it created. Some setup or assertion may have failed, and a
cleanup attempt may itself fail because GitHub is unavailable or a resource
was changed by another actor.

### Trigger and chronological behavior

1. The lane closes and deletes only fixture issues and labels whose exact
   locators are in that list, in a deterministic order. It rereads each
   resource where the disposal contract requires and records a typed outcome.
2. If any cleanup call fails or returns an uncertain result, the lane retains
   the exact repository locator and every unresolved issue/label locator in its
   typed failure and diagnostic artifact. It does not broaden deletion to a
   repository, title prefix, issue range, or label prefix.

There is no retry that can safely guess a locator after a lost response. A
later operator can rerun disposal with the retained locators. The maintainer
sees a passing cleanup or a repairable typed failure with exact locators. Dalph
must not hide cleanup failure, delete the configured repository, expose a
secret token, or report a clean fixture while resources remain.

### Acceptance test

`retains exact GitHub fixture locators when cleanup cannot finish` exercises the
fixture disposition value and a controlled cleanup failure without contacting
the live provider.

## Same-repository V1 closure remains explicit

The reader accepts only the root repository's issue node IDs. If a discovered
issue reports a different repository, the logical read returns a typed
incomplete/contradictory failure and no snapshot. The qualification keeps this
policy from #42; changing it would require a separate evidence-backed policy
issue and is not part of #71.

## Scenario-to-test mapping

| Scenario | Concrete result | Acceptance test |
| --- | --- | --- |
| Complete native closure and generic pagination | Native identity, grouping, prerequisites, closure, and provider-shaped boundary facts become one opaque normalized observation; controlled pages prove atomic traversal or no snapshot | `qualifies a complete native GitHub closure, reconfirms unchanged and changed facts, and reconciles competing claims`; `projects paginated grouping and transitive prerequisite closure atomically` |
| Comparable unchanged and changed reads | Equal content becomes a compact reconfirmation; lifecycle/membership edits become fresh complete facts; failures never authorize a graph | `qualifies a complete native GitHub closure, reconfirms unchanged and changed facts, and reconciles competing claims` |
| Competing claims and ambiguous create | GitHub establishes one label owner; ambiguity is reread before retry and exact node cleanup protects replacements | `qualifies a complete native GitHub closure, reconfirms unchanged and changed facts, and reconciles competing claims` |
| Exact cleanup disposition | Failed cleanup retains exact repository/issue/label locators and never broadens deletion | `retains exact GitHub fixture locators when cleanup cannot finish` |
| Same-repository policy | A cross-repository discovered issue fails the read before snapshot exposure | `rejects a cross-repository native relationship without exposing a graph` |
