# Codex CLI executor integration research

Status: retained research input. It is not itself an executor specification,
architecture decision, or provider taxonomy. The later accepted decision in
[`issue-219-codex-app-server-executor.md`](../docs/scenarios/issue-219-codex-app-server-executor.md)
selects app-server from the compared surfaces without adopting the other
candidates or their policies.

Evidence checked: 2026-08-13. This artifact changes no Dalph runtime behavior;
it records source-visible implementation choices and gaps for a later executor
design.

## Question and working hypothesis

The immediate question was how Dalph could launch and observe an unattended
Codex implementation while keeping the outer executor generic. The initial
working hypothesis was deliberately small:

> Dalph starts one fresh `codex exec` CLI process for one planned attempt. The
> process inherits the user's ambient Codex installation, authentication,
> configuration, instructions, and other harness choices. Dalph supplies the
> task prompt and worktree boundary, then observes the process and its exposed
> output.

“Fresh process” and “fresh Codex conversation/thread” are different claims. A
new CLI process can start a new thread, or it can use `codex exec resume` with a
Codex-owned thread id. The latter is not implied by the hypothesis and remains
an unresolved choice below.

That initial hypothesis did not prescribe a skill, review loop, subagent topology,
provider routing, model, or inner journal. Codex may load whatever the user
has made available in the ambient environment; Dalph neither injects nor
interprets those choices at this boundary.

## Evidence boundary

The source links below are the primary sources used for this comparison.
Codex source links are pinned to the current `openai/codex` main commit
[`990218bbbd5cb4bb5aafd646c56461dfb2f95d17`](https://github.com/openai/codex/tree/990218bbbd5cb4bb5aafd646c56461dfb2f95d17),
Symphony to
[`8001b52e3062495a16e520e4ceaf8f9de868c4d0`](https://github.com/openai/symphony/tree/8001b52e3062495a16e520e4ceaf8f9de868c4d0),
Agent Kanban to
[`a26bef6e4f657ed8217eca79b0b90a3a1a8ac198`](https://github.com/saltbo/agent-kanban/tree/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198),
and the first-party Codex Action to
[`c385816875cc2fc8e033ed9d1cba96f8c331210e`](https://github.com/openai/codex-action/tree/c385816875cc2fc8e033ed9d1cba96f8c331210e).
Current product documentation is linked at its canonical OpenAI URL where a
versioned source file does not exist.

The conclusions below distinguish source facts from inferences. A tool's
implementation is evidence that a surface is usable; it is not a Dalph policy
or an endorsement of the tool's permissions and orchestration choices.

## What `codex exec` exposes

The [Codex non-interactive mode
guide](https://developers.openai.com/codex/noninteractive) describes
`codex exec` as the non-TUI command for scripts and CI. In normal output,
progress is sent to stderr and the final message is sent to stdout. A prompt
may be positional, or stdin may provide it when no prompt argument is given.
The CLI accepts `--cd` for the working directory and, unless explicitly
disabled, reads the user's normal Codex configuration. The same guide documents
`--ignore-user-config` and `--ignore-rules` as opt-out controls, not as
requirements for automation.

The current CLI declaration makes the relevant output and lifecycle options
visible in [`codex-rs/exec/src/cli.rs`](https://github.com/openai/codex/blob/990218bbbd5cb4bb5aafd646c56461dfb2f95d17/codex-rs/exec/src/cli.rs):

| Surface | What it provides | What it does not prove |
| --- | --- | --- |
| Plain `codex exec` | One non-interactive process; final text on stdout and progress/diagnostics on stderr. | That the requested Git change exists, is based on the planned base, passed verification, or is acceptable to Dalph. |
| `--json` (the source also accepts the `--experimental-json` spelling) | JSONL events including `thread.started`, `turn.started`, `item.*`, `turn.completed`, `turn.failed`, and `error`. `thread.started` exposes a Codex thread id; command, file-change, message, MCP, and other item observations can be streamed. See [`exec_events.rs`](https://github.com/openai/codex/blob/990218bbbd5cb4bb5aafd646c56461dfb2f95d17/codex-rs/exec/src/exec_events.rs). | A provider thread id is not a Dalph `(RunId, AttemptId)`, and an agent message or command item is not Git/evidence authority. |
| `--output-last-message FILE` / `-o FILE` | Writes the final Codex message to a path when the exec run reaches its shutdown path. The process still has its ordinary output stream. | The existence of a file is not proof of successful completion; a crash, missing final message, stale file, or unreadable path needs explicit classification. |
| `--output-schema FILE` | Constrains the final response to a supplied JSON Schema. The guide's example uses it with `-o` so a caller can read a machine-shaped final response. | Schema-valid text is a declaration made by Codex. It is not proof that a claimed commit, test result, or file change is true. Git and evidence boundaries still need their own observations. |
| `--ephemeral` | Avoids persisting the Codex session rollout files for that run. | It also removes one possible source of provider-owned continuation state; it does not make filesystem changes or an outer report durable. |
| `exec resume <SESSION_ID>` / `exec resume --last` | Starts a new CLI invocation against a persisted Codex session. | It requires durable Codex session data and a known provider id. It is not a generic Dalph resume protocol. |

The source implementation confirms that the JSONL stream is an execution
observation rather than a durable outer report. [`event_processor_with_jsonl_output.rs`](https://github.com/openai/codex/blob/990218bbbd5cb4bb5aafd646c56461dfb2f95d17/codex-rs/exec/src/event_processor_with_jsonl_output.rs)
tracks the final agent message and emits event lines; it writes the requested
last-message file during terminal output handling. [`lib.rs`](https://github.com/openai/codex/blob/990218bbbd5cb4bb5aafd646c56461dfb2f95d17/codex-rs/exec/src/lib.rs)
also shows that the exec command uses Codex's in-process app-server machinery
under the CLI surface. That internal fact does not turn `codex exec` into a
long-lived app-server protocol for its caller.

The non-interactive guide says the default sandbox and permission behavior can
be changed with CLI options. Which mode is appropriate for Dalph is not
settled here: forcing a mode would be a policy choice about the user's
ambient harness, while blindly inheriting a permissive ambient configuration
has an obvious safety cost. This research does not choose either.

## Current official surfaces compared

| Surface | Launch/control shape | Input and output | Interruption, resume, and cleanup | Fit with the working hypothesis |
| --- | --- | --- | --- | --- |
| Raw `codex exec` | Parent spawns one `codex exec` child with a cwd and inherited environment. Prompt is an argument or stdin. | Plain final text, or JSONL with `--json`; optional final-message file and output schema. | Parent owns the child handle and waits for exit. Resume is a separate CLI invocation using Codex session state. No documented `codex exec` request equivalent to app-server `turn/interrupt`; killing a child is not by itself proof of safe suspension or complete descendant cleanup. | Closest to the hypothesis and smallest surface. |
| Raw `codex exec --json` plus `-o` | Same child process; parent parses lines and may keep a final-message file. | Structured progress/events and a final file can be captured without inventing an inner protocol. | Same process-loss and cleanup limits as raw exec; the JSONL thread id is optional provider metadata, not outer identity. | Plausible observability variant, but event-to-report rules remain to be accepted. |
| Raw `codex exec --output-schema` | Same child process; caller supplies a temporary or checked-in schema file. | Final response is constrained to JSON; progress still needs the ordinary stream if desired. | Temporary schema/output files become resources with exact cleanup/disposition obligations. | Possible report-shape aid, but not needed to establish Git/evidence truth and may be unnecessary for the naive MVP. |
| Official TypeScript Codex SDK | `Codex.startThread()` / `resumeThread()` then `thread.run()` or `runStreamed()`. The pinned SDK implementation itself spawns `codex exec --experimental-json` and pipes the prompt. | Typed `ThreadEvent` stream; `run()` returns items, `finalResponse`, and usage. | `AbortSignal` is passed to the spawned child. Thread continuation is via persisted Codex session id. The SDK cleans its temporary output-schema file but does not define a Dalph process-tree or report protocol. | A convenient wrapper around raw exec, not a different execution authority. It adds package/version and binary-resolution choices. |
| Official Python Codex SDK | Controls a local Codex app-server over JSON-RPC; supports thread start/run and continuation. | Typed Python client responses/events. | App-server semantics are available, but the caller still owns the app-server process and workspace cleanup. | More machinery than the working hypothesis requires; useful if Python is already the host boundary. |
| Codex app-server | Parent launches `codex app-server` (normally stdio JSONL) and speaks JSON-RPC 2.0. `thread/start`, `turn/start`, and streamed item events are the core. | Requests/notifications with explicit thread and turn ids; generated TypeScript/JSON schemas are available. | `turn/interrupt` is an explicit protocol operation; `thread/resume` resumes a stored thread; parent still needs to close/kill the process and account for descendants. | Stronger control and observability, but it expands the MVP boundary from one command to a stateful protocol. |
| Responses API / Agents SDK | Caller talks to the hosted Responses API or runs an Agents SDK loop. Background responses return a response id and are polled. | API response objects, streamed events, structured output, server-managed conversation state, and (in Agents SDK) tool/sandbox abstractions. | Hosted state can outlive the caller, but local Git workspace access, credentials, tools, and state are separately configured. | Not equivalent to inheriting the user's local Codex CLI harness; an alternative executor family, not the current MVP implementation. |

### TypeScript SDK details

The [official Codex SDK guide](https://developers.openai.com/codex/sdk)
describes the TypeScript library as a programmatic interface for local Codex
threads. In the pinned implementation,
[`sdk/typescript/src/exec.ts`](https://github.com/openai/codex/blob/990218bbbd5cb4bb5aafd646c56461dfb2f95d17/sdk/typescript/src/exec.ts)
constructs an `exec` command, inherits `process.env` unless its caller passes
an override, writes the prompt to stdin, reads JSONL stdout, accumulates
stderr, waits for child exit, and rejects on a non-zero exit or signal.
[`thread.ts`](https://github.com/openai/codex/blob/990218bbbd5cb4bb5aafd646c56461dfb2f95d17/sdk/typescript/src/thread.ts)
maps `thread.started` and `turn.*` events into typed results, supports an
`AbortSignal`, and can create/delete a temporary output-schema file.

[`codex.ts`](https://github.com/openai/codex/blob/990218bbbd5cb4bb5aafd646c56461dfb2f95d17/sdk/typescript/src/codex.ts)
exposes `startThread()` and `resumeThread(id)`. The source comments and
implementation use Codex's session storage under `~/.codex/sessions`; the
SDK's “thread” abstraction therefore does not mean that one OS process remains
alive across calls. A later `run()` can spawn another CLI child and resume the
provider-owned session.

This distinction matters for Dalph: adopting the SDK would simplify event
parsing, but it would not remove the need to decide what a process death,
abort, stale session id, output-schema failure, or missing final message means
for the outer planned attempt.

### App-server details

The [official app-server guide](https://developers.openai.com/codex/app-server)
describes app-server as the rich-client/deep-integration surface and points
automation/CI users toward the SDK. Its transport is JSONL over stdio by
default, with other transports documented as experimental or optional. The
guide's Node example spawns `codex app-server`, sends `initialize`,
`thread/start`, and `turn/start`, then reads notifications from stdout.

The protocol documents `turn/interrupt`, whose successful response is empty
and whose eventual turn status is `interrupted`, and `thread/resume`, which
takes a recorded Codex thread id. The generated protocol includes additional
thread, terminal, approval, and cleanup operations. These are real controls,
but they are controls of Codex's session/process protocol, not evidence that a
planned attempt has reached a Dalph safe boundary.

### Session-id timing and the harmless pre-turn prefix

The current public protocol does not let a caller choose a deterministic
Codex thread id. `thread/start` generates the id and returns it in the
response. The JSON-RPC request id correlates that response; it is not the
thread's identity or an idempotency key.

App-server nevertheless exposes a useful ordering boundary because
`thread/start` and `turn/start` are separate requests. A future adapter could:

1. record that it intends to establish the private Codex session for one exact
   planned attempt;
2. call `thread/start` in the exact worktree supplied by Dalph;
3. durably associate the returned Codex thread id with that attempt; and
4. only then record and send the first `turn/start` request.

If the adapter dies before step 3, it has not authorized a Codex turn, model
request, or task tool call. It may abandon that empty thread and create
another. This is a deliberately narrower claim than “nothing happened”:
`thread/start` initializes the Codex session, including ambient configuration,
instructions, session-start hooks, and MCP setup, so those startup mechanisms
may have run. The repeat is harmless with respect to the task turn, but an
accepted implementation must still define what it assumes about ambient
startup side effects.

A local probe against the installed Codex CLI 0.147.0 used a fresh temporary
`CODEX_HOME`, called `thread/start` without `turn/start`, stopped app-server,
and launched a second app-server over the same home. The first call returned
an idle thread id. Both `thread/read` and `thread/resume` in the second process
reported that no stored rollout existed. This is empirical evidence for one
current build, not a compatibility guarantee, but it supports treating an
unmaterialized pre-turn thread as disposable.

The rule changes after step 4. Once `turn/start` may have crossed the process
boundary, Codex may have made model requests, called tools, or changed the
worktree. Losing the response is an ambiguous outcome, not evidence that no
work ran. The adapter must retain the known thread id and reconcile through
`thread/read`/`thread/resume`; an unavailable, unreadable, or contradictory
session must fail closed through the generic executor projection instead of
silently launching replacement work.

Raw `codex exec --json` does not provide the same durable handshake. Its
implementation emits `thread.started` after creating the thread and then
continues directly into the first turn; it does not wait for Dalph to
acknowledge or durably record the id. A parent crash after Codex writes the
event but before Dalph records it can therefore lose the id while the task
turn proceeds. The user's proposed retry rule is exact with app-server's
explicit pre-turn boundary, not with an unmodified one-shot `codex exec`.

## Source-visible integrations

### Symphony: app-server process and turn protocol

OpenAI's [Symphony `app_server.ex`](https://github.com/openai/symphony/blob/8001b52e3062495a16e520e4ceaf8f9de868c4d0/elixir/lib/symphony_elixir/codex/app_server.ex)
is a concrete first-party integration. It starts a local `codex app-server`
through an Erlang port (or an SSH-backed port remotely), sets the workspace as
the process cwd, performs `initialize` and `thread/start`, and sends
`turn/start` for prompts. It consumes JSON-RPC notifications until
`turn/completed`, `turn/failed`, or cancellation, handling Codex approval and
user-input requests along the way. The runner can issue multiple turns on the
same app-server thread and then closes the port in `stop_session`.

This is evidence for the app-server surface's viability. It also shows the
additional lifecycle decisions an app-server integration owns: remote/local
process launch, per-workspace session setup, turn continuation, approval
callbacks, and port closure. Closing the port is not itself a source-level
proof that every descendant command has stopped, and Symphony's multi-turn
runner is not a requirement for Dalph's one-process MVP. See
[`agent_runner.ex`](https://github.com/openai/symphony/blob/8001b52e3062495a16e520e4ceaf8f9de868c4d0/elixir/lib/symphony_elixir/codex/agent_runner.ex)
for the runner-level loop and cleanup call.

### Agent Kanban: TypeScript SDK integration

Agent Kanban's pinned Codex provider is a concrete user of the official SDK:
[`packages/cli/src/providers/codex.ts`](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/providers/codex.ts).
It constructs `new Codex(...)`, chooses `startThread` or `resumeThread`, uses
`runStreamed`, captures the `thread.started` id as a resume token, maps native
events to its own provider events, and passes an `AbortSignal`. It also reads
Codex session files for history. Its provider options explicitly select
`danger-full-access` and `approvalPolicy: "never"`; those are integration
choices, not defaults Dalph should copy. Its general provider interface keeps
process spawning, signals, and abort behavior behind a provider boundary; see
[`providers/types.ts`](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/providers/types.ts).

### Codex Action: direct CLI, final file, schema, and cleanup

OpenAI's first-party [Codex Action](https://github.com/openai/codex-action/blob/c385816875cc2fc8e033ed9d1cba96f8c331210e/action.yml)
is a concrete raw-spawn integration. Its helper
[`runCodexExec.ts`](https://github.com/openai/codex-action/blob/c385816875cc2fc8e033ed9d1cba96f8c331210e/src/runCodexExec.ts)
reads an inline/file prompt, creates a temporary final-output file when one
was not supplied, optionally materializes an inline schema, then invokes
`codex exec --skip-git-repo-check --cd ... --output-last-message ...` with a
copied environment. It waits for the child to close, reads the final-message
file, publishes the action output, and removes temporary output/schema
directories. The action separately installs/configures Codex and a Responses
API proxy, applies GitHub-specific safety strategy, and may select a sandbox or
permission profile; those surrounding policies are not part of the naive
ambient-process hypothesis.

The Action is useful evidence for an implementation shape—prompt on stdin,
cwd, final file, optional schema, child exit, and temporary-file cleanup. Its
source does not define a general process-tree cleanup proof or a Dalph
safe-suspension report.

## Hosted API and Agents SDK are alternatives, not local CLI variants

The [OpenAI background-mode guide](https://developers.openai.com/api/docs/guides/background)
shows a Responses API request with `background: true`, a returned response
status/id, and polling through `responses.retrieve` until a terminal status.
The [Agents SDK guide](https://developers.openai.com/api/docs/guides/agents)
describes a code-first agent loop whose server owns deployment/tool/state
choices; the Agents SDK uses the Responses API by default. These surfaces can
be useful for a different executor implementation, but they do not launch a
local `codex` binary in the user's cwd and do not automatically inherit the
user's `~/.codex` configuration or local harness.

A hosted response can therefore report that a model/API operation reached a
terminal API state. It does not, without separately configured local or
hosted workspace tools and evidence boundaries, prove a Git commit or a Dalph
accepted result. This is a capability distinction, not a judgment about which
surface is better.

## Truthful mapping to the outer planned-attempt boundary

Dalph's existing boundary is intentionally opaque. The relevant contract is
[`PlannedAttemptExecutor`](../packages/contracts/src/executor.ts): one exact
`(RunId, AttemptId)` correlation; a `Running`, `SafelySuspended`, or `Terminal`
report; and a projection that may be `Exact`, `NoReport`, temporarily
unavailable, unreadable, or contradictory. The contract says safe suspension
proves that no executor-owned activity remains running and that the same
attempt can resume. The executor's inner process/session identity is not an
outer identity.

The following is a mapping of observations that an adapter *could* make. It
is not an accepted report protocol.

| Outer concern | Observation available from a naive CLI adapter | Truthful boundary and gap |
| --- | --- | --- |
| Start one exact attempt | Spawn one child in the planned worktree, pass the attempt prompt, and associate the child with the outer correlation in process-local state. | The child PID and Codex `thread_id` are substrate observations. Neither replaces the outer `(RunId, AttemptId)` nor proves that the task began in the intended Git state. |
| `Running` | Child is alive and stdout/stderr/JSONL can still be read. | Running means only that the executor still owns active work. A `thread.started` event is useful evidence but not a report by itself. |
| `Terminal / Completed` | Child exits successfully and the adapter has an accepted interpretation of its final output. | Exit 0 and a final message mean Codex finished its invocation. They do not prove Git lineage, tests, evidence sealing, or target acceptance. The adapter may only report `Completed` if its future contract says that process-level completion is sufficient for that result. |
| `Terminal / Failed` | Non-zero exit, `turn.failed`, malformed protocol, missing required final output, or a typed launcher failure. | Exact classification needs a future contract. A failure message must not be turned into a successful completion merely because files changed. |
| `Terminal / Accepted` | Not supplied by `codex exec` alone. | Current `Accepted` requires an accepted commit and evidence manifest. A Codex final JSON object that claims a SHA is not Git/evidence proof; Git and the evidence store must establish those facts at their own boundaries. |
| `SafelySuspended` | App-server has an explicit `turn/interrupt`; raw exec has only caller-controlled process interruption/termination. | `turn/interrupt` reports an interrupted Codex turn, but Dalph still needs proof that no process/command remains owned and that continuation is possible. A signal or `child.kill()` alone must not be called safe suspension. |
| Projection after process death | If no durable adapter report exists, return `NoReport` or another explicitly unavailable/unreadable projection according to the future adapter contract. | Process disappearance, a stale output file, a surviving worktree change, or a missing session file is not completion. The outer architecture explicitly forbids inferring a terminal result from process loss. |

The separation between Codex output and Git/evidence is important even if an
output schema is adopted. For example, a schema might require
`{"commit":"...","tests":"passed"}`. Parsing that object can make the
adapter's declaration well-formed; it cannot establish that the named commit
exists in the exact worktree, descends from the planned base, or has the test
artifact and evidence manifest Dalph requires. A later Git/evidence protocol
must reread and seal those facts.

## Process loss, restart, and cleanup limits

### What can survive

Depending on options and timing, the following may survive a Dalph process
loss:

* files Codex already changed in the worktree;
* Codex's default session rollout files, if the run was not `--ephemeral` and
  the CLI reached a point at which it wrote them;
* an explicitly chosen output or schema file;
* a journaled outer intent, if Dalph wrote it before launching the child.

None of these is automatically a terminal executor report. The output file is
an artifact whose owner, freshness, and cleanup disposition must be known. A
Codex session file is provider-owned state, not Dalph's workflow journal. A
worktree diff is a Git observation, not a proof that the attempt completed.

### What a restart can and cannot infer

The outer architecture requires a restart to continue the same planned
attempt, not silently create a replacement attempt. A raw fresh `codex exec`
can be launched in the same exact worktree, but without a provider resume id it
does not carry the prior conversational context. Conversely,
`codex exec resume`, the TypeScript SDK's `resumeThread`, or app-server's
`thread/resume` can carry Codex context only when the provider session exists
and its id is known. The adapter would then need a durable place to retain and
reconcile that provider-specific id, while still treating it as implementation
state rather than outer identity.

`--ephemeral` makes the latter recovery path intentionally unavailable. The
default persistent session path makes it possible but does not make it
reliable after an arbitrary crash, deletion, configuration change, or version
change. This is why “one fresh process” should not be silently expanded into a
promise of “resume the same Codex thread.”

### Cleanup limits

At minimum, a process adapter owns stdin closure, stdout/stderr readers,
temporary schema/output files, and the direct child handle. It must await the
child's exit before calling the run terminal, and it needs an exact disposition
for each temporary artifact on success, failure, interruption, and crash.

The TypeScript SDK and Codex Action demonstrate direct child spawning and
temporary-file cleanup. Neither source establishes a portable process-group
or descendant cleanup proof. Codex can execute shell/file tools, and an
adapter's `AbortSignal`, port close, or child signal may not by itself prove
that every process it caused has stopped. App-server's `turn/interrupt` gives a
cooperative protocol-level interruption and a final interrupted turn status,
but it does not remove the caller's responsibility to observe process exit and
dispose the workspace/process resources it owns.

Therefore, “the Codex process was interrupted” and “the planned attempt is
safely suspended” cannot be treated as synonyms without a future executor
protocol that proves both no owned activity remains and resumability. This is
the central gap between the raw CLI MVP and the outer `SafelySuspended`
report.

## Compared implementation shapes

These were options considered before issue 219 selected app-server. They remain
useful comparison evidence and do not become alternate configured modes.

### A. Raw `codex exec` child

The smallest adapter would:

1. receive one exact planned attempt and its worktree path;
2. spawn `codex exec` with that cwd (or `--cd`), pass the prompt through stdin,
   and inherit the ambient environment;
3. retain the direct child handle and capture stdout/stderr;
4. expose a process-local `Running` observation while the child is alive;
5. wait for exit, classify the result under an accepted contract, and clean
   owned temporary resources.

This preserves the user's chosen Codex harness and introduces no Dalph skill,
review, subagent, or provider topology. It leaves structured output,
cooperative suspension, thread resume, and post-crash continuation unresolved.

### B. Raw child plus JSONL and/or final-message file

The same process shape can add `--json`, `--output-last-message`, and possibly
`--output-schema`. JSONL gives progress and terminal event observations;
`-o` gives a simple final-message artifact; a schema can make that final
message machine-readable. The additional options do not solve Git/evidence
authority, safe suspension, or process-tree cleanup. They also add malformed
output, stale-file, schema-temporary-file, and cleanup cases to the adapter.

### C. Official TypeScript SDK wrapper

The SDK removes hand-written JSONL parsing and offers `runStreamed`, final
responses, usage, `AbortSignal`, and provider thread continuation. At the
pinned source it still starts a `codex exec` child for each run, so the MVP's
ambient-process model remains recognizable. The tradeoffs are a dependency on
SDK/CLI version compatibility, SDK binary resolution, provider session-id
storage, and SDK-specific abort semantics.

### D. App-server protocol

Launching `codex app-server` gives explicit JSON-RPC initialization, thread and
turn ids, streaming, `turn/interrupt`, and `thread/resume`. It is the strongest
candidate if Dalph must prove cooperative interruption or multiple turns, but
it expands the adapter to a stateful protocol and still requires outer process
and resource cleanup. It is not necessary merely to prove that one raw
non-interactive Codex process can edit a worktree.

### E. Responses API / Agents SDK

This is a separate hosted execution shape with API credentials, model/tool
configuration, and server-managed response state. Background polling can
survive the local caller, but local repository access and Git/evidence proof
must be designed separately. It should not be described as the implementation
of the ambient Codex CLI hypothesis.

## Decisions left to the implementation tickets

Issue 219 selected app-server, persistent attempt threads, and the ambient user
harness. The focused implementation tickets still have to materialize and
qualify the following details without changing generic Dalph semantics.

1. **Protocol encoding:** generated app-server types versus a narrow checked
   JSON-RPC codec and how protocol-version compatibility fails closed.
2. **Executable selection:** PATH-discovered `codex`, a package/bundled binary,
   or an explicit configured path; required version compatibility and upgrade
   behavior.
3. **Ambient configuration boundary:** whether Dalph passes all ambient
   configuration unchanged, and which security/permission override (if any)
   is required by an accepted operational scenario.
4. **Output contract:** which app-server turn/item observations are needed for
   a normalized report and how missing or malformed terminal output is
   classified.
5. **Suspension contract:** how app-server `turn/interrupt`, terminal-session
   observation, and execution-substrate process evidence together prove
   no command/process remains owned.
6. **Resume mechanics:** where the private attempt-thread association is
   retained and what exact Codex observations distinguish absent, unreadable,
   stale, active, safely suspended, and terminal thread state.
7. **Cleanup contract:** direct child versus process group/descendants,
   temporary schema/output files, durable Codex rollout files, worktree locks,
   and exact recoverable/fail-closed dispositions on each crash point.
8. **Report timing and durability:** when `Running` is exposed, when terminal
   output is considered observed, and how Dalph handles a crash after Codex
   exits but before the outer report is durably recorded.
9. **Evidence boundary:** how Git rereads the worktree/ref and how an evidence
   manifest is sealed before any `Accepted` result is possible. A Codex claim
   about a commit is not enough.
10. **Host integration:** whether the eventual adapter is implemented with
    Effect's process service, the official SDK, or another wrapper. This is an
    implementation choice behind `PlannedAttemptExecutor`, not a generic
    executor taxonomy.

## Explicit non-conclusions

* Codex, Claude, or any other implementation is not a category in the generic
  executor taxonomy. Codex is only the current MVP executor candidate.
* No skill is required or selected. No review loop, inner journal, subagent
  arrangement, or provider topology is required or selected.
* The selected MVP surface is app-server. Raw `codex exec`, the SDK, and the
  Responses API remain comparison evidence, not alternate V1 modes.
* No output schema is a substitute for Git authority, verification, or an
  evidence manifest. A structured declaration is not external proof.
* No process signal, port close, `AbortSignal`, or `turn/interrupt` is by
  itself a Dalph `SafelySuspended` report.
* No worktree diff, Codex session file, output file, or missing process is by
  itself a terminal executor result.
* No provider thread/session id is a second outer executor identity. If later
  retained, it remains implementation state that must be reconciled.
* Dalph does not encode a human takeover, manual Codex turn, or manual worktree
  edit. Preserving the same non-ephemeral thread and exact planned worktree
  whose registration Git proved keeps that composition possible; later Git
  and executor observations remain the only facts Dalph consumes.
* Symphony, Agent Kanban, and Codex Action demonstrate viable integration
  techniques; their permissions, retries, multi-turn loops, proxy setup, and
  cleanup assumptions are not Dalph policy.
* This document does not claim that Codex's internal implementation is stable
  beyond the pinned source snapshots and current official documentation.

## Scenario/test gate

This is a documentation-only research artifact and changes no Dalph runtime
behavior, so it does not itself claim an implementation scenario-to-test
mapping. Issue 219's accepted scenario now owns the selected launch shape,
normal terminal observation, process-death cuts, suspension, cleanup, and test
seams. The implementation's fake process and Git/evidence fixtures must be
derived from that scenario rather than inferred from this research note.
