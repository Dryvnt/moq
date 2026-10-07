# [M] An unread front ends after its linger

## Goal

A relay ends an origin front once nothing has read it for `track::IDLE_LINGER`,
so the next request for that path resolves by current route cost. Today a
front lives until its route leaves. Two workers claim a prefix with
`origin::Producer::dynamic`, a viewer reads path P through a relay and leaves,
the serving worker closes its output and re-prices its claim to
`Cost::DRAIN`. Minutes later a new viewer on a new session still gets P from
the drained worker, while a fresh path under the same claim goes to the cheaper
one. Done when, after the linger, that viewer gets P from the cheapest claim,
and the session no longer holds per-path state for P.

Non-goal: a worker that closes an output and serves the same path again
restarting at group 0. That reuses a name for different content, which is the
publisher's bug (see Plan).

## Plan

Facts from `main` (`rs/moq-net/src/model/origin.rs`, `front.rs`,
`lite/subscriber.rs`):

- A front resolved without an epoch stays on its first route (`pick`, #4942),
  and `request()` joins any live front whose epoch matches the best route's,
  `None == None` here, without asking whether its route is still the best.
- Under a claim, the session answers a request with a placeholder source it
  creates on the spot (`poll_serve`), kept in the announced route's sources
  until the claim is withdrawn or the session closes. moq-lite has no message
  for "the broadcast served under this prefix closed", so the relay never sees
  `SourceClosed` when the worker closes its output. In-process (no relay) the
  front's source is the worker's broadcast, `SourceClosed` fires, and the next
  request re-resolves; that's why the bug needs a relay.
- Nothing ends a front for having no readers. Its unread tracks park and are
  forgotten after `IDLE_LINGER`, but the front and its driver task stay.
- Each distinct path requested under a claim therefore leaves a placeholder
  source and serve state on the session, and a front on the relay, for as
  long as the claim stands.

Decisions (2026-10-07):

- End every front, epoch or not, once all its tracks are forgotten and no
  consumer holds its broadcast. Ending only after the linger keeps the cache
  window for a returning viewer, needs no wire change, and doesn't conflict
  with the draft's Resume text, which pins subscriptions, not idle fronts.
  A front serving a local source forgets an unread track outright, so it ends
  as soon as it goes unread; reaching a local source again is free.
- A request must never join a front that is ending: the front leaves the
  origin's front table under the lock before it ends (or `request()` treats an
  ending front as gone), so a newcomer gets a fresh front rather than a
  broadcast that closes at once.
- A front still waiting for coverage
  ([Front parking](/quest/m1/origin-front-parks.md)) is not idle and stays.
- The session drops a placeholder source once it has no consumers left, so
  per-path state under a claim goes with its fronts instead of piling up until
  the claim leaves. The route's served cache hands one source to every front
  for the path (a plain front and a peer's filtered front can share it), so
  the trigger is the source losing its last consumer, not one front ending.
  The session keeps that state in more than one place; all of it goes.
- This also reclaims the filtered front a peer session leaves behind (moved
  here from [Front parking](/quest/m1/origin-front-parks.md)): a hop in a
  covering route chain gets its own filtered front, which today lives as long
  as the route, one per peer session that both publishes and subscribes or
  reconnects with a fresh hop.
- A claim worker that re-serves a path after closing it is a new instance.
  Document that in `doc/concept/moq-lite.md` Resume: such a worker keeps its
  group sequence going, across its own source restarting too (mirroring an
  upstream sequence that goes back to 0 isn't enough), or gives each output its own epoch once
  [Claim-served epochs](/quest/m0/broadcast-epoch/claim-epochs.md) lands, and
  "a transcoder claim stays on the worker that first served it" holds only
  while something reads it. Without that, a viewer returning within the
  linger gets the old instance's cached latest group and then nothing until
  the new instance's sequence passes it.

Verification: a relay integration test with two `dynamic` claims on their own
sessions (mocked time): read P, leave, close the output, drain the serving
claim, advance past the linger, and check a new session's P comes from the
other claim and that the first session holds no source for P. A `front.rs`
unit test for the end condition, including a parked front that must stay,
and an origin test of a request racing a front's end (like `front.rs`'s
`a_reader_racing_the_forget_keeps_the_track`, one level up). The front count
returns to the plain front after a peer session closes.

Public API: none expected. Wire: none.

## Related

- [Claim-served epochs](/quest/m0/broadcast-epoch/claim-epochs.md) - on lite-07, an unread front re-resolves at once instead of after the linger, and a restarted output is never spliced
- [Upstream position regression](/quest/m0/largest-regression.md) - fails loud on the stale splice where the answer shows it
- [Prefix route fronts](/quest/m0/prefix-route-fronts.md) - bounds how many fronts a prefix route can mint at once; this reclaims idle ones
- [Front parking](/quest/m1/origin-front-parks.md) - a front waiting for coverage must survive this; the filtered-front leak moved here from it
- [Route wakes](/quest/m1/route-wakes.md) - indexes fronts per route, so an ended front must drop its entries
- [Broadcast epochs](/quest/m0/broadcast-epoch/README.md) - restarted publishers mint a fresh epoch, the documented fix for a re-served path
