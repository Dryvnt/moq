# [M] Fallback renditions

## Goal

A hang video rendition marked `fallback: true` is only selected
automatically when no non-fallback rendition can be decoded. `<moq-watch>`,
`hang::catalog::Video::ranked`, and WHEP's codec choice honor it, so a viewer
and every single-rendition egress (single-track RTMP play, WHEP, FLV export,
moq-transcode's source pick) only subscribe to a transcode (such as H.265
republished as H.264) when they must. A multitrack RTMP client still receives
every rendition, fallbacks included.

## Plan

Decided in a planning interview on 2026-10-01:

- A boolean `fallback`, not a numeric `cost` or `preference`. Routing cost
  picks between paths to the same bytes. Renditions are different pictures,
  and an honest "produced on demand" cost would mark moq-transcode's rungs,
  so a strict rule would stop capable viewers from ever stepping down. The
  field names the role (a compatibility fallback), so moq-transcode's rungs
  stay `false` and keep adapting. DASH's `@selectionPriority` across
  per-codec Adaptation Sets is the precedent for the strict rule. Two tiers
  cover the use case; multi-level ranking waits for a consumer.
- Video only. Optional on the wire, absent means `false`, omitted when
  `false` (like `stalled`). Additive, so older players ignore it.
- Selection order in `js/watch/src/video/source.ts`: decode support, then
  drop fallbacks when any supported non-fallback remains, then `stalled`,
  then the existing target and bitrate pick within what is left. Fallback is
  about decodability only: a stalled source does not move capable viewers
  onto a transcode, which is derived from it and likely stalled too.
- A manual `target.name` still wins, as it does for `stalled`. The quality
  picker keeps listing fallbacks.
- `Video::ranked` sorts every fallback after every non-fallback, then by
  picture and bitrate as today. RTMP play, FLV export, and moq-transcode take
  the first rendition they support, so they need no change. Update the
  [JS rendition ranking](/quest/m1/js-ranked.md) Plan if it is still open.
- WHEP needs its own step: `Session::handle_media` (`rs/moq-rtc`) takes the
  peer's first negotiated payload type, then `pick_video` filters `ranked()`
  to that codec, so a peer offering the fallback's codec first would get the
  fallback. Choose across every negotiated video codec so a supported
  non-fallback wins.
- Update `rs/hang` `VideoConfig`, `js/hang` `VideoConfigSchema`,
  `drafts/draft-lcurley-moq-hang.md` (next to `stalled`, with a
  source-plus-fallback example), and `doc/concept/hang.md`. No new docs page.
- Tests: a supported source wins over a fallback with a higher bitrate, over
  a bitrate budget that fits only the fallback, and while the source is
  stalled and the fallback is not; an unsupported source selects the
  fallback; a manual `target.name` selects a fallback; `ranked` orders a
  larger fallback after a smaller source; a WHEP peer offering the fallback's
  codec first still gets the source.
- Out of scope: moq-ffi, libmoq, and the bindings until a native player needs
  the field. moq-transcode producing same-size codec fallbacks; the consumer
  publishes its own.

## Related

- [JS rendition ranking](/quest/m1/js-ranked.md) - mirrors `Video::ranked` in `@moq/hang`, which now sorts fallbacks last
- [Audio rendition pick](/quest/m1/audio-ranked.md) - audio ranking, where `fallback` could join later
