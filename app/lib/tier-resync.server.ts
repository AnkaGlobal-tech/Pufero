import { getSupabaseAdmin } from "./supabase.server";
import { recalculateCustomerTier } from "./tier-engine.server";

export type TierResyncStatus = "idle" | "running" | "done";

export interface TierResyncJob {
  status: TierResyncStatus;
  processed: number;
  changed: number;
  cursor: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}

export const TIER_RESYNC_BATCH_SIZE = 75;

const IDLE_JOB: TierResyncJob = {
  status: "idle",
  processed: 0,
  changed: 0,
  cursor: null,
  startedAt: null,
  finishedAt: null,
  lastError: null,
};

function readJob(raw: unknown): TierResyncJob {
  if (!raw || typeof raw !== "object") return { ...IDLE_JOB };
  const root = raw as Record<string, unknown>;
  const block = (root.tier_resync as Record<string, unknown> | undefined) ?? {};
  const status = block.status;
  return {
    status:
      status === "running" || status === "done" || status === "idle"
        ? status
        : "idle",
    processed: Number(block.processed) || 0,
    changed: Number(block.changed) || 0,
    cursor: typeof block.cursor === "string" ? block.cursor : null,
    startedAt: typeof block.started_at === "string" ? block.started_at : null,
    finishedAt: typeof block.finished_at === "string" ? block.finished_at : null,
    lastError: typeof block.last_error === "string" ? block.last_error : null,
  };
}

async function readWidgetSettings(
  storeId: string,
): Promise<Record<string, unknown>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stores")
    .select("widget_settings")
    .eq("id", storeId)
    .single();

  if (error) {
    throw new Error(`tier resync read failed: ${error.message}`);
  }

  return data?.widget_settings && typeof data.widget_settings === "object"
    ? (data.widget_settings as Record<string, unknown>)
    : {};
}

async function writeJob(storeId: string, job: TierResyncJob): Promise<void> {
  const supabase = getSupabaseAdmin();
  const current = await readWidgetSettings(storeId);

  const { error } = await supabase
    .from("stores")
    .update({
      widget_settings: {
        ...current,
        tier_resync: {
          status: job.status,
          processed: job.processed,
          changed: job.changed,
          cursor: job.cursor,
          started_at: job.startedAt,
          finished_at: job.finishedAt,
          last_error: job.lastError,
        },
      },
    })
    .eq("id", storeId);

  if (error) {
    throw new Error(`tier resync write failed: ${error.message}`);
  }
}

export async function getTierResyncJob(storeId: string): Promise<TierResyncJob> {
  const settings = await readWidgetSettings(storeId);
  return readJob(settings);
}

/** Reset counters and mark job as running (does not process members yet). */
export async function startTierResyncJob(storeId: string): Promise<TierResyncJob> {
  const job: TierResyncJob = {
    status: "running",
    processed: 0,
    changed: 0,
    cursor: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastError: null,
  };
  await writeJob(storeId, job);
  return job;
}

export interface TierResyncBatchResult {
  processed: number;
  changed: number;
  totalProcessed: number;
  totalChanged: number;
  done: boolean;
  status: TierResyncStatus;
}

/**
 * Process one page of customers. Safe for large stores — call repeatedly
 * until `done` (from Program UI auto-continue or Dashboard loader).
 */
export async function processTierResyncBatch(params: {
  storeId: string;
  shopDomain: string;
  batchSize?: number;
}): Promise<TierResyncBatchResult> {
  const batchSize = params.batchSize ?? TIER_RESYNC_BATCH_SIZE;
  const supabase = getSupabaseAdmin();
  let job = await getTierResyncJob(params.storeId);

  if (job.status !== "running") {
    return {
      processed: 0,
      changed: 0,
      totalProcessed: job.processed,
      totalChanged: job.changed,
      done: job.status === "done" || job.status === "idle",
      status: job.status,
    };
  }

  try {
    let query = supabase
      .from("customers")
      .select("id")
      .eq("store_id", params.storeId)
      .order("id", { ascending: true })
      .limit(batchSize);

    if (job.cursor) {
      query = query.gt("id", job.cursor);
    }

    const { data: rows, error } = await query;
    if (error) {
      throw new Error(`tier resync list failed: ${error.message}`);
    }

    const customers = rows ?? [];
    let changed = 0;

    for (const row of customers) {
      const didChange = await recalculateCustomerTier({
        storeId: params.storeId,
        customerId: row.id,
        shopDomain: params.shopDomain,
      });
      if (didChange) changed += 1;
    }

    const processed = customers.length;
    const nextCursor =
      customers.length > 0 ? customers[customers.length - 1]!.id : job.cursor;
    const done = customers.length < batchSize;

    job = {
      ...job,
      processed: job.processed + processed,
      changed: job.changed + changed,
      cursor: done ? null : nextCursor,
      status: done ? "done" : "running",
      finishedAt: done ? new Date().toISOString() : null,
      lastError: null,
    };
    await writeJob(params.storeId, job);

    return {
      processed,
      changed,
      totalProcessed: job.processed,
      totalChanged: job.changed,
      done,
      status: job.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tier resync failed";
    await writeJob(params.storeId, {
      ...job,
      status: "running",
      lastError: message,
    });
    throw error;
  }
}
