# Issue 165 choices audit

Resolved choices were transferred to the accepted scenario and domain
documentation and are omitted here. The original choice numbers remain stable
so conversation references do not drift.

## 14. Starting-fact cross-field validity

- Tentative choice: Reject contradictions through cassette-owned semantic
  validation when the contradiction can be derived entirely from authored
  data.
- Constraint: Do not add or expose production behavior solely to validate a
  cassette. An intended authority mismatch belongs in the typed response of the
  relevant ordinary production boundary.
- Verify: During implementation, determine whether any remaining cross-field
  check can be local to the cassette schema/interpreter. If not, leave that
  check to the production interaction rather than dirtying production code.

## 17. Empty-journal projection

- Settled boundary: An authored cassette never supplies a `RunId`; Dalph owns
  generation of workflow identities.
- Open choice: Whether projecting an empty journal returns an empty recorded
  story without a run identity or has no recording until the first journaled
  occurrence.
- Constraint: Do not make either the cassette or its interpreter generate or
  inject Dalph's `RunId`.

## 22. Continuation authorization before executor contact

- Tentative choice: Require one durable, non-recovery-specific action that
  authorizes continuation of the existing executor-work responsibility from
  fresh active-task continuation and exact-worktree observations.
- Limited confidence: The action closes the causal gap between current facts
  and executor contact without adding another executor-work identity, but its
  exact reducer shape has not yet been exercised in Reducer Lab.
- Verify: After the cassette tickets land, model crash prefixes before and
  after authorization in Reducer Lab and confirm that Running and Terminal
  reports remain facts about one coarse responsibility.
