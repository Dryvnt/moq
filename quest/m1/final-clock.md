# [S] The catalog clock is final from its first snapshot

## Goal

Every catalog snapshot a consumer can read carries the final root `clock`,
and nothing re-anchors it after a snapshot is out. Today fMP4 and MKV imports
publish the catalog when their init segment (`moov`, `Tracks`) resolves the
reservation, and an Opus-only MPEG-TS import when its PMT does, on a
provisional clock, then re-anchor it on the first frame
(`catalog::Producer::anchor`). Readers that copy the clock once (moq-hls
export's `EXT-X-PROGRAM-DATE-TIME` and `availabilityStartTime`, derived
broadcasts) keep the provisional one, and the hang draft says the mapping is
"fixed for the broadcast".

Non-goals: per-importer offsets for sources sharing a catalog (that is
[shared-clock](/quest/m1/shared-clock.md)), and JS publish.

## Plan

The anchor is unreleased, and this breaks an in-tree path (an fMP4 or MKV
import read by moq-hls export), so it lands before the next release cut.
Requested by an external consumer (OneTooMany); scope and milestone are
proposals for the maintainer.

Decided (2026-10-05):

- fMP4, MKV, and MPEG-TS hold their initial reservation until their first
  frame anchors, as FLV already does (`flv/import.rs`, "anchored before the
  reservation below publishes"). The first snapshot then carries the anchored
  clock. PTS stays verbatim for a single importer, so a passthrough fragment's
  `tfdt` still agrees with its frame timestamp.
- The first catalog publish fixes the clock (sets `anchored`), whatever
  triggered it. A snapshot on the wire is a mapping a reader may have copied.
- An importer whose first frame arrives after a snapshot is out offsets its
  PTS by shared-clock's mechanism, which is why shared-clock is required. A
  data track or catalog section publishes the moment it is registered
  (`Producer::data_entry` holds its reservation only for `init`), so a
  container set up after one, in any order moq-c and moq-ffi allow, joins a
  clock it didn't place. moq-hls import's later renditions also reach it, and
  share the first rendition's offset through their `Reserved`.
- Rejected: a late anchor as a no-op with verbatim PTS (an fMP4 an hour into
  its `tfdt`, or a TS PTS up to about 26.5 h, lands that far off the clock), a
  warning or a refusal until shared-clock lands (a regression on `main` for an
  order the bindings allow), and holding every publish until a container
  anchors (a data-only or capture-only catalog would never publish).
- Rejected: folding shared-clock into this quest. Each keeps its own reviewed
  plan, and this one shrinks to the hold and the publish rule.
- Rejected: fixing the clock at catalog creation and offsetting every
  importer. Even a lone importer, the common case, would carry frame
  timestamps that disagree with its `tfdt`, leaning on
  [cmaf-frame-timestamp](/quest/m1/cmaf-frame-timestamp.md) for every fMP4
  passthrough instead of only a joining one.
- Rejected: omitting `clock` until anchored. Adding it later is still a change
  copy-once readers miss.

Guidance:

- An fMP4 `moov` declares every track at once, and MKV's `Tracks` likewise, so
  the first frame of any track releases the hold.
- MPEG-TS drops its hold after the PMT (`ts/import.rs`, "Every stream in the
  initial program is registered now"). Video configs resolve only on the first
  frame, after the anchor, but Opus builds its config from PMT descriptors, so
  an Opus-only stream publishes before its first PES anchors. Keep the hold
  until the first anchor.
- moq-hls import mints each rendition's importer lazily, so the first
  rendition can publish before later ones exist. The clock is still final:
  later renditions take the first one's offset (zero) through their shared
  `Reserved`, so they land on the same timeline.
- Tests (fail on `main` for fMP4, MKV, and Opus-only TS): for each of fMP4,
  MKV, FLV, and TS, a catalog consumer's first snapshot carries the anchored
  clock and later snapshots never change it. The TS case is Opus-only with a
  nonzero first PTS, since a video stream's config resolves only on its first
  frame, after the anchor. Also a TS program of only verbatim PIDs, which
  publish through `modify` with no reservation.
  Plus an end-to-end fMP4 import into moq-hls export whose
  `EXT-X-PROGRAM-DATE-TIME` matches the anchored clock. And a data track
  registered before a container's first frame, then a container starting at a
  nonzero PTS: the clock never moves, and the container's frames land at now.
  This rewrites `a_write_follows_the_anchored_clock` (`binary.rs`, `json.rs`)
  and `an_anchor_is_not_jitter` (`binary.rs`), which create a data track and
  then anchor.
- fMP4 detects a duplicate `moov` by its reservation being gone
  (`fmp4/import.rs`, `DuplicateMoov`). Holding it to the first fragment lets a
  second `moov` slip through, so key the check on the parsed `moov` instead.
  Likewise check that a TS PMT version change before the first PES does not
  re-reserve against the held handle.
- Docs: fix `Config::with_clock`, `Producer::clock`, and `Producer::anchor`
  comments, `doc/lib/rs/moq-mux.md` (its promise that a data track created
  before the first frame follows the anchor), and add an `Unreleased` line in
  `doc/setup/upgrade.md`: the catalog now appears at an importer's first frame,
  not its init segment. If [#4821](https://github.com/moq-dev/moq/pull/4821)
  has landed, align its `Clock` docs, which say a copy goes stale when an
  importer re-anchors.

Public API: no new items. A catalog fed by an fMP4, MKV, or Opus-only TS
importer is published at the first frame instead of the init segment, and its root clock
never changes after. Wire: none; the hang draft already says the mapping is
fixed.

## Required

- [Shared clock](/quest/m1/shared-clock.md) - an importer joining a clock already fixed offsets its PTS instead of moving it
