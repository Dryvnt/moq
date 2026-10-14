# [S] Window codec property tests

## Goal

`@moq/json` and `moq-json` each have a property test that applies random
sequences of window pushes and pops (with resets and group rolls) through the
Window `Encoder` and `Decoder`, and asserts that a reader keeping up sees the
producer's window exactly, and that a reader joining at any group gets the
records its first group carries plus a `skip` for exactly the span it missed. It runs on
every PR and in the nightly. No change to the codec itself unless the test
finds a bug.

## Plan

Decided 2026-10-14, alongside
[Snapshot codec property tests](/quest/m2/json-snapshot-properties.md),
which carries the reasoning for each choice:

- **Codec sequences** through `Encoder` -> `Decoder`, per implementation, at
  the level a consumer sees: push, pop, and skip events.
- **Generators** cover record values with `null` at any depth, `opRatio`
  rolls, `checkpointRecords` bounds, and readers that join late or fall a
  group behind.
- **CI:** fixed seed and modest case count on PRs, random seed and more cases
  nightly. A nightly failure's shrunk case becomes a vector in
  `rs/moq-json/tests/window-vectors.json` alongside the fix.
- **Same PR for both languages** so the two generators stay mirrored.
- **Open: library.** Reuse whatever the Snapshot quest picks; fast-check and
  proptest are suggested.

## Related

- [Snapshot codec property tests](/quest/m2/json-snapshot-properties.md) - the same treatment for the Snapshot codec
