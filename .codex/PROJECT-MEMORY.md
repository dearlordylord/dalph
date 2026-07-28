# Dalph project memory

This is project tooling, not part of Dalph's runtime control plane. It does not
change a Dalph command, tracker or Git authority, executor behavior, journal
fact, retry, recovery, cleanup, or user-visible orchestration result.

Codex's built-in Memories are disabled here. The repository instead pins
[OptMem](https://github.com/VictorTaelin/OptMem) as a Git submodule at
`tools/optmem` and tracks its data under `.codex/memory`.

## Operational tooling scenarios

### A developer starts or resumes Codex

The developer has a trusted Dalph checkout whose OptMem submodule is
initialized. Codex runs the checked-in `SessionStart` hook for startup, resume,
clear, or post-compaction continuation. The hook resolves the Git root and runs
`node scripts/project-memory.mjs wake`. Codex receives the bounded OptMem output
as developer context.

If the submodule is missing, the developer sees the exact initialization
command. If a required tree summary is missing, the root agent sees OptMem's
requested `nap` operation rather than silently receiving incomplete memory.
No network boundary, Dalph process, or Dalph durable state participates.

Acceptance tests: `loads the same checked-in memory from the repository root
and a nested working directory` and `wake surfaces a required compression
through the project wrapper`.

### The root agent records a durable project lesson

The root agent is running in `master`'s primary worktree and has checked that
the text is a durable project lesson rather than an authority fact, personal
fact, credential, or secret. It runs
`pnpm memory -- note "<one line>"`. The wrapper checks the branch, the physical
worktree, and obvious credential forms, then OptMem appends the record under
`.codex/memory`. Git cannot reveal whether the caller is a root agent, so
`AGENTS.md` supplies that non-mechanical restriction.

The root agent reviews and commits the memory diff. A process crash is handled
by OptMem's fixed-record repair and advisory lock. Retrying can append a second
semantic duplicate, so the agent must run `wake` or `recall` before retrying an
uncertain note. The wrapper must never claim that heuristic secret detection
proves the note is safe.

Acceptance tests: `master appends one note to the project store`, `repairs a
partial record before appending a retried note`, and `refuses authored memory
text that resembles a credential`.

### A task worktree proposes a memory

An agent works on a non-`master` branch whose checked-in memory starts at the
same record position as other worktrees. It may run `wake`, `recall`, or
`zoom`. If it tries `note`, `nap`, `forget`, or a mutating `config`, the wrapper
refuses before invoking OptMem and tells the agent to put the proposal in its
handoff. Bulk `import` is disabled everywhere because its unreviewed text
cannot satisfy the checked-in-memory policy.

The serialized root agent later decides whether to append the proposal from
`master`. Separate worktrees must not allocate competing positional IDs.

Acceptance tests: `non-master worktrees can read but cannot mutate project
memory`, `a second physical master worktree cannot mutate project memory`, and
`bulk import is disabled`.

### A maintainer updates OptMem

The maintainer starts from `master` with no local change inside the submodule
and runs `pnpm memory:update`. The updater initializes the submodule if needed,
fetches the configured `main` branch, checks out its current commit, and runs
OptMem's upstream test suite. The parent repository exposes the changed
gitlink for review and commit.

If the submodule contains local changes or the upstream tests fail, the
maintainer sees an error. The updater never commits or pushes. The currently
inspected upstream repository has no license file; do not distribute Dalph
with the submodule populated until licensing terms permit it.

Acceptance tests: `update command refuses a non-master worktree`, `update
refuses a dirty submodule`, `update surfaces an upstream test failure`, and
`update checks out the remote revision and runs both test suites`. Each actual
update also records the upstream and local test output in its handoff.

## Commands

```sh
git submodule update --init tools/optmem
pnpm memory:wake
pnpm memory -- recall '<regex>'
pnpm memory -- note '<durable project lesson>'
pnpm memory:update
```

After cloning, review and trust `.codex/hooks.json` with Codex's `/hooks`
command. Hook trust is bound to the exact hook definition, so changed hooks
must be reviewed again.

`LOG.txt` and `TREE/` use fixed-width, space-padded records. `.gitattributes`
disables only the end-of-line whitespace warning for those paths. The raw log,
tree summaries, and `config` are tracked; the process-local `.lock` is ignored.
OptMem's printed follow-up commands are rewritten through `pnpm memory --` so
they retain this store location and its write policy.
