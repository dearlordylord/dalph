# Chartr source comparison: cockpit overlap, control-plane divergence

Research date: 2026-07-29

Evaluated source: [`rengwu/chartr` commit
`278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58`](https://github.com/rengwu/chartr/tree/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58),
checked out at `.references/chartr`. The commit was the remote default-branch
head when this research began.

This is a source-code comparison, not a README feature comparison. It
distinguishes:

1. what chartr actually implements at the evaluated commit;
2. what Dalph actually implements now;
3. Dalph's accepted control-plane architecture; and
4. earlier market-research goals that remain future executor or integration
   design rather than current Dalph behavior.

This research changes no Dalph runtime behavior, so no operational scenario or
scenario-to-test mapping applies.

## Bottom line

**Chartr is a direct competitor for the operator-facing job, an adjacent tool
for the orchestration job, and not an implementation of Dalph's control-plane
contract.**

A person who says “show me the dependency map, let me take ready work, launch
Codex or Claude with the right context, and keep the sessions in one cockpit”
can use chartr today. In that product-shaped sense it intersects heavily with
the visible Dalph idea, and its shipped cockpit is substantially ahead of
Dalph's current UI.

A person who says “read the canonical DAG from an external tracker, claim the
runnable frontier mechanically, run several attempts in exact worktrees,
recover ambiguous boundary calls, and integrate accepted work safely” cannot
use chartr as a substitute. Chartr deliberately chooses a repository-local
Markdown ledger, operator-selected dispatch, a shared working tree, Git commits
as the audit trail, in-memory sessions, and no review or integration protocol.
Those are not missing checkboxes. They are explicit product and architecture
decisions opposite to Dalph's.

The practical conclusion is:

- do not adopt chartr as Dalph's scheduler, tracker adapter, executor boundary,
  journal, or Git lifecycle;
- treat chartr as serious evidence that the graph-plus-terminal cockpit is a
  real product category and that Dalph's visible surface is not unique;
- reuse interaction and presentation ideas, especially stable graph layout,
  context preview, agent selection, live terminal attachment, and explicit
  attention states; and
- if Dalph builds a graphical client, feed it Dalph's semantic trace and typed
  control service. Forking chartr's backend or translating Dalph into chartr's
  `.plan` model would create a second authority and erase the behavior Dalph is
  being built to guarantee.

## What chartr actually is

Chartr calls itself an “agent multiplexer with a map of the work.” Its shipped
shape is a local, single-operator desktop/browser cockpit:

- a Go HTTP server owns repository registration, filesystem watches, PTYs,
  process observation, and action endpoints;
- a Svelte SPA receives a whole derived model over a push-only WebSocket;
- xterm.js terminals use separate binary WebSockets;
- an imperative canvas renders the dependency star-map; and
- registered agent CLIs are launched in PTYs with a freshly composed Markdown
  payload.

The server wiring makes this concrete: spaces, agent configuration, payload
preview, spawn, resume, respawn, release, ad-hoc terminals, and skill launchers
are all local HTTP actions, while model and terminal data travel on separate
sockets ([server routes](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/server/server.go#L88-L199)).
The control socket sends the current whole snapshot at connection and on every
change; it is not an event stream and the browser cannot mutate through it
([control socket](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/server/control.go#L11-L66)).

Chartr is young and explicitly alpha. The evaluated repository advertises
`v0.2.1`, says breaking changes are expected, and says it does not plan a hosted
service or account system
([status](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/README.md#L101-L129)).
Its source is nevertheless not a mockup: the checkout contains the full Go
server and PTY layer, the Svelte cockpit, release packaging for several
platforms, 36 Go test files, and 14 frontend test files.

## The most important naming trap: its “tracker adapter” is not ours

Chartr's task authority is committed Markdown under `.plan/maps/`. Its bundled
tracker instructions say, unambiguously, “No remote tracker,” define ticket
numbers as identities, derive status from headings and claim frontmatter, and
declare that the map is memory
([tracker contract](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/prompt/assets/issue-tracker.md#L1-L58)).

The code called `internal/tracker/adapter.go` does not read GitHub, Linear, or
another task API. It classifies and optionally installs that Markdown
instruction file at `docs/agents/issue-tracker.md`. Its GitHub/Linear/GitLab
detection is only a best-effort hint used to phrase the warning before replacing
a foreign file; behavior does not depend on it
([adapter classification](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/tracker/adapter.go#L1-L12),
[remote hint](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/tracker/adapter.go#L118-L132)).

Dalph's task-tracker adapter has the opposite responsibility: decode an external
tracker's API responses into normalized task facts and encode normalized
mutations back to that authority. GitHub Issues is the first implementation
([Dalph context](../docs/CONTEXT.md#task-tracker-target)). Adopting chartr's map
as an intermediate mirror would violate Dalph's rule that the tracker, not a
repository file or UI, owns task identity, lifecycle, dependencies, grouping,
and claims.

## Source-level behavior comparison

| Concern | Chartr at the evaluated commit | Dalph boundary | Fit |
| --- | --- | --- | --- |
| Person and operating mode | A person watches the cockpit, chooses a frontier ticket, chooses a role and agent, and stays available to answer a TUI or resolve a dead session. | The coordinator mechanically selects legal work; an operator controls exceptional or policy transitions through one typed service. | Strong UX overlap, different automation boundary. |
| Task authority | `.plan/maps/<slug>/map.md` plus ticket Markdown committed in the target repository. | External task tracker owns task identity, lifecycle, graph, grouping, and claims. | Fundamentally incompatible. |
| Frontier | Pure derivation: an open ticket is ready when every `blocked_by` ticket has an `## Answer`. | Derived from normalized tracker facts with explicit coverage, freshness, contradiction, lifecycle, and claim evidence. | Same graph idea; radically different evidence model. |
| Claim | Chartr writes `claimed_by` and `claimed_at` into the ticket, then makes a path-limited Git commit. | Tracker-specific atomic claim with exact owner/token and journaled intent before the external mutation. | Superficial overlap only. |
| Dispatch | Operator clicks one ticket and explicitly selects one registered agent. | Bounded coordinator admission of independently legal transitions. | Complementary interaction pattern, not equivalent scheduling. |
| Concurrency | Defaults to one live session per repository. The operator may force more sessions into the same tree after a warning. | Bounded task-work positions; one exact worktree and planned Base SHA per attempt; integration resources are distinct and serialized. | Opposite safety model. |
| Work isolation | No per-ticket branch or worktree. Concurrent agents can overwrite each other's uncommitted files. | Planned attempt binds Base SHA, branch, worktree path, and executor locator before use. | Direct contradiction. |
| Agent support | Strong: arbitrary CLI on `PATH`, configured argv/env/prompt delivery, with built-in detection for common agents. | Generic planned-attempt executor boundary; concrete production executor internals are still future design. | Chartr is useful executor-UX prior art. |
| Context assembly | Fresh map, ticket, blockers' answers, glossary, skill manifest, and role skill become one inspectable payload; a SHA is recorded. | Task-work specification is tracker-authored title/body; evidence and executor-internal prompting stay behind typed boundaries. | Useful idea, but chartr's map content cannot become Dalph authority. |
| Completion | A non-empty `## Answer` immediately resolves a ticket and releases dependants. No component blesses, merges, or verifies it. | A terminal executor report is not tracker completion or Git integration. The wider research direction requires accepted integration before advancing graph state. | Chartr does not implement Dalph completion semantics. |
| Review | The review pipeline was deliberately removed. | Review/handback is explicitly not part of the current coarse executor milestone; it remains future executor design in the wider product research. | Chartr does not settle the future design. |
| Git integration | Agents edit the one checked-out tree and commit their own work. Chartr commits only claim/release, never pushes, merges, rebases, resets, or integrates. | Git owns lineage and accepted integration; planned worktrees and future serialized integration are distinct coordinator concerns. | No replacement. |
| Restart and ambiguity | Repository files and claims survive. PTY/session tabs do not. An orphan claim requires an explicit operator release; there is no startup sweep or timeout. | Durable workflow journal plus fresh tracker/Git/executor reads; ambiguous effects are reconciled before retry and invalid regions fail closed. | Fundamentally weaker, intentionally human-mediated. |
| Retry and non-convergence | Dead sessions offer human-selected resume, fresh respawn, or release. No technical retry schedule, semantic round budget, or quarantine protocol exists. | Typed bounded policies and exact dispositions are core research requirements; current fake executor exposes only running/suspended/terminal. | No replacement. |
| Observability | Latest map/session snapshot, terminal scrollback, Git history, live status, and a fading per-push ticker. | Ordered schema-versioned semantic trace; UI projections must not become authority. | Strong visual prior art, weaker historical semantics. |
| UI graph | Stable dependency graph with status and live-session overlays, pan/zoom/fit, detail pane, and terminal tabs. | Intended workbench separates task DAG, execution-causality graph, actor spans, and cursor replay. | Closest and most valuable intersection. |

### Frontier derivation is real, but intentionally small

Chartr's parser derives only `open`, `claimed`, `resolved`, and `out_of_scope`.
An answer wins over a leftover claim; a claim wins over open
([status derivation](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/wayfinder/parse.go#L71-L89)).
Its frontier loops over open tickets and requires every referenced blocker to be
present and resolved
([frontier](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/wayfinder/parse.go#L132-L155)).

That is a genuine dependency scheduler predicate, not decorative UI. It is also
far below Dalph's normalized graph-read boundary: there is no remote coverage,
freshness, membership closure, grouping, revision comparison, mixed-time read,
or contradiction policy. Malformed maps and dangling edges are deliberately
rendered with warnings rather than refused
([map scan](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/mapscan/mapscan.go#L80-L139)).
That is appropriate for a human-driven planning cockpit and unsafe as Dalph's
authorization to cross an external mutation boundary.

### Its claim is carefully implemented, but it is not atomic coordination

Before launch, chartr rereads the map from disk, requires the ticket to be on
the frontier, resolves the chosen agent, and checks the default one-session
guard
([spawn gates](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/server/spawn.go#L90-L140)).
It then writes claim fields into the ticket and runs a pathspec-limited Git
commit so unrelated staged work is excluded
([claim commit](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/server/claim.go#L38-L75)).
The commit trailers include session, selected agent, executable adapter, argv,
role, payload hash, and skill hashes
([claim message](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/server/claim.go#L175-L208)).

This is thoughtful auditability. It still has no compare-and-set against a
remote authority and no intent/effect/observation journal. The code explicitly
accepts that a failure after the claim commit leaves the claim standing, and a
race at PTY seating can therefore produce a claim without a session
([launch ordering](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/server/spawn.go#L262-L347)).
The operator repairs that condition. Dalph instead needs to record intent
before ambiguity-crossing effects, observe afterward, and reconcile before
retry.

### Isolation is the decisive architectural conflict

Chartr explicitly rejected branches and per-ticket worktrees to keep local
history linear. Its default is one session per repository, not one per map.
An amendment now lets the operator override the warning; the ADR states that
two agents can clobber each other's uncommitted edits and Git may not announce
it
([ADR 0003](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/docs/adr/0003-serialise-per-space-no-worktrees.md#L1-L23)).
The PTY manager implements exactly that guard and bypass
([session admission](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/terminal/manager.go#L152-L203)).

Dalph requires one exact worktree and planned Base SHA per attempt. The worktree
must be freshly observed at the planned branch, and Base must be an ancestor of
its current `HEAD`; contradictions are preserved for repair rather than reset
or ignored ([Dalph planned-attempt language](../docs/CONTEXT.md#executor-internal-policy)).
Chartr cannot be extended into this behavior with a concurrency setting. Its
space model, Git history, spawn path, and human recovery UX all rely on the one
shared tree.

### Completion and review are intentionally outside chartr

At this commit, a ticket becomes resolved as soon as it contains a non-empty
`## Answer`; a dependent becomes ready immediately. Chartr's earlier proposed
answer and human/agent review gate was intentionally removed. Its ADR says the
result now means “the session said so,” that the former containment against a
wrong answer is knowingly forfeited, and that the replacement is social and
visible rather than mechanical
([ADR 0004 amendment](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/docs/adr/0004-derived-ticket-state-and-proposed-answer.md#L16-L23)).
Chartr only commits claim and release, while the agent owns work and answer
commits
([ADR 0008 amendment](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/docs/adr/0008-split-commit-ownership-append-only-harness.md#L16-L22)).

This is especially important when comparing against Dalph's README, which still
summarizes the broader review/retry/integration ambition. Current accepted
Dalph terminology deliberately keeps reviewer, handback, retry, restoration,
and convergence policy behind a coarse planned-attempt executor boundary until
new operational scenarios accept a production algorithm
([current executor boundary](../docs/CONTEXT.md#executor-internal-policy)).
Therefore:

- chartr does not already implement the broader Dalph review and integration
  idea; and
- its removed review feature is not an implementation candidate that Dalph can
  simply restore, because Dalph has not yet accepted that future protocol.

### Restart recovery is an operator repair workflow

Chartr persists registered space paths and lightweight preferences in an
atomically replaced `spaces.toml`; it describes this as a rebuildable index, not
work authority
([registry](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/registry/registry.go#L1-L8),
[atomic save](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/registry/registry.go#L228-L253)).
It archives the composed session payload and terminal scrollback, but the
terminal manager's session set is process memory.

The release handler documents the resulting restart behavior directly: every
tab disappears, an on-disk claim can become orphaned, there is no startup sweep
or timeout, and the operator must release the exact ticket before spawning
again
([orphan release](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/server/release.go#L11-L32)).
A dead session that remains in the same process offers resume, fresh respawn,
or release, and chartr takes none automatically
([death halt](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/server/halt.go#L18-L33)).

Dalph's durable journal exists to answer a different question: which exact
responsibilities remain after process loss, which external outcomes are
ambiguous, and which fresh authority observations permit another action. It
must validate complete history and fail only the affected region closed where
possible ([Dalph durability architecture](../docs/ARCHITECTURE.md#durability-and-reconstruction)).
Chartr's manual release flow is honest and adequate for its cockpit, but not
Dalph-style recovery.

## Where chartr is ahead and worth learning from

### 1. It has shipped the obvious cockpit

Dalph currently has a fixture-only `--dry` CLI and a disposable visual
prototype; it does not create worktrees, run real task work, or integrate
results ([current Dalph status](../README.md#status)). Chartr already ships:

- repository registration and switching;
- live filesystem discovery of maps;
- deterministic dependency visualization;
- agent selection and launch;
- terminal tabs and scrollback;
- status derived from agent broadcasts and terminal screen content;
- payload preview with content provenance;
- dead-session actions; and
- browser, macOS, and Linux packaging.

Anyone evaluating only a screenshot or demo may reasonably conclude that
chartr “already did the app.” Dalph needs to articulate its authority,
reliability, and autonomous delivery differences in product language, not rely
on implementation details to make the distinction.

### 2. Stable graph geography is a strong interaction

Chartr computes layout only from ticket identities and dependency edges, never
from lifecycle status. Status changes therefore do not move a star
([layout invariant](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/web/src/lib/starmap/layout.ts#L1-L11),
[structure signature](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/web/src/lib/starmap/layout.ts#L147-L160)).
This is directly reusable design evidence for Dalph's task-DAG projection:
people should not have to relearn graph geography every time work changes
state.

The code also keeps the star-map as an imperative island with a narrow
`mount / setModel / selection` seam under reactive Svelte chrome
([wrapper](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/web/src/lib/StarMap.svelte#L9-L66)).
That is a useful presentation architecture if Dalph retains a canvas/WebGL
graph.

### 3. Session liveness has a legible non-color grammar

Chartr overlays live work as an orbiting body, blocked work as a crawl/blink,
and dead work as a frozen body/halo. The state is derived from the pushed
snapshot rather than stored separately
([session overlay](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/web/src/lib/starmap/session.ts#L1-L81)).
The exact animation is not a Dalph domain decision, but the principles are:

- graph lifecycle and execution liveness are separate visual axes;
- attention states need non-color channels; and
- views derive from one typed model instead of inventing status locally.

### 4. Payload preview and provenance are valuable executor UX

Chartr assembles the map, ticket, blockers' answers, role skill, common skill,
and skill manifest fresh at spawn. It hashes the exact payload, archives it, and
records executable argv plus contributing skill hashes in the claim commit
([session launch](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/server/spawn.go#L262-L360)).
Dalph should preserve the distinction between tracker-authored work and
executor-internal prompting, but a future executor/operator surface would
benefit from the same answer to “what exactly was this attempt told?”

### 5. Agent-CLI portability is substantive

Chartr's adapter boundary is intentionally small: executable, arguments,
environment, and one of several prompt-delivery modes. The operator chooses a
complete registered agent per spawn. This has shipped across common agent CLIs
without making the ticket model depend on one provider. It is useful evidence
for a future Dalph executor implementation, though Dalph also needs suspension,
terminal reporting, correlation, and recovery semantics chartr's adapter does
not provide
([adapter boundary](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/adapter/adapter.go#L1-L36),
[generic fallback](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/adapter/adapter.go#L105-L143)).

## What should not be copied

1. **Do not make `.plan` a Dalph task mirror.** It would duplicate the external
   tracker and create a synchronization protocol.
2. **Do not treat a Git commit as the workflow journal.** Git is Dalph's lineage
   authority, not a place to mix claim intent, boundary ambiguity, executor
   reports, and control directions.
3. **Do not inherit chartr's shared-tree override.** Dalph's exact worktree and
   Base SHA rule exists precisely so the operator is not asked to guess whether
   two agents will collide.
4. **Do not infer completion from agent-authored prose.** An executor terminal
   result, tracker completion, and accepted Git integration are distinct facts.
5. **Do not use latest-snapshot push as historical trace.** It is excellent for
   repainting a cockpit and cannot support causal replay, recovery proof, or
   “what did Dalph know when it acted?”
6. **Do not interpret the old chartr review code as settled prior art.** The
   feature was removed, and Dalph's future reviewer/convergence algorithm still
   requires accepted operational scenarios.

## Competitive assessment

### Is it a competitor?

**Yes, for attention, adoption, and the visible cockpit.** Both projects can be
described as graph-aware tools for driving coding agents through dependent
work. Chartr is downloadable, visually polished, agent-agnostic, and much
easier to explain. A solo operator who values direct control and local files may
prefer its intentionally smaller promise.

**No, as a drop-in control-plane competitor.** Chartr is not attempting
unattended bounded orchestration, external-tracker authority, exact worktree
lineage, serialized accepted-head integration, or durable reconciliation. It
explicitly calls itself a cockpit rather than autopilot.

The most accurate market placement is **operator-present graph cockpit and
session multiplexer**. Dalph's intended placement is **reliable graph-native
delivery orchestrator with replaceable presentations**. The categories overlap
at the frontend and agent-launch edge, then separate at the authority and
recovery boundary.

### Does it do what Dalph planned?

It does a meaningful subset:

- dependency graph and runnable frontier;
- claim visibility;
- agent selection and launch;
- assembled ticket context;
- live process/session status;
- operator attention and recovery choices; and
- a polished graph-plus-terminal UI.

It does not do the decisive control-plane work:

- external tracker DAG or provider-neutral graph adapter;
- atomic external claims with owner/token reconciliation;
- automatic bounded frontier admission;
- exact Base SHA and per-attempt worktree;
- safe concurrent same-repository execution;
- typed attempt-level suspension and terminal reports;
- durable intent/effect/observation journal;
- restart reconstruction from journal plus fresh authorities;
- independent acceptance/convergence protocol;
- accepted-head integration;
- separate technical and semantic retry scopes;
- quarantine and disposition-typed cleanup; or
- task/execution causal replay from a canonical semantic trace.

## Recommended response

1. **Add chartr to the market topology** as the strongest operator-present
   graph cockpit, beside rather than inside the scheduler/control-plane
   candidates.
2. **Keep building Dalph's control plane.** Nothing in chartr falsifies the
   need for Dalph's authority, lineage, and recovery protocol.
3. **Revisit Dalph's presentation requirements with chartr in view.** At
   minimum, compare stable graph geography, agent selection, payload preview,
   terminal attachment, blocked/dead attention, and multi-repository navigation
   against the existing execution-trace prototype.
4. **Avoid a backend fork or protocol adapter.** The reusable part is interaction
   design and isolated rendering/PTY technique, not chartr's task model.
5. **Consider a clean client seam later.** A chartr-like cockpit could be a
   replaceable client of Dalph's local control service and semantic trace, but
   only if it consumes Dalph's schemas directly and never writes a parallel
   `.plan` lifecycle.

## Verification

- Inspected the complete source tree at the fixed commit, including the Go
  server, map parser, claim/release logic, terminal manager, Svelte model and
  star-map, tests, ADRs, current simplification spec, and CI/release workflows.
- Ran `npm ci`, `npm test`, and `npm run check` in `.references/chartr/web`.
  Result: 14 test files and 185 tests passed; `svelte-check` reported zero
  errors and zero warnings.
- Could not run `go test ./...` because this workspace does not have the Go
  executable installed. The checkout contains 36 Go test files and CI declares
  `go vet ./...` plus `go test ./...`, but those facts are not presented as a
  local passing result
  ([CI workflow](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/.github/workflows/ci.yml#L1-L53)).
- The repository's GitHub Actions run for the evaluated head completed
  successfully
  ([head CI run](https://github.com/rengwu/chartr/actions/runs/30347754319)).
- Dalph comparison sources were its checked-in
  [README](../README.md), [context](../docs/CONTEXT.md),
  [architecture](../docs/ARCHITECTURE.md), and
  [market rubric](market-and-adoption-alternatives.md). Earlier research claims
  were not silently promoted into current accepted executor behavior.
