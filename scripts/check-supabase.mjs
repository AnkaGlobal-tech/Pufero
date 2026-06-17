import { loadEnvFile } from "./load-env.mjs";

loadEnvFile();

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url) {
  console.error("❌ SUPABASE_URL eksik (.env)");
  process.exit(1);
}

if (serviceRoleKey) {
  const response = await fetch(`${url}/storage/v1/bucket`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`❌ Supabase bağlantı hatası (${response.status}): ${body}`);
    process.exit(1);
  }

  console.log("✅ Supabase bağlantısı başarılı (service_role key)");
  process.exit(0);
}

if (!anonKey) {
  console.error("❌ SUPABASE_ANON_KEY veya SUPABASE_SERVICE_ROLE_KEY gerekli");
  process.exit(1);
}

const response = await fetch(`${url}/auth/v1/health`, {
  headers: { apikey: anonKey },
});

if (!response.ok) {
  const body = await response.text();
  console.error(`❌ Supabase bağlantı hatası (${response.status}): ${body}`);
  process.exit(1);
}

console.log("✅ Supabase bağlantısı başarılı (anon key)");
console.log(
  "ℹ️  Server-side islemler icin Dashboard → API → service_role key'i .env'e ekle",
);
