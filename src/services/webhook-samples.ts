import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { and, eq } from "drizzle-orm";

import { db } from "../db/client";
import { integrations } from "../db/schema";
import type { IntegrationKind } from "../types";

const sampleFiles: Array<{
  kind: IntegrationKind;
  name: string;
  fileName: string;
}> = [
  {
    kind: "slack",
    name: "Slack sample integration",
    fileName: "slack-webhook.sample.txt"
  },
  {
    kind: "discord",
    name: "Discord sample integration",
    fileName: "discord-webhook.sample.txt"
  }
];

const normalizeWebhookUrl = (contents: string) => contents.trim().split(/\r?\n/).find(Boolean)?.trim() ?? "";

const loadWebhookUrl = async (fileName: string) => {
  const filePath = resolve(process.cwd(), fileName);

  try {
    await access(filePath);
  } catch {
    return null;
  }

  const contents = await readFile(filePath, "utf8");
  const webhookUrl = normalizeWebhookUrl(contents);

  if (!webhookUrl) {
    return null;
  }

  try {
    new URL(webhookUrl);
  } catch {
    console.warn(`Skipping ${fileName}: not a valid URL`);
    return null;
  }

  return webhookUrl;
};

const ensureIntegration = async (kind: IntegrationKind, name: string, webhookUrl: string) => {
  const existing = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.kind, kind), eq(integrations.webhookUrl, webhookUrl)))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(integrations).values({
    id,
    name,
    kind,
    webhookUrl,
    createdAt: now
  });

  const inserted = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
  return inserted[0] ?? null;
};

export const importSampleWebhookIntegrations = async () => {
  const results: Array<{
    kind: IntegrationKind;
    name: string;
    fileName: string;
    webhookUrl: string;
    integrationId: string;
  }> = [];

  for (const sampleFile of sampleFiles) {
    const webhookUrl = await loadWebhookUrl(sampleFile.fileName);

    if (!webhookUrl) {
      continue;
    }

    const integration = await ensureIntegration(sampleFile.kind, sampleFile.name, webhookUrl);

    if (!integration) {
      continue;
    }

    results.push({
      kind: sampleFile.kind,
      name: sampleFile.name,
      fileName: sampleFile.fileName,
      webhookUrl,
      integrationId: integration.id
    });
  }

  return results;
};

export const seedSampleWebhookIntegrations = async () => {
  await importSampleWebhookIntegrations();
};
