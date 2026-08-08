# Competitor crash-experiment specifications

These documents translate the
[common crash protocol](../control-plane-crash-experiment-protocol.md) into
product-specific, source-backed setups. A specification is not evidence that an
experiment ran.

The current competitive comparison does not execute these specifications. It
uses source-code inference and labels it explicitly. The specifications and
blocked Symphony preflight are retained as research history, not as planned
work or empirical recovery evidence.

No destructive fault case may run until its specification proves that:

- every tracker, database, repository, worktree, session, process, and log is
  inside one explicit disposable root;
- no real provider, tracker, cloud, package-publishing, or user credential is
  available to the experiment;
- all process and session names are unique to the disposable fixture;
- start, observation, interruption, restart, and teardown commands were
  validated against the pinned source;
- teardown can prove ownership of every resource before removing it; and
- unsupported scenarios are reported rather than approximated against a real
  account or repository.

## Index

| Product | Specification | Execution |
|---|---|---|
| Gas Town + Beads | [Prepared; preflight not implemented](./gastown-beads-crash-spec.md) | Not run |
| OpenAI Symphony / Elixir OTP | [Prepared](./symphony-crash-spec.md) | [Preflight attempted and blocked; Symphony not started, no crash run](./results/symphony-c0-20260730T204747602Z-97dbf5f6-blocked/result.md) |
| Paperclip | [Prepared; preflight not implemented](./paperclip-crash-spec.md) | Not run |
| HerdOS | [Prepared; persistent fake-platform harness not implemented](./herdos-crash-spec.md) | Not run |

If this archived path is ever reopened by a new decision, experiment results
must live separately from specifications and identify the exact product
revision, fixture manifest, scenario, interruption type, and evidence-bundle
hash.

The [cross-product readiness matrix](../control-plane-crash-readiness-matrix.md)
explains why no C0-C9 case was ready to run when the experiment path was
evaluated.

The first [Symphony C0 harness](./harnesses/symphony/README.md) is now
implemented. Its retained execution bundle proves that this host lacks the
required Elixir runtime, private network namespace, and hard resource-control
boundary. It therefore stopped in preflight before starting Symphony or
injecting any fault.
