# [S] Several video and audio sources in one broadcast

## Goal

Settle whether and how one hang broadcast carries several distinct video and
audio sources, each with its own renditions, on one shared clock and one
catalog, so a consumer chooses sources independently instead of treating
every rendition as an alternative. The study ends by rewriting itself into an
implementation epic with the chosen shape, or by deleting itself with a
recorded no-go.

Use cases:

- Webcam plus screen share in one broadcast, synchronized by construction
  rather than by two broadcasts that happen to share a clock.
- A robot with several cameras and one shared set of telemetry.
- One video with audio in several languages at once.

Requested downstream; the robot case motivates it.
Non-goals: tying a `json` or `binary` track to one source. Those sections are
application-defined and already carry several distinct tracks; an
application that needs the association defines it, presumably in a catalog
extension section.

## Plan

### Today

The catalog has no notion of a source. `video` and `audio` are each one map
of renditions, and every reader treats the entries as interchangeable:

- `Video::ranked` and `Audio::ranked` in `rs/hang` (and `ranked` in `js/hang`)
  order renditions as alternatives of one picture or one sound.
- js/watch picks one video rendition by ABR and one audio rendition by name
  or container; `moq play` plays the first enabled of each; moq-ffi hands the
  maps to the application.
- `display`, `rotation`, and `flip` sit on the `video` section, shared by
  every rendition, so a catalog can describe only one picture's presentation.
- Audio has no `lang`; only `text` renditions carry `lang` and `role`.
- `drafts/draft-lcurley-moq-hang.md` defines video and audio as rendition
  maps; only json and binary are called distinct tracks, not alternatives.
- js/room publishes camera and screen as two broadcasts,
  `{identity}/camera.hang` and `{identity}/screen.hang`.

### Options to compare

Decided 2026-10-12 (planning): the study compares both, since the additive
one may be enough.

1. **Source-grouped catalog (breaking).** `video` and `audio` become maps of
   sources, each holding its renditions plus per-source presentation
   (`display`, `rotation`, `flip`) and, for audio, a language. Readers rank
   within a source and choose among sources.
2. **Sibling-broadcast references (additive).** Each source stays its own
   broadcast; a composite catalog lists them through the existing relative
   `broadcast` references and a shared `clock`. Builds on
   [catalog rendition IDs](/quest/m1/catalog-track-id.md), which already lets
   one catalog list renditions from several broadcasts, but still as
   alternatives, so this option needs some grouping key too.

The two are not independent: grouping (which renditions are alternatives of
one source) is one axis, and placement (whether a rendition lives in this
broadcast or a referenced one) is another. Per-rendition `broadcast`
references already work inside any grouping, and placement alone solves
neither selection nor per-source presentation. Consider the minimal
candidate too: one grouping model that covers both local and referenced
renditions, with an explicit policy for legacy readers.

For each option, record: the wire and draft change; old readers' behaviour on
a new catalog (does a released player silently play camera and screen as ABR
rungs?); the cost across `rs/hang`, `js/hang`, js/watch, js/publish, moq-cli,
moq-ffi and every binding, the HLS, TS, and MP4 exporters, and the MSF
conversion in `rs/moq-mux`; how a consumer names a source (a stable ID versus
a role such as `camera` or `screen`); and how archive and replay see it.

### Deliverable

Decided 2026-10-12 (planning): the study rewrites this quest into an epic
whose Plan holds the chosen shape and whose children split the work by
package, including the draft change and its `doc/concept` page, or deletes
it with the no-go reason. It writes no code.

Decided 2026-10-12 (planning): ranked last in m2. The goal is to make the need
visible; nothing is blocked on it, and the maintainer may promote it.

## Related

- [Catalog rendition IDs](/quest/m1/catalog-track-id.md) - IDs plus an optional `track` let one catalog list renditions from several broadcasts; both options build on it
- [Catalog references](/quest/m0/broadcast-epoch/catalog-references.md) - an optional `epoch` beside every `broadcast` reference, which sibling-broadcast references would carry
- [Catalog track identity](/quest/m1/catalog-tracks.md) - `display`, `rotation`, and `flip` are presentation state; a source-grouped catalog moves them per source
- [Teleoperation](/quest/m2/teleop/README.md) - the robot line whose multi-camera case motivates this
- [Shared timebase in the bindings](/quest/m2/ffi-timebase.md) - binding apps publish several containers on one shared offset, the clock a multi-source publisher needs
