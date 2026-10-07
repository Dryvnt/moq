# [S] A relay copy fails loud when upstream's position goes backwards

## Goal

A relay copy that subscribes upstream again and hears that upstream's largest
group is below the newest group it has cached treats it as a reused name: the
copy ends with an error, its source closes so the front ends, and readers
re-request. Today the copy keeps its stale live floor (`set_live` in
`rs/moq-net/src/model/track.rs`), so a viewer returning within the linger to a
publisher that restarted at group 0 gets the old instance's cached group and
then nothing until the new sequence passes it.

Covers lite-07 and moq-transport, whose answers carry the largest position.
lite-05 and 06 can't tell, and keep waiting on the floor.

## Plan

Found while scoping [Idle fronts](/quest/m0/idle-fronts.md) (2026-10-07):
under a prefix claim the relay never sees the worker close a broadcast, so a
restart at the same path reaches a lingering copy unannounced. A publisher
that restarts its group sequence under the same name is buggy, and this makes
that bug visible instead of a silent stall. Check first that no legitimate
answer reports a largest group below what a copy already holds from the same
instance, notably a same-epoch resume onto a replica that has fallen behind.

Verification: mocked time, a publisher restarting a path at group 0 within
the linger. The returning reader gets an error and then the new instance from
group 0, never the old group.

Public API: none. Wire: none.

## Related

- [Claim-served epochs](/quest/m0/broadcast-epoch/claim-epochs.md) - prevents the splice on lite-07 by naming the instance
- [Coalesce dynamic tracks](/quest/m1/2991-net-coalesce-dynamic-tracks-and-preserve-sequences-across.md) - keeps sequences going when a dynamic track's producer is replaced within one broadcast
