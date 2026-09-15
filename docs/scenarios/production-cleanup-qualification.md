# Issue #77: qualify production cleanup adapters

Issue: [#77 Qualify production cleanup](https://github.com/dearlordylord/dalph/issues/77)

Status: accepted implementation scenarios for the production qualification
layer. Issue #69 owns the provider-neutral authorization, observation, intent,
mutation, contradiction, and settlement protocols. This ticket supplies the
real Git and provider-authority composition and hermetic qualification; it does
not create a fourth cleanup family or reinterpret a locator as ownership.

The `P0`–`P6` names below are test cut points, not production workflow stages.

## A production Run removes one exact worktree, then one exact branch

No person directly triggers this qualification. The coordinator holds the OS
coordinator lock for the target Git common directory. The Run journal contains
one accepted Restart for task P1, a terminal predecessor attempt P1, and the
exact terminal Git/executor facts from which #69 derives one worktree and
branch authorization: worktree W1, branch B1, owner P1, expected head H, and
the exact evidence revision. The authorization is not a caller-provided
candidate before activation. Git contains W1 registered on B1 at H. A
different task P2 has a separate worktree and branch; the executor and journal
contain no P2 cleanup responsibility.

The production Run activation reads the journal, derives and records that exact
authorization from the terminal facts, and selects it. Before each external call it records the family-specific intent
through the SQLite journal. It asks the real Git adapter for the registered
worktree facts, checks the owner, branch, head, and quiescence proof, and then
asks Git to remove W1 under `CoordinatorOwnership`. It records the response and
reads Git again. Only after the fresh read proves W1 absent does it run the
branch family, which reads B1 and the worktree registration and asks Git to
delete B1 only when B1 is still at H and no worktree owns it. It records both
settlements and leaves P2 untouched.

If the process stops after either intent or after Git applies a mutation but
before SQLite records the response, reopening the same journal reconstructs the
same operation. The next Run reads Git first; an absent W1 or B1 settles without
a duplicate delete, while a changed or unreadable fact preserves the resource.

The maintainer sees one exact worktree and branch removed and the unrelated P2
resources still present. Dalph must not pass the controlled preserving layer
for production, delete a path or branch not named by the authorization, delete
B1 before W1 settles, or infer a successful mutation from a lost response.

Acceptance test: `production Git cleanup removes only the authorized worktree
and branch and leaves an unrelated task intact`; the restart variant is
`production SQLite cleanup reopens after a lost Git response without a duplicate
delete`.

## Changed, foreign, unreadable, and malformed Git facts preserve resources

No person directly triggers this qualification. The production journal contains
the same exact P1 authorization, but outside Dalph Git has changed one fact:
the branch head moved, W1 is registered to another branch or owner, the
authorized path is an existing unregistered directory, a foreign provider owns
the resource, or Git returns unreadable/malformed worktree records. The P2
worktree and branch remain independent.

Activation records the read intent and asks the owning Git/provider adapter for
fresh evidence. For every changed, foreign, unreadable, or malformed result,
the adapter returns a typed observation; the cleanup protocol records a
family-specific contradiction or preservation and sends zero remove/delete
calls. A later activation may reread the same exact subject, but it cannot
reuse the old authorization as permission for a changed owner, path, head, or
provider.

There is no mutation boundary after a read-only contradiction. If the process
stops before the observation is recorded, restart repeats the exact read. If it
stops after a contradiction, restart preserves the terminal contradiction and
does not probe or mutate an unrelated resource.

The maintainer sees the typed preservation result and all changed/foreign files
and refs intact. Dalph must not clean an existing plain directory, force-delete
a changed branch, treat malformed output as absence, or call a provider
mutation without provider ownership and quiescence evidence.

Acceptance test: `production cleanup preserves changed, foreign, unreadable,
and malformed Git facts with zero mutation calls`.

## FullRerun deletes only the predecessor candidate through provider authority

No person directly triggers this qualification. The journal contains a
quarantined predecessor Integrator session S1 with candidate resource C1 and a
FullRerun successor S2 with candidate resource C2. The successor relation,
history, accepted result, and exact predecessor cleanup authorization are
durable. The provider owns both resources and reports C1 as owned by S1 and
writer-quiescent; C2 is owned by live S2. Git object presence, branch tips, and
the locator text are not used as a substitute for those provider facts.

Production activation records the candidate observation intent and calls the
provider-authority adapter. After it returns the exact `(C1, S1,
writer-quiescent)` observation, the coordinator records mutation intent and
asks the same provider authority to remove C1 under `CoordinatorOwnership`.
It records the result and rereads provider authority. Absence settles C1. S2,
C2, S1's history/evidence, and the target Git ref remain untouched.

If the provider applies removal but the response is lost, process reopen reads
provider authority before retrying. A fresh absence settles with no second
destructive call. If provider authority reports a live writer, another owner,
transfer, or unreadable/malformed data, cleanup preserves C1 with zero
mutation calls. The adapter never invents quiescence from a locator lookup.

The maintainer sees predecessor cleanup only. Dalph must not delete C2, erase
S1 history/evidence, infer provider ownership from Git object existence, or
retry a mutation after an ambiguous response without a fresh provider read.

Acceptance test: `production SQLite cleanup reopens after a lost provider
response without a duplicate delete for an exact FullRerun predecessor`; the
negative matrix is included in `production cleanup preserves changed, foreign,
unreadable, and malformed Git facts with zero mutation calls`.

## Current quarantine performs no cleanup

No person directly triggers this qualification. The journal contains a current
quarantined Integrator session with no FullRerun successor and no terminal
cleanup occurrence. Git and the provider may still contain its worktree,
candidate resource, ref, and evidence. No other cleanup authorization is
derived from those facts.

Activation reconstructs the journal-derived responsibility set and finds no
eligible candidate disposal. It performs no Git or provider observation and no
mutation call for the current quarantine. The session and evidence remain
available for a separately accepted operator decision.

If the process stops or the Run is invoked again, the same absence of an exact
terminal disposal witness yields the same no-op. The caller cannot turn a
quarantine label or a locator into an authorization by retrying.

The maintainer sees no cleanup boundary calls. Dalph must not delete the current
candidate, release its session, or fabricate a FullRerun predecessor relation.

Acceptance test: `ordinary production Run activation leaves a current quarantine
untouched`; the focused boundary negative control is `production current
quarantine performs no cleanup boundary call`.

## SQLite/process reopen resumes from fresh observed authority

No person directly triggers this qualification. A production Run has durable
SQLite journal history containing an exact cleanup authorization and a mutation
intent for W1 or C1, but no mutation result because the process exited while
the Git/provider call was in flight. The outside authority may have applied the
request, may still contain the exact resource, or may report a changed owner.

After reopening the same SQLite journal, the coordinator reacquires the OS
coordinator lock, reconstructs the exact operation identity and attempt budget,
and performs the owning Git/provider observation before considering another
mutation. An absent resource records the typed absence confirmation and
settles. A matching present and quiescent resource may receive only the
remaining bounded mutation attempt. A foreign, live, changed, unreadable, or
malformed observation preserves it and stops.

The maintainer sees recovery from durable history with no duplicate destructive
call beyond the #69 bounded contract. Dalph must not infer the lost response,
reset the attempt budget, mutate before the fresh read, or delete a resource
outside the exact authorization.

Acceptance test: `production SQLite cleanup reopens after a lost Git response
without a duplicate delete`, and the provider analogue
`production SQLite cleanup reopens after a lost provider response without a
duplicate delete`.

## Scenario-to-test map

| Scenario | Concrete result | Acceptance test |
| --- | --- | --- |
| One exact worktree and branch | Real Git removes W1 then B1 at H, while P2 remains untouched and B1 waits for W1 settlement | `production Git cleanup removes only the authorized worktree and branch and leaves an unrelated task intact`; restart variant |
| Changed/foreign/unreadable/malformed facts | Typed fresh evidence preserves every resource and sends zero mutation calls | `production cleanup preserves changed, foreign, unreadable, and malformed Git facts with zero mutation calls` |
| FullRerun predecessor candidate | Provider authority removes only C1 after proving S1 ownership and quiescence; C2, successor history, and evidence remain | `production SQLite cleanup reopens after a lost provider response without a duplicate delete for an exact FullRerun predecessor` |
| Current quarantine | No cleanup responsibility or boundary call is manufactured | `ordinary production Run activation leaves a current quarantine untouched`; focused boundary negative control: `production current quarantine performs no cleanup boundary call` |
| SQLite/process reopen | Recovery rereads owning authority before any remaining mutation and does not duplicate a settled delete | `production SQLite cleanup reopens after a lost Git response without a duplicate delete`; provider analogue |

## Model decision

No Quint model changes. Issue #69 records why the existing subject-scoped
models cannot faithfully model three independent cleanup authorities, and #77
qualifies concrete Git/provider adapters behind those already accepted
provider-neutral protocols. Focused hermetic real-Git tests, provider-authority
test doubles, and SQLite/process-reopen tests are the executable evidence.
