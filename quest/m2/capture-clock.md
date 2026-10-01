# [S] Captures stamp on the catalog's current clock

## Goal

A moq-audio or moq-video capture sharing a catalog with a container importer
stamps on the clock the importer's first frame anchors, even when the capture
started first. Today both copy `catalog.clock()` once at startup
(`rs/moq-audio/src/encode/capture.rs`, `rs/moq-video/src/encode/producer.rs`),
so after the anchor their frames sit on the catalog's starting clock while the
importer's sit on the anchored one.

## Plan

Follow-up of [#4668](https://github.com/moq-dev/moq/pull/4668), which fixed
the same stale copy for JSON and binary data tracks. The first-frame anchor
exists only on `dev`, so this targets `dev`.

Decided (2026-10-01):

- Re-read `catalog.clock()` when stamping, rather than make `moq_mux::Clock` a
  shared live handle. Same shape as #4668, with no public API change. A shared
  handle would also fix copies applications hold, but it breaks a public
  `Copy` type and every stamper still needs to detect the break.
- m2: nothing in-tree reaches it. `moq-cli publish` runs a capture or a stdin
  import, never both, and moq-ffi does not expose capture. Only a Rust caller
  passing `publish_capture` a catalog shared with an importer hits it.
- One quest for both crates: the same pattern and test.

Guidance:

- A changed wall mapping is a break in the capture's timeline. Mark it the way
  each already marks a stop (video `discontinuity`, audio `reset_epoch`), and
  recompute video's per-open `capture_epoch` then, not at the next open.
- Document on `catalog::Producer::clock` that the value is a snapshot an
  importer's first frame replaces, for applications that stamp with it.
- Test with a default-clock catalog anchored while a synthetic capture runs.
  The existing `mod clock` fixtures pin the clock with `with_clock`, which is
  never re-anchored.

Public API: none. Wire: none.

## Related

- [Audio capture time](/quest/m2/audio-capture-time.md) - maps audio's capture timeline onto the broadcast clock once per open, which must recompute on an anchor too
