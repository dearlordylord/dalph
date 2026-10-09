# Refuse incompatible development history before effects

The Operator starts Dalph with an obsolete development dataset. Accepted scope:
[issue #491, R2](https://github.com/dearlordylord/dalph/issues/491).

Starting facts: SQLite contains a retained Run whose stored event semantics are
older or newer than the supported format. Trigger: public production startup.
Boundary order: acquire coordinator and Journal ownership, inspect stored event
versions, refuse before acquiring tracker, Git, executor, Integrator or evidence
mutation capabilities. No Run beginning is appended. The refusal names the
supported event format and separate manual retirement after external custody
resolution. Source bytes remain intact; no reset command, deletion, migration
or package release bump is introduced. Existing historical readers remain.

Retry after a lost refusal repeats inspection, never deletion or reinterpretation.
An interrupted manual retirement or disputed prior owner cannot authorize
competing work. Missing local files do not prove external claims, dirty
worktrees, sessions or writers disappeared. Only a separately retired, safely
isolated fresh current-format dataset starts normally. Current-format recovery,
exact cleanup dispositions and the separate archive scopes retain their rules.
No mutation crash reconciliation is added because refusal performs no workflow
effect; existing ownership acquisition and release remain applicable.

Acceptance mapping in `production-host.test.ts`:

- `unsupported development history refuses before effects and preserves source bytes`
  covers older/newer semantics, exact source bytes and zero forbidden boundary calls.
- `isolated fresh SQLite dataset starts only after exact Run selection and acknowledged WorkflowRunBegan`
  covers a physically separate empty SQLite dataset through public startup.
- `default production graph keeps one owner per mutation capability while H2 fails before every boundary and fresh H2 recovers`
  covers native coordinator ownership and disputed prior-owner refusal.
- `production provider refuses retained shared attempts before spawning and preserves their custody`
  covers old provider custody without a spawn or record removal.

`production-cli.test.ts` checks useful public format/refusal guidance without
exposing private decoding content. Documentation changes align pre-release
planning only; they confer no runtime cleanup or archive authority.
