# Human interaction with Dalph workers

Research dated 2026-09-13. This is an Astra investigation of the user's standing
requirement: the person should be able to open an individual worker, converse
with it, help it, and take over when its execution host supports that operation.
It extends [agent-operated Dalph](agent-driven-dalph.md) and changes no runtime,
configuration, accepted scenario, or formal model. Recursive planning is a
separate design question.

## What Alice wants to do

Alice asks an orchestrator to deliver A and B. Dalph admits both attempts and
starts their workers in the exact planned checkouts. While A is running, Alice
opens its transcript, notices a misunderstanding, and sends A a correction
directly. Later she asks A a follow-up question. If she decides to edit A's
checkout herself, she explicitly takes control, waits until the agent's writers
have stopped, edits, and returns control. B can keep progressing throughout.

**Finding:** support this as several explicit capabilities. Codex can provide
addressable independent worker conversations, and its CLI exposes session
browsing, resume and queued messages. However, installed Codex 0.154.0 contains
a specific parent-controlled subagent mode that disables direct user input.
Opening its transcript does not necessarily make that child conversationally
attachable. The user's suspicion is supported for that mode; it should not be
generalized to all Codex sessions, historical subagent implementations, or
clients.

**Design recommendation:** use independent executor-owned sessions for durable
workers that Alice must address directly. Make the interaction capability
visible on each worker. Parent-controlled private helpers can remain useful,
but label any parent-mediated communication accurately. A human typing directly
to an independent worker can still go through Dalph's routing transport without
requiring the orchestrator model to relay or interpret the message.

## Evidence boundaries

Official pages were opened on the research date. Installed-binary evidence is
specific to `codex-cli 0.154.0`: CLI help, previously generated experimental
app-server JSON schemas, and bounded string inspection of its shipped binary.
No worker was started, no message was sent, no provider turn was requested, and
no existing conversation was resumed during this investigation.

The earlier [offline probes](codex-managed-worktrees-local-probes.md) established
that an independently started CLI thread could be read and reloaded by a new
app-server with the same thread ID and directory. Its loaded response included
`canAcceptDirectInput: true`; the stored, unloaded response had `null`. That was
not a native-child interaction test or a successful model conversation.

### Codex documentation does not promise one universal experience

The subagents guide describes `/agent` as switching among running agent threads
for inspection, and suggests asking Codex to steer or stop a child. Web's
subagent sidebar is expressly an activity/result view without individual
stop/steer controls. Desktop and IDE capabilities have their own descriptions.
[Official subagents guide](https://learn.chatgpt.com/docs/agent-configuration/subagents).

The CLI command guide describes `/agent` and `/subagents` as allowing inspection
or continuation of a selected agent's work. This broad wording does not explain
the parent-controlled restriction found in the installed binary. Treat it as
general UI guidance, not proof that every selectable child accepts input.
[Official developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli#switch-agent-threads-with-agent).

The 0.154.0 changelog documents read-only fallback when resuming a conversation
that has another active writer. Earlier release notes document `codex agents`
and `codex queue`. Attaching a second app is therefore not an unconditional
transfer of conversation ownership.
[Official changelog](https://learn.chatgpt.com/docs/changelog).

### Installed capability and ownership evidence

| Evidence inspected | What it actually says | Consequence |
| --- | --- | --- |
| Generated `Thread.canAcceptDirectInput` | Boolean or null; whether app-server accepts direct turn input for this loaded thread; unavailable for some states, such as unloaded history | Read the current capability. Null is unknown, not permission. |
| Generated `Thread.parentThreadId` | Identifies a subagent's parent separately | Parentage and direct-input permission are distinct facts; do not derive one from the other. |
| Binary TUI message | `This sub-agent is controlled by its parent. Direct input is disabled.` | A concrete input-disabled child path exists in this installation. |
| Binary resume errors | Multi-agent v2 child resume can require its loaded parent, matching parent ownership, and compatible parent execution policy | A child thread ID is not enough to promise independent adoption. These paths were inspected, not exercised. |
| Binary active-writer message | Another open owner requires closing there and retrying resume | A second terminal can become a viewer rather than a controlling client. |
| `codex agents --help` | Browses sessions on the shared local app-server daemon; accepts a remote endpoint | Discoverability depends on the relevant server, not just filesystem proximity. |
| `codex resume --help` | Accepts a session UUID/name; supports remote endpoints and including non-interactive sessions in selection | CLI can target independently started work. Help does not prove simultaneous owner compatibility. |
| `codex queue --help` | Accepts an exact session UUID/name and message, locally or remotely | A first-party queued-message entry point exists; no delivery or deduplication behavior was exercised. |

The binary inspected is the installed ARM64 executable under
`@openai/codex-linux-arm64/vendor/aarch64-unknown-linux-musl/bin/codex` in the
global package. Schemas are the generated artifacts described in the
[local probe record](codex-managed-worktrees-local-probes.md#evidence-retained-in-this-workspace-session).
Temporary schema files may disappear; regenerate with the installed CLI's
`app-server generate-json-schema --experimental --out <temporary-directory>`.
Binary strings establish implemented messages, not the reachability of every
branch in every configuration. No claim of live child testing is made.

### Protocol primitives and their limits

App-server documents passive `thread/read`, thread events, `turn/start`, and
`turn/steer`. Steering requires the exact active `expectedTurnId`, fails when
there is no matching active turn, and does not create a new turn. It cannot
change the turn's directory or model. `turn/interrupt` is separate from
background-terminal cleanup. Resume continues stored identity; fork copies
history into a new thread. Remote TUI connections can use an app-server
endpoint. None of these descriptions establishes exclusive ownership of all
filesystem writers.
[Official app-server reference](https://learn.chatgpt.com/docs/app-server).

The installed schema additionally contains `thread/queue/add`, `list`, `update`,
`delete`, `reorder`, `start`, and a queue-change notification. Add requires
`threadId`, `clientUserMessageId`, and input, and returns a queued submission ID.
These contracts expose queue management, but the schema alone does not prove
restart durability, exactly-once delivery, native-child eligibility, automatic
turn start, or whether the model acted on a message. `clientUserMessageId`
must not be presumed an idempotency guarantee merely because the field exists.

The installed error schema also distinguishes an active turn that cannot be
steered, including review and manual compaction. Some `turn/start` field
descriptions explicitly mention steering an already-active turn. Therefore
Dalph should choose an explicit operation from fresh status, rather than use
`turn/start` as an assumed enqueue-only command.

## Capability matrix for the product

“Available” below means a documented or inspected primitive; it is not completed
Dalph integration. “Conditional” requires current host/thread evidence.

| Alice's action | Independent Codex worker | Parent-controlled native Codex child | Dalph requirement |
| --- | --- | --- | --- |
| Watch saved work | Available: read history; earlier offline lookup passed | Inspection supported in relevant clients; parent/server availability can constrain access | Watching must not start a turn or change execution permission. Show freshness and provider identity. |
| Watch live work | Available through server events and supported clients | Supported inspection in relevant clients | Route events from the owner; reconnect with explicit gaps. A copied transcript is not live observation. |
| Correct the running turn | Conditional on direct-input capability and a steerable exact turn | Direct input is disabled in the observed parent-controlled path; parent-mediated steering is separate | Bind message to the current attempt and turn; reject stale targets rather than redirecting silently. |
| Queue a later message | CLI/schema available; delivery semantics unqualified | Whether queueing can target this child is unverified; do not use it to bypass disabled direct input | Show queued, applied-to-provider, and unresolved outcomes distinctly; do not equate queue receipt with obedience. |
| Have a direct multi-turn conversation | Supported primitives for addressable sessions; client/owner qualification needed | Not promised for the parent-controlled path | Prefer independently started durable workers where direct conversation is required. |
| Open another terminal on the same session | Resume/remote interfaces exist; another writer may yield read-only UI | Parent ownership may prevent independent resume | Prefer the same owning service or an explicit transfer; launching a second owner is not a neutral attach. |
| Resume after a disconnect | Independent stored identity and directory reload were proved offline | Parent-first and ownership checks exist; recovery not tested | Preserve attempt/resource identity and inspect live activity separately. |
| Fork or copy a conversation | Creates a different provider conversation | Client-dependent; no child-detachment guarantee established | Label it as a copy. Do not represent it as conversation takeover or the same executor attempt. |
| Edit the worker's checkout herself | Files can be accessible, but no exclusive transfer is established | Child plus parent/siblings can still own writers | Require an accepted per-attempt handoff protocol before claiming exclusive manual control. |

## Claude contrast, without assuming all native children are alike

Current Claude Code documentation explicitly says opening a fork or subagent
transcript routes follow-up messages and skills to that agent; some built-in
commands still affect the main conversation. Its agent-team documentation
separately describes direct conversation with independent teammate sessions,
through an in-process panel or terminal panes. These are stronger explicit
client promises for direct conversation than the parent-controlled Codex path.
[Claude subagent interaction](https://code.claude.com/docs/en/sub-agents#observe-and-steer-running-forks),
[Claude teammate interaction](https://code.claude.com/docs/en/agent-teams#talk-to-teammates-directly).

Claude teams are experimental and interactive-session-specific; documented
resumption and shutdown limitations remain. Do not transfer teammate guarantees
to Agent SDK subagents or treat message access as filesystem ownership.
[Claude team scope](https://code.claude.com/docs/en/agent-teams).
No installed Claude behavior or provider turn was tested here.

## Implications for the current Dalph boundary

The existing [executor contract](../packages/contracts/src/executor.ts) exposes
Begin, Resume, Suspend, and passive lifecycle observation. It does not expose
human conversation, queueing, viewer attachment, or manual takeover. The
[Codex transport](../packages/dalph/src/application/codex-app-server.ts) likewise
does not yet surface `canAcceptDirectInput`, queue operations, or `turn/steer`.
Adding a button that merely launches a CLI cannot supply those missing workflow
semantics.

Direct conversation and manual control are different changes. A conversation
view can route Alice's input directly to the worker while the Dalph executor
retains lifecycle ownership. It must constrain overrides that would change the
planned worktree or bypass result qualification. Alice's reply to a worker
question must not accidentally Resume a suspended attempt or authorize another
task. Transport cancellation must not become workflow cancellation.

Exclusive manual editing requires more. Dalph needs to prevent new autonomous
commands for that exact attempt, stop and prove absence of the executor's
writers, retain the exact claim/worktree and outstanding obligations, and
record who currently may resume work. On return, inspect the same Git resource
and changes before resuming under an accepted rule. Global Pause alone is not
proof that existing writers stopped, and a successful turn interrupt is not
that proof either. A host unable to fence future writes cannot advertise
exclusive takeover; it can still offer observation and supported conversation.

The [existing executor](../packages/dalph/src/application/codex-planned-attempt-executor.ts)
already guards against surviving descendants when reporting safe suspension or
terminal completion. Preserve those checks. Human editing after safe suspension
introduces a separate resource holder whose activity and relinquishment must
be accounted for before cleanup. Closing Alice's browser cannot prove she
closed her editor or background commands.

## Proposed chronological scenarios and test seams

These are exploratory acceptance candidates, not accepted implementation work.
Expand selected behavior under [the scenario gate](../docs/OPERATIONAL-SCENARIOS.md)
before implementing it. GitHub task identity/claims remain unchanged in these
scenarios; Alice is directing the existing exact attempt, not creating or
closing a tracker task. No tracker mutation is needed merely to open a viewer
or send an in-scope correction.

| Scenario, starting facts and trigger | Ordered boundary calls, crash/retry, visible and forbidden outcomes | Proposed acceptance seam |
| --- | --- | --- |
| H1: A's claimed attempt and exact worktree exist; worker turn T is running; Alice opens its graph node | Dalph reads its current provider binding/capabilities and subscribes or reads history. Reconnect rebuilds observation after a gap. Alice sees A; no provider turn or lifecycle transition occurs from viewing. | `opening a worker viewer does not start resume or steer work`; disconnected-stream negative control |
| H2: A accepts direct input and T is active; Alice sends a correction | Validate scope/attempt, reread the binding and turn, then steer T. If T ends or response is lost, retain/reconcile uncertainty; do not silently start a new turn or deliver to a replacement attempt. Show receipt separately from model response. | `rejects a correction for an obsolete turn without starting another`; lost-response delivery seam |
| H3: Alice opens a parent-controlled child with direct input disabled | Read capability and show inspection plus explicitly parent-mediated options. No direct queue/turn call is used as a workaround. Parent disappearance remains unavailable, not permission to detach. | `shows parent-controlled child as inspectable without advertising direct conversation`; null-capability negative control |
| H4: Alice queues guidance for A's next turn while T runs | Bind to A, submit one identified message, observe queued outcome. Lost response requires exact reconciliation before retry. Replacement or suspension prevents unintended application until the accepted rule permits it. | `reconciles a queued correction without duplicate delivery or implicit resume`; provider queue durability qualification |
| H5: Alice requests manual control while A and a descendant command write | Block new autonomous work for A, request stop, prove writers absent, then grant exact manual control and preserve resources. Crash after stop but before grant exposes pending transfer. B continues. Never claim control or delete A while a writer survives. | `grants manual control only after all attempt writers stop`; crash-prefix and surviving-descendant negative controls |
| H6: Alice has manual control, edits A, then returns it; her editor process may still write | Confirm relinquishment under the selected host protocol, observe exact branch/path/Base and new Git facts, then allow accepted continuation. Lost client connection leaves responsibility explicit. Never infer relinquishment or integration from an edited file or closed browser. | `keeps manually held worktree until return is established and rereads Git before continuation` |
| H7: Alice opens a session already controlled by another app | Same-owner routing succeeds where qualified; competing ownership yields visible read-only/unavailable state. Retry after release keeps the exact identity; a fork is labeled a different conversation. | `does not turn active-writer resume failure into a duplicate worker` |

Existing executor tests for surviving descendants, suspension, exact thread
association and ambiguous turn responses provide reusable seams, not passing
evidence for these new human-interaction scenarios. No implementation or
provider-qualification gates were run for this documentation-only investigation.
