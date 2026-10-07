import { expect, jest, test } from "bun:test";
import { Container } from "@moq/hang";
import * as Moq from "@moq/net";
import { Time } from "@moq/net";
import { Effect, Once, Signal } from "@moq/signals";
import { nextMedia, subscribeMedia } from "./media";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Drain reactive work without waiting on a timer.
async function microtasks() {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

test("media max age is present on the initial subscription and later updates", async () => {
	let initial: Moq.Track.Subscription | undefined;
	const updates: Moq.Track.Subscription[] = [];
	const subscriber = {
		closed: new Once<Error | null>(),
		close: () => undefined,
		update: (subscription: Moq.Track.Subscription) => updates.push(subscription),
	} as unknown as Moq.Track.Subscriber;
	const broadcast = {
		closed: new Once<Error | null>(),
		track: () => ({
			subscribe: (subscription: Moq.Track.Subscription) => {
				initial = subscription;
				return subscriber;
			},
		}),
	} as unknown as Moq.Broadcast.Consumer;
	const maxAge = new Signal(Time.Milli(250));
	const effect = new Effect();

	subscribeMedia(effect, {
		broadcast,
		track: "media",
		priority: 7,
		maxAge,
	});
	expect(initial).toEqual({ priority: 7, maxAge: Time.Milli(250) });

	maxAge.set(Time.Milli(500));
	await flush();
	expect(updates.at(-1)).toEqual({ priority: 7, maxAge: Time.Milli(500) });

	effect.close();
});

for (const end of [
	new Moq.Error.Stream(Moq.StreamCode.Cancel),
	new Moq.Error.Stream(Moq.StreamCode.Internal),
	new Moq.Error.Stream(Moq.StreamCode(1234)),
	new Moq.Error.Session(Moq.SessionCode.Internal),
	new Error("decoder failed"),
]) {
	test(`media subscription end: ${end}`, async () => {
		const track = new Moq.Track.Producer("test");
		const consumer = new Container.Consumer(track.subscribe(), { format: new Container.Legacy.Format("data") });
		try {
			const pending = nextMedia(consumer);
			track.close(end);
			if (end instanceof Moq.Error.Stream) expect(await pending).toBeUndefined();
			else await expect(pending).rejects.toBe(end);
		} finally {
			consumer.close();
		}
	});
}

test("media does not subscribe through a closed broadcast handle", () => {
	const broadcast = new Moq.Broadcast.Producer();
	const handle = broadcast.consume();
	broadcast.close();
	const effect = new Effect();
	try {
		expect(
			subscribeMedia(effect, {
				broadcast: handle,
				track: "video",
				priority: 0,
				maxAge: new Signal(Time.Milli(0)),
			}),
		).toBeUndefined();
	} finally {
		effect.close();
		handle.close();
	}
});

// What the subscriber rejects a track with once its own setup deadline passes: the code, wrapping the
// TimeoutError its timer raised. A peer's reset with the same code wraps the transport error instead.
const timedOut = () =>
	new Moq.Error.Stream(Moq.StreamCode.ControlTimeout, {
		cause: Object.assign(new Error("subscribe timed out after 10000ms"), { name: "TimeoutError" }),
	});

// A subscription that timed out here before its first response is opened again at once, and one a relay
// reset because its upstream died is opened again after a delay; any other reset ends it.
// Driven the way the decoders drive it: one effect that subscribes and reads until `nextMedia` runs out.
for (const [label, failure, resumes] of [
	["a local setup timeout", timedOut(), "at once"],
	["Internal", new Moq.Error.Stream(Moq.StreamCode.Internal), "after a delay"],
	["SessionClosed", new Moq.Error.Stream(Moq.StreamCode.SessionClosed), "after a delay"],
	["a peer's ControlTimeout reset", new Moq.Error.Stream(Moq.StreamCode.ControlTimeout), "never"],
	["Unroutable", new Moq.Error.Stream(Moq.StreamCode.Unroutable), "never"],
	["Cancel", new Moq.Error.Stream(Moq.StreamCode.Cancel), "never"],
	["NotFound", new Moq.Error.Stream(Moq.StreamCode.NotFound), "never"],
] as const) {
	test(`media re-subscribes ${resumes} on ${label}`, async () => {
		jest.useFakeTimers();
		const warn = console.warn;
		console.warn = () => {};
		const broadcast = new Moq.Broadcast.Producer();
		const handle = broadcast.consume();
		const format = new Container.Legacy.Format("data");
		const failing = broadcast.createTrack("video");
		const effect = new Effect();
		const frames: number[] = [];
		try {
			effect.run((inner) => {
				const sub = subscribeMedia(inner, {
					broadcast: handle,
					track: "video",
					priority: 0,
					maxAge: new Signal(Time.Milli(10_000)),
				});
				if (!sub) return;
				const consumer = new Container.Consumer(sub, { format });
				inner.cleanup(() => consumer.close());
				inner.spawn(async () => {
					for (;;) {
						const next = await nextMedia(consumer);
						if (!next) break;
						if (next.frame) frames.push(next.frame.payload[0]);
					}
				});
			});

			// Let the effect subscribe before the subscription fails.
			await microtasks();
			failing.close(failure);

			// The publisher is fine and serves the next subscription.
			const serving = broadcast.createTrack("video");
			new Container.Legacy.Producer(serving, format).encode(new Uint8Array([42]), Time.Micro(0), true);

			await microtasks();
			expect(frames).toEqual(resumes === "at once" ? [42] : []);

			jest.advanceTimersByTime(1000);
			await microtasks();
			expect(frames).toEqual(resumes === "never" ? [] : [42]);
		} finally {
			effect.close();
			handle.close();
			broadcast.close();
			console.warn = warn;
			jest.useRealTimers();
		}
	});
}
