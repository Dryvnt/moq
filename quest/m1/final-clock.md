# [S] The catalog clock is final from its first snapshot

## Goal

Every catalog snapshot a consumer can read carries the final root `clock`,
and nothing re-anchors it after a snapshot is out. Today fMP4 and MKV imports
publish the catalog when their init segment (`moov`, `Tracks`) resolves the
reservation, on a provisional clock, then re-anchor it on the first frame
(`catalog::Producer::anchor`). Readers that copy the clock once (moq-hls
export's `EXT-X-PROGRAM-DATE-TIME` and `availabilityStartTime`, derived
broadcasts) keep the provisional one, and the hang draft says the mapping is
"fixed for the broadcast".

Non-goals: per-importer offsets for sources sharing a catalog (that is
[shared-clock](/quest/m2/shared-clock.md)), and JS publish.

## Plan

The anchor is unreleased, and this breaks an in-tree path (an fMP4 or MKV
import read by moq-hls export), so it lands before the next release cut.
Requested by an external consumer (OneTooMany); scope and milestone are
proposals for the maintainer.

Decided (2026-10-05):

- fMP4 and MKV hold their initial reservation until their first frame
  anchors, as FLV already does (`flv/import.rs`, "anchored before the
  reservation below publishes"). The first snapshot then carries the anchored
  clock. PTS stays verbatim for a single importer, so a passthrough fragment's
  `tfdt` still agrees with its frame timestamp.
- The first catalog publish fixes the clock (sets `anchored`), whatever
  triggered it. A snapshot on the wire is a mapping a reader may have copied.
- An importer whose first frame arrives after a snapshot is out keeps its
  PTS verbatim (the anchor is a no-op), the same as on a `with_clock` catalog
  today. No in-tree path reaches it: every importer takes a `Reserved`.
  shared-clock replaces this with its per-importer offset.
- Rejected: fixing the clock at catalog creation and offsetting every
  importer. Every fMP4 passthrough would carry a frame timestamp that
  disagrees with its `tfdt`, which needs
  [cmaf-frame-timestamp](/quest/m2/cmaf-frame-timestamp.md) first, and it
  subsumes most of shared-clock.
- Rejected: omitting `clock` until anchored. Adding it later is still a change
  copy-once readers miss.

Guidance:

- An fMP4 `moov` declares every track at once, and MKV's `Tracks` likewise, so
  the first frame of any track releases the hold. Several importers on one
  catalog (moq-hls import's renditions) each hold their own reservation, so the
  catalog still waits for all of them.
- Tests (fail on `main` for fMP4 and MKV): for each of fMP4, MKV, FLV, and TS,
  a catalog consumer's first snapshot carries the anchored clock and later
  snapshots never change it. Plus an end-to-end fMP4 import into moq-hls export
  whose `EXT-X-PROGRAM-DATE-TIME` matches the anchored clock.
- Docs: fix `Config::with_clock`, `Producer::clock`, and `Producer::anchor`
  comments, `doc/lib/rs/moq-mux.md`, and add an `Unreleased` line in
  `doc/setup/upgrade.md`: the catalog now appears at an importer's first frame,
  not its init segment. If [#4821](https://github.com/moq-dev/moq/pull/4821)
  has landed, align its `Clock` docs, which say a copy goes stale when an
  importer re-anchors.

Public API: no new items. A catalog fed by an fMP4 or MKV importer is
published at the first frame instead of the init segment, and its root clock
never changes after. Wire: none; the hang draft already says the mapping is
fixed.

## Related

- [Shared clock](/quest/m2/shared-clock.md) - per-importer offsets once the clock is fixed before an importer's first frame
- [Mux data timestamp](/quest/m1/mux-data-timestamp.md) - data producers stamp on the catalog clock this fixes
