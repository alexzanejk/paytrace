/** Opens the Wallet ledger page pre-set to one phone's wallet (from a phone card). The preset travels through
 *  sessionStorage like the Transactions presets, so the address stays a plain "#/ledger". */
const KEY = "pt-ledger-preset";

export interface LedgerPreset { device: string; provider: string }

export function openLedgerFor(preset: LedgerPreset) {
  try { sessionStorage.setItem(KEY, JSON.stringify(preset)); } catch { /* private window */ }
  window.location.hash = "#/ledger";
}

export function takeLedgerPreset(): LedgerPreset | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const p = JSON.parse(raw) as Partial<LedgerPreset>;
    return typeof p.device === "string" && typeof p.provider === "string" ? { device: p.device, provider: p.provider } : null;
  } catch {
    return null;
  }
}
