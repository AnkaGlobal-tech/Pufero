import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

function getSupabaseEnv() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return { url, serviceRoleKey };
}

/** Server-side Supabase client (service role). RLS bypass — yalnızca Remix loader/action/webhook'larda kullan. */
export function getSupabaseAdmin(): SupabaseClient {
  const env = getSupabaseEnv();

  if (!env) {
    throw new Error(
      "Supabase yapılandırılmamış. SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY .env dosyasında olmalı.",
    );
  }

  if (!adminClient) {
    adminClient = createClient(env.url, env.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return adminClient;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

/** Bağlantı doğrulaması — tablo olmadan storage API ile ping atar. */
export async function verifySupabaseConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      message: "SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY eksik",
    };
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.storage.listBuckets();

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "Supabase bağlantısı başarılı" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Bilinmeyen hata",
    };
  }
}
