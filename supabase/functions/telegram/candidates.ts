// TrxID-shaped strings in a piece of text: what the bot pulls out of a message or an OCR read before the database
// decides which (if any) is a transaction PayTrace holds. Pure, no I/O.
//
// bKash: 10 letters/digits (DKJ9NWWLEH). Its receipt font can turn the only digit into a letter (DKJONWWLEH, a real OCR
// read 2026-11-20), so a 10-character string needs only a letter. Nagad: 8 with letters AND digits (76CCGNVE). Rocket:
// 10 digits. Noise such as a site name ("777bajii") passes here and matches nothing in the database, which is the real
// filter. A COPY of this rule lives in `public.tg_trx_candidates` (migration 112) and in `ocr-worker/src/candidates.ts`;
// tests/telegram.test.ts keeps the TypeScript copies in step and names the SQL one.

const TOKEN = /(?<![A-Za-z0-9])([A-Za-z0-9]{8}|[A-Za-z0-9]{10})(?![A-Za-z0-9])/g;

/** Every candidate, upper case, each once, in the order first seen. */
export function trxCandidates(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(TOKEN)) {
    const t = m[1].toUpperCase();
    const ok = (t.length === 8 && /[A-Z]/.test(t) && /[0-9]/.test(t)) || (t.length === 10 && /[A-Z]/.test(t)) || /^[0-9]{10}$/.test(t);
    if (ok && !out.includes(t)) out.push(t);
  }
  return out;
}
