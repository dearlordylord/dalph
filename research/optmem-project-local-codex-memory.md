# OptMem as project-local Codex memory

Status: research input for the project-memory tooling adopted on 2026-07-28.
This note itself changes no Dalph runtime behavior. The implementation lives in
`.codex/`, `scripts/project-memory.mjs`, and the `tools/optmem` submodule.

Research date: 2026-07-28.

External source version: OptMem `main` at
[`e36da55815951d50d103d7242d92cf9a71ceee96`](https://github.com/VictorTaelin/OptMem/tree/e36da55815951d50d103d7242d92cf9a71ceee96).

## Answer

Yes, OptMem can keep its data inside a project and Git can track it. OptMem
reads `MEMORY_DIR`, and its README explicitly names a Git repository as a
supported location
([README](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/README.md#files),
[path selection](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L134-L154)).
Codex can read that store when repository instructions tell it to run
`memo wake`, or more automatically when a trusted project `SessionStart` hook
runs `memo wake` and returns its stdout as developer context
([OptMem's integration prompt](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/README.md#the-prompt),
[Codex `SessionStart`](https://learn.chatgpt.com/docs/hooks#sessionstart)).

No documented Codex setting makes the built-in **Memories** feature use an
OptMem store or an arbitrary per-project memory directory. Codex's local
memories live under `CODEX_HOME` (normally `~/.codex/memories/`) and are
generated state; the documented memory settings control generation, use,
models, retention, and rate-limit thresholds, not a storage backend or path
([Codex Memories](https://learn.chatgpt.com/docs/customization/memories),
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)).
OptMem would therefore be a second, repository-owned context source, not a
replacement backend for Codex Memories.

The most promising experiment is a checked-in OptMem store plus a project
`SessionStart` hook for reads and narrow `AGENTS.md` instructions for writes.
It should first be tried in a throwaway branch because OptMem's position-based
identity is poorly suited to concurrent Git branches.

## What happens in a Codex session

With a project-local integration, a developer starts Codex in a trusted Dalph
checkout. A checked-in `SessionStart` hook resolves the Git root, sets
`MEMORY_DIR` to the repository's OptMem directory, runs `memo wake`, and lets
Codex add the returned lines to developer context. Codex's hook protocol
supports this directly: project hooks run with the session working directory,
plain stdout from `SessionStart` becomes developer context, and the same event
can run after compaction
([hook locations and execution](https://learn.chatgpt.com/docs/hooks#where-codex-looks-for-hooks),
[`SessionStart` output](https://learn.chatgpt.com/docs/hooks#sessionstart)).

While working, the root agent records a short project fact with `memo note`.
The command appends a dated, numbered record, then may ask the agent to
compress the next pending range with `memo nap`
([`note` and `nap`](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L654-L692)).
The resulting `LOG.txt`, summaries, and configuration appear as ordinary
worktree changes and are reviewed and committed deliberately. A subagent does
not write memory: that is part of OptMem's own prescribed integration because
subagent observations can be duplicated or lack the context needed to judge
what is already known
([upstream prompt](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/README.md#the-prompt)).

This is documentation-only research, so the Dalph operational-scenario
implementation gate does not apply. An implementation ticket would still need
accepted chronological scenarios for startup, compaction, concurrent
worktrees, merge conflicts, missing summaries, and rejected sensitive notes,
with a scenario-to-test mapping.

## OptMem's storage and interface

OptMem is one dependency-free Python 3 script. Its public interface is a CLI:

- `init` creates a store and prints the instruction block;
- `wake` renders the bounded current context;
- `note` appends one memory;
- `nap` records one requested summary;
- `recall` performs a case-insensitive regular-expression scan;
- `zoom` opens one summary node;
- `forget` removes a bad summary and its descendants so they can be rebuilt;
  and
- `config` changes output-size knobs, while `import` bootstraps dated records
  ([command dispatch](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L785-L850),
  [README command summary](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/README.md#commands)).

There is no HTTP API, library API, MCP server, or Codex-specific memory
adapter in the inspected repository. Upstream describes the `AGENTS.md` prompt
as “the whole of the integration”
([README](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/README.md#the-prompt)).

The store contains:

```text
memory/
  LOG.txt       fixed-width append-only raw records
  TREE/<size>   fixed-width summary records by power-of-two range size
  config        output-size overrides
  .lock         advisory process lock created at runtime
```

`LOG.txt` records are 320 bytes and tree records are 288 bytes, padded with
spaces. A record's byte position is its identity. The tree is a cache derived
from the log, but its summary text is supplied by the agent, not computed
deterministically
([record layout](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L47-L80),
[`nap` prompt and write](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L463-L487),
[README file description](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/README.md#files)).

The default wake budget is 208 lines, described upstream as about 16,000
tokens. Output is paged to stay within harness limits. Once old raw entries no
longer fit, `wake` needs the corresponding tree summaries and refuses to
complete when a required summary is missing
([size knobs](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L47-L65),
[`wake`](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L584-L651)).

The README calls the entry limit 280 characters, but the implementation
actually enforces 280 UTF-8 **bytes** by default
([README](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/README.md#commands),
[implementation](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L47-L55)).

## Git suitability

### What works

- The canonical raw log and summaries are text files, so Git can store and
  review them. `MEMORY_DIR` is the supported redirection mechanism.
- Raw records are append-only during normal operation. `forget` truncates tree
  files but never changes the raw log
  ([append path](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L335-L350),
  [`forget`](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L718-L728)).
- A clone can reproduce the same raw history. Checking in `TREE/` also
  preserves the exact agent-written summaries and lets a clone wake without
  first paying the compression work.
- The in-store advisory lock serializes processes that share the same physical
  directory
  ([locking and append](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L303-L350)).

### What does not work cleanly

- Two Git branches that start from the same log length both assign their first
  new memory the same next numeric identity. Filesystem locking cannot help
  because separate worktrees contain separate stores. Merging those branches
  requires choosing an order, renumbering at least one suffix, and rebuilding
  affected tree levels. Stock OptMem has no merge command; its only bulk
  import is explicitly for bootstrapping and still appends into one store
  ([identity assignment](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L335-L348),
  [`import`](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L785-L823)).
- This is especially relevant to Dalph's one-worktree-per-task-attempt model.
  Automatically noting from every task worktree would create competing memory
  suffixes. Memory publication needs its own serialized integration step, or
  task agents should propose memories without directly appending them.
- Fixed-width padding makes diffs much larger than the visible text. Upstream
  estimates 608 MB for one million memories
  ([README](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/README.md#files)).
- Ignoring `TREE/` reduces generated-file conflicts, but a fresh clone may
  have to perform many agent-authored `nap` operations before `wake` can
  finish. Tracking it gives reproducible, immediately usable summaries but
  adds derived-file conflicts. For a first trial, track `LOG.txt`, `TREE/`,
  and `config`, ignore `.lock`, and serialize all memory updates.
- OptMem stores the supplied note verbatim and performs no secret or
  personal-data redaction before appending it
  ([validation and append](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L394-L411),
  [`note`](https://github.com/VictorTaelin/OptMem/blob/e36da55815951d50d103d7242d92cf9a71ceee96/memo#L654-L663)).
  The stock prompt explicitly asks for facts about the user's life. That
  policy is unsuitable for a team repository. A project integration must
  allow only durable project facts and forbid secrets, personal facts,
  credentials, private incident details, and unreviewed external content.
- The inspected OptMem commit has no license file
  ([repository tree](https://github.com/VictorTaelin/OptMem/tree/e36da55815951d50d103d7242d92cf9a71ceee96)).
  Do not vendor or redistribute `memo` in Dalph until the author supplies
  licensing terms. Keeping only Dalph's own memory data in Git and installing
  the tool separately avoids copying the source, but a production dependency
  still needs provenance, version pinning, and license review.

## Codex integration options

### 1. Project hook plus `AGENTS.md` — recommended experiment

A trusted `.codex/hooks.json` can run a small checked-in wrapper on
`SessionStart` for `startup`, `resume`, `clear`, and `compact`. The wrapper can
resolve the Git root, set `MEMORY_DIR`, and execute an externally installed,
commit-pinned OptMem script. Codex adds stdout as developer context. Hooks are
reviewed and trusted by exact hash, and untrusted projects do not run
project-local hooks
([hook trust](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks),
[project hook behavior](https://learn.chatgpt.com/docs/hooks#where-codex-looks-for-hooks)).

`AGENTS.md` should then cover only the agent decisions a hook cannot make:
what qualifies as a project memory, when to call `note`, how to answer a
requested `nap`, the sensitive-data prohibition, and the rule that subagents
do not append. Codex officially treats checked-in `AGENTS.md` as the durable
repository guidance surface
([Codex `AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md)).

This option is automatic for reads but not transparent. A missing required
summary can make `wake` exit unsuccessfully and ask for an agent-authored
compression; the wrapper must surface that failure, and `AGENTS.md` must tell
the root agent how to recover. OptMem's default context can also exceed
Codex's default hook `additionalContext` threshold, so the trial must set and
test an intentional wake budget and hook context limit
([large hook output](https://learn.chatgpt.com/docs/hooks#large-hook-output)).

### 2. `AGENTS.md` shell protocol only — smallest experiment

This is upstream's intended integration: tell the root agent to run `wake`
before other tools and to call `note` and `nap` while working. It needs no
adapter, but compliance depends on instruction following, the first tool call
is spent reading memory, and context after compaction is less reliable unless
the instruction explicitly handles compaction. This is suitable for testing
the store and merge workflow before adding a hook.

### 3. Project-local MCP wrapper — useful only if richer tools are wanted

A small stdio MCP server could wrap `wake`, `note`, `recall`, and `zoom` as
typed tools or resources. Codex supports project-scoped MCP configuration in
`.codex/config.toml` for trusted projects
([Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp#connect-codex-to-an-mcp-server)).
This would improve argument validation and discovery but would not make OptMem
the built-in memory backend or make reads automatic. It also introduces an
adapter to maintain and license; use it only if the shell protocol proves
valuable and its text interface becomes a real problem.

### 4. Relocating `CODEX_HOME` — not a project-memory solution

Launching with `CODEX_HOME=$(pwd)/.codex` would place Codex's own memory under
the repository, but it also relocates configuration, authentication-related
state, logs, sessions, skills, caches, and other per-user state
([Codex state locations](https://learn.chatgpt.com/docs/config-file/config-advanced#config-and-state-locations),
[`CODEX_HOME`](https://learn.chatgpt.com/docs/config-file/config-advanced#project-instructions-discovery)).
Codex explicitly says its memory files are generated state and recommends
checked-in documentation or `AGENTS.md` for required team guidance
([Codex Memories](https://learn.chatgpt.com/docs/customization/memories)).
Checking a whole project `CODEX_HOME` into Git would therefore mix credentials
and personal/session state with shared project knowledge and is not
recommended.

## Suggested adoption gate

Proceed only with a throwaway prototype that demonstrates all of the following:

1. A fresh clone runs the project hook and receives the same checked-in wake
   context.
2. Startup and post-compaction reads complete within a declared token budget.
3. A missing or corrupt summary produces a visible, recoverable failure.
4. Two task worktrees proposing memories do not append competing numbered
   suffixes; one serialized publisher applies the accepted notes.
5. Git diffs clearly expose every raw note and summary for review.
6. A rejection test proves that secrets and personal facts are not written.
7. Deleting `TREE/` and rebuilding it from `LOG.txt` preserves usable memory,
   with the time and model cost recorded.
8. The OptMem dependency has explicit licensing terms before any source is
   vendored or redistributed.

If those checks pass, OptMem can be a useful project context index. It should
still remain advisory: accepted scenarios, architecture decisions, and rules
that must always apply belong in normal checked-in Dalph documentation and
`AGENTS.md`, not only in compressed memory.
