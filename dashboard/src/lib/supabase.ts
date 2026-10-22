import { createClient } from "@supabase/supabase-js";

import { SUPABASE_URL } from "@/lib/config";

export { SUPABASE_URL };
// Publishable key: public by design. Row Level Security protects the data.
const SUPABASE_KEY = "sb_publishable_faG5Xm4u4Dp9ObPP10oaSQ_Ocye9262";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
export const INGEST_URL = `${SUPABASE_URL}/functions/v1/ingest`;

/** Throws on a failed query so screens can show one error message. */
export function must<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}
