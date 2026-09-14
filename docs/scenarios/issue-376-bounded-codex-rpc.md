# Bound a Codex RPC wait without deciding the task outcome

Issue: [#376](https://github.com/dearlordylord/dalph/issues/376)

Status: accepted required behavior for issue #376.

## A Codex request stops answering

No person directly starts the failing request. Alice previously started one
Dalph Run. Dalph, its application-owned Codex app-server child, the private
Codex attempt store, and the execution substrate are the relevant systems.

Before the failure, Git identifies one exact planned worktree and Base commit.
The tracker identifies the task and attempt. The Dalph Journal contains the
ordinary workflow history. The private Codex store contains the exact
application-server launch identity and, when a task turn can be affected, the
attempt, thread, worktree, fresh owned-turn token, and previous observed turn.
Codex owns whether it accepted a JSON-RPC request and whether a task turn is
running. The private store does not replace those Codex facts.

Dalph writes one `initialize`, `thread/start`, `thread/read`, or `turn/start`
JSON-RPC request to its application-owned child. The child then returns neither
a response nor EOF. Sixty seconds after that request entered its serialized
write-and-response boundary, Dalph ends only its local wait and returns a typed
failure naming the operation. The diagnostic snapshot contains the request id,
method, sent, response, and pending counts. It contains no request parameters,
response body, prompt text, credential name or value, or raw environment entry.

For `initialize`, no task thread or turn can have started. For `thread/start`,
Codex might have created an idle private thread, but Dalph has not associated
that thread and cannot send task work to it. Both failures close the exact
owned app-server process group once after rechecking its process identity.
`thread/read` is read-only; its deadline preserves the prior durable state,
closes the same exact owner, and authorizes no later action.

Before `turn/start`, Dalph durably records `TurnIntentRecorded` with the fresh
owned-turn token. If the response deadline expires, Dalph asks the same
app-server once to read the exact associated thread, with the same sixty-second
RPC bound. If that read exposes the matching token and turn, Dalph records the
observation and continues from that fact. If the read does not expose the
token, fails, or reaches its own deadline, Dalph keeps the intent unresolved,
closes the exact owned app-server process group once, and returns the existing
unknown-boundary result. A later Dalph invocation must reconcile that exact
thread and token before it may issue any later task command.

The deadline does not bound an accepted Codex turn's execution time. It does
not prove that Codex rejected a request, stop remote work by inference, release
task capacity, record safe suspension or terminal completion, or authorize a
second `turn/start`. A process crash before, during, or after the deadline
leaves the same private intent and launch records for ordinary startup
reconciliation. Repeating the Dalph command therefore rereads Codex; it does
not repeat the ambiguous request.

Alice sees the Run remain recoverable with a typed unavailable or
unknown-boundary result. She never sees fabricated success, safe suspension,
or a duplicate task turn.

## Scenario-to-test mapping

| Concrete chronology | Executable evidence |
| --- | --- |
| `initialize` receives no response or EOF. | Controlled app-server protocol test advances `TestClock` to sixty seconds and proves the typed operation failure, sanitized pending snapshot, and one owned close. |
| `thread/start` receives no response or EOF. | Controlled app-server protocol test proves finite failure, no task turn, no replacement child, and one owned close. |
| `thread/read` receives no response or EOF. | The shared bounded transport proof and the unavailable exact-thread reconciliation case prove finite failure, retained durable intent, and one owned close. |
| Codex accepts `turn/start` but its response is lost. | Planned-attempt executor test proves the durable token is found by one bounded exact-thread read and no second `turn/start` is sent. |
| The `turn/start` reconciliation read is unanswered or lacks the token. | Planned-attempt executor test proves `TurnIntentRecorded` remains durable, the result is unknown, and reconstruction still refuses a duplicate turn. |

The controlled tests use Effect services and a scripted local child transport.
They do not emulate the Responses API or qualify Codex wire compatibility.
