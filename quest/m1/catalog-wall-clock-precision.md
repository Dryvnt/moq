# [XS] Exact catalog wall clock

## Goal

`hang::catalog::Clock::wall_clock(pts)` returns the exact instant
`wall + pts` names, down to the nanosecond, instead of rounding down to the
millisecond. Today it computes
`unix_millis = MOQ_EPOCH_UNIX_MILLIS + total * 1000 / scale` and returns
`UNIX_EPOCH + Duration::from_millis(unix_millis)`, dropping up to 999 µs of a
microsecond wall. `moq_mux::Clock::wall_clock` delegates to it and documents
"Refuses an unrepresentable result rather than truncating it", which this
contradicts. Any caller turning a pts into a wall time loses the
sub-millisecond part, and one that rebuilds a mapping from the result
(`Clock::at(…, wall_clock(ZERO))`) re-advertises a wall up to 999 µs early.

Non-goal: JS `wallClockTime`, which returns a millisecond `Date` by nature.

## Plan

Decided 2026-10-12: split from
[the mux clock constructor](/quest/m1/mux-clock-from-wall.md); the two are
independent.

Compute whole seconds and the remainder from `total` and the scale, and
build the `Duration` from seconds plus nanos (checked, keeping the existing
`TimestampOverflow` for a wall `SystemTime` cannot reach). A wall in a
timescale like 90 kHz names instants finer than a nanosecond; floor that
remainder (decided 2026-10-12: refusing it would break ordinary 48 kHz and
90 kHz pts), and say so in both `wall_clock` docs instead of "rather than
truncating".

Tests: a whole-microsecond `wall` with a sub-millisecond part round-trips,
`moq_mux::Clock::at(epoch, wall)` → `wall_clock(ZERO)` gives back `wall`;
the existing cross-timescale cases still hold; a 90 kHz value floors to the
nanosecond.

Public API: none (behavior fix). Wire: none.

## Related

- [A mux Clock from a catalog clock](/quest/m1/mux-clock-from-wall.md) - builds the same mapping in the other direction
