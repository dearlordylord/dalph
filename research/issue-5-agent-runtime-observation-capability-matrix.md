# Issue 5: agent-runtime observation and exact-session interaction

Status: current source and official-document audit, with disposable host
experiments. This is research evidence, not a Dalph executor specification or
provider taxonomy. It changes no Dalph runtime behavior.

Evidence checked: 2026-08-18. The installed tools were Codex CLI 0.148.0,
Claude Code 2.1.218, and OpenCode 1.14.44. Codex source is pinned to the
matching 0.148.0 release commit
[`3ba0f711642a888aec92a611a3f3b2211157ff89`](https://github.com/openai/codex/tree/3ba0f711642a888aec92a611a3f3b2211157ff89).
OpenCode and tmux source revisions are pinned below. Claude Code was reviewed
from its official product documentation and live help because its CLI source is
not public. The Claude pages were fetched on 2026-08-18; their page metadata
has no immutable source revision (the sessions page reported a 2026-08-15
update, while agent-view, headless, CLI-reference, and troubleshooting pages
reported 2026-08-18). Claims below distinguish that documentation snapshot
from the installed 2.1.218 binary. tmux and Docker were reviewed from their
official documentation/source; neither executable is installed in this
environment.

## Question and evidence boundary

Issue [#5](https://github.com/dearlordylord/dalph/issues/5) asks what an outer
controller can reliably observe live, retain for replay, use to find one exact
durable session, interrupt safely, and resume interactively across Codex CLI,
Claude Code, OpenCode, and the current tmux/container environment. It also
asks that nested subagent visibility remain optional telemetry rather than a
cross-runtime requirement.

This note uses two evidence classes:

- **Provider guarantee** means an official interface or source explicitly
  exposes the identity, stream, replay, or control operation described.
- **Best-effort telemetry** means an observation can be useful but can be
  truncated, lost, stale, process-local, or otherwise cannot be used as an
  authority without a separate reconciliation step.

“Exact session” means a recorded provider-owned session handle is associated
with one invocation. It does not mean that the handle is an OS PID, that the
session is exclusively owned, or that a live stream can be reconstructed after
an adapter crash.

The current host probes below were read-only except for short-lived temporary
processes. No model task, provider mutation, GitHub mutation, or Dalph runtime
change was performed. No operational acceptance scenario applies: this is a
documentation-only artifact, so there is no runtime scenario-to-test mapping
to preserve.

## Capability matrix

| Runtime surface | Live observation | Durable identity and discovery | Replay or cursor | Safe interruption and resume | PTY/process identity | Exact-session exclusivity | Explicit limits | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Codex `exec` | `--json` emits JSONL events such as `thread.started`, turn/item events, and terminal events. Plain mode separates progress and final output. | `thread.started` provides a Codex thread id; `exec resume <id>` or `--last` can reopen persisted session state. `--ephemeral` removes that persistence. | The top-level `exec` JSONL events expose no replay cursor or event id. Each `item.*` event carries an item id, so `item.started`/`updated`/`completed` can correlate or deduplicate one item lifecycle; that does not replay missing lines. A thread id identifies provider state, not every emitted event or an OS process. | The CLI handles Ctrl-C by requesting `turn/interrupt` for the current thread/turn in its internal app-server client. This is a turn control, not proof that every descendant process stopped. Resume is a later invocation. | Ordinary `exec` event items report command text, aggregated output, exit code/status, and file changes; they do not expose a durable OS PID/process handle. | No cross-process ownership guarantee is stated for one-shot `exec`. Do not infer exclusivity from the thread id. | `--ephemeral` cannot resume; a parent that loses the JSONL line containing the id may lose its continuation token; background terminals require separate cleanup. | [Codex non-interactive guide](https://developers.openai.com/codex/noninteractive), pinned [`exec` CLI source](https://github.com/openai/codex/blob/3ba0f711642a888aec92a611a3f3b2211157ff89/codex-rs/exec/src/cli.rs), [`exec` event source](https://github.com/openai/codex/blob/3ba0f711642a888aec92a611a3f3b2211157ff89/codex-rs/exec/src/exec_events.rs), [`exec` lifecycle/source](https://github.com/openai/codex/blob/3ba0f711642a888aec92a611a3f3b2211157ff89/codex-rs/exec/src/lib.rs) |
| Codex app-server | JSONL JSON-RPC notifications identify a thread and turn and stream item events. | `thread/start`, `thread/resume`, `thread/read`, and `thread/fork` expose provider-owned thread identity and continuation. | Durable thread/turn/item history is provider-owned and paginated where the protocol requires it; live notifications expose no general replay cursor or event id. Item ids can correlate lifecycle notifications, not recover a lost stream. | `turn/interrupt` targets exact `threadId` and `turnId`; terminal/process APIs can write, resize, or terminate an exact app-server process handle. An interrupt sets the turn status to `interrupted`, but does not automatically clean background terminals. | `command/exec` can request `tty: true`; streaming/write/resize/terminate use an app-server `processId`. The documented OS PID for a background terminal can be nullable. | Current app-server documentation/source says one app-server process can hold a paginated thread open for writing; another owner gets `-32600` for conflicting resume/archive/delete operations while read-only requests remain available. This is a provider-level ownership guarantee for that surface. | The process API is experimental; plain `codex exec` is not the same caller contract. Terminating the app-server still needs an outer process-tree and worktree reconciliation policy. | [Codex app-server guide](https://developers.openai.com/codex/app-server), pinned [app-server README](https://github.com/openai/codex/blob/3ba0f711642a888aec92a611a3f3b2211157ff89/codex-rs/app-server/README.md), [process/terminal API documentation](https://developers.openai.com/codex/app-server#command-execution) |
| Claude Code headless/interactive | `-p/--print --output-format stream-json` emits newline-delimited events; `--verbose --include-partial-messages` adds real-time partial messages. Structured events may carry a `uuid` for event correlation/deduplication, and `system/init` may advertise interrupt capabilities. Hooks can expose transcript paths and events. | JSON output contains a session id; `--resume <session-id>`, `--continue`, and `--session-id` provide exact-id continuation/creation controls. Current docs say ID lookup reaches every project, but that behavior was added in v2.1.223; installed 2.1.218 predates it and must be verified/treated as current-project/worktree lookup only. Sessions are saved continuously to a local transcript by default. | No official event cursor/replay protocol was found. Event UUIDs correlate/deduplicate observed records but do not replay gaps. The default JSONL transcript is durable but documented as an internal format that can change; use export/script interfaces rather than treating it as a stable event API. | Interactive Ctrl-C cancels the current operation. From v2.1.212, SIGTERM in print/SDK mode aborts the turn, kills the process tree of a running Bash tool, runs `SessionEnd` hooks, and exits 143; this is not a durable handle that can be recovered after adapter loss. The `system/init.capabilities` array can advertise interrupt flags; observe it at runtime rather than assuming a version. | Official docs expose session/transcript identity, not a durable process handle that survives the invocation. `--tmux` is a launch convenience that requires a worktree and an available tmux. | Explicitly not guaranteed: resuming the same session in two ordinary terminals without `--fork-session` can interleave messages in one transcript. An adapter must enforce its own owner or fork. | `--no-session-persistence` disables resume; current docs' cross-project lookup wording does not describe installed 2.1.218; nested subagent forwarding requires v2.1.219 and is not an installed-version guarantee; direct transcript parsing is unsupported as a stable contract; SIGTERM cleans the running Bash tool's tree in print/SDK mode but supplies no durable process handle or replay cursor. | [Headless mode](https://code.claude.com/docs/en/headless), [2.1.212 changelog](https://code.claude.com/docs/en/changelog#2-1-212), [sessions](https://code.claude.com/docs/en/sessions), [CLI reference](https://code.claude.com/docs/en/cli-reference), [keybindings](https://code.claude.com/docs/en/keybindings), [troubleshooting](https://code.claude.com/docs/en/troubleshooting) |
| Claude Code background/agent view | `claude agents` shows state and recent activity; `claude agents --json` reports each active/background session's working directory, kind, state, and, while alive, PID/status. `claude logs <id>` reads recent output. | `claude --bg` creates a short background-job id; JSON listing can also expose the full resumable session UUID. `attach`, `respawn`, and ordinary `--resume` provide distinct background-process and conversation controls. | The documented shell surface exposes status and recent output, not an event cursor. The supervisor persists session state on disk and reconnects workers across supervisor restarts, but that is continuation rather than replay of a lost live stream. | `claude stop <id>`/`kill` stops one background session; `respawn <id>` starts its process again with the conversation intact. Detach leaves work running. The supervisor can be restarted while keeping workers. | JSON listing exposes the current PID while alive and a short background-job id, but neither is a provider-independent durable OS-process handle. `claude --bg --exec '<command>'` starts a PTY-backed shell job with attach/log/stop controls; its captured output is memory-only. A per-user supervisor owns workers. | Background sessions reject a second process that tries to open the same conversation because two processes cannot write the same transcript. This writer exclusion is specific to the agent-view supervisor surface; it does not change the ordinary two-terminal resume warning above. | Agent view is a research preview, shell-job output is removed shortly after exit, subagents/teammates are not separate rows, machine shutdown stops workers, and the current documentation has no immutable version pin. Installed 2.1.218 help exposes the commands, but authenticated background execution was not exercised. | [Agent view](https://code.claude.com/docs/en/agent-view), especially [shell controls and JSON fields](https://code.claude.com/docs/en/agent-view#manage-sessions-from-the-shell), [PTY-backed shell jobs](https://code.claude.com/docs/en/agent-view#run-a-shell-command), [supervisor behavior](https://code.claude.com/docs/en/agent-view#the-supervisor-process), and [writer exclusion](https://code.claude.com/docs/en/agent-view#opening-a-session-says-the-conversation-is-already-open) |
| OpenCode stable `run`/server (v1.14.44) | `opencode run --format json` emits live events tagged with `sessionID`; `opencode serve` exposes an HTTP API and global SSE event stream. | Session ids are persisted and can be listed, resumed, forked, exported, and imported. HTTP routes expose session status/messages/children/abort. | Stable `run` JSON events carry a timestamp and session id, not a sequence/cursor. The server SSE route sends live events with no replay id. The pinned v1.14.44 session route accepts a `before` cursor for durable message-history pagination, and its handler returns `X-Next-Cursor`; this is not live-event replay. The pinned development v2 session spec's `sessions.events({ after })` cursor is a separate, unreleased design and not a v1.14.44 guarantee. | `/session/:id/abort` calls the prompt cancellation service. A session can be resumed or forked through the API/CLI after observing its durable state. The stable source does not establish that abort drains every tool child. | Session execution has a process-local runner map, not a durable OS process handle. PTY subprocesses have a separate PID/control surface described below. | Same-server duplicate execution is rejected by a process-local `BusyError`; the source does not establish ownership across separate server processes, so do not treat the session id as a cross-process lock. | Live events may be lost during caller/server restart; the stable CLI event loop is live-only and its final-event draining behavior needs an adapter test; `run` does not expose a durable process id. | [CLI](https://opencode.ai/docs/cli/), [server](https://opencode.ai/docs/server/), [SDK](https://opencode.ai/docs/sdk/), pinned [`run` source](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/cli/cmd/run.ts), [`session routes`](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts#L38), [`session handler`](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts#L93), [`run-state` source](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/session/run-state.ts), [`SSE` source](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/server/routes/instance/httpapi/event.ts), [pinned v2 session draft](https://github.com/anomalyco/opencode/blob/65210f2d975afa8c2a05ebdc0c3296f30a9bbcc9/specs/v2/session.md) |
| OpenCode PTY endpoint | The pinned `/pty/:ptyID/connect` route upgrades to WebSocket and calls the PTY service's `connect`; it streams PTY text while the server owns the session. | PTY info includes id, command, cwd, status, and PID while the server process owns it. | A bounded in-memory text buffer supports a numeric cursor measured in JavaScript string code units (`chunk.length`), not bytes; `-1` starts at the current end. The cursor and buffer are process-local, and trimmed text cannot be recovered after the buffer limit. | PTY objects support write, resize, and kill. Server teardown removes/kills them. This is process control, not a semantic guarantee about the agent's turn or its descendants. | Uses `node-pty`; PID, resize, write, and kill are explicit. | The PTY id is not a durable cross-server session id and is not an exclusivity lock. | The buffer is bounded at `2 * 1024 * 1024` JavaScript string code units in the pinned source; the PTY disappears on exit/server teardown. A string cursor is not a structured event cursor. | Pinned [PTY service](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/pty/index.ts), [PTY WebSocket route](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts#L90), [PTY process source](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/pty/pty.node.ts) |
| tmux server/pane | Each pane has a PTY. `capture-pane` reads current/history lines and `pipe-pane` sends live pane output to a process. Control mode emits live `%output` notifications and command responses. | Session/window/pane ids and pane PID/path/TTY are queryable. The pinned manual says these IDs are unique and unchanged for the life of their tmux object in the tmux server; that is not a cross-server-restart identity. Pane PID is only the first process in the pane. | `capture-pane` replays bounded screen/history lines controlled by `history-limit`; control-mode output is live and has no durable event cursor. A slow control client can be discarded. | `send-keys -t <pane> C-c` injects terminal input. `kill-pane`/`kill-window` are stronger destruction controls. Neither is a semantic “safe turn interrupt” nor proof of descendant cleanup. Reattach gives interactive access to the same tmux pane. | PTY, pane PID, pane TTY, and exact target-pane ids are real controls/observations. | Not exclusive: multiple clients can attach to the same session and send input. tmux coordinates a shared session; it does not grant one external adapter ownership. | No tmux executable is installed here; history is bounded; pane PID is not a durable process-tree handle; pane output is terminal telemetry, not provider events. | [Pinned tmux manual/source](https://github.com/tmux/tmux/blob/e5a2058c7ca350cda9436720b4e76a2224b8681f/tmux.1), especially [`capture-pane`](https://github.com/tmux/tmux/blob/e5a2058c7ca350cda9436720b4e76a2224b8681f/tmux.1#L2790), [`pipe-pane`](https://github.com/tmux/tmux/blob/e5a2058c7ca350cda9436720b4e76a2224b8681f/tmux.1#L3732), [`send-keys`](https://github.com/tmux/tmux/blob/e5a2058c7ca350cda9436720b4e76a2224b8681f/tmux.1#L4430), [target ID lifetime](https://github.com/tmux/tmux/blob/e5a2058c7ca350cda9436720b4e76a2224b8681f/tmux.1#L923), and [pane formats/ids](https://github.com/tmux/tmux/blob/e5a2058c7ca350cda9436720b4e76a2224b8681f/tmux.1#L7393) |
| Current container/host shell | The current execution boundary gives ordinary pipes; a caller can allocate a PTY with `script` and inspect `/proc`, namespaces, cgroups, and `/dev/pts`. | **Local inference from the shell observation:** no container id, provider session id, or durable process registry is exposed to this shell. PID 1 is the shell in the current PID namespace. Docker's documented attach/exec handles are not present because those CLIs/APIs are unavailable here. | Pipes, `/proc`, and PTYs do not supply durable replay. Any retained output would be an outer adapter responsibility. | Signals can target a known PID/process group, but generic wrapper termination is not safe process-tree cleanup. No Docker/Podman/tmux control API is installed. | Linux exposes PTYs, PIDs, process groups, sessions, cgroup v2, and namespace boundaries. These are host observations, not an agent-runtime contract. | No exact-session exclusivity is available from the shell itself. | **Local inference:** the container's overlay filesystem and cgroup/namespace facts do not imply durable container identity, logs, attach, or restart semantics. Docker `attach`/`exec` capabilities are unavailable locally. | [Docker `attach`](https://docs.docker.com/reference/cli/docker/container/attach/), [Docker `exec`](https://docs.docker.com/reference/cli/docker/container/exec/), [Docker container isolation/lifecycle](https://docs.docker.com/engine/containers/run/), [Linux cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) |

The matrix deliberately separates Codex app-server from `codex exec`, and
OpenCode's PTY service from its agent session. An adapter must not lift a
capability from one surface and silently claim it for another.

## Findings by required capability

### Live observation is not replay

The strongest live provider streams are structured, but all four runtime
families have a boundary where live output can be lost:

- Codex `exec --json` gives structured JSONL and a thread id. Its top-level
  events have no replay cursor or event id, while each item has an id whose
  `item.started`/`updated`/`completed` lifecycle can correlate or deduplicate
  observations. That lifecycle id cannot recover a missing line. Codex
  app-server can read/resume provider-owned thread state and has paginated
  thread history, but the caller still needs to record `threadId` and
  correlate `turnId` before a crash.
- Claude Code can emit `stream-json` partial events and saves a JSONL transcript
  continuously. Where present, event `uuid` values are useful for correlation/deduplication,
  not replay. The transcript is documented as an internal implementation
  format, not a stable cursor protocol. `--resume` is an exact session
  continuation mechanism, not a stream replay API. The current docs' event and
  session behavior must be qualified against the installed 2.1.218 binary.
- OpenCode stable `run --format json` emits live events with a wall-clock
  timestamp and `sessionID`. Its global SSE has no event id/replay mechanism.
  The pinned v1.14.44 session route and handler accept a `before` cursor and
  return `X-Next-Cursor` for durable message pagination; neither reconstructs
  arbitrary live event bytes. The unreleased dev v2 session draft's
  `sessions.events({ after })` cursor is a separate design. Its PTY endpoint
  has a bounded JavaScript string/code-unit cursor only while that server-side
  PTY exists.
- tmux can recapture bounded terminal history with `capture-pane` and can pipe
  future output. Control mode output is live; a slow client can be discarded.
  Terminal lines are not provider events and have no cross-restart cursor.

Therefore a generic adapter may promise “live events observed while connected”
only when it records loss/closure explicitly. It should promise replay only
for a provider's documented durable history or a separately persisted outer
capture. A timestamp, line number, tmux pane, or PTY string/code-unit offset is
not by itself a durable event cursor.

### Identity has several independent layers

The useful identity fields do not collapse into one universal session id:

| Layer | Codex | Claude Code | OpenCode | tmux/container |
| --- | --- | --- | --- | --- |
| Provider conversation/session | `threadId`, with `turnId` for one turn | session UUID and transcript path | `sessionID` and persisted session record; child records are exposed by the pinned session route | none; tmux session is a terminal container, while the shell has only local PID/namespace observations |
| Live process/control handle | app-server `processId` for command APIs; plain `exec` exposes no durable PID | foreground/headless has no durable process handle; agent view exposes a short background id, current PID/status, and `attach`/`logs`/`stop`/`respawn`, but its PID is not durable | PTY id and PID; agent runner is process-local | pane id/TTY/PID; current shell can inspect Linux PIDs/groups |
| Filesystem/work boundary | app-server thread cwd/worktree; `exec --cd` | current directory/project and transcript project key | server instance/project/directory and session record | pane path; container mounts/filesystem |
| Outer invocation identity | must be assigned by Dalph | must be assigned by Dalph | must be assigned by Dalph | must be assigned by Dalph |

The adapter should record the provider handle, the exact working directory or
worktree, the launch mode/version, and the observed process/control handle when
one exists. It should not substitute a PID for a provider session, or a
provider session for an OS process.

### Safe interruption is an explicit provider operation when available

Codex app-server is the clearest control surface: `turn/interrupt` targets a
specific thread and turn, and `command/exec` process operations can terminate
an exact process. The implementation still has to observe the resulting turn
status and clean background terminals separately. The `codex exec` Ctrl-C path
uses this internal turn interrupt, but an outer caller that only kills the CLI
cannot assume the same outcome.

Claude's interactive Ctrl-C cancels the current operation. The current
headless documentation gives SIGTERM stronger semantics for `claude -p`: abort
the turn, terminate a running Bash command's process tree, run `SessionEnd`
hooks, and exit 143. The process still has to be live and known to the caller;
Claude exposes no durable process handle that an adapter can recover after it
loses the invocation. The current docs also describe a
`system/init.capabilities` array with interrupt flags that must be observed
rather than inferred from a version string. A lost headless process therefore
remains ambiguous until the session transcript and Git/worktree facts are
reconciled.

OpenCode exposes session abort and PTY kill separately. A session abort is not a
proof that every tool process exited; PTY kill is an OS-terminal operation, not
a provider turn status. The `run-state` busy map only protects concurrent runs
inside one server process.

tmux `send-keys C-c` is input injection. It is useful for an interactive
operator but does not establish that the foreground program handled it or that
children stopped. A disposable local probe demonstrated the related process
boundary: running a loop under `script`, sending `SIGTERM` only to the wrapper,
allowed the child to continue after the wrapper exited. Exact process-group or
provider-level control and a post-interruption observation are required.

Docker's official `attach` documentation also warns that Ctrl-C signal
behavior depends on the attached process and PID 1; attach is not a generic
process-tree cancellation protocol. The current shell has no Docker API to
exercise.

### Exact-session exclusivity is runtime-specific, not an identity property

- Codex app-server documents one writer for an open paginated thread and
  rejects conflicting ownership operations. This is the strongest exact-session
  exclusivity evidence found, and it applies to that app-server surface.
- Claude explicitly documents that two ordinary terminals resuming one session
  can interleave messages. The separate background-session supervisor refuses
  a second process that tries to open the same conversation. An adapter must
  not generalize that agent-view writer exclusion to ordinary `--resume`; it
  needs an outer ownership record/lock or a fork outside that surface.
- OpenCode's `BusyError` is a `Map<SessionID, Runner>` in one server process.
  A second server process has a separate map; source review found no
  cross-process lock. This is a source-based inference and needs a disposable
  multi-server experiment before being treated as a version-stable guarantee.
- tmux intentionally permits multiple clients to attach to one session. It is
  shared interactive state, not exclusive ownership.
- Docker permits multiple simultaneous attaches to one contained process. The
  attach connection is not a session lock.

No adapter should retry a session merely because its id is known. It must first
check the provider's ownership semantics, its own claim, and the durable
worktree/Git facts. When ownership is not guaranteed, a second invocation must
be treated as a possible duplicate, not as an automatic continuation.

### Nested subagents remain optional telemetry

Codex JSONL can report collaboration items containing sender/receiver thread
ids, and app-server clients can observe provider notifications. Claude's
`--forward-subagent-text` is documented from v2.1.211, while forwarding nested
subagent messages at every depth requires v2.1.219; the installed 2.1.218
binary therefore must not be assumed to provide the nested-depth behavior.
Agent view also states that subagents and teammates do not appear as separate
rows.
OpenCode emits task/tool-use parts, and its pinned v1.14.44 session routes
expose a `/session/:sessionID/children` query ([route](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts#L71),
[handler](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts#L78));
that exposes child-session metadata, not a unified nested live stream. These
surfaces are useful diagnostics, but none supplies a portable cross-runtime
child process/session/replay contract. tmux and container observations expose
terminal/process facts without provider-level parent-child meaning.

The generic adapter should therefore record nested observations when a provider
offers them, but should not require them for liveness, interruption, resume, or
completion classification.

## Minimal adapter promises and unsupported cases

The evidence supports a deliberately narrow common contract:

1. Before launching, record the intended working directory/worktree, runtime
   name/version, launch mode, and an outer invocation id.
2. After launch, record the provider session handle as soon as it is exposed;
   for app-server/PTY surfaces, also record the process/control handle when
   present. Treat any crash before that observation as a separate ambiguous
   case rather than inventing an id.
3. Persist live events as observations with source/runtime and loss/closure
   markers. Do not call a live stream replayable unless the runtime documents a
   durable cursor or the outer adapter has captured it durably.
4. Prefer a provider's exact interrupt/abort operation. If only terminal input
   or an OS signal is available, classify it as best-effort, then reread
   provider state and inspect the exact worktree/Git facts before retrying.
5. Require an explicit ownership decision for a resume. Provider ids alone do
   not imply exclusivity.

The following are unsupported or unsafe to promise as generic behavior:

- replaying lost Codex `exec`, Claude `stream-json`, OpenCode SSE, or tmux
  control-mode output from an unrecorded live connection;
- using a session id as a durable OS PID or process-tree handle;
- claiming ordinary Claude foreground/headless same-session exclusivity (or
  generalizing agent-view writer exclusion), OpenCode cross-server
  exclusivity, tmux exclusivity, or Docker attach exclusivity;
- claiming `Ctrl-C`, `send-keys C-c`, wrapper termination, or PTY kill means all
  agent descendants have stopped;
- parsing Claude's internal transcript JSONL as a stable cross-version event
  protocol;
- treating tmux screen history as structured provider events;
- treating the current container's overlayfs/cgroup/namespace facts as a
  durable container identity or as evidence that Docker attach/exec/log APIs
  are available;
- requiring nested subagent output for a cross-runtime adapter;
- treating Codex app-server's experimental process APIs as a capability of
  plain `codex exec`.

## Disposable environment observations

These observations characterize the current execution substrate, not a
provider guarantee. They were checked on 2026-08-18:

| Observation | Result | Consequence |
| --- | --- | --- |
| Host/kernel | Linux `aarch64`, kernel `7.0.14-orbstack-00380-ga7e0a2dc9535` | A Linux process/PTY adapter is plausible, but host identity is not a Dalph session id. |
| Normal command pipe | Child stdin/stdout are not TTYs | Interactive runtimes need an explicit PTY allocation or a documented headless mode. |
| PTY allocation | `script -qefc ...` produced a child with a `pts/*` TTY, its own SID/PGID, and TTY-backed stdin/stdout | PTY scraping is possible, but it introduces wrapper/process-group cleanup obligations. |
| Wrapper signal probe | Sending `SIGTERM` only to `script` let the wrapped child continue after the wrapper exited; the child was then killed by its exact PID | Killing a launcher/wrapper is not safe process-tree interruption. |
| tmux/Docker tools | `tmux`, `docker`, `podman`, and `socat` are absent | Their documented capabilities are not locally available to an adapter without an explicit dependency or provider boundary. |
| Linux process boundary | PID, mount, IPC, UTS, and network namespaces are present; cgroup v2 is mounted read-only with `cpu`, `io`, `memory`, `pids`, and related controllers visible | Namespace/cgroup observations can aid diagnostics, but no durable session/control API is implied. |
| OpenCode session probe | `opencode session list --format json --max-count 1` returned no sessions | No authenticated provider run was created; the source audit remains the evidence for behavior. |

No provider task was run. The local signal probe is intentionally narrow: it
shows why a generic wrapper kill cannot be advertised as safe descendant
cleanup; it does not characterize any agent's own signal handling.

## Sources and revision pins

Primary issue and product documentation:

- [Dalph issue #5](https://github.com/dearlordylord/dalph/issues/5)
- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
- [Codex app-server](https://developers.openai.com/codex/app-server)
- [Claude Code headless mode](https://code.claude.com/docs/en/headless)
- [Claude Code agent view](https://code.claude.com/docs/en/agent-view)
- [Claude Code changelog](https://code.claude.com/docs/en/changelog#2-1-212)
- [Claude Code sessions](https://code.claude.com/docs/en/sessions)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code keybindings](https://code.claude.com/docs/en/keybindings)
- [Claude Code troubleshooting](https://code.claude.com/docs/en/troubleshooting)
- [OpenCode CLI](https://opencode.ai/docs/cli/)
- [OpenCode server](https://opencode.ai/docs/server/)
- [OpenCode SDK](https://opencode.ai/docs/sdk/)
- [Docker `attach`](https://docs.docker.com/reference/cli/docker/container/attach/)
- [Docker `exec`](https://docs.docker.com/reference/cli/docker/container/exec/)
- [Docker container run/isolation](https://docs.docker.com/engine/containers/run/)
- [Linux cgroup v2 administration guide](https://docs.kernel.org/admin-guide/cgroup-v2.html)

Pinned source:

- [Codex 0.148.0 source at `3ba0f711642a888aec92a611a3f3b2211157ff89`](https://github.com/openai/codex/tree/3ba0f711642a888aec92a611a3f3b2211157ff89)
  ([exec CLI](https://github.com/openai/codex/blob/3ba0f711642a888aec92a611a3f3b2211157ff89/codex-rs/exec/src/cli.rs),
  [exec events](https://github.com/openai/codex/blob/3ba0f711642a888aec92a611a3f3b2211157ff89/codex-rs/exec/src/exec_events.rs),
  [exec lifecycle](https://github.com/openai/codex/blob/3ba0f711642a888aec92a611a3f3b2211157ff89/codex-rs/exec/src/lib.rs),
  [app-server README](https://github.com/openai/codex/blob/3ba0f711642a888aec92a611a3f3b2211157ff89/codex-rs/app-server/README.md)).
- [OpenCode v1.14.44 source at `0f8e98e10f130d12df9b52b7c97bd25b00fd6362`](https://github.com/anomalyco/opencode/tree/0f8e98e10f130d12df9b52b7c97bd25b00fd6362)
  ([run command](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/cli/cmd/run.ts),
  [session routes](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts),
  [session handler](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts),
  [run-state](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/session/run-state.ts),
  [SSE events](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/server/routes/instance/httpapi/event.ts),
  [PTY service](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/pty/index.ts),
  [PTY WebSocket route](https://github.com/anomalyco/opencode/blob/0f8e98e10f130d12df9b52b7c97bd25b00fd6362/packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts)).
- [tmux source/manual at `e5a2058c7ca350cda9436720b4e76a2224b8681f`](https://github.com/tmux/tmux/tree/e5a2058c7ca350cda9436720b4e76a2224b8681f)
  ([manual](https://github.com/tmux/tmux/blob/e5a2058c7ca350cda9436720b4e76a2224b8681f/tmux.1),
  [target ID lifetime](https://github.com/tmux/tmux/blob/e5a2058c7ca350cda9436720b4e76a2224b8681f/tmux.1#L923)).
- [OpenCode v2 session draft at `65210f2d975afa8c2a05ebdc0c3296f30a9bbcc9`](https://github.com/anomalyco/opencode/blob/65210f2d975afa8c2a05ebdc0c3296f30a9bbcc9/specs/v2/session.md) — development-only `after` event/history cursors, not the installed v1.14.44 contract.

## Uncertainties and follow-up experiments

- No authenticated task run was started for any provider. Live reconnect,
  dropped-event recovery, interrupt timing, and resume-after-crash behavior
  therefore remain untested here.
- Claude Code's documentation is authoritative for its public contract, but
  the pages have no immutable source revision and the installed binary is
  2.1.218. The current docs describe cross-project session-id lookup from
  v2.1.223, nested subagent forwarding from v2.1.219, and interrupt capability
  flags from v2.1.205; the installed version predates the first two thresholds.
  A live `system/init` observation is needed before relying on UUIDs,
  capabilities, or nested-forwarding behavior. The closed CLI also prevents a
  source audit of child process cleanup, transcript writes, and exact interrupt
  ordering.
- OpenCode's process-local `run-state` map and live-only SSE behavior are
  source findings for v1.14.44. A disposable multi-server test should verify
  whether a newer release adds a cross-process lock. The stable `run` source's
  asynchronous event loop also deserves a focused test for final-event drain;
  this note records the risk rather than claiming a reproduced bug. The
  v1.14.44 `before` cursor is source-verified message pagination; the v2
  `after` event/history cursor remains an unreleased draft.
- The OpenCode PTY cursor is source-verified as a bounded JavaScript string
  code-unit offset (`chunk.length`), not a byte offset; a WebSocket route
  exposes it only while the server-side PTY exists.
- Codex source is pinned to the installed 0.148.0 release commit. The matching
  source path was rechecked, including item lifecycle ids and app-server
  pagination/interrupt/process behavior.
- The Codex app-server ownership rule is documented for its paginated thread
  lifecycle. It should not be generalized to all Codex CLI invocations or to
  an outer worktree claim.
- tmux and Docker behavior is source/documentation evidence only on this host;
  a future adapter test needs the tools installed in a disposable environment.
- The container observations identify Linux primitives but not the enclosing
  orchestration provider. A durable container id, cgroup kill policy, or log
  backend must be supplied explicitly if an adapter depends on it.

The safe conclusion for issue #5 is therefore capability-specific: persist
provider session ids and exact work boundaries, capture live observations with
loss markers, use provider-native interruption when available, reconcile after
ambiguous outcomes, and advertise replay, process control, and exclusivity only
where the particular runtime proves them.
