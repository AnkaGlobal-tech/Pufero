import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Node --env-file ile SUPABASE_* satirlari yuklenmiyor; basit parser. */
export function loadEnvFile(filename = ".env") {
  const path = resolve(process.cwd(), filename);
  let content;

  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}
