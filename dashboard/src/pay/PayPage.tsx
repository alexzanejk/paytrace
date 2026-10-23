import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle, X } from "lucide-react";
import { DEMO, Gone, demoStyle, demoSwitch, getOrder, pickProvider, submitTrx, type OrderView, type SubmitState } from "./api";
import { leaveTo, reportHeight, tellParent } from "./embed";
import { BkashMenuRow, HowToBody, howCaption, howClose, howKind, howTitle } from "./HowTo";
import { ResultScreen, RESULT_STYLE_NAMES, type Phase } from "./ResultScreens";
import { bannerColor, bdt, bnDigits, clock, headerColor, mmss, PROVIDER_NAME, t, variantFor, type Lang, type Variant } from "./i18n";
import bkashLogo from "./logos/bkash.png";
import nagadLogo from "./logos/nagad.png";
import rocketLogo from "./logos/rocket.png";

const POLL_MS = 4000;
const LOGO: Record<string, string> = { bkash: bkashLogo, nagad: nagadLogo, rocket: rocketLogo };
const FONT = '"Noto Sans Bengali","Noto Sans","Noto Sans TC",Roboto,system-ui,sans-serif';

function readLang(): Lang {
  try {
    const v = window.localStorage.getItem("pay_lang");
    if (v === "en" || v === "bn") return v;
  } catch {
    /* storage can be blocked; the default is fine */
  }
  return "bn";
}

type Screen = "loading" | "gone" | "error" | "ready";
type Toast = { kind: "ok" | "bad"; text: string } | null;

/** The page a customer lands on after choosing the method on the website. It starts at the payment step: the number to pay,
 *  then the TrxID, then the result. Two layouts, matching the owner's reference pages: Cash Out and Send Money. */
export function PayPage() {
  const tracking = DEMO ? "demo" : new URLSearchParams(window.location.search).get("trackingNumber") ?? "";
  const [lang, setLang] = useState<Lang>(readLang);
  const [screen, setScreen] = useState<Screen>(tracking ? "loading" : "gone");
  const [view, setView] = useState<OrderView | null>(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [trx, setTrx] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [wallProblem, setWallProblem] = useState(false);
  const picking = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const variant: Variant = variantFor(view?.provider ?? "", view?.method ?? null);
  const tr = (key: string, vars?: Record<string, string>) => t(lang, variant, key, vars);

  const showToast = (kind: "ok" | "bad", text: string) => {
    setToast({ kind, text });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  const changeLang = (l: Lang) => {
    setLang(l);
    try {
      window.localStorage.setItem("pay_lang", l);
    } catch {
      /* ignore */
    }
  };

  const refresh = useCallback(async () => {
    if (!tracking) return;
    try {
      const v = await getOrder(tracking);
      setView(v);
      setFetchedAt(Date.now());
      setScreen("ready");
    } catch (e) {
      if (e instanceof Gone) setScreen("gone");
      else setScreen((s) => (s === "loading" ? "error" : s)); // a missed poll must not wipe a page that is already showing
    }
  }, [tracking]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const finished = view !== null && view.status !== "pending";
  useEffect(() => {
    if (finished) return;
    const poll = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(poll);
  }, [finished, refresh]);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  // Safety net: an order that has a provider but no number yet gets one (normally the number is assigned when the website creates the order).
  useEffect(() => {
    if (!view || view.status !== "pending" || !view.provider || view.wallet_number || picking.current) return;
    picking.current = true;
    void pickProvider(tracking, view.provider)
      .then((r) => {
        if ("error" in r) setWallProblem(true);
        else {
          setView(r);
          setFetchedAt(Date.now());
        }
      })
      .catch(() => setWallProblem(true))
      .finally(() => {
        picking.current = false;
      });
  }, [view, tracking]);

  // After the result, go back to the website: to its success page after a paid order, to its "failed" page after an expired or cancelled one.
  const leaveUrl = view?.status === "paid" ? view.return_url : view?.status === "expired" || view?.status === "cancelled" ? view.failed_url ?? null : null;
  useEffect(() => {
    if (!leaveUrl) return;
    const timer = window.setTimeout(() => leaveTo(leaveUrl), view?.status === "paid" ? 4000 : 8000);
    return () => window.clearTimeout(timer);
  }, [leaveUrl, view?.status]);

  // Let a website that shows this page in a frame know the state and the height.
  useEffect(() => {
    if (view) tellParent({ type: "state", state: view.status, order_id: view.merchant_order_id ?? null });
  }, [view?.status, view?.merchant_order_id]);
  useEffect(() => reportHeight(), []);

  const left = view ? Math.max(0, view.seconds_left - Math.floor((now - fetchedAt) / 1000)) : 0;
  useEffect(() => {
    if (view?.status === "pending" && left === 0 && !view.trx_id) void refresh();
  }, [left, view, refresh]);

  const cleanTrx = trx.replace(/\s+/g, "");

  function pressConfirm() {
    if (cleanTrx.length < 6) {
      document.getElementById("trx")?.focus();
      return;
    }
    setConfirmOpen(true);
  }

  async function sendTrx() {
    setConfirmOpen(false);
    setBusy(true);
    try {
      const state: SubmitState = await submitTrx(tracking, cleanTrx);
      if (state === "checking" || state === "paid" || state === "review") {
        setEditing(false);
        await refresh();
      } else {
        showToast("bad", tr(state === "used" ? "used" : state === "too_many" ? "tooMany" : state === "wrong_method" ? "wrongMethod" : state === "invalid" ? "invalid" : "failed"));
        if (state === "expired" || state === "closed") await refresh();
      }
    } catch (e) {
      if (e instanceof Gone) setScreen("gone");
      else showToast("bad", tr("failed"));
    }
    setBusy(false);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* the number is on screen; copying is a convenience */
    }
    showToast("ok", "Copy Success");
  }

  const shop = view?.shop || "the shop";
  const provider = view?.provider ?? "";
  const pname = PROVIDER_NAME[provider] ?? "";
  const color = bannerColor(provider, variant);
  const head = view?.provider ? headerColor(provider, variant) : "#216a4a";
  const amountText = view ? bdt(view.amount, view.currency, variant === "send") : "";
  const redAmount = view ? (variant === "send" ? bnDigits(bdt(view.amount, view.currency, false)) : bdt(view.amount, view.currency, false)) : "";
  const shownAmount = lang === "bn" && variant === "send" ? redAmount : bdt(view?.amount ?? 0, view?.currency ?? "BDT", false);
  const timer = `${tr("expiresIn")}: ${clock(left)}`;
  const dim = confirmOpen || howOpen;
  const how = howKind(provider, view?.method ?? null);

  const banner = (
    <div className="flex items-center gap-4 rounded px-4 py-3 text-white" style={{ background: color, minHeight: 76 }}>
      {LOGO[provider] ? (
        <img src={LOGO[provider]} alt="" width={60} height={60} className="size-[60px] rounded-full bg-white" />
      ) : (
        <span className="grid size-[60px] place-items-center rounded-full bg-white text-2xl font-bold" style={{ color }}>
          {pname.slice(0, 1)}
        </span>
      )}
      <span className="text-xl font-bold">
        {variant === "bsend" && lang === "bn" ? tr("bannerName") : `${pname.toUpperCase()} ${tr("deposit")}`}
      </span>
    </div>
  );

  const walletBox = (
    <div className={`flex items-center justify-between px-5 ${variant === "send" ? "border-b border-neutral-500 bg-neutral-100" : "bg-neutral-100"}`} style={{ height: 56 }}>
      <span className="text-xl tabular-nums">{view?.wallet_number}</span>
      <button type="button" onClick={() => void copy(view?.wallet_number ?? "")} aria-label={tr("copy")} className="text-[#216a4a]">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="8" y="3" width="12" height="15" rx="2" />
          <path d="M16 21H6a2 2 0 0 1-2-2V8" />
          <path d="M11 8h6M11 11h6M11 14h4" />
        </svg>
      </button>
    </div>
  );

  const floating = focused || cleanTrx.length > 0;
  const trxBox = (
    <div className="relative">
      <label
        htmlFor="trx"
        className="pay-float-label pointer-events-none absolute left-4 text-neutral-500"
        style={{ top: floating ? 6 : 16, fontSize: floating ? 12 : 18, lineHeight: 1.2 }}
      >
        {tr("placeholder")}
      </label>
      <input
        id="trx"
        value={trx}
        onChange={(e) => setTrx(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={60}
        className="w-full bg-transparent px-4 text-lg outline-none"
        style={{
          height: 56,
          paddingTop: floating ? 20 : 0,
          borderRadius: 4,
          border: variant === "cash" ? "2px solid #e0392b" : `1px solid ${focused ? "#222" : "#bbb"}`,
        }}
      />
    </div>
  );

  const linkRow = (
    <button type="button" onClick={() => setHowOpen(true)} className="block w-full py-1 text-center text-[15px] font-bold text-[#1565c0]">
      {tr("link")}
    </button>
  );

  const confirmBtn = (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={pressConfirm}
        disabled={busy}
        className={`rounded-[10px] border border-neutral-900 bg-white py-3 text-sm text-neutral-900 transition-colors hover:bg-neutral-200 active:bg-neutral-300 disabled:opacity-50 ${variant === "bsend" ? "w-full" : "px-14"}`}
      >
        {busy ? "…" : tr("confirm")}
      </button>
    </div>
  );

  const warning = (
    <section className="space-y-1">
      <p className="text-[15px] font-bold">{tr("warnTitle")}</p>
      <p className="pay-warn-pulse text-center text-[11px] font-bold text-red-600">{tr("warnRed")}</p>
      <p className="text-[11px] leading-snug text-neutral-500">{tr("warnGray", { P: variant === "send" ? pname.toUpperCase() : pname.toUpperCase() })}</p>
    </section>
  );

  const checkingPanel = (
    <section className="space-y-3 rounded-xl border border-neutral-200 p-4 text-center">
      <Loader2 className="mx-auto size-8 animate-spin" style={{ color: head }} />
      <h2 className="text-lg font-bold">{tr("checkingTitle")}</h2>
      <p className="text-sm text-neutral-600">{tr("checkingBody")}</p>
      <p className="text-sm">
        {tr("yourTrx")}: <span className="font-mono font-semibold">{view?.trx_id}</span>
      </p>
      <button
        type="button"
        onClick={() => {
          setEditing(true);
          setTrx(view?.trx_id ?? "");
        }}
        className="text-sm font-semibold underline"
        style={{ color: head }}
      >
        {tr("change")}
      </button>
    </section>
  );

  const demoBar = DEMO ? (

        <div className="mx-auto mb-3 w-full max-w-[680px] space-y-2 bg-amber-100 px-3 py-2 text-center text-xs text-amber-900 sm:rounded-lg">
          <p className="font-semibold">Preview only: nothing real is created or paid. Your website chooses the method before sending the customer here.</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {(
              [
                ["bkash", "cash_out", "bKash Cash Out"],
                ["nagad", "cash_out", "Nagad Cash Out"],
                ["nagad", "send_money", "Nagad Send Money"],
                ["rocket", "cash_out", "Rocket Cash Out"],
                ["bkash", "send_money", "bKash Send Money"],
              ] as const
            ).map(([p, m, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  demoSwitch(p, m);
                  setTrx("");
                  setEditing(false);
                  void refresh();
                }}
                className={`rounded-md border px-3 py-1 font-semibold ${provider === p && view?.method === m ? "border-amber-900 bg-amber-900 text-white" : "border-amber-700"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <span className="font-semibold">After Confirm, look:</span>
            {RESULT_STYLE_NAMES.map((n, i) => (
              <button key={n} type="button" onClick={() => demoStyle(i)} className={`rounded-md border px-2 py-0.5 font-semibold ${(view?.result_style ?? 0) === i ? "border-amber-900 bg-amber-900 text-white" : "border-amber-700"}`}>
                {n}
              </button>
            ))}
          </div>
          <p>Try any TrxID of 6+ letters or numbers. REVIEW001 ends in "held for review", EXPIRED01 in "expired". USEDTRX1 shows the "already used" message; FORMATBAD1 shows the red error message.</p>
        </div>
  ) : null;

  const showResult = screen === "ready" && !!view && !!view.provider && (view.status === "paid" || view.status === "review" || view.status === "expired" || (view.status === "pending" && !!view.trx_id && !editing));
  if (showResult && view) {
    const phase: Phase = view.status === "pending" ? "checking" : (view.status as Phase);
    return (
      <div className="min-h-screen bg-[#eceff1] px-3 py-6 sm:py-10" style={{ fontFamily: FONT, color: "#222" }}>
        {demoBar}
        <div className="mx-auto w-full max-w-[560px]">
          <div className="mb-2 flex justify-end">
            <div className="flex overflow-hidden rounded text-[11px] font-bold shadow" role="group" aria-label="Language">
              {(["en", "bn"] as Lang[]).map((l) => (
                <button key={l} type="button" onClick={() => changeLang(l)} aria-pressed={lang === l} className={`px-3 py-1 ${lang === l ? "bg-neutral-300 text-neutral-800" : "bg-white text-black"}`}>
                  {l === "en" ? "EN" : "বাং"}
                </button>
              ))}
            </div>
          </div>
          <ResultScreen
            style={view.result_style ?? 0}
            phase={phase}
            lang={lang}
            amount={bdt(view.amount, view.currency, false)}
            shop={shop}
            provider={pname}
            trx={view.trx_id ?? ""}
            returnUrl={view.return_url ?? view.failed_url ?? null}
            onChange={() => {
              setEditing(true);
              setTrx(view.trx_id ?? "");
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eceff1] sm:px-3 sm:py-8" style={{ fontFamily: FONT, color: "#222" }}>
      {demoBar}

      {dim && <div className="pay-fade fixed inset-0 z-40 bg-black/45" onClick={() => (howOpen ? setHowOpen(false) : setConfirmOpen(false))} />}

      {toast && (
        <div
          role="status"
          className={`pay-toast fixed right-3 top-3 z-[60] flex items-center gap-3 rounded px-4 py-2.5 text-sm text-white shadow-lg ${toast.kind === "ok" ? "bg-[#21ba45]" : "bg-[#e53935]"}`}
        >
          <span>{toast.text}</span>
          <button type="button" aria-label="Close" onClick={() => setToast(null)}>
            <X className="size-5" />
          </button>
        </div>
      )}

      <main className="mx-auto w-full max-w-[680px] overflow-hidden bg-white shadow-md sm:rounded-[10px]">
        <header className="px-5 py-3 text-white" style={{ background: head, minHeight: 74 }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xl font-bold leading-tight">{view ? amountText : tr("loading")}</p>
              <p className={`mt-1 font-bold leading-tight ${variant === "bsend" ? "text-sm" : "text-base"}`}>{view ? tr("sub") : ""}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <div className="flex items-center gap-2" aria-label={shop}>
                <span className="rounded bg-white px-1.5 py-0.5 text-xl font-extrabold leading-none" style={{ color: head }}>
                  PAY
                </span>
                <span className="text-xl font-light tracking-[0.2em]">SERVICE</span>
              </div>
              <div className="flex overflow-hidden rounded text-[11px] font-bold shadow" role="group" aria-label="Language">
                {(["en", "bn"] as Lang[]).map((l) => (
                  <button key={l} type="button" onClick={() => changeLang(l)} aria-pressed={lang === l} className={`px-3 py-1 ${lang === l ? "bg-neutral-300 text-neutral-800" : "bg-white text-black"}`}>
                    {l === "en" ? "EN" : "বাং"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        <div className="space-y-4 px-5 pb-8 pt-5">
          {screen === "loading" && (
            <p className="flex items-center justify-center gap-2 py-10 text-neutral-600">
              <Loader2 className="size-5 animate-spin" /> {tr("loading")}
            </p>
          )}

          {screen === "gone" && <Notice icon="bad" title={tr("notFoundTitle")} body={tr("notFoundBody")} />}

          {screen === "error" && (
            <div className="space-y-3 py-6 text-center">
              <p className="text-neutral-700">{tr("failed")}</p>
              <button type="button" onClick={() => void refresh()} className="rounded-lg border border-neutral-300 px-5 py-2 font-medium">
                {tr("retry")}
              </button>
            </div>
          )}

          {screen === "ready" && view && view.status === "paid" && (
            <>
              <Notice icon="ok" title={tr("paidTitle")} body={tr("paidBody", { amount: shownAmount })} />
              {view.return_url && (
                <p className="text-center text-sm text-neutral-600">
                  {tr("returning", { shop })}{" "}
                  <a className="font-semibold underline" href={view.return_url} target="_top" rel="noreferrer noopener">
                    {tr("returnNow")}
                  </a>
                </p>
              )}
            </>
          )}

          {screen === "ready" && view && view.status === "review" && <Notice icon="warn" title={tr("reviewTitle")} body={tr("reviewBody", { shop })} />}
          {screen === "ready" && view && view.status === "expired" && (
            <>
              <Notice icon="bad" title={tr("expiredTitle")} body={tr("expiredBody", { shop })} />
              {view.failed_url && (
                <p className="text-center text-sm text-neutral-600">
                  <a className="font-semibold underline" href={view.failed_url} target="_top" rel="noreferrer noopener">
                    {tr("returnNow")}
                  </a>
                </p>
              )}
            </>
          )}
          {screen === "ready" && view && view.status === "cancelled" && <Notice icon="bad" title={tr("closedTitle")} body="" />}
          {screen === "ready" && view && view.status === "pending" && !view.provider && <Notice icon="bad" title={tr("notFoundTitle")} body={tr("badLink")} />}

          {screen === "ready" && view && view.status === "pending" && view.provider && (
            <>
              <p className="text-[17px] font-bold leading-snug text-[#e0392b]">{tr("amountNote", { amount: lang === "bn" && variant === "send" ? redAmount : redAmount })}</p>
              {variant !== "bsend" && (
                <p className="text-[13px] font-bold" style={{ color: left < 60 ? "#b3261e" : "#d9722b" }}>
                  {timer}
                </p>
              )}

              {wallProblem && !view.wallet_number && <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">{tr("noWallet")}</p>}

              {view.wallet_number && (variant === "cash" || variant === "bsend") && (
                <>
                  {banner}
                  <div>
                    <p className="text-xl font-bold">
                      {tr("walletNo")}
                      <span className="text-[#9c27b0]">*</span>
                    </p>
                    <p className="mb-1 text-[17px]">{tr("walletOnly", { P: pname.toUpperCase() })}</p>
                    {walletBox}
                  </div>
                  {view.trx_id && !editing ? (
                    checkingPanel
                  ) : (
                    <>
                      <p className="text-xl font-bold leading-snug">
                        {tr("trxLabel")}
                        <span className="text-[#e0392b]">{tr("required")}</span>
                      </p>
                      {linkRow}
                      {trxBox}
                      {confirmBtn}
                    </>
                  )}
                  {variant === "bsend" && (
                    <>
                      <BkashMenuRow lang={lang} />
                      <p className="text-center text-xl font-bold text-[#e0392b]">{tr("menuLabel")}</p>
                      <p className="text-center text-sm font-bold" style={{ color: left < 60 ? "#b3261e" : "#555" }}>
                        {tr("timeLeft")} <span className="text-[#e0392b]">{mmss(left)}</span>
                      </p>
                    </>
                  )}
                  {warning}
                </>
              )}

              {view.wallet_number && variant === "send" && (
                <>
                  <div>
                    <p className="text-lg font-bold">
                      {tr("walletNoSend")}
                      <span className="text-[#9c27b0]">*</span>
                    </p>
                    <p className="mb-1 text-[16px]">{tr("walletOnly", { P: pname.toUpperCase() })}</p>
                    {walletBox}
                  </div>
                  <p className="text-lg font-bold">{tr("walletProvider")}</p>
                  {banner}
                  {view.trx_id && !editing ? (
                    checkingPanel
                  ) : (
                    <>
                      <p className="text-lg font-bold">
                        {tr("trxLabel")}
                        <span className="text-[#9c27b0]">*</span>
                        <span className="text-[#e0392b]">{tr("required")}</span>
                      </p>
                      {linkRow}
                      {trxBox}
                      {confirmBtn}
                    </>
                  )}
                  {warning}
                </>
              )}
            </>
          )}
        </div>
      </main>

      {howOpen && (
        <div role="dialog" aria-modal="true" aria-label={howTitle(how, lang)} className="pay-pop fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded bg-white p-5 text-center shadow-2xl">
          <h2 className="mb-3 text-base font-bold">{howTitle(how, lang)}</h2>
          <HowToBody kind={how} lang={lang} />
          {howCaption(how) && <p className="my-3 text-[11px] font-bold">{howCaption(how)}</p>}
          <button type="button" onClick={() => setHowOpen(false)} className={`rounded bg-[#0b6b45] py-2 text-sm font-bold text-white ${how === "bkash_send" ? "mt-3 w-full" : "px-6"}`}>
            {howClose(how, lang)}
          </button>
        </div>
      )}

      {confirmOpen && (
        <div role="alertdialog" aria-modal="true" className="pay-pop fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded bg-white px-6 pb-6 pt-7 text-center shadow-2xl">
          <p className="text-[17px] leading-relaxed text-neutral-700">
            This order can only be submitted once, please confirm your Transaction ID: <span className="break-all text-[#e0392b]">{cleanTrx}</span> is correct!
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-full bg-neutral-300 px-8 py-2 text-sm font-semibold text-neutral-700 shadow">
              Cancel
            </button>
            <button type="button" onClick={() => void sendTrx()} className="rounded-full bg-[#0b6b45] px-8 py-2 text-sm font-semibold text-white shadow">
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Notice({ icon, title, body }: { icon: "ok" | "warn" | "bad"; title: string; body: string }) {
  const Icon = icon === "ok" ? CheckCircle2 : icon === "warn" ? AlertTriangle : XCircle;
  const color = icon === "ok" ? "#146c43" : icon === "warn" ? "#9a5b00" : "#b3261e";
  return (
    <div className="space-y-2 py-6 text-center">
      <Icon className="mx-auto size-14" style={{ color }} />
      <h1 className="text-xl font-bold">{title}</h1>
      {body && <p className="text-sm text-neutral-600">{body}</p>}
    </div>
  );
}
