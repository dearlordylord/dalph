# Isolate Codex integration sessions from planned-attempt threads

Status: accepted in the maintainer conversation on 2026-08-14

Dalph keeps one generic Integrator boundary and selects a simple implementation
backed by the same application-scoped Codex app-server and process substrate as
the planned-attempt executor. Each exact integration session receives its own
persistent Codex thread whose working directory is the session's isolated
candidate resource; it never reuses the planned attempt's thread or worktree.

The Codex-backed Integrator owns its whole private workflow: merge construction,
conflict resolution, repository checks, review, and provider-private retries.
Generic Dalph receives only its prepared-candidate or conclusive unsuccessful
result. Sharing qualified transport and process-lifecycle machinery therefore
does not combine task execution with integration. The cost is a separate
durable integration-session-to-thread association and recovery protocol, but
that separation preserves the two responsibilities, resource lifecycles, and
correlations and prevents either thread from becoming authority for the
other's work.
