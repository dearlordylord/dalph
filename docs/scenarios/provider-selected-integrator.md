# The selected provider owns both task execution and integration

The operator selects one executor profile before Dalph claims a task. The
profile identifies one provider adapter, such as Kimi ACP or Codex app-server.
The same selected provider owns the planned-attempt executor and the outer
Integrator for that Run.

## Starting facts

The tracker exposes an eligible task and no claim exists. Git identifies the
repository and exact target head. Dalph has decoded the provider profile and
has not started either provider's process or session.

## Chronology

1. Dalph records the selected provider profile before claiming the task.
2. Dalph creates the exact planned-attempt worktree and starts the selected
   provider's executor session. The provider edits and commits only there.
3. Dalph verifies and records the terminal accepted result, then closes the
   executor session before admitting integration.
4. Dalph starts the Integrator for the same selected provider. It creates a
   separate candidate worktree and provider session, sends the accepted commit
   and exact target head, and receives one explicit candidate or a conclusive
   unsuccessful result.
5. Dalph qualifies the explicit candidate through Git, promotes only the
   qualified candidate, releases the exact resources, and closes the tracker
   task. Provider sessions and worktrees remain distinct between execution and
   integration.

## Visible and forbidden results

The operator can see the selected provider, the task result, the integration
result, and the final tracker state. Dalph must not start the other provider,
reuse the planned-attempt worktree or session for integration, infer a
candidate from a worktree head, promote an unqualified commit, or close the
task before promotion and cleanup.

## Acceptance tests

- A Kimi-selected run starts Kimi for both the planned attempt and Integrator,
  with two distinct sessions and worktrees, and records an explicit candidate.
- A Codex-selected run preserves the existing Codex executor and Integrator
  behavior.
- Provider selection is eager and deterministic: the selected Integrator layer
  is built at host construction, with no lazy provider acquisition.
- Kimi and Codex private stores are disjoint and a provider result is never
  reused by the other provider.

Bounded live evidence on 2026-09-15 exercised the shared Integrator core with
the real `kimi acp` executable and the `kimi-code/kimi-for-coding` profile. Kimi
started session `session_fb570e6f-d77a-43b6-b5f5-5f70ce53879c`, verified accepted
commit `4a9ef63bd3a15fdda507d13968a0680ffab93ba5` as a child of target head
`99df9eeb725b642381214807bd948ce6b83dc7ff`, prepared candidate commit
`bf6b9206e571c60cec951502442948c380ccaef1`, and left the target ref unchanged.
