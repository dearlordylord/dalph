# Reducer Lab: act from immutable history

This scenario changes only the throwaway Reducer Lab's in-memory exploration
history. It does not change Dalph runtime behavior, GitHub, Git, an executor, or
the workflow journal.

## Reread a task after moving back

### Starting situation

A developer has used the Reducer Lab to observe the Lab's fake in-memory task
tracker and then to reread task A before claiming it. The active exploration
branch therefore contains two replayable inputs:

1. observe the Lab's fake in-memory task tracker;
2. reread task A before claim.

The Lab displays the snapshot reconstructed from both inputs. No GitHub, Git, or
executor boundary applies because the prototype uses fake in-memory
authorities. The displayed workflow journal contains only the events produced
by replaying those Lab inputs.

### Trigger and ordered behavior

The developer chooses Back/Undo once. The Lab reconstructs the snapshot from
only the first input. The developer then chooses either “Reread A before claim”
or “Reread C before claim.”

Before executing that reread, FoldKit creates a new branch containing the exact
input prefix at the displayed cursor. It leaves the original branch and its
second input unchanged. The driver revalidates the selected reread against the
exact displayed snapshot, executes it, and appends the resulting input only to
the new branch.

### Visible and forbidden results

The reread controls remain enabled after Back/Undo. The branch selector shows a
new active branch after the developer chooses one. Selecting the original
branch and moving forward still reconstructs its original reread of A.

The Lab must not truncate, overwrite, or append to the original branch's future.
It must not require a separate manual Fork click before a semantic action. It
must not reuse a later snapshot, accept a stale move, duplicate a workflow
journal event, or mutate a previously reconstructed snapshot.

### Crash and retry

Process crash and external retry do not apply: all exploration state is
in-memory and intentionally disappears with the browser tab. A delayed command
result is accepted only when its request identity is still current; otherwise
FoldKit ignores it. Retrying the user interaction from the same historical
cursor creates one new immutable branch per accepted interaction.

## Change a fake tracker fact after moving back

After Back/Undo has reconstructed the displayed input prefix, the developer may
edit a task card, save or delete it, or change a fake task claim. Creating or
editing a draft changes only FoldKit's view-local model. Saving, deleting, or
changing a claim first creates a new branch from the displayed input prefix;
the driver then executes that explicit Lab command against the snapshot for
that exact prefix and appends its replayable input only to the new branch.

The task-editor and claim controls are enabled after reconstruction. They are
unavailable only while no snapshot exists, including the brief interval while
Back/Undo is reconstructing the selected prefix. They must not change the
original branch, reuse the snapshot from its future, or silently observe the
changed fake tracker fact.

### Acceptance-test mapping

- `Choosing a reread after Undo forks the immutable input prefix and preserves the original future`
  in `prototypes/reducer-lab/src/lab-engine.smoke.ts`.
- That test drives Back/Undo, asserts that actions cannot execute while its
  snapshot is reconstructing, then asserts that both semantic rereads are
  enabled, the old branch retains both original inputs, the new branch begins
  with only the displayed prefix, and the completed reread appends only to the
  new branch. It selects and redoes the original branch to confirm that reread
  A still reconstructs.
- `Task editing and claim changes after Undo use the same immutable prefix-fork seam`
  in `prototypes/reducer-lab/src/lab-engine.smoke.ts` asserts that task and
  claim controls are enabled and that each explicit Lab command selects a new
  prefix branch before execution.
