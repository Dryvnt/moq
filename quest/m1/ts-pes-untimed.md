# [XS] A PES without a PTS imports untimed

## Goal

The MPEG-TS importer publishes a PES that carries no PTS as an untimed frame,
instead of stamping it 0. Asynchronous private data such as KLV is the usual
case. `drafts/draft-lcurley-moq-mpegts.md` says the same.

## Plan

Decided (2026-10-02 12:43 +02:00): its own quest, because it lands
independently in a different crate. 0 is the sentinel that
[moq-net carries untimed frames faithfully](/quest/m1/untimed-model.md)
rejected, because it collides with a real pts of 0.

Check which stream types this applies to. A media elementary stream may
legitimately split an access unit across PES packets, or infer timing.
There, "no PTS" doesn't mean untimed, and the importer's existing handling
stays. Check the TS exporter for the reverse: an untimed frame should go out
as a PES with no PTS.

Test: a private-data PES with no PTS imports untimed and exports back
without a PTS.

Public API: none. Wire: the mpegts draft's mapping of a missing PTS changes.

## Required

- [moq-net carries untimed frames faithfully](/quest/m1/untimed-model.md) - a frame must be able to carry no timestamp
