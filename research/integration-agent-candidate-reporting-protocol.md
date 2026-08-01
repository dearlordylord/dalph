# Integration-Agent Candidate Reporting Protocol

Research note for the question: how should a freeform, nondeterministic coding
agent reliably return the exact integration-candidate commit `M` to Dalph?

## Status and abstraction boundary

This is design research for a future lower-level agent boundary. It does not
select the current implementation mechanism.

The accepted issue #57 requirement to preserve at the current, higher
abstraction is only:

- the integration agent must explicitly submit one candidate `M`;
- a successful process exit, freeform response, or observed worktree tip is
  not that submission; and
- the first valid submission fixes `M` for the integration session.

Whether a future adapter carries that submission through a Dalph CLI helper,
an MCP tool, a provider terminal envelope, a private Git ref, or another typed
boundary remains deferred. The protocol below is the current recommendation
for that future design, not an implementation commitment.

## Answer

Dalph should give the integration agent one dedicated, schema-validated
operation:

```text
submit_integration_candidate(
  protocol_version,
  integration_operation_id,
  integration_session_id,
  candidate_commit
)
```

The portable form is a Dalph-owned CLI command. Providers that support MCP may
expose the same operation as an MCP tool. The operation, not the agent's prose,
is the result boundary.

On a valid first submission for the session, Dalph should:

1. authenticate and correlate the call with the operation, session,
   repository, and worktree Dalph supplied to this invocation, rather than
   trusting model-supplied identifiers;
2. record intent to accept this session's candidate before crossing the Git
   boundary;
3. ask Git whether `candidate_commit` exists and has exactly the ordered direct
   parents `[H, C]` already fixed by the integration operation;
4. create a session-owned ref such as
   `refs/dalph/integration-sessions/<session-id>/candidate` with a
   compare-and-set that requires the ref not to exist; and
5. record that Dalph observed the accepted submission before acknowledging the
   call to the agent.

The ref pins `M` against garbage collection and makes crash reconciliation
independent of the agent's last line of text. Git's `update-ref` supports the
needed compare-and-set: supplying an expected old object verifies the old
value, and a zero old object requires the new ref not to exist. Each individual
ref update is atomic. See the official
[`git update-ref` documentation](https://git-scm.com/docs/git-update-ref).

The candidate becomes fixed at the first accepted submission. A repeated
submission of the same `M` is idempotent. A later submission of a different
commit for the same integration session is a typed contradiction, not silent
replacement. Commits made afterward remain in the worktree and may produce a
best-effort warning, but they do not change `M`.

## Why this is stronger than parsing the final answer

Current agent CLIs increasingly offer structured automation surfaces:

- Codex `exec` can emit JSONL lifecycle events, constrain the final response
  with `--output-schema`, write the last response to a file, and resume an exact
  session. See the official [Codex CLI command
  reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-exec).
- Claude Code print mode supports JSON and streaming JSON, includes a session
  ID, supports resume, and can validate a final structured value against
  `--json-schema`. See [Run Claude Code
  programmatically](https://code.claude.com/docs/en/headless) and its [CLI
  reference](https://code.claude.com/docs/en/cli-usage).
- Gemini CLI headless mode offers a JSON result or a JSONL stream containing an
  `init` event with session metadata and a terminal `result` event. It also
  assigns standard exit codes. See its [headless mode
  reference](https://geminicli.com/docs/cli/headless/) and [session-management
  reference](https://geminicli.com/docs/cli/session-management/).

These facilities are useful provider adapters, but they answer different
questions:

| Facility | What it reliably establishes | What it does not establish |
| --- | --- | --- |
| Exit code | The CLI considers the invocation successful or failed | Which Git commit Dalph should accept |
| JSON/JSONL | Message framing and documented lifecycle events | That freeform result text names a valid candidate |
| JSON Schema final output | A terminal value has the expected shape | Durable recovery if the process dies before that value is emitted |
| Session ID and resume | Which conversation/process history to continue | Dalph's integration-domain completion condition |
| Dedicated submission operation | An explicit, correlated candidate claim | Whether the claimed commit is structurally valid |
| Session-owned Git ref plus Git inspection | A durable pinned commit and its actual parents | Whether the agent semantically intended to finish, unless created by the submission operation |

Therefore, schema-constrained final output is a good fallback for providers
that cannot call a dedicated operation, but it should feed the same Dalph
submission handler. Dalph must never infer `M` from branch `HEAD`, the newest
commit, a clean exit, or a SHA found in prose.

## Common protocol building blocks

### MCP tool call

MCP tools have JSON Schema inputs and may declare an output schema; servers
must conform structured results to that schema and clients should validate
them. This is a natural carrier for `submit_integration_candidate`. See the
official [MCP tools
specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).

The operation should be idempotent and narrow. Its response can say whether
the submission was newly accepted or already accepted, and return the pinned
commit. Tool annotations are not authority; the MCP specification explicitly
tells clients to treat annotations as untrusted. Dalph still validates every
input and asks Git for the commit facts.

For that proof, Dalph should resolve a full object ID, verify the object is a
commit, and inspect its raw `parent` headers rather than parse human-oriented
`git log` output. See the official [`git cat-file`
documentation](https://git-scm.com/docs/git-cat-file.html).

### Agent Client Protocol or provider session protocol

ACP standardizes JSON-RPC communication, session identity, streaming updates,
and agent/client interaction. Its architecture is aimed at the lifecycle and
UX between an editor/client and an agent, and it can pass MCP server
configuration to the agent. See the official [ACP
architecture](https://agentclientprotocol.com/get-started/architecture).

ACP is therefore useful for starting, correlating, cancelling, loading, and
resuming the exact integration-agent session. It does not supply Dalph's
domain-specific meaning of “this exact Git commit is my completed integration
candidate.” That remains the dedicated submission operation, normally carried
through MCP or a Dalph CLI helper.

### Dalph-owned CLI helper

The provider-neutral interface can look like:

```bash
dalph integration submit-candidate \
  --operation "$DALPH_INTEGRATION_OPERATION_ID" \
  --session "$DALPH_INTEGRATION_SESSION_ID" \
  --candidate HEAD
```

The helper resolves `HEAD` to a full commit object ID at call time. Dalph uses
the operation's already-planned `H` and `C`; the agent does not get to redefine
them in the report.

The session identifier may come from a scoped environment value or invocation
context, but the helper must compare it with the expected integration
operation. The agent must not be able to select an unrelated active session by
guessing a path or relying on the current directory.

The helper's stdout is merely an acknowledgement. The durable effect is the
validated, compare-and-set Git ref followed by Dalph's observed workflow
record. If MCP is available, its tool handler should call this same application
service rather than implement a second protocol.

### Result file

A session-scoped JSON result file is a workable fallback when no callable tool
or helper can be exposed. It needs schema validation, exclusive creation or
compare-and-set semantics, and a supervisor-controlled finalization step. A
model directly writing arbitrary JSON is weaker: it can leave malformed,
partial, missing, or later-overwritten data, and filesystem rename by itself
does not settle the full crash-durability story. A file should therefore be an
adapter into the same submission handler, not the source of truth.

The portable preference order is therefore: dedicated submission operation;
provider terminal envelope with locally validated schema; create-once private
Git result ref; atomic result file. Every adapter enters the same Dalph
submission handler and receives the same validation and recovery semantics.

## Failure and restart semantics

- **CLI exits zero without an accepted submission:** `ExitedWithoutCandidate`;
  preserve the worktree and exact session for diagnosis or resume.
- **CLI crashes before submission:** resume the same session. Do not infer a
  result from the worktree tip.
- **Dalph crashes after the ref is created but before recording its
  observation:** reconciliation reads the exact session ref, verifies its
  parents in Git, and records the same submission. It does not start another
  integration agent.
- **Malformed submission:** reject it as a typed boundary failure and preserve
  the session/worktree.
- **Submission correlation contradicts its intrinsically bound session:** stop
  the affected integration operation before reading or changing Git, preserve
  every possibly involved session, and require operator repair. Do not turn a
  deterministic infrastructure contradiction into an agent resubmission loop.
- **Submission is well formed but Git validation is unreadable:** keep the
  exact submitted commit pending and retry the Git read. Do not ask the agent
  to resubmit and do not charge an agent correction or convergence round.
- **Commit missing or parents not exactly ordered `[H, C]`:** reject it as an
  invalid candidate claim. Git, not the agent's report, supplies this proof.
  Keep `M` unset, return the concrete mismatch to the same integration-agent
  session, and allow corrected submission from the same isolated resource.
- **Same session submits the same `M` again:** acknowledge idempotently.
- **Before M is accepted, the same session corrects an invalid submission:**
  validate the new claim normally; the rejected commit never fixed M.
- **After M is accepted, the same session submits a different commit:** surface
  a contradiction and preserve both the submitted evidence and worktree; never
  silently move the pinned ref.
- **Agent keeps committing after accepted submission:** keep `M` fixed and warn
  if the later movement is observable. Promotion later uses the fixed `M`.

## Authority fit

- The execution substrate owns the provider session identity and whether it
  can be resumed.
- Git owns commit existence, the session-owned candidate ref, and the ordered
  parent facts.
- The agent supplies an untrusted candidate claim through a typed operation.
- Dalph's journal owns the workflow history that it intended and then observed
  that submission.

This separation preserves the same restart semantic as the executor: reconnect
to and project the existing session and its durable work before starting any
new agent.

Every future automatic retry, correction, and convergence loop in this
protocol must have a positive finite bound and an explicit exhausted
disposition. Numeric limits and operator policy remain future design. The
coordinator may remain alive and continue observing new work indefinitely;
that service lifetime is not a retry loop for one responsibility.

For candidate correction, exhaustion records the integration responsibility
as non-convergent, preserves the exact agent session and all Git work, fixes no
candidate M, leaves the task incomplete for operator action, and releases the
serialized integration-target position so unrelated accepted results may
continue.
