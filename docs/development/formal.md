# Formal verification

[Development entry](../DEVELOPMENT.md) · [Navigation](../NAVIGATION.md)

### Formal reuse and handoff

The explicit standalone `pnpm check:quint` command uses one complete profile and
one guarded applicability boundary. Ordinary local `check:all` records the
candidate's formal relevance and `not-requested` disposition without starting
Quint proof. A maintainer runs `pnpm check:quint` manually when formal proof is
wanted; CI retains its independent formal job. A passing local `check:all` is
not evidence of formal proof. It does not consume the standalone reuse contract.
The formal command runs missing or stale work, or reuses
an applicable local success record while naming that record. A complete changed
path inventory includes committed, staged, unstaged, deleted, rename-source,
and untracked paths; coverage explanation and raw debugging retain that complete
inventory, while formal applicability comes from the guarded input, toolchain
and profile identity plus full observation. It is never inferred from the
narrower development-loop classifier. A final applicability check still runs
after the external tool observation reaches the end of the application stage,
so a final input change fails the handoff. A final check failure does not
silently start a second formal profile.

Local reuse requires supported cooperative Linux, exact current-worktree
admission, shared Git-repository custody, prepared coherent
pnpm/Quint/Apalache/Java roots, and the conservative environment and input
boundary enforced by the formal policy. Equivalent governed inputs may reuse a
complete success from another worktree of the same clone and host boot.
Repository-local source and tool paths, checkout PATH entries, and a
checkout-local pnpm launcher are compared by role plus checkout-relative
location and content rather than raw worktree path. A recognized pnpm launcher
retains a digest of its complete generated script with only checkout-local
components of the generated `NODE_PATH` assignments represented symbolically;
added commands or changed targets remain input changes. Absolute original
worktree/run/report paths remain provenance and must still resolve through the
same Git common directory; every original checker/server process group must be
proven stopped. Unresolved custody, missing origin provenance, reconciliation
or observer evidence fails closed. The local boundary
does not coordinate arbitrary external processes, other clones, distributed
filesystems, non-Linux hosts, or tool roots outside the identified installation.

The supported runtime policy currently identifies Debian 12 on x64 or arm64,
with finite dedicated Node and Java installation roots and a checkout-local
pinned pnpm/Quint installation. The affected-input rule in the
[formal affected-input reuse scenario](../scenarios/formal-affected-input-reuse.md)
supersedes the former whole-`specs/`, whole-`scripts/`, and raw-configuration
fingerprint. The policy parses the actual admitted/formal process entries and
recursively follows their repository JavaScript dependencies. It selects Quint
roots from the effective profile command arguments and follows imports with the
pinned Quint resolver. Unselected scripts, experimental models, documentation,
raw package/lock/workspace/npm/patch metadata, and the hosted CI workflow do not
change local formal identity merely because their bytes changed.

Hosted admission has a different boundary because every shard starts from a
fresh checkout and installation. The checked-in
`scripts/hosted-formal-input-manifest.json` is generated from the same parsed
JavaScript and selected-Quint closure, using the hosted shard, aggregate,
admission, generator, and classifier entries. It also includes the workflow and
the exact package, lock, workspace, npm, and selected Quint patch inputs that
determine the hosted command and installed tools. The classifier reads the
union of the exact base and head manifests so a removed input remains governed.
Missing, malformed, or stale projection evidence fails closed to formal
execution; `formal-input-policy.test.mjs` refuses a checked-in projection that
does not exactly regenerate from the authoritative closure.

The identity retains the consumed profile/toolchain projections and resolved
Node, pnpm, Quint, parser, Rust evaluator, Apalache, Java, observer Python, and
declared system library, locale, certificate, and runtime configuration roots.
Unknown or non-literal dynamic source imports, external or cyclic links,
unsupported native repository inputs, unsupported runtime configuration, and
unreadable inputs fail instead of permitting reuse. Implicit Apalache
configuration locations are observed even when absent; present unsupported
configurations are refused. Git HEAD/index/base changes alone do not change
formal identity. Independent candidate verification still applies. Automatic
MBT is temporarily excluded pending #363; formal reuse does not prove
application conformance.

Current allowances in [formal-gate-policy.mjs](../../scripts/formal-gate-policy.mjs)
are 2,100 seconds for
formal acquisition and 30 seconds for final handoff validation. Acquisition
charges tool identification, observer setup, hashing, execution, evidence and
qualification to one decreasing allowance; phase caps do not restart it. The
local execution allowance is 1,800 seconds with a 1,850-second regression
ceiling, following the maintainer-authorized extension after the original
720-second attempt timed out. Hosted execution and regression remain 720/750
seconds. Both retain 5-second termination plus 2-second absence proof. See the
[local qualification scenario](../scenarios/formal-reuse-local-qualification-budget.md)
for the observed cost and bounded allowance rationale. The 30-second final allowance follows a 7.333-second complete
snapshot probe and reserves the remainder for evidence reads and observer
drains; it is not the withdrawn 60-second final estimate. Final qualification measured
560.085 seconds fresh, a 4.329-second median across ten warm commands, and
2.629 seconds for final no-checker validation.

The optional standalone local formal command retains its 35-minute acquisition
and 0.5-minute final-validation bounds. Those bounds are outside the ordinary
local `check:all` budget. Choose a separate absolute deadline when invoking
`pnpm check:quint` manually. These are ceilings, not measured duration or
claimed savings from the opt-in policy.
Hosted formal verification has a 16-minute job deadline and reserves
210 seconds for checkout, setup, network, and final reporting.

The former `check:quint:changed` and `check:quint:final` aliases are retired.
Select local checks through [choosing checks](checks.md#choosing-checks).
