export type IntegrationKind = "slack" | "discord";
export type AlertEventType = "alert.fired" | "alert.resolved";
export type AlertSeverity = "critical" | "high" | "medium" | "low" | "info";

export type AlertInput = {
  alertId: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  source: string;
  occurredAt?: string;
};

export type StandardPayload = {
  eventType: AlertEventType;
  alert: {
    id: string;
    title: string;
    description: string;
    severity: AlertSeverity;
    source: string;
    occurredAt: string;
    occurredAtUnix: number;
    status: "FIRED" | "RESOLVED";
  };
};
