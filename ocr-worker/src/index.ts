// PayTrace OCR worker. Runs on the owner's own VPS as a small systemd service (see setup.sh). Every few seconds it asks
// the PayTrace `telegram` function for photos still to read, downloads each one THROUGH that function (so the bot
// token never lives here), runs Tesseract over a few prepared copies, and sends the text back. The database then
// decides which stored transaction, if any, the text names; this worker never matches, never pays, never writes
// anything but the OCR text. Outbound connections only; nothing listens on any port.
//
// Needs on the machine: node (>= 18.17), `tesseract` (apt: tesseract-ocr tesseract-ocr-eng) and `convert` from
// ImageMagick (apt: imagemagick). Configuration from the environment (the systemd unit reads /etc/paytrace-ocr.env):
//   PAYTRACE_FUNCTION_URL   the telegram function's address (default: PayTrace's live project)
//   SUPABASE_SERVICE_KEY    the project's service key, the ONE secret here; typed in by the owner, never in the repo
//   OCR_POLL_SECONDS        how often to ask (default 5)
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { trxCandidates } from "./candidates.js";

const run = promisify(execFile);

const FN = (process.env.PAYTRACE_FUNCTION_URL ?? "https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/telegram").replace(/\/+$/, "");
const KEY = (process.env.SUPABASE_SERVICE_KEY ?? "").trim();
const POLL_MS = Math.max(2, Number(process.env.OCR_POLL_SECONDS) || 5) * 1000;
const ONCE = process.argv.includes("--once");

if (!KEY) { console.error("SUPABASE_SERVICE_KEY is not set (see /etc/paytrace-ocr.env)"); process.exit(2); }

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function call(action: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(FN, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ action, ...body }), signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${action}: HTTP ${res.status} ${String(j.message ?? "")}`);
  return j;
}

async function download(claimId: string): Promise<Buffer> {
  const res = await fetch(`${FN}?photo=${encodeURIComponent(claimId)}`, { headers: { authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`photo: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new Error("photo: empty");
  if (buf.length > 20_000_000) throw new Error("photo: too large");
  return buf;
}

/** The prepared copies Tesseract reads: grey and doubled, the same inverted (dark app screens), and a thresholded one.
 *  Each is one ImageMagick call; a copy that fails is skipped. */
const VARIANTS: Array<{ name: string; args: string[] }> = [
  { name: "up2", args: ["-colorspace", "Gray", "-resize", "200%", "-normalize"] },
  { name: "up2_inv", args: ["-colorspace", "Gray", "-resize", "200%", "-normalize", "-negate"] },
  { name: "up2_thr", args: ["-colorspace", "Gray", "-resize", "200%", "-normalize", "-threshold", "60%"] },
  { name: "up3_sharp", args: ["-colorspace", "Gray", "-resize", "300%", "-sharpen", "0x1"] },
];
const PSMS = ["6", "11"];

async function ocr(image: Buffer): Promise<{ text: string; ok: boolean }> {
  const dir = await mkdtemp(join(tmpdir(), "paytrace-ocr-"));
  try {
    const src = join(dir, "in.img");
    await writeFile(src, image);
    const parts: string[] = [];
    let ran = 0;
    for (const v of VARIANTS) {
      const out = join(dir, `${v.name}.png`);
      try { await run("convert", [src, ...v.args, out], { timeout: 30_000 }); } catch { continue; }
      for (const psm of PSMS) {
        try {
          const { stdout } = await run("tesseract", [out, "stdout", "-l", "eng", "--psm", psm], { timeout: 60_000, maxBuffer: 4_000_000 });
          ran++;
          parts.push(stdout);
        } catch { /* one pass failing is fine */ }
      }
    }
    // Candidate strings first (what the database reads), then a capped slice of the raw text for the owner's eyes.
    const cands = trxCandidates(parts.join("\n"));
    const text = (cands.length ? "candidates: " + cands.join(" ") + "\n" : "") + parts.join("\n").replace(/\s+\n/g, "\n").slice(0, 3500);
    return { text, ok: ran > 0 };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function one(): Promise<number> {
  const next = await call("ocr_next", { limit: 5 });
  const claims = (next.claims ?? []) as Array<{ id: string; file_id: string | null; tries: number }>;
  for (const c of claims) {
    const t0 = Date.now();
    try {
      const img = await download(c.id);
      const { text, ok } = await ocr(img);
      const done = await call("ocr_done", { claim_id: c.id, text, ok });
      const claim = (done.claim ?? {}) as { status?: string; candidates?: string[] };
      log(`claim ${c.id.slice(0, 8)} try ${c.tries}: ${ok ? "read" : "no read"} in ${Date.now() - t0} ms -> ${claim.status ?? "?"} [${(claim.candidates ?? []).join(" ")}]`);
    } catch (e) {
      log(`claim ${c.id.slice(0, 8)} try ${c.tries}: failed (${e instanceof Error ? e.message : "error"})`);
      await call("ocr_done", { claim_id: c.id, text: "", ok: false }).catch(() => {});
    }
  }
  return claims.length;
}

async function main() {
  log(`PayTrace OCR worker started; asking ${FN} every ${POLL_MS / 1000} s`);
  let quietErrors = 0;
  for (;;) {
    try {
      const n = await one();
      quietErrors = 0;
      if (ONCE) { log(`done (${n} photo(s))`); return; }
      if (n === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (e) {
      // The function unreachable, the key refused, ...: say it once a minute, keep trying.
      if (quietErrors++ % 12 === 0) log(`waiting: ${e instanceof Error ? e.message : "error"}`);
      if (ONCE) process.exit(1);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

main();
