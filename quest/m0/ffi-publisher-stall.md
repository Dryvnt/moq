# [M] FFI publishers stay connected through interop

## Goal

Every cell of `just test interop --all` with a Go or Python publisher passes
reliably on `main` and in nightly CI, with the cause found and fixed. Today a
moq-ffi publisher goes silent, not even sending QUIC keep-alives, until the
relay's 10 s idle timeout closes its connection and it reconnects. The
browser cells (`go -> js`, `python -> js`) can't absorb that within their
30 s limit and fail at 32 to 33 s; the others (`-> rust`, `-> python`,
`-> gst`) pass slowly at 10 to 11 s or fail intermittently. The harness fails
any cell whose connection idles out, so a drop and reconnect can no longer
pass as a slow cell.

## Plan

Facts (2026-10-08, line numbers at time of writing):

- Run 37511624075 (`main` at 29792f815): `python -> js` and `go -> js`
  failed; `python -> rust` (11 s), `go -> rust` (10 s) and both `-> gst`
  cells (10 to 11 s) passed slowly. The browser saw the Python broadcast go
  offline, come back, and go offline again. On the auth line the browser's
  tone subscription was reset with code 0. PR runs 37710920335 and
  37676389320 fail non-browser cells the same way; other runs pass, so it is
  intermittent.
- A local run's `relay.log`: the relay subscribes upstream on the
  publisher's connection, logs `connection closed err=transport: connection
  error: timed out` 10 s later, and the publisher reconnects from the same
  port. The publisher logs nothing.
- The 10 s is `DEFAULT_IDLE_TIMEOUT` (`rs/moq-tokio/src/quic.rs:98`,
  keep-alive 3 s at `:104`). It predates the passing nightlies, so the
  trigger is the publisher going silent, not the timeout.
- Go stalls too, so the cause is in moq-ffi or below, not `py/`. Unproven
  lead: `rs/moq-ffi/src/ffi.rs:41` runs everything on one single-threaded
  runtime thread, which may block once the first subscribes arrive.
- The nightlies up to 2026-10-05 (11b28de07) passed, with `python -> rust`
  at 1 to 4 s. The regression is in 11b28de07..29792f815 (92 commits).

Decided 2026-10-08:

- Moved from m1 and widened from the browser cells: the stall masks interop
  on every wire PR, and may disconnect real FFI publishers.
- Bisect the window on a cell that reproduces locally, then fix the cause.
  Never raise a timeout or add a retry.
- The harness fails a cell when any connection in it idles out (the relay
  logs `timed out`), so this class of regression fails every run instead of
  passing slowly. Land a moq-ffi regression test too if the cause allows one.

Public API: none expected. Wire: none.

## Related

- [CI runner stalls](/quest/m1/ci-runner-stalls.md) - shorter freezes of both interop tracks on CI runners, a different symptom
