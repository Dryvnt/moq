import { expect, test } from "bun:test";
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

// A subscription that timed out before its first response is opened again; any other reset ends it.
// Driven the way the decoders drive it: one effect that subscribes and reads until `nextMedia` runs out.
// ControlTimeout is what the subscriber rejects a track with once SUBSCRIBE goes unanswered for 10 s.
for (const [code, resumes] of [
	["ControlTimeout", true],
	["Unroutable", false],
	["Cancel", false],
	["NotFound", false],
] as const) {
	test(`media ${resumes ? "re-subscribes" : "stays ended"} after ${code}`, async () => {
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
			failing.close(new Moq.Error.Stream(Moq.StreamCode[code]));

			// The publisher is fine and serves the next subscription.
			const serving = broadcast.createTrack("video");
			new Container.Legacy.Producer(serving, format).encode(new Uint8Array([42]), Time.Micro(0), true);

			await microtasks();
			expect(frames).toEqual(resumes ? [42] : []);
		} finally {
			effect.close();
			handle.close();
			broadcast.close();
		}
	});
}
