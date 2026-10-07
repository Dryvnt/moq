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

Opens use `waitUntilAvailable: true`, and two deadlines run before a request
has a stream: each open's own `OPEN_TIMEOUT_MS` (`openWithin` in
`js/net/src/stream.ts`), and the subscribe setup deadline around the open.
Either rejects with a `TimeoutError`, which both subscribers map to
`ControlTimeout`, so a request waiting on stream credit times out as one.
Neither WebTransport nor `@moq/qmux` can cancel a waiting create; `@moq/net`
resets the stream when it finally opens. Each retry after
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
  timeout. Both deadlines move off the wait: the per-request opens drop
  `OPEN_TIMEOUT_MS` (moving only the setup deadline would leave the open's
  own timeout producing `ControlTimeout` at 10 s), while the probe, SETUP and
  publisher group streams keep it. Rejected: keeping an open deadline with a
  distinct "no stream slot" error (still one waiting create per attempt, and
  callers must decide whether to retry it), and a per-session opener that
  caps waiting creates, hands a late stream to the next waiter and orders by
  priority (bounds everything, but [L] and beyond this goal).
- A request that has waited for a slot past about 10 s logs a `console.warn`
  once and keeps waiting, so a peer that never grants credit (a limit of zero,
  or slots held forever) shows up for whoever debugs it instead of stalling
  silently. It recovers as soon as a slot frees. Rejected: a long cap with a
  distinct error that `@moq/watch` doesn't retry (the track dies, as on Chrome
  today), and a silent stall that is only documented.
- `ControlTimeout` narrows to "opened, unanswered", which is what the lite
  draft's 0x31 text already says. No draft change.
- Scope is every per-request setup, not only subscribe. Each path gains a
  cancellable wait for its slot and no new answer deadline:
  - subscribe (lite TRACK and SUBSCRIBE opens, IETF draft 17): its existing
    answer deadline starts once the stream is open; the wait ends when demand
    leaves or the session closes. On lite-05+ the answer is the TRACK_INFO
    that subscribe reads through `#trackInfo` (SUBSCRIBE itself gets no
    response), so that TRACK_INFO stays under the deadline, started once the
    TRACK stream opens; the SUBSCRIBE open after it only waits. On older lite
    drafts the answer is SUBSCRIBE_OK;
  - standalone track info and fetch (lite `#exchange`, outside subscribe): no
    answer deadline today and none added; the wait ends with whatever ends
    the request today (the fetched group closing, the subscriber closing);
  - announce interest (lite) and SubscribeNamespace (IETF v16): long-lived,
    so no answer deadline ever; the wait ends when the interest is dropped.
- Chrome's immediate rejection stays terminal. Fix the text it makes stale:
  the "Chrome silently blocks" and "Chrome ~100" comments in both subscribers
  (the stream cap is the peer's MAX_STREAMS; the Rust relay grants 10,000 by
  default), `stream.ts`'s claim that a non-waiting open rejects with
  `QuotaExceededError` and its "matches the subscribe budget" note, and the
  "(browser stream limit reached?)" hint in both subscribe timeout messages,
  which no longer names a plausible cause.
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
  stream; both opens wait, and only TRACK_INFO is under the deadline. Keep
  [#5002](https://github.com/moq-dev/moq/pull/5002)'s handling of a deadline
  that fires mid-setup: the TRACK stream is reset, and a SUBSCRIBE stream
  that opens afterwards is reset with nothing written.
- On IETF drafts 14-16 requests ride the control stream and need no stream
  credit; only real opens (draft 17, v16 SubscribeNamespace) are affected.
- Demand churn can still add waiting creates: each time demand leaves while
  an open waits and then returns, the old create stays queued and a new one
  is made. That is bounded by how often demand comes and goes while slots are
  held, not by time or by viewers. Bounding it too is the per-session
  opener's job, rejected above as beyond this goal.

Tests (mocked time): give the mock transport an optional stream limit with
FIFO creates and slots returned when a stream closes. With the limit held, a
subscribe whose open waits doesn't fail after 10 s, including an open
waiting past `OPEN_TIMEOUT_MS` with no response deadline involved, and logs
one warning; a watch-like retry loop
over several deadlines leaves at most one waiting create; a freed slot lets
the waiting create carry the SUBSCRIBE and the track delivers; a stream that
opened but got no answer still fails with `ControlTimeout`, including a
lite-05+ subscribe whose TRACK stream opens but whose TRACK_INFO never
comes, while one whose TRACK open waits for credit doesn't; demand leaving
during the wait resets the late stream; repeated leave and return cycles
while slots stay held leave one queued create per cycle, no more. Cover
lite and IETF draft 17, and a fetch and an announce interest whose opens wait.

Public API: none; the open deadline and the new wait mode are internal to
`@moq/net`. Behaviour: `ControlTimeout` no longer covers waiting for a stream
slot, and a per-request open no longer fails after 10 s. Wire: none.

## Related

- [JS abandonment](/quest/m1/js-subscribe-abandonment.md) - edits the IETF setup path; land after its PRs to avoid conflicts
- [JS GOAWAY requests](/quest/m1/js-goaway-requests.md) - adds a check at every open site this touches; land after its PR
- [JS request window](/quest/m1/js-request-window.md) - the IETF setup can also wait, unbounded, on MAX_REQUEST_ID before its deadline starts
