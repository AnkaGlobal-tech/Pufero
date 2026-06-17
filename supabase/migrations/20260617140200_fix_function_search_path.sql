-- Fix Supabase advisor: function search_path mutable

ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.prevent_points_ledger_mutation() SET search_path = public;
ALTER FUNCTION public.customer_points_balance(uuid) SET search_path = public;
ALTER FUNCTION public.seed_store_defaults(uuid) SET search_path = public;
