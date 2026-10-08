# [M] FFI publishers stay connected through interop

## Goal

Every cell of `just test interop --all` with a Go or Python publisher passes
reliably on `main` and in nightly CI, with the cause found and fixed. Today a
moq-ffi publisher goes silent, not even sending QUIC keep-alives, until the
relay's 10 s idle timeout closes its connection and it reconnects. The
browser cells (`go -> js`, `python -> js`) can't absorb that within their
30 s limit and fail at 32 to 33 s; `-> rust` and `-> gst` pass slowly at 10
to 11 s, and in some runs most cells of one publisher fail at 11 s. The
harness fails any cell whose connection idles out, so a drop and reconnect
can no longer pass as a slow cell.

## Plan

Facts (2026-10-08, line numbers at time of writing):

- Run 37511624075 (`main` at 29792f815): `python -> js` and `go -> js`
  failed; `-> rust` and `-> gst` (10 to 11 s) passed slowly; the rest passed
  in 0 to 1 s. Those subscribers exit on their first byte, while `-> rust`
  and `-> gst` exit only on their next write after `head` closes, so the
  publisher delivers its first data and then stalls. A bisect therefore
  judges by `-> rust`'s time or the browser cells; the one-byte cells pass
  either way. The browser saw the Python broadcast go offline, come back,
  and go offline again. On the auth line the browser's tone subscription was
  reset with code 0.
- PR runs 37710920335 (Python) and 37676389320 (Go) fail most cells of that
  publisher at 11 s, one-byte cells included, so it can stall before the
  first byte too. Other runs pass, so it is intermittent.
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
- The harness fails a cell when any connection in it idles out, so this
  class of regression fails every run instead of passing slowly. Land a
  moq-ffi regression test too if the cause allows one.
- The harness shuts down every client it starts cleanly, so every idle-out
  counts. Today `gst-launch` dies on SIGPIPE and `moq-cli` can be killed
  under `timeout -k`, which may leave a QUIC connection to idle out. No
  exception list for killed clients: it would hide a real idle-out behind a
  harness kill.

Harness pitfall: one relay serves the whole run, and its `connection closed
err=... timed out` warning (`rs/moq-relay/src/relay.rs:792`) names no
connection and lands about 10 s after the peer went quiet, often in a later
cell. Tie each idle-out to its connection first, by logging the connection
there or having the client report its own drop.

Public API: none expected. Wire: none.

## Related

- [CI runner stalls](/quest/m1/ci-runner-stalls.md) - shorter freezes of both interop tracks on CI runners, a different symptom
