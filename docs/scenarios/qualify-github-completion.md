# Issue #72: qualify GitHub evidence and completion behavior

Issue: [Qualify GitHub evidence and completion behavior](https://github.com/dearlordylord/dalph/issues/72)

These scenarios qualify the existing provider-neutral completion, evidence,
claim, and graph boundaries against a disposable real GitHub repository. The
fixture uses GitHub's native issue, dependency, comment, label, and lifecycle
operations. It does not add a provider-specific completion protocol or make
GitHub-derived state a Dalph journal fact.

The qualification is explicitly opt-in and serialized by its operator. It
uses a repository selected by the operator and creates uniquely named issues.
Every created issue, claim label, evidence-store directory, and evidence
reference is an exact locator. A successful run removes only those exact
resources. A failed run, an unreadable response, or a process crash retains
the resources and reports their locators for diagnosis; it never guesses at
cleanup targets.

## The maintainer creates a disposable evidence-backed GitHub fixture

### Starting situation

The maintainer has a GitHub token with permission to create and delete issues,
comments, labels, and issue relationships in one disposable repository. The
repository exists, but the fixture issues and the matching `dalph-claim-*`
label do not. The local evidence store has no fixture directory. A temporary
Git repository contains the exact commit and ancestry locators used by the
provider-neutral evidence contract; equivalent file content is not an
ancestry fact. No executor or workflow journal entry is needed for this
provider qualification.

### Trigger and chronological behavior

1. The maintainer starts the opt-in qualification with the repository locator.
   The lane refuses to start without the explicit opt-in and required
   repository configuration.
2. The qualification reads the repository node ID, creates a uniquely named
   parent issue and dependent issue, and records both returned node IDs and
   issue numbers. It adds the dependent issue as a sub-issue and as blocked by
   the parent using native GitHub mutations, then rereads the graph.
3. It writes immutable evidence to the real content-addressed evidence store,
   attaches a comment containing the exact evidence digest and Git locators,
   and acquires the existing exact task claim through the GitHub tracker
   mutation seam. The claim label name and node ID are recorded.
4. The maintainer can see the exact repository, issue, claim-label, evidence,
   and Git locators. Before completion the dependent issue remains blocked.

If the process stops after any mutation, the already returned locators are
retained. A later run does not delete an unrecognised issue or label merely
because its title is similar. Cleanup is attempted only after all assertions
pass, and only for the exact resources recorded by this run.

### Forbidden result

GitHub-equivalent issue content must not stand in for the returned node IDs,
the evidence digest, or the exact Git ancestry. The qualification must not
silently use a maintainer's existing issue, claim label, comment, or evidence
directory as its fixture.

### Acceptance test

`qualifies GitHub evidence-backed completion, ambiguity, conflicts, and graph refresh`
creates this fixture through the native GitHub boundary and asserts the
locators, evidence attachment, initial blocked graph, and success-only exact
cleanup.

## A completion mutation is applied but its response is lost

### Starting situation

The parent issue is open and has the exact active claim, attached evidence
digest, and exact promotion/ancestry locators from the first scenario. A fresh
graph read still says that the dependent issue is blocked. No completion
request with this operation ID has been observed by the qualification.

### Trigger and chronological behavior

1. The qualification rereads the parent issue and exact claim before the
   ambiguity-crossing call. It verifies the issue is open and the evidence
   marker is the expected digest.
2. It sends one native GitHub lifecycle mutation carrying a unique operation
   ID, then deliberately discards the successful response to model a lost
   client response. The qualification does not send a second mutation.
3. It performs a fresh issue read. If GitHub now proves the issue is closed for
   successful completion, the qualification accepts that exact observed state
   and rereads the claim and evidence. If the issue is still open, the result
   remains ambiguous: without an authoritative exact request lookup the lane
   waits and preserves the fixture rather than claiming `NotApplied` or
   retrying.
4. After the proven successful close, a later fresh graph read shows the
   dependent issue eligible. The graph read is the release observation; no
   eligible frontier is persisted by the qualification.

A crash after the lifecycle request has the same recovery rule: reread the
   issue and exact claim before considering another action. An unreadable read
   preserves the claim, evidence, and all fixture locators.

### Forbidden result

The lane must not close the issue twice, treat an open issue as proof that the
first request was not applied, replace the exact claim with an equivalent
label, or release the dependent issue from a stale pre-completion graph.

### Acceptance test

`qualifies GitHub evidence-backed completion, ambiguity, conflicts, and graph refresh`
asserts one native lifecycle call, a fresh successful-completion observation,
preserved exact claim/evidence, and the later graph refresh. Its negative
ambiguous-read path retains the fixture and emits exact locators.

## A human changes the issue while the completion request is not safe

### Starting situation

The fixture parent issue has just been proven closed for successful completion,
with its exact active claim, evidence marker, and released dependency graph.
A human maintainer reopens that issue before cleanup or any next completion
decision. The claim and evidence still belong to the qualification.

### Trigger and chronological behavior

1. The qualification rereads the issue, lifecycle state, claim, and evidence
   marker after the human reopen.
2. It classifies the reopened lifecycle as a human conflict and makes no
   second completion mutation. It rereads the exact claim and evidence to
   prove they were preserved, and rereads the graph to prove dependants are
   blocked again unless GitHub itself reports a successful completion.
3. The run retains the exact issue, label, comment, and evidence locators for
   diagnosis. Successful cleanup later removes only those exact resources.

If the process crashes during the reread, retry starts with the same exact
issue and claim locators; it does not infer a conflict from a missing label or
delete a resource it cannot identify.

### Forbidden result

The qualification must not overwrite the human state, retry a completion
mutation against a changed revision, delete the claim as a side effect of the
conflict, or make a dependant eligible from a non-successful terminal state.

### Acceptance test

`qualifies GitHub evidence-backed completion, ambiguity, conflicts, and graph refresh`
asserts the native human conflict, zero completion calls after the conflict,
preserved claim/evidence, and the blocked dependant.

## Exact ancestry remains a Git fact

### Starting situation

The fixture's evidence records a candidate commit and its ordered parent
commits. A separate temporary Git repository contains two commits with equal
file content but different ancestry. Git and the provider-neutral Git
qualification seam are the only authorities for this check.

### Trigger and chronological behavior

1. The qualification asks the existing public Git lineage/candidate seam for
   the submitted commit and expected parent.
2. Git returns the exact commit and parent relationship. An equal-content
   commit with a different parent is reported as non-ancestral and cannot
   satisfy the evidence-backed completion precondition.
3. The qualification preserves both exact Git locators and the GitHub fixture
   locators; it does not rewrite a ref or replace the candidate with the
   equivalent-content commit.

There is no GitHub mutation in this scenario. A Git read failure is retained
as a typed observation and never converted into ancestry success.

### Forbidden result

Equal trees, issue bodies, or evidence bytes must not substitute for the
exact commit ancestry required by the provider-neutral contract.

### Acceptance test

The provider qualification reuses the existing real-Git exact-ancestry
acceptance test, `reads real compatible, equivalent-content, rewritten, and
unrelated target lineage without mutation`, while the GitHub qualification
asserts that its attached evidence records the exact Git locators.

## Scenario-to-test mapping

| Scenario | Concrete result | Acceptance test |
| --- | --- | --- |
| Disposable evidence-backed fixture | Native issue/dependency/comment/claim operations return exact locators; initial dependant remains blocked; cleanup is exact and success-only | `qualifies GitHub evidence-backed completion, ambiguity, conflicts, and graph refresh` |
| Applied completion with lost response | One native completion call is followed by a fresh issue read; proven success is accepted, otherwise ambiguity preserves the fixture and no retry is sent | `qualifies GitHub evidence-backed completion, ambiguity, conflicts, and graph refresh` |
| Human lifecycle conflict | Fresh changed state causes zero completion mutations; claim, evidence, and blocked graph remain | `qualifies GitHub evidence-backed completion, ambiguity, conflicts, and graph refresh` |
| Exact ancestry | Equal content with different ancestry is rejected by the existing Git seam; exact Git locators remain attached | `reads real compatible, equivalent-content, rewritten, and unrelated target lineage without mutation` plus the GitHub qualification above |
