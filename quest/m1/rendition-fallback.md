# [S] Fallback renditions

## Goal

A hang video rendition marked `fallback: true` is only chosen when no
non-fallback rendition can be decoded. `<moq-watch>` and
`hang::catalog::Video::ranked` both honor it, so a viewer, RTMP play, WHEP,
FLV export, and moq-transcode's source pick only subscribe to a transcode
(such as H.265 republished as H.264) when they must.

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
  picture and bitrate as today. Its callers take the first rendition they
  support, so they need no change. Update the
  [JS rendition ranking](/quest/m1/js-ranked.md) Plan if it is still open.
- Update `rs/hang` `VideoConfig`, `js/hang` `VideoConfigSchema`,
  `drafts/draft-lcurley-moq-hang.md` (next to `stalled`, with a
  source-plus-fallback example), and `doc/concept/hang.md`. No new docs page.
- Tests: a supported source wins over an unstalled fallback with a higher
  bitrate or a bitrate budget that fits only the fallback; an unsupported
  source selects the fallback; `ranked` orders a larger fallback after a
  smaller source.
- Out of scope: moq-ffi, libmoq, and the bindings until a native player needs
  the field. moq-transcode producing same-size codec fallbacks; the consumer
  publishes its own.

## Related

- [JS rendition ranking](/quest/m1/js-ranked.md) - mirrors `Video::ranked` in `@moq/hang`, which now sorts fallbacks last
- [Audio rendition pick](/quest/m1/audio-ranked.md) - audio ranking, where `fallback` could join later
