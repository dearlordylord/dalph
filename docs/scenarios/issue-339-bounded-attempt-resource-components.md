# Alice's ordinary task gets a filesystem-sized worktree component

## Governing behavior

When Alice's ordinary built production command plans a task worktree, this
accepted #339 repair preserves the exact attempt and Base SHA required by
[D1–D3](../DELIVERY-INVARIANTS.md#identity) and the existing
[#259 production planner](https://github.com/dearlordylord/dalph/issues/259).
Only the encoding of a newly derived filesystem/Git-ref component changes.
It adds no workflow operation, retry, authority, schema migration or Quint
transition. The full Run, task, task-local ordinal and AttemptId remain exact;
a resource component cannot replace any of those authority facts.
The existing admission/recovery models constrain workflow decisions, not the
UTF-8 byte length of this host codec; focused codec and real Git/filesystem
tests are its executable acceptance boundary.

## Starting facts and trigger

Alice invokes the built production command for GitHub task A using the exact
local fixture Q. Git contains the initial H and no task worktree or promoted
target. SQLite has acknowledged the Run beginning, claim and task specification.
The configured executor has not received any call.

The production planner derives a fresh task attempt from the actual RunId,
TaskId and workflow-owned task-local ordinal. The current length-delimited
UTF-8 tuple expands into one filename and branch-ref component. In the built
#339 diagnostic, each final component is 528 bytes. SQLite acknowledges the
exact planned attempt and worktree reconciliation intent; the filesystem
rejects that planned component with `ENAMETOOLONG`. Git still lists only the
initial repository worktree, no ready-worktree observation is acknowledged,
and Alice sees waiting instead of executor progress. This is a path encoding
defect, not permission to shorten the task identity or raise a timeout.

## Ordered calls and visible result

1. For a newly derived attempt, the planner retains the existing complete
   length-delimited UTF-8 tuple as its AttemptId. It splits that same ASCII
   resource into fixed 128-character chunks, prefixes each with `part-`, and
   appends a distinct terminal `_leaf` component. RunId, TaskId and ordinal are
   not hashed, truncated or omitted. Concatenating the chunk payloads recovers
   the unchanged tuple resource.
2. It derives the worktree strictly beneath the configured root and a valid
   branch under `refs/heads/dalph/` using this hierarchy. Each chunk component
   is at most 133 bytes; `_leaf` cannot be confused with a chunk. Equal tuples
   produce equal locations, and extending an ordinal cannot turn one attempt
   leaf into another attempt's parent directory or ref prefix.
   Root does not become part of attempt identity, and Base remains owned by
   the existing workflow planner protocol.
3. The workflow acknowledges the exact planned attempt and existing
   reconciliation intent. Real Git and filesystem boundaries check/create
   that exact worktree with the declared Base and branch. The ordinary
   ownership and foreign-resource checks remain; matching an encoded path alone is
   never permission to adopt, overwrite or delete an existing resource.
4. Git reports the actual ready worktree; SQLite acknowledges that observation
   before the executor starts. The built controller can then reach its real
   promotion boundary. The test does not shorten RunId, fake Git, pre-create
   the expected worktree or increase its deadline to manufacture progress.

## Crash, retry and forbidden results

On crash, P2 consumes the already acknowledged exact planned locators and
ordinary reconciliation protocol. This repair must not rewrite an existing
plan, change its Base, derive a second worktree for that acknowledged attempt,
or infer ownership from a filename. A new test invocation uses its own fresh Q;
it is not an automatic retry of a failed qualification or provider mutation.
No live GitHub boundary applies because #339 uses controlled outer providers.

This repair bounds individual components, not every platform's total pathname.
Unsupported total paths remain subject to the existing typed real Git/filesystem
failure boundary. It introduces no universal total-path cutoff or platform
compatibility policy. Canonical UTF-8 tuple identity remains unchanged; the
actual Run/GitHub task inputs and generated properties use well-formed Unicode.

## Scenario-to-test mapping

- Actual-length and longer hostile identities → focused codec tests assert
  bounded component bytes, valid refs, root containment and unchanged full
  AttemptId. Include Unicode and tuple-delimiter ambiguity controls.
- Chunk inverse and ordinal-prefix families → generated tests reconstruct the
  original full resource and prove terminal leaves do not overlap.
- Equal/different Run, task and ordinal → retain deterministic and distinct
  tuple tests; preserve task-local fresh ordinal and exact replacement Base
  and ordinal tests. No released-path compatibility fallback is required.
- Actual local filesystem/Git → focused integration creates the derived
  long-identity worktree using real Git and asserts its branch, H and exact
  path; no live provider calls or timeout widening.
- Ordinary complete command → #339's built SQLite/Git controller asserts
  real ready-worktree evidence before executor progress and reaches real CAS.
  The other three controller cuts and downstream #304–#306 blockers remain.
