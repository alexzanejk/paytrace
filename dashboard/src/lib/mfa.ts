import { sb } from "@/lib/supabase";

/** True when the person has signed in with their password, has a verified authenticator, and has not
 *  entered the 6-digit code yet. The database refuses everything until they do. */
export async function needsSecondStep(): Promise<boolean> {
  const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === "aal1" && data?.nextLevel === "aal2";
}

/** The code is six digits; people paste it with spaces or a dash. */
export const cleanCode = (raw: string) => raw.replace(/\D/g, "").slice(0, 6);
