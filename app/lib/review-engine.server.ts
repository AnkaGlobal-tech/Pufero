import { getSupabaseAdmin } from "./supabase.server";
import { markJudgemeConnected } from "./judgeme-settings.server";

type ReviewRuleType = "review_text" | "review_photo" | "ugc_video";

interface JudgeMeReviewPayload {
  id?: number;
  hidden?: boolean;
  rating?: number;
  body?: string | null;
  pictures?: unknown[] | null;
  reviewer?: {
    email?: string | null;
    name?: string | null;
  } | null;
}

interface JudgeMeWebhookPayload {
  event?: string;
  shop_domain?: string;
  review?: JudgeMeReviewPayload;
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

async function isProgramPaused(storeId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stores")
    .select("program_paused")
    .eq("id", storeId)
    .single();

  if (error || !data) {
    throw new Error(`store pause check failed: ${error?.message ?? "no row"}`);
  }
  return Boolean(data.program_paused);
}

async function getEnabledReviewRule(
  storeId: string,
  ruleType: ReviewRuleType,
): Promise<{ points: number } | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rules")
    .select("enabled, points_value, config")
    .eq("store_id", storeId)
    .eq("rule_type", ruleType)
    .maybeSingle();

  if (error) {
    throw new Error(`review rule fetch failed: ${error.message}`);
  }
  if (!data?.enabled) {
    return null;
  }

  const points = Math.floor(toNumber(data.points_value));
  if (points <= 0) {
    return null;
  }

  return { points };
}

async function findCustomerByEmail(
  storeId: string,
  email: string,
): Promise<{ id: string; shopifyCustomerId: number } | null> {
  const supabase = getSupabaseAdmin();
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabase
    .from("customers")
    .select("id, shopify_customer_id")
    .eq("store_id", storeId)
    .ilike("email", normalized)
    .maybeSingle();

  if (error) {
    throw new Error(`customer lookup failed: ${error.message}`);
  }
  if (!data?.shopify_customer_id) {
    return null;
  }

  return {
    id: data.id as string,
    shopifyCustomerId: data.shopify_customer_id as number,
  };
}

async function reviewPointsAlreadyAwarded(
  storeId: string,
  sourceId: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("points_ledger")
    .select("id")
    .eq("store_id", storeId)
    .eq("source_id", sourceId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`review ledger lookup failed: ${error.message}`);
  }
  return data != null;
}

function resolveReviewRuleType(review: JudgeMeReviewPayload): ReviewRuleType {
  const pictures = Array.isArray(review.pictures) ? review.pictures : [];
  if (pictures.length > 0) {
    return "review_photo";
  }
  return "review_text";
}

/** Judge.me webhook — award review points once per review id. */
export async function processJudgeMeReviewWebhook(params: {
  storeId: string;
  payload: Record<string, unknown>;
}): Promise<number> {
  if (await isProgramPaused(params.storeId)) {
    return 0;
  }

  const body = params.payload as JudgeMeWebhookPayload;
  const review = body.review;
  if (!review?.id) {
    console.log("[review-engine] judgeme webhook missing review.id — skipped");
    return 0;
  }

  if (review.hidden) {
    console.log(`[review-engine] judgeme review=${review.id} hidden — skipped`);
    return 0;
  }

  const email = review.reviewer?.email?.trim();
  if (!email) {
    console.log(`[review-engine] judgeme review=${review.id} no reviewer email — skipped`);
    return 0;
  }

  const customer = await findCustomerByEmail(params.storeId, email);
  if (!customer) {
    console.log(
      `[review-engine] judgeme review=${review.id} no loyalty customer for ${email} — skipped`,
    );
    return 0;
  }

  const ruleType = resolveReviewRuleType(review);
  const rule = await getEnabledReviewRule(params.storeId, ruleType);
  if (!rule) {
    console.log(`[review-engine] judgeme review=${review.id} rule ${ruleType} disabled — skipped`);
    return 0;
  }

  const sourceId = `judgeme-review-${review.id}`;
  if (await reviewPointsAlreadyAwarded(params.storeId, sourceId)) {
    console.log(`[review-engine] judgeme review=${review.id} already awarded — skipped`);
    return 0;
  }

  const supabase = getSupabaseAdmin();
  const description =
    ruleType === "review_photo"
      ? `Photo review bonus — Judge.me #${review.id}`
      : `Text review bonus — Judge.me #${review.id}`;

  const { error } = await supabase.from("points_ledger").insert({
    store_id: params.storeId,
    customer_id: customer.id,
    movement_type: "earn",
    points: rule.points,
    source: ruleType,
    source_id: sourceId,
    description,
    metadata: {
      judgeme_review_id: review.id,
      rating: review.rating ?? null,
      reviewer_email: email,
    },
    created_by: "review-engine",
  });

  if (error) {
    throw new Error(`review ledger insert failed: ${error.message}`);
  }

  await supabase
    .from("customers")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", customer.id);

  await markJudgemeConnected(params.storeId);

  console.log(
    `[review-engine] judgeme review=${review.id} customer=${customer.id} +${rule.points} ${ruleType}`,
  );

  return rule.points;
}
