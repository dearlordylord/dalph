# Recorded-cassette observation size baseline

Measured by
`reports encoded journal and cassette sizes for changed and unchanged graph observations`
for the maintained singleton authored cassette.

The measurement encodes values with their maintained Effect Schema, serializes
the encoded value as JSON, and counts UTF-8 bytes. Journal measurements include
the complete physical journal envelopes for the selected observation records.
Recorded-cassette measurements include the cassette root and the selected
domain entries, without journal keys, positions, event payload versions, or
database encoding.

| Observation representation | Occurrences | Journal bytes | Recorded cassette bytes |
| --- | ---: | ---: | ---: |
| Complete changed graph observation | 1 | 2,377 | 2,395 |
| Compact unchanged graph reconfirmation | 2 | 4,648 | 4,599 |

These numbers are a regression-visible baseline, not evidence for a delta,
compression, or content-addressing design. The singleton graph is intentionally
representative of the maintained cassette seam rather than a claim about large
production graphs.
