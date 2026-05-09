import type { AlertEventType, AlertInput, StandardPayload } from "../types";

const FIRED_SLACK_COLOR = "#E01E5A";
const RESOLVED_SLACK_COLOR = "#2EB67D";
const FIRED_DISCORD_COLOR = 15158332;
const RESOLVED_DISCORD_COLOR = 3066993;

export const buildStandardPayload = (
  eventType: AlertEventType,
  alert: AlertInput
): StandardPayload => {
  const occurredAtIso = alert.occurredAt ?? new Date().toISOString();
  const occurredAtUnix = Math.floor(new Date(occurredAtIso).getTime() / 1000);

  return {
    eventType,
    alert: {
      id: alert.alertId,
      title: alert.title,
      description: alert.description,
      severity: alert.severity,
      source: alert.source,
      occurredAt: occurredAtIso,
      occurredAtUnix,
      status: eventType === "alert.fired" ? "FIRED" : "RESOLVED"
    }
  };
};

export const buildSlackPayload = (payload: StandardPayload) => {
  const isFired = payload.eventType === "alert.fired";

  return {
    attachments: [
      {
        color: isFired ? FIRED_SLACK_COLOR : RESOLVED_SLACK_COLOR,
        title: `${isFired ? "Alert Fired" : "Alert Resolved"}: ${payload.alert.title}`,
        text: payload.alert.description,
        ts: payload.alert.occurredAtUnix,
        fields: [
          { title: "Alert ID", value: payload.alert.id, short: true },
          { title: "Severity", value: payload.alert.severity, short: true },
          { title: "Status", value: payload.alert.status, short: true },
          { title: "Source", value: payload.alert.source, short: true }
        ]
      }
    ]
  };
};

export const buildDiscordPayload = (payload: StandardPayload) => {
  const isFired = payload.eventType === "alert.fired";

  return {
    embeds: [
      {
        title: `${isFired ? "Alert Fired" : "Alert Resolved"}: ${payload.alert.title}`,
        description: payload.alert.description,
        color: isFired ? FIRED_DISCORD_COLOR : RESOLVED_DISCORD_COLOR,
        timestamp: payload.alert.occurredAt,
        fields: [
          { name: "Alert ID", value: payload.alert.id, inline: true },
          { name: "Severity", value: payload.alert.severity, inline: true },
          { name: "Status", value: payload.alert.status, inline: true },
          { name: "Source", value: payload.alert.source, inline: true }
        ]
      }
    ]
  };
};

type PoolIncidentInput = {
  id: string;
  status: "open" | "resolved";
  failureRate: number;
  threshold: number;
  downCount: number;
  totalCount: number;
  openedAt: Date;
  resolvedAt: Date | null;
};

export const buildStandardPayloadForIncident = (
  eventType: AlertEventType,
  incident: PoolIncidentInput
): StandardPayload => {
  const occurredAt = incident.resolvedAt ?? incident.openedAt;
  const occurredAtIso = occurredAt.toISOString();
  const occurredAtUnix = Math.floor(occurredAt.getTime() / 1000);

  return {
    eventType,
    alert: {
      id: incident.id,
      title: eventType === "alert.fired" ? "Proxy pool unhealthy" : "Proxy pool recovered",
      description:
        eventType === "alert.fired"
          ? `Failure rate ${incident.failureRate.toFixed(2)} reached threshold ${incident.threshold.toFixed(2)}`
          : `Failure rate recovered to ${incident.failureRate.toFixed(2)} below threshold ${incident.threshold.toFixed(2)}`,
      severity: incident.failureRate >= 0.75 ? "critical" : incident.failureRate >= 0.5 ? "high" : "medium",
      source: "Proxy Maze",
      occurredAt: occurredAtIso,
      occurredAtUnix,
      status: eventType === "alert.fired" ? "FIRED" : "RESOLVED"
    }
  };
};
