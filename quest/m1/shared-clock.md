# [M] One timeline for every source on a catalog

## Goal

Every source sharing a catalog (captures, and any number of container
importers) lands on one forward timeline, whichever starts first. Today the
first importer's first frame re-anchors the catalog clock
(`catalog::Producer::anchor`). A capture that started earlier has copied the
old clock, and a second importer's anchor is a no-op, so it publishes its own
PTS base on a clock it didn't place. Either way the sources drift apart. Following the new clock doesn't help: sources near PTS 0 step it
backwards, and `container::Producer::write` refuses a group below the last one
(`TimestampRewind`), even across a discontinuity.

## Plan

Follow-up of [#4668](https://github.com/moq-dev/moq/pull/4668), which moved
data tracks onto the anchored clock. The anchor is unreleased.

Decided (2026-10-01):

- The clock never moves once something stamps with it. The public
  `catalog::Producer::clock()` fixes the mapping (sets `anchored`).
  [final-clock](/quest/m1/final-clock.md) then makes the first catalog
  publish fix it too. Crate-internal
  readers, like #4668's `Listing`, read the state without fixing it.
- An importer anchors once, on its first frame, and gets back an offset: zero
  if it placed the mapping (PTS stays verbatim), `clock.now() - first_pts`
  otherwise. Every frame from that importer, on all of its tracks, is shifted
  by that offset, so its audio and video stay in sync. Separate importers get
  separate offsets.
- Captures read the clock once and never re-check it. Audio already stamps by
  sample count from one `clock.now()` per epoch; there is no per-frame clock
  read to add.
- Rejected: captures re-read the clock per frame and mark a break when it
  changes. A backward anchor would hit `TimestampRewind`, and every audio
  buffer would take the catalog lock to watch for an event that should never
  happen while it is live.
- The offset rewrites only the moq-lite frame timestamp, never the payload. An
  fMP4 passthrough fragment keeps its source `tfdt`, so the two disagree. The
  frame timestamp is the broadcast timeline; a payload's timestamps are only
  relative within the frame. Ad insertion (splicing sources with unrelated PTS
  bases) needs the same rule.
Decided (2026-10-05):

- m1, ahead of [final-clock](/quest/m1/final-clock.md), which needs the
  offset: once the first publish fixes the clock, a container set up after a
  data track or catalog section (any order moq-c and moq-ffi allow) joins a
  clock it didn't place.
- One source's offset lives on a public `catalog::Source` handle, separate
  from the publication gate: `catalog.source()` returns a clonable handle for
  one PTS base, and `source.reserve()` mints a `Reserved` gated as today that
  shares the source's offset. The first anchor through any of them sets it.
  `catalog.reserve()` keeps a fresh offset per call. Holding a `Source` never
  withholds the catalog. moq-hls import holds one for the whole import, so its
  renditions (separate fMP4 importers on one PTS base) and every replacement
  importer on an `EXT-X-MAP` change share one offset; separate offsets would
  shift each by its first frame's arrival gap. The name is a proposal for the
  maintainer.
- Rejected: sharing the offset through `Reserved` clones. A live `Reserved`
  withholds the initial catalog, so a handle kept for later importers would
  hold it for the whole import. Also rejected: importers handing the offset
  to each other (`with_offset` on all four).

Guidance:

- The offset is signed: a stream starting at 3600 s on a clock reading 10 s
  shifts down. Refuse a frame that would land below zero rather than clamp it.
- A `with_clock` catalog is fixed from the start, so its importers offset too.
  Today they publish verbatim PTS on a clock they didn't place.
- Document on `catalog::Producer::clock` that taking the clock fixes it.
- Test: moq-hls import receives its initial catalog while its `Source` is
  alive, then replaces a rendition's importer, and the replacement keeps the
  same offset.
- Test: start a synthetic capture, then import an fMP4 starting at PTS 0. Both
  tracks advance from the capture's timeline with no rewind. Also cover the
  reverse order: an importer first keeps its PTS verbatim. A passthrough
  fragment whose `tfdt` disagrees with its frame timestamp decodes at the frame
  timestamp, in Rust and JS.

Public API: `catalog::Source`, `catalog::Producer::source`, and
`Source::reserve` are new. `catalog::Producer::clock()` now fixes the mapping,
and importers no longer publish verbatim PTS when the clock was already taken.
Wire: none.

## Required

- [CMAF frame timestamp](/quest/m1/cmaf-frame-timestamp.md) - decoders honour an offset frame timestamp on passthrough tracks

## Related

- [Audio capture time](/quest/m2/audio-capture-time.md) - maps audio's capture timeline onto the broadcast clock once per open
