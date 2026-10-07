# [M] JS requests wait for a stream slot without timing out

## Goal

A `@moq/net` request whose stream open is waiting for the peer to free a
stream slot never fails with `ControlTimeout`, and never leaves more than one
waiting open per live request. The 10 s setup deadline covers only the peer's
answer once the stream is open, so `ControlTimeout` means "the peer never
answered", and `@moq/watch`'s re-subscribe on it
([#4999](https://github.com/moq-dev/moq/pull/4999)) can't pile up waiting
opens on Firefox or the WebSocket fallback. Covers every per-request setup on
lite and IETF: subscribe, track info, fetch, and announce interest.

Out of scope: publisher group streams, and Chrome's immediate rejection
(below).

## Plan

Opens use `waitUntilAvailable: true`, and the subscribe setup deadline is
started before the open, so a request waiting on stream credit times out as a
`ControlTimeout`. Neither WebTransport nor `@moq/qmux` can cancel a waiting
create; `@moq/net` resets the stream when it finally opens. Each retry after
such a timeout therefore adds another waiting create, served oldest first.

Engine behaviour (2026-10-07):

- Firefox ignores `waitUntilAvailable` and always queues an over-limit create
  (FIFO, no cancel).
- `@moq/qmux` (the WebSocket fallback, and so Safari) waits on its stream
  credit FIFO, ignoring the flag, with no cancel.
- Chrome never waits: an over-limit create rejects at once with a
  `NetworkError`, whatever the flag, until crbug.com/487117768 lands. Once it
  does, Chrome waits like Firefox, and the spec offers no cancel either.

Decided (2026-10-07, with OneTooMany):

- A request waits for a slot with no deadline. It gives up only when its
  demand leaves or the session closes; a stream that opens after that is
  reset. The response deadline starts once the stream is open. Rust already
  works this way (no setup deadline, a dropped open is cancelled cleanly), and
  the IETF publisher's announce advertisement already opens outside its
  timeout. Rejected: keeping an open deadline with a distinct "no stream
  slot" error (still one waiting create per attempt, and callers must decide
  whether to retry it), and a per-session opener that caps waiting creates,
  hands a late stream to the next waiter and orders by priority (bounds
  everything, but [L] and beyond this goal).
- `ControlTimeout` narrows to "opened, unanswered", which is what the lite
  draft's 0x31 text already says. No draft change.
- Scope is every per-request setup, not only subscribe.
- Chrome's immediate rejection stays terminal. Fix the stale "Chrome silently
  blocks" and "Chrome ~100" comments in both subscribers; the stream cap is
  the peer's MAX_STREAMS (the Rust relay grants 10,000 by default).
- No cancel in `@moq/qmux`: with at most one waiting create per live request
  it adds little.
- Documentation stays inline: comments and any doc describing the setup
  timeout.

Things to look out for:

- The lite subscriber has no abandonment watch during setup (the IETF one has
  `waitAbandoned`), so a request whose demand leaves while its open waits
  needs one here.
- `Stream.open` needs a mode that waits until cancelled rather than until a
  deadline; `Writer.tryOpen` already has a cancel.
- On lite-05+ a subscribe opens the TRACK stream and then the SUBSCRIBE
  stream; both opens wait, and only the answer is under the deadline.
- On IETF drafts 14-16 requests ride the control stream and need no stream
  credit; only real opens (draft 17, v16 SubscribeNamespace) are affected.
- Demand churn can still add waiting creates (a viewer leaves, the late
  stream is reset, a new viewer opens again). That is bounded by viewers, not
  time.

Tests (mocked time): give the mock transport an optional stream limit with
FIFO creates and slots returned when a stream closes. With the limit held, a
subscribe whose open waits doesn't fail after 10 s; a watch-like retry loop
over several deadlines leaves at most one waiting create; a freed slot lets
the waiting create carry the SUBSCRIBE and the track delivers; a stream that
opened but got no answer still fails with `ControlTimeout`; demand leaving
during the wait resets the late stream. Cover lite and IETF draft 17.

Public API: none. Behaviour: `ControlTimeout` no longer covers waiting for a
stream slot. Wire: none.

## Related

- [JS abandonment](/quest/m1/js-subscribe-abandonment.md) - edits the IETF setup path; land after its PRs to avoid conflicts
- [JS GOAWAY requests](/quest/m1/js-goaway-requests.md) - adds a check at every open site this touches; land after its PR
- [JS request window](/quest/m1/js-request-window.md) - the IETF setup can also wait, unbounded, on MAX_REQUEST_ID before its deadline starts
