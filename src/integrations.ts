import type { Alert } from "./alerts";
import { nowEpochSec, round4 } from "./util";

const SLACK_COLORS = {
	"alert.fired": "#dc2626",
	"alert.resolved": "#16a34a",
} as const;

const DISCORD_COLORS = {
	"alert.fired": 0xdc2626,
	"alert.resolved": 0x16a34a,
} as const;

export type AlertEvent = "alert.fired" | "alert.resolved";

export function buildGenericPayload(event: AlertEvent, alert: Alert) {
	return {
		event,
		alert_id: alert.alert_id,
		status: alert.status,
		failure_rate: round4(alert.failure_rate),
		threshold: alert.threshold,
		total_proxies: alert.total_proxies,
		failed_proxies: alert.failed_proxies,
		failed_proxy_ids: alert.failed_proxy_ids,
		fired_at: alert.fired_at,
		resolved_at: alert.resolved_at,
		message: alert.message,
	};
}

export function buildSlackPayload(
	event: AlertEvent,
	alert: Alert,
	username = "Proxy Maze",
) {
	const ratePct = (round4(alert.failure_rate) * 100).toFixed(2);
	const thresholdPct = (alert.threshold * 100).toFixed(0);
	const headline =
		event === "alert.fired"
			? `:rotating_light: Proxy pool breach detected`
			: `:white_check_mark: Proxy pool recovered`;

	return {
		username,
		text: `${headline} — alert ${alert.alert_id}`,
		attachments: [
			{
				color: SLACK_COLORS[event],
				footer: "Proxy Maze · Torch Labs",
				ts: nowEpochSec(),
				fields: [
					{ title: "Alert ID", value: alert.alert_id, short: true },
					{ title: "Failure Rate", value: `${ratePct}%`, short: true },
					{
						title: "Failed Proxies",
						value: `${alert.failed_proxies} / ${alert.total_proxies}`,
						short: true,
					},
					{ title: "Threshold", value: `${thresholdPct}%`, short: true },
					{
						title: "Failed IDs",
						value: alert.failed_proxy_ids.length
							? alert.failed_proxy_ids.join(", ")
							: "—",
						short: false,
					},
					{ title: "Fired At", value: alert.fired_at, short: false },
				],
			},
		],
	};
}

export function buildDiscordPayload(event: AlertEvent, alert: Alert) {
	const ratePct = (round4(alert.failure_rate) * 100).toFixed(2);
	const thresholdPct = (alert.threshold * 100).toFixed(0);
	const title =
		event === "alert.fired"
			? "🚨 Proxy pool breach detected"
			: "✅ Proxy pool recovered";

	return {
		embeds: [
			{
				title,
				description: alert.message,
				color: DISCORD_COLORS[event],
				footer: { text: "Proxy Maze · Torch Labs" },
				timestamp: alert.fired_at,
				fields: [
					{ name: "Alert ID", value: alert.alert_id, inline: true },
					{ name: "Failure Rate", value: `${ratePct}%`, inline: true },
					{
						name: "Failed Proxies",
						value: `${alert.failed_proxies} / ${alert.total_proxies}`,
						inline: true,
					},
					{ name: "Threshold", value: `${thresholdPct}%`, inline: true },
					{
						name: "Failed IDs",
						value: alert.failed_proxy_ids.length
							? alert.failed_proxy_ids.join(", ")
							: "—",
						inline: false,
					},
				],
			},
		],
	};
}
