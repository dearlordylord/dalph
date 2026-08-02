# Common crash experiment protocol for agent control planes

**Status:** Retained protocol draft. The current competitive comparison infers
failure behavior from pinned source code and marks it source-inferred; no
further crash experiment is planned, and no crash experiment has run.

## Purpose

Source code can show intended recovery paths, but it cannot prove which state
actually survives a stopped process. This protocol gives every open-source
competitor the same task, Git state, agent-session evidence, interruption
points, and external drift.

The experiment records what the product does. It does not require competitors
to behave like Dalph.

This is research tooling only. It changes no Dalph runtime behavior.

## Safety boundary

Every experiment must:

- create one explicit temporary root with `mktemp -d`;
- create a local tracker fixture or product-owned test database under that
  root;
- create a local bare Git remote and disposable clones/worktrees under that
  root;
- use a fake agent executable with no model or network credentials;
- clear inherited GitHub, GitLab, Linear, Jira, model-provider, cloud, and
  package-publishing credentials;
- bind servers to loopback or a private experiment network;
- cap processes, memory, CPU, disk, and elapsed time;
- record every spawned PID/container and terminate it during teardown;
- verify the exact temporary path before deleting it;
- never run cleanup against `$HOME`, `~`, the workspace root, `/`, a real Git
  common directory, or a user repository;
- retain the evidence bundle when cleanup cannot prove ownership.

Products that cannot run without a real external service receive source-only
results for the blocked scenarios. The research does not connect them to a
user account merely to fill a matrix cell.

## Single-coordinator model

One control-plane coordinator is active at a time. The experiment may leave an
executor process alive while killing the coordinator, because executor
survival is one of the questions.

The protocol does not test two active Dalph-style coordinators. It may run a
competitor's second coordinator only as a negative qualification check when
the product claims multi-replica support.

## Canonical fixture

### Task graph

Create four tasks:

```text
A ──► C
B ──► C
D
```

- A and B are initially ready.
- C depends on both A and B.
- D is independent but lower priority.
- Task-work capacity is two where the product supports a configurable limit.

This fixture reveals whether eligibility and capacity are separate:

- A and B may start;
- C must not start;
- D is graph-eligible but may wait because both positions are used.

If a product cannot represent external dependencies, use its native task graph
and record that authority difference.

### Git repository

Create:

1. a local bare remote;
2. a target branch at commit `B0`;
3. one later target commit `B1` used only for drift scenarios;
4. product-specific task branches or worktrees.

Record commit IDs rather than relying on generated names such as `main`.

### Fake agent

The fake agent accepts:

- task identity;
- attempt identity when supplied;
- workspace path;
- session-state directory;
- phase to stop at;
- control FIFO or local socket.

It writes an append-only agent log with:

- process identity;
- invocation identity;
- provider-style session identity;
- start time;
- workspace path;
- phase transitions;
- received continuation messages;
- controlled exit reason.

It then creates the following worktree evidence in order:

1. commit `C1` containing `committed.txt`;
2. `staged.txt` added to the Git index but not committed;
3. an unstaged modification to a tracked `unstaged.txt`;
4. an untracked `untracked.txt`;
5. an ignored local artifact under `.agent-local/required-state.json`;
6. optionally, a stash in a separate scenario;
7. optionally, an unresolved conflict in a separate scenario.

The conflict and stash variants remain separate because adding them to the
base fixture can prevent ordinary product commands from running at all.

The agent blocks after each phase until told to continue or stop. This provides
deterministic interruption points without a real model.

### Control-plane evidence

Capture, when the product exposes it:

- task and dependency records;
- claim/assignment/lease;
- queue position and capacity count;
- run, attempt, job, heartbeat, or workflow identity;
- retry count and next retry time;
- agent session ID and log locator;
- workspace and branch record;
- base ref and resolved base commit;
- process/container/VM identity;
- integration request and target commit;
- cleanup and recovery decisions;
- operator-visible status.

## Four restoration layers

Every result reports these independently:

| Layer | Complete | Partial | Lost or unknown |
|---|---|---|---|
| Control-plane attempt | Same task/run/attempt and effects are reconstructed | Task is eligible again but attempt identity or effect history is missing | Product cannot relate the restart to prior work |
| Agent session | Same provider-style session/context/log continues | Fresh agent receives preserved handoff or prior log | Context/log is discarded or falsely reported as the same session |
| Git worktree | Commit, index, unstaged, untracked, ignored required state, conflicts/stash, worktree registration, branch, and base all survive | Some WIP survives or a new worktree imports selected artifacts | Valuable changes disappear, are silently reset, or ownership is unknown |
| Live execution | Surviving execution is identified and adopted or deliberately stopped | Product detects it but requires operator action | Duplicate execution starts, orphan remains invisible, or ownership is guessed |

“Resume” is not a result category. Use one of the concrete classifications
above.

## Interruption types

Test these separately:

1. **Graceful coordinator stop:** allow shutdown handlers to run.
2. **Coordinator crash:** kill the coordinator without running its cleanup;
   leave executor and storage processes alive.
3. **Whole control-plane crash:** kill coordinator and locally owned executor
   processes, leaving durable storage and Git.
4. **Storage interruption:** only where the product documents a crash-safe
   database and supplies a supported test seam.
5. **Executor crash:** kill the fake agent while the coordinator remains
   alive.

Do not describe a graceful restart result as crash recovery.

## Chronological scenarios

### C0 — stop before claim

1. The graph reports A and B ready.
2. Stop the coordinator before it changes task ownership.
3. Restart.

Record whether the same frontier is recomputed without phantom queued work.

### C1 — claim applied, response lost

1. Coordinator asks the task store to claim A.
2. The claim becomes durable.
3. Prevent the success response or kill the coordinator before it records the
   result.
4. Restart.

Record whether it rereads the claim, creates a duplicate claim, waits for
lease expiry, or abandons the task.

### C2 — worktree created, control record missing

1. Claim A.
2. Create A's branch/worktree from `B0`.
3. Stop before the control plane records or acknowledges workspace creation.
4. Restart.

Record whether the exact workspace is adopted, quarantined, deleted, ignored,
or duplicated.

### C3 — agent started, start response lost

1. Start the fake agent and let it record its session and PID.
2. Stop the coordinator before it records that start succeeded.
3. Leave the agent alive.
4. Restart.

Record whether the live execution is adopted, stopped, ignored, or duplicated.

### C4 — full uncommitted worktree

1. Let the agent create `C1`, staged, unstaged, untracked, and ignored evidence.
2. Crash the coordinator, leaving the agent alive.
3. Restart.
4. Repeat with the whole control plane killed.

Hash and compare every file, the Git index, `HEAD`, branch, worktree
registration, stash list, conflict state, and agent log before and after.

### C5 — agent finishes, result not recorded

1. Agent completes and exits successfully.
2. Stop the coordinator before it records completion.
3. Restart.

Record whether completion is reconstructed from authoritative evidence, work
is rerun, or operator action is required.

### C6 — push applied, response lost

1. Push the task branch or candidate commit.
2. Suppress the successful response or stop before recording it.
3. Restart.

Record whether the product checks the remote ref before pushing again.

### C7 — target update applied, response lost

Run only for products that integrate:

1. Move the target from its observed head to the accepted candidate.
2. Suppress the success response or stop before recording it.
3. Restart.

Record whether it rereads the target, attempts the mutation twice, marks a
false failure, or leaves cleanup incomplete.

### C8 — immediate close and reopen

Repeat C4 through a supported graceful shutdown and immediate restart.
Compare the result with the crash result.

### C9 — reopen after a week with external drift

Simulate elapsed retention/lease time through the product's supported clock
seam or timestamp fixtures; do not wait a real week.

Before restart:

- advance the target from `B0` to `B1`;
- change one dependency or task lifecycle;
- expire a claim/lease when the product has one;
- expire or remove a provider-style session handle in one variant;
- retain the worktree and all WIP;
- remove the worktree in another variant while preserving the branch/commit.

Record whether the product:

- resumes the same attempt;
- starts a fresh agent in the old worktree;
- replans from `B1`;
- preserves or discards old WIP;
- asks for operator choice;
- starts duplicate work;
- silently changes the original starting point.

## Capacity observations

At every restart record:

- configured capacity;
- tasks counted as running;
- tasks counted as retrying;
- tasks counted as paused or blocked;
- surviving executor processes;
- newly dispatched tasks.

For the canonical graph, the important check is whether D starts while A's old
agent may still be running. Do not assume either answer is correct; explain the
product's rule and user consequence.

## Integration observations

For products with integration:

- identify the exact target ref and observed commit;
- identify the candidate commit;
- record the concurrency fence: process mutex, file lock, database row,
  Git compare-and-swap, CI concurrency group, provider merge queue, or none;
- record whether agents may continue while integration waits;
- record conflict ownership and retained evidence;
- record post-integration cleanup separately from the target update.

For products without integration, record the handoff boundary: branch, PR,
work product, or operator instruction.

## Evidence bundle

Each run produces:

```text
evidence/
  manifest.json
  environment.txt
  product-version.txt
  scenario.json
  timeline.jsonl
  process-before.json
  process-after.json
  task-state-before.json
  task-state-after.json
  git-before/
  git-after/
  agent-log.jsonl
  control-plane.log
  database-export-or-query-results/
  result.md
```

`manifest.json` records hashes for every evidence file. Secrets and unrelated
environment variables must not enter the bundle.

## Result format

Each scenario result answers:

1. What was true before interruption?
2. Exactly what was interrupted?
3. Which durable records and external facts survived?
4. What did startup read?
5. Did it use the same control-plane attempt?
6. Did it use the same agent session/context/log?
7. Did every category of worktree state survive?
8. Was any old execution still active?
9. Was capacity counted without duplication or oversubscription?
10. What happened to Git integration?
11. What did the operator see?
12. What manual repair was required?
13. Which source path explains the behavior?

## Product-specific preparation gate

Do not run experiments directly from this common protocol. First write a
product-specific experiment specification that identifies:

- supported local installation;
- fake tracker or native task fixture;
- fake-agent adapter seam;
- exact start, ready, shutdown, and recovery commands;
- safe crash-injection mechanism;
- database and Git inspection commands;
- clock/time simulation seam;
- unsupported scenarios and why;
- teardown proof.

Review that specification before executing destructive fault cases.

## Relationship to Dalph

The protocol does not assert that Dalph already passes these cases. Results
will inform future accepted operational scenarios and tests. Dalph's current
same-process fake executor cannot prove independent agent-session survival or
production restoration.
