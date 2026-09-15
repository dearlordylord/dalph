# Issue #74: qualify real Git worktree ownership and preservation

Issue: [Qualify worktree lease behavior](https://github.com/dearlordylord/dalph/issues/74)

These scenarios qualify the provider-neutral planned-attempt worktree boundary
against disposable local Git repositories. A caller has already recorded one
immutable planned attempt containing the exact Base commit, full branch ref,
and worktree path. Git owns branch refs, commits, and worktree registrations;
Dalph reads and classifies those facts. The `P0`–`P6` labels in the issue are
conformance-test cut points, not runtime stages.

## The coordinator creates or rediscovers one exact worktree

No person directly triggers this qualification. The Git repository contains
the planned Base commit, but the planned branch and exact worktree path have no
registration. The caller retains one planned attempt with Base `B`, branch
`refs/heads/task-A`, and path `/tmp/dalph/task-A`; no other task or executor
uses those locators.

The coordinator starts preparation for that planned attempt. It first asks Git
for the exact path and branch. Git reports that neither is registered. The
coordinator then asks Git to create only that branch at only that path under
its coordinator-ownership boundary, and reads Git again. Git returns a ready
proof with the same Base, branch, path, and current HEAD. A later activation
with the same plan repeats the read and receives the existing proof without a
second create request.

If the process stops after the first read, the next activation repeats the
same exact read and create protocol. If it stops after Git creates the
worktree but before the final read returns, the interruption scenario below
applies: the next activation reads the exact registration before deciding
whether any action is possible. A read or create command failure is returned
as a typed Git failure; it is not evidence that another path or branch may be
used.

The maintainer can see one ready worktree proof tied to the planned Base,
branch, and path. Dalph must not create a second path, replace an existing
branch, infer a path from a branch name, or treat a matching read as permission
to continue after coordinator ownership has been lost.

Acceptance test: `creates and rediscovers the exact isolated worktree`,
`rediscovers an exact dirty worktree without cleaning tracked or untracked
files`, and `does not turn an ownership loss into a ready worktree proof`.

## Git reports another registration or a path that is not registered

No person directly triggers this qualification. The repository contains an
untracked directory at the planned path, a worktree registered for a foreign
branch at another path and then made dirty, and a worktree registered at the exact
planned path for a different branch. The foreign and conflicting worktrees
contain committed changes, modified tracked files, and untracked files. Git
has not granted the planned attempt permission to repair any of them.

The coordinator reads Git for each exact planned attempt. Git reports a typed
untracked-path, foreign-registration, or conflicting-registration result. The
coordinator returns that result without calling `git worktree add`, reset,
clean, prune, move, or delete. The foreign and conflicting branches, paths,
tracked changes, and untracked files remain exactly as Git reported them.

There is no ambiguity-crossing effect in this read. If the coordinator stops
before recording a result, a retry repeats the read; it does not guess which
resource is disposable. If Git returns a competing registration, the same
read-only behavior keeps both observed registrations distinct.

The maintainer can see the concrete contradiction and the preserved work in
the other worktrees. Dalph must not take ownership by deleting, cleaning,
moving, or silently reusing a foreign, dirty, untracked, or contradictory
resource.

Acceptance test: `classifies untracked, foreign, and conflicting resources
without deleting them` and `decodes branch-only, detached, duplicate, and
malformed Git observations`.

## A previously ready worktree disappears

No person directly triggers this qualification. Git previously proved the
planned attempt ready at its exact path and branch. Outside Dalph, a Git user
removes that worktree while its branch remains. The caller still has the same
planned attempt and its other responsibilities.

Before continuing the attempt, the coordinator asks Git for one read-only
observation of the exact path and branch. Git reports that the path is absent
and the branch is no longer registered as a worktree. Dalph records the
attempt-scoped loss observation through the existing observation protocol and
returns it to recovery; it does not call `git worktree add` or any cleanup
operation. The exact planned path and branch remain in the loss result so a
later decision cannot infer new resources.

If the process stops before recording this read, a later activation repeats
the read. If the read command is unreadable, Dalph returns the typed Git read
failure instead of treating absence as permission to create. A later read may
show a different external fact, but the original loss does not authorize a
repair by itself.

The maintainer sees the exact attempt and worktree locators as lost, while the
branch and all unrelated resources remain intact. Dalph must not silently
downgrade the attempt to fresh work, recreate the path, prune unrelated
registrations, or release the attempt's other responsibilities.

Acceptance test: `reports a lost exact worktree without recreating or deleting
any path`.

## The process is interrupted after Git creates the exact path

No person directly triggers this qualification. The repository has the
planned Base, and neither the planned branch nor path is registered. The
coordinator has read that absence and asks Git to create the exact planned
branch at the exact planned path. Git applies that request, then the process
is interrupted while the create call is still waiting to return; no response
is available to the coordinator.

The interrupted activation performs no inferred cleanup. A subsequent
activation reads Git's exact registration and receives a ready proof for the
same Base, branch, and path. It does not delete the path, search for broad
temporary directories, or create another worktree. If the interrupted request
had not applied, the normal exact absence observation would be the only basis
for a later create request.

The maintainer sees one exact worktree, not a leaked broad cleanup or a second
checkout. Dalph must not infer ownership of unrelated paths from the
interruption, delete a path merely because a response was lost, or retry a
mutation before rereading Git.

Acceptance test: `preserves the exact worktree when interrupted after Git
creation`.

## Scenario-to-test map

| Scenario | Concrete result | Acceptance test |
| --- | --- | --- |
| One exact create and rediscovery | The same plan yields one ready proof; a later read does not create again, dirty contents remain untouched, and ownership loss is not converted into proof | `creates and rediscovers the exact isolated worktree`; `rediscovers an exact dirty worktree without cleaning tracked or untracked files`; `does not turn an ownership loss into a ready worktree proof` |
| Foreign, dirty, untracked, and contradictory resources | Typed observations preserve every foreign path, branch, tracked edit, and untracked file | `classifies untracked, foreign, and conflicting resources without deleting them`; `decodes branch-only, detached, duplicate, and malformed Git observations` |
| Previously ready worktree disappears | Read-only observation returns the exact `AttemptWorktreeLost` result without recreation or cleanup | `reports a lost exact worktree without recreating or deleting any path` |
| Interruption after exact creation | The exact created registration remains and is rediscovered; no inferred or broad deletion occurs | `preserves the exact worktree when interrupted after Git creation` |
