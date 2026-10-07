import type { Container } from "@moq/hang";
import type * as Moq from "@moq/net";
import { Error as NetError, StreamCode, type Time } from "@moq/net";
import { type Effect, type Getter, Signal } from "@moq/signals";

/**
 * Open a media subscription with its max age on the initial request and every update.
 *
 * Reruns `effect` to subscribe again when the subscription fails for a reason that says nothing about
 * the track (see {@link resubscribe}).
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
	resubscribe(effect, subscriber, props.track);

	effect.run((inner) => {
		subscriber.update({ priority: props.priority, maxAge: inner.get(props.maxAge) });
	});

	return subscriber;
}

// Spaces the attempts when a relay keeps resetting a track it cannot serve.
const RESET_RETRY_MS = 1000;

/**
 * Rerun `effect` once `subscriber` closes for a reason that says nothing about the track.
 *
 * - This side's setup deadline passed: each attempt already waited it out, so subscribe again at once.
 * - The peer reset with Internal or SessionClosed: a relay sends these when the upstream session
 *   serving the track dies. The broadcast handle can stay open across that, when the publisher
 *   restarted on a new session the relay routes to, so nothing else would rerun the caller.
 *   Subscribe again after {@link RESET_RETRY_MS}.
 *
 * Every other reset ends the track: a withdrawn route (Unroutable) comes back as a new broadcast
 * handle, which reruns the caller anyway.
 *
 * @internal
 */
export function resubscribe(effect: Effect, subscriber: Moq.Track.Subscriber, track: string): void {
	const retry = new Signal(false);
	effect.get(retry);
	effect.run((inner) => {
		const closed = inner.get(subscriber.closed);
		const delay = retryDelay(closed);
		if (delay === undefined) return;
		console.warn(`subscription to ${track} ended, subscribing again`, closed);
		if (delay === 0) retry.set(true);
		else inner.timer(() => retry.set(true), delay);
	});
}

// Only the deadline raised here, which wraps a TimeoutError, retries at once. A peer can reset with
// the same code at once (and relays forward it), so retrying that would spin.
function retryDelay(err: Error | null | undefined): number | undefined {
	if (!(err instanceof NetError.Stream)) return undefined;
	if (err.code === StreamCode.ControlTimeout && err.cause instanceof Error && err.cause.name === "TimeoutError")
		return 0;
	if (err.code === StreamCode.Internal || err.code === StreamCode.SessionClosed) return RESET_RETRY_MS;
	return undefined;
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
