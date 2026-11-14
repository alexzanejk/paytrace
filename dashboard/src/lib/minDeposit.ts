// The smallest deposit a website may ask for (owner 2026-11-14, migration 100). Every site starts at 500; the owner
// may lower one site to anything down to 100. The database decides (gw_create_deposit / gw_create_crypto_deposit);
// these helpers only read what was typed and say it in words. Pure, no imports, so the node tests can run them.

export const DEFAULT_MIN_DEPOSIT = 500;
export const LOWEST_MIN_DEPOSIT = 100;
export const MAX_DEPOSIT = 50000;

const BANGLA = "০১২৩৪৫৬৭৮৯";

/** A whole taka amount from 100 to 500, or null. Commas, "Tk" and Bangla digits are fine; decimals are not. */
export function parseMinDeposit(text: string): number | null {
  const clean = text.replace(/[০-৯]/g, (d) => String(BANGLA.indexOf(d))).replace(/tk|৳|,|\s/gi, "");
  if (!/^\d+$/.test(clean)) return null;
  const n = Number(clean);
  return n >= LOWEST_MIN_DEPOSIT && n <= DEFAULT_MIN_DEPOSIT ? n : null;
}

/** The site's deposit range in words, for its card and its developer brief. */
export function depositRange(min: number | null | undefined): string {
  const m = min ?? DEFAULT_MIN_DEPOSIT;
  return `${m.toLocaleString("en-IN")} to ${MAX_DEPOSIT.toLocaleString("en-IN")} taka`;
}

/** One line under the setting: what the site's customers can do now. */
export function minDepositLine(min: number | null | undefined): string {
  const m = min ?? DEFAULT_MIN_DEPOSIT;
  return m === DEFAULT_MIN_DEPOSIT
    ? "The usual minimum: deposits from 500 taka, the same as every other site."
    : `Lowered for this site: its customers can deposit from ${m.toLocaleString("en-IN")} taka (USDT too). Other sites stay at 500.`;
}
