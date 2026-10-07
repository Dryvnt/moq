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

	// A SUBSCRIBE that went unanswered says nothing about the track, and each attempt already waits
	// out the setup deadline, so subscribe again at once. Every other reset ends the track; a
	// withdrawn route (Unroutable) comes back as a new broadcast handle, which reruns this anyway.
	const retry = new Signal(false);
	effect.get(retry);
	effect.run((inner) => {
		const closed = inner.get(subscriber.closed);
		if (!(closed instanceof NetError.Stream && closed.code === StreamCode.ControlTimeout)) return;
		console.warn(`media subscription to ${props.track} timed out, subscribing again`, closed);
		retry.set(true);
	});

	effect.run((inner) => {
		subscriber.update({ priority: props.priority, maxAge: inner.get(props.maxAge) });
	});

	return subscriber;
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
