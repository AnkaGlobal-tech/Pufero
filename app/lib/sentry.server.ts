import * as Sentry from "@sentry/remix";

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
) {
  if (!process.env.SENTRY_DSN) {
    console.error("[sentry-disabled]", error, context);
    return;
  }

  Sentry.captureException(error, {
    extra: context,
  });
}

export function captureWebhookFailure(
  topic: string,
  error: unknown,
  metadata?: Record<string, unknown>,
) {
  captureException(error, {
    source: "webhook",
    topic,
    ...metadata,
  });
}
