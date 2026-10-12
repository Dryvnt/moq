# [S] A mux Clock from a catalog clock

## Goal

`moq_mux::Clock::from_wall(hang::catalog::Clock)` is public, so a
derivative broadcast (a transcode ladder, or one assembled from other
broadcasts) builds its catalog with
`Config::with_clock(Clock::from_wall(input_clock)?)` and re-advertises its
input's wall mapping exactly. Requested downstream.

A derivative republishes its input's timestamps, which only mean something
under the input's mapping. Today the only public way to carry it over is
`Producer::modify()` setting `clock` on the catalog, which rewrites the
advertised field but leaves the producer's internal `Clock` fresh. That
internal clock drives `Producer::clock()`, `timestamp(None)`, the json and
binary data tracks' stamping, and importer offsets (`Producer::anchor`), so
it disagrees with the mapping the catalog advertises. `Clock::at(Instant,
SystemTime)` can express the mapping, but the caller has to invent an
`Instant` for the input's PTS zero (`Instant::now() - (SystemTime::now() -
wall)`), and on Windows, whose `Instant` cannot go below its origin, that
subtraction fails for a PTS zero before the host's boot.

Non-goals: moving moq-transcode (`populate` in
`rs/moq-transcode/src/catalog.rs` sets `out.clock = source.clock`) onto the
new constructor, which is a follow-up; the sub-millisecond loss in
`hang::catalog::Clock::wall_clock`, owned by
[its own quest](/quest/m1/catalog-wall-clock-precision.md); JS publishers,
which already emit microsecond walls; browser support. Every
`moq_mux::Clock` reads `SystemTime::now()`, which panics in the browser, so
none works there today (moq-mux is only compile-checked for wasm32).
Browser wall time comes with [moq-net on moq-time](/quest/m1/time/net.md),
whose ambient clock `from_wall` picks up along with `placed` and `arrival`
(decided 2026-10-12 from review, over adding a browser wall source here or
waiting on moq-time).

## Plan

Decided 2026-10-12:

- Shape: a named constructor `Clock::from_wall`, the inverse of
  `Clock::wall()`. A named function makes visible that it samples now (it
  anchors the monotonic instant at the call), which a `TryFrom` would hide.
  `placed` and `arrival` stay `pub(crate)`.
- Build it on `placed`'s approach: anchor `instant` at now and compute
  `reading` from the wall, with no `Instant` arithmetic. Take the catalog
  wall `Timestamp` as given rather than round-tripping it through
  `SystemTime`, so the stored mapping equals the input's (factor the shared
  part out of `placed` rather than duplicating it).
- Timescale: rescale the wall to `Clock::TIMESCALE` (micro) exactly, and
  refuse one that does not land on a whole microsecond (some 90 kHz values).
  Every first-party publisher already emits micro.
- A PTS zero after this host's now (cross-host skew beyond the input's 10 s
  lead) is refused with `UnmappableTimestamp`, as `placed` does: `now()`
  cannot read a negative timestamp, and saturating would stamp data tracks
  and importers early by the skew without saying so.
- Docs: rustdoc only, no `doc/` page. `Config::with_clock` points a
  derivative at `from_wall` and says writes through `Reserved::video` and the
  codec producers keep their timestamps verbatim; today it only describes
  importers shifting onto a pinned clock.

Tests: a micro wall round-trips (`from_wall(c)?.wall() == c`); a millisecond
wall converts; an inexact wall and a future PTS zero are refused; `now()`
reads the elapsed time since the wall's PTS zero, on a paused clock.

Public API: additive, one new `moq_mux::Clock` constructor. Wire: none.

## Related

- [Exact catalog wall clock](/quest/m1/catalog-wall-clock-precision.md) - the same mapping read back at full precision
- [moq-net on moq-time](/quest/m1/time/net.md) - moves this constructor's clock reads to moq-time
