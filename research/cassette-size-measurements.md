# Recorded-cassette observation size baseline

Measured by
`reports encoded journal and cassette sizes for changed and unchanged graph observations`
for a maintained 100-task chain. Ninety-nine tasks are tracker-complete, the
last task is open, and the production loop reads the same complete graph three
times: one changed observation followed by two compact unchanged
reconfirmations.

The measurement encodes values with their maintained Effect Schema, serializes
the encoded value as JSON, and counts UTF-8 bytes. Journal measurements include
the complete physical journal envelopes for the selected observation records.
Recorded-cassette measurements include the cassette root and the selected
domain entries, without journal keys, positions, event payload versions, or
database encoding.

| Observation representation | Occurrences | Journal bytes | Recorded cassette bytes |
| --- | ---: | ---: | ---: |
| Complete changed graph observation | 1 | 24,586 | 24,593 |
| Compact unchanged graph reconfirmation | 2 | 11,829 | 11,747 |

These numbers are a regression-visible baseline, not evidence for a delta,
compression, or content-addressing design.
