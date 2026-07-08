import { KLAVIYO_METRICS } from "./klaviyo-constants";

const KLAVIYO_API_REVISION = "2024-10-15";
const KLAVIYO_EVENTS_URL = "https://a.klaviyo.com/api/events/";

export interface KlaviyoProfileInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  properties?: Record<string, unknown>;
}

export interface KlaviyoEventInput {
  metricName: string;
  profile: KlaviyoProfileInput;
  properties?: Record<string, unknown>;
  time?: string;
}

export class KlaviyoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "KlaviyoApiError";
  }
}

/** Create a Klaviyo event (creates/updates profile + properties). */
export async function createKlaviyoEvent(
  apiKey: string,
  input: KlaviyoEventInput,
): Promise<void> {
  const profileAttributes: Record<string, unknown> = {
    email: input.profile.email,
  };
  if (input.profile.firstName) {
    profileAttributes.first_name = input.profile.firstName;
  }
  if (input.profile.lastName) {
    profileAttributes.last_name = input.profile.lastName;
  }
  if (input.profile.properties && Object.keys(input.profile.properties).length > 0) {
    profileAttributes.properties = input.profile.properties;
  }

  const body = {
    data: {
      type: "event",
      attributes: {
        properties: input.properties ?? {},
        metric: {
          data: {
            type: "metric",
            attributes: { name: input.metricName },
          },
        },
        profile: {
          data: {
            type: "profile",
            attributes: profileAttributes,
          },
        },
        ...(input.time ? { time: input.time } : {}),
      },
    },
  };

  const response = await fetch(KLAVIYO_EVENTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: KLAVIYO_API_REVISION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new KlaviyoApiError(
      `Klaviyo event failed (${response.status})`,
      response.status,
      text,
    );
  }
}

/** Lightweight connection test — sends a metric Klaviyo accepts. */
export async function testKlaviyoConnection(apiKey: string): Promise<void> {
  await createKlaviyoEvent(apiKey, {
    metricName: KLAVIYO_METRICS.connectionTest,
    profile: {
      email: `loyalty-test-${Date.now()}@loyalty.invalid`,
      properties: { loyalty_connection_test: true },
    },
    properties: { source: "loyalty-admin" },
  });
}
