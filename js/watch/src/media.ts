import type { Container } from "@moq/hang";
import type * as Moq from "@moq/net";
import { Error as NetError, StreamCode, type Time } from "@moq/net";
import { type Effect, type Getter, Signal } from "@moq/signals";

/**
 * Open a media subscription with its max age on the initial request and every update.
 *
 * Reruns `effect` to subscribe again when the subscription times out before its first response.
 *
 * @internal
 */
export function subscribeMedia(
	effect: Effect,
	props: {
		broadcast: Moq.Broadcast.Consumer;
		track: string;
		priority: number;
		maxAge: Getter<Time.Milli>;
	},
): Moq.Track.Subscriber | undefined {
	if (effect.get(props.broadcast.closed) !== undefined) return;
	const subscription = () => ({ priority: props.priority, maxAge: props.maxAge.peek() });
	const subscriber = props.broadcast.track(props.track).subscribe(subscription());
	effect.cleanup(() => subscriber.close());
	resubscribeOnTimeout(effect, subscriber, props.track);

	effect.run((inner) => {
		subscriber.update({ priority: props.priority, maxAge: inner.get(props.maxAge) });
	});

	return subscriber;
}

/**
 * Rerun `effect` once `subscriber` closes because its SUBSCRIBE went unanswered past this side's
 * setup deadline.
 *
 * Such a failure says nothing about the track, and each attempt already waited out the deadline,
 * so the rerun subscribes again at once. Every other reset ends the track: a withdrawn route
 * (Unroutable) comes back as a new broadcast handle, which reruns the caller anyway.
 *
 * @internal
 */
export function resubscribeOnTimeout(effect: Effect, subscriber: Moq.Track.Subscriber, track: string): void {
	const retry = new Signal(false);
	effect.get(retry);
	effect.run((inner) => {
		const closed = inner.get(subscriber.closed);
		if (!timedOut(closed)) return;
		console.warn(`subscription to ${track} timed out, subscribing again`, closed);
		retry.set(true);
	});
}

// Only the deadline raised here, which wraps a TimeoutError. A peer can reset with the same code at
// once (and relays forward it), so retrying that would spin.
function timedOut(err: Error | null | undefined): boolean {
	return (
		err instanceof NetError.Stream &&
		err.code === StreamCode.ControlTimeout &&
		err.cause instanceof Error &&
		err.cause.name === "TimeoutError"
	);
}

/** Read the next media frame, ending playback when its subscription is reset. @internal */
export async function nextMedia(consumer: Container.Consumer) {
	try {
		return await consumer.next();
	} catch (err) {
		if (!(err instanceof NetError.Stream)) throw err;
		// The subscription is over, even when other tracks on the session are still live.
		console.debug("media subscription ended", err);
		return undefined;
	}
}
