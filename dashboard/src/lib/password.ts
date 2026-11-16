/** Pure rules for the admin password screens (tested in tests/password.test.ts). Nothing here ever keeps,
 *  logs or sends a password; it only says what is wrong with one. */

export const MIN_PASSWORD = 10;

export type AuthLanding = { recovery: boolean; error: string | null };

/** What the address said when the page opened. A password-reset email lands on
 *  "#access_token=...&type=recovery"; an old or used link lands on "#error=...&error_description=...". */
export function readLanding(hash: string): AuthLanding {
  const params = new URLSearchParams(hash.replace(/^#\/?/, ""));
  const code = params.get("error_code") ?? "";
  const error = params.get("error");
  if (error) {
    const expired = /expired|invalid/i.test(code + " " + (params.get("error_description") ?? ""));
    return {
      recovery: false,
      error: expired
        ? "That email link has expired or was already used. Ask for a new one below."
        : "The email link did not work. Ask for a new one below.",
    };
  }
  return { recovery: params.get("type") === "recovery" && params.has("access_token"), error: null };
}

/** Why the new password cannot be saved yet, or null when it can. */
export function passwordProblem(pw: string, again: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (/^\s|\s$/.test(pw)) return "Take out the space at the start or end.";
  if (/^(.)\1+$/.test(pw)) return "Do not repeat one character.";
  if (again !== pw) return "The two boxes are not the same.";
  return null;
}

/** Supabase's answer to a password change, in plain words. */
export function saveErrorText(message: string, code?: string): string {
  const m = `${code ?? ""} ${message}`.toLowerCase();
  if (m.includes("same_password") || m.includes("different from the old")) return "That is the password you already have. Choose a new one.";
  if (m.includes("weak_password") || m.includes("weak") || m.includes("pwned") || m.includes("leaked"))
    return "Supabase refused it as too easy to guess. Choose a longer or less common one.";
  if (m.includes("aal") || m.includes("assurance")) return "Enter your two-step code first, then try again.";
  if (m.includes("rate") || m.includes("too many")) return "Too many tries. Wait a minute and try again.";
  if (m.includes("session") || m.includes("jwt") || m.includes("expired"))
    return "This sign-in has run out. Ask for a new email link and open it straight away.";
  return `The password was not saved: ${message}`;
}
