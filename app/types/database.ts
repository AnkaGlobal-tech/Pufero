/**
 * Supabase üretilmiş tip tanımları (placeholder).
 *
 * NOT: Bu dosya `supabase gen types typescript` çıktısıyla doldurulmalı.
 * Üretim için AnkaLoyalty Supabase projesine (loyalty: stores/customers/points_ledger/...)
 * bağlı bir erişim tokenı gerekir. Şu an elle yazılan tipler `app/types/loyalty.ts`
 * ve ilgili `*.server.ts` dosyalarındaki arayüzlerden geliyor.
 *
 * Henüz hiçbir yerde import edilmiyor; doğru tipler üretilene kadar boş bırakıldı.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = Record<string, never>;
