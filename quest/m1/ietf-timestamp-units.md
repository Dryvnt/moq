# [XS] IETF drafts 14-16 send object-scope timestamps

## Goal

On moq-transport drafts 14 through 16, where SUBSCRIBE_OK can't carry
TIMESCALE, the Rust publisher writes an object-scope TIMESCALE beside each
Timestamp. A Rust subscriber then reads those objects as timed, so
Rust-to-Rust on those drafts keeps its timeline, and no object carries a
Timestamp without units, as `drafts/draft-lcurley-moq-timestamp.md`
requires.

## Plan

Decided 2026-10-05 11:39 +0200: send object-scope units rather than stop
sending timestamps, which was this quest's earlier goal. #4822 already
encodes and reads them (`ObjectTime::Object`), and peers ignore object
properties they don't know. The cost is about two bytes per object.

`ObjectTime::new` (`rs/moq-net/src/ietf/publisher.rs`) picks `Track` whenever
the track has a timescale, but `Properties::encode` never writes TIMESCALE
before draft-17 (`rs/moq-net/src/ietf/properties.rs`). On drafts 14-16, pick
`Object` instead. Test that a timed frame stays timed over IETF 14 and 16,
with and without a relay, in `rs/moq-net/tests/untimed.rs`.

Decided 2026-10-05 11:39 +0200: Rust only. js/net's publisher has the same
gap (`stamped` in `js/net/src/ietf/publisher.ts`). It goes to [JS untimed
model](/quest/m1/js-untimed-model.md), which owns reading object-scope units
in JS.

Fix the stale `track::Info::timescale` doc (`rs/moq-net/src/model/track.rs`)
if it still says IETF always falls back to local milliseconds. Fix
`doc/concept/standard.md` if it says drafts 14-16 deliver untimed frames.

Wire: drafts 14-16 objects gain an object-scope TIMESCALE property, which the
timestamp draft already allows. Public API: none. Lands on `main`.

## Required

- [Untimed model](/quest/m1/untimed-model.md) - adds object-scope units and their receive path
