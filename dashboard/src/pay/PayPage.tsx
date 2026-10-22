import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Copy, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { DEMO, Gone, demoSwitch, getOrder, pickProvider, submitTrx, type OrderView, type SubmitState } from "./api";
import { clock, money, PROVIDER_COLOR, PROVIDER_NAME, t, type Lang } from "./i18n";
import bkashLogo from "./logos/bkash.png";
import nagadLogo from "./logos/nagad.png";
import rocketLogo from "./logos/rocket.png";

const HEADER = "#216a4a";
const POLL_MS = 4000;
const LOGO: Record<string, string> = { bkash: bkashLogo, nagad: nagadLogo, rocket: rocketLogo };

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

/** The customer's website has already let them choose the method (for example "Nagad Cash Out"). This page starts at the
 *  payment step: the number to pay, then the TrxID, then the result. */
export function PayPage() {
  const tracking = DEMO ? "demo" : new URLSearchParams(window.location.search).get("trackingNumber") ?? "";
  const [lang, setLang] = useState<Lang>(readLang);
  const [screen, setScreen] = useState<Screen>(tracking ? "loading" : "gone");
  const [view, setView] = useState<OrderView | null>(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [trx, setTrx] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [editing, setEditing] = useState(false);
  const [help, setHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  const picking = useRef(false);
  const tr = (key: string, vars?: Record<string, string>) => t(lang, key, vars);

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

  // Keep the order fresh until it is finished, and tick the clock.
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
        if ("error" in r) setProblem("noWallet");
        else {
          setView(r);
          setFetchedAt(Date.now());
        }
      })
      .catch(() => setProblem("failed"))
      .finally(() => {
        picking.current = false;
      });
  }, [view, tracking]);

  // After a successful payment, go back to the website.
  useEffect(() => {
    if (view?.status !== "paid" || !view.return_url) return;
    const to = view.return_url;
    const timer = window.setTimeout(() => window.location.assign(to), 4000);
    return () => window.clearTimeout(timer);
  }, [view?.status, view?.return_url]);

  const left = view ? Math.max(0, view.seconds_left - Math.floor((now - fetchedAt) / 1000)) : 0;
  useEffect(() => {
    if (view?.status === "pending" && left === 0 && !view.trx_id) void refresh();
  }, [left, view, refresh]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      const state: SubmitState = await submitTrx(tracking, trx);
      if (state === "checking" || state === "paid" || state === "review") {
        setEditing(false);
        await refresh();
      } else {
        setProblem(state === "used" ? "used" : state === "too_many" ? "tooMany" : state === "wrong_method" ? "wrongMethod" : state === "invalid" ? "invalid" : "failed");
        if (state === "expired" || state === "closed") await refresh();
      }
    } catch (e2) {
      if (e2 instanceof Gone) setScreen("gone");
      else setProblem("failed");
    }
    setBusy(false);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the number is on screen; copying is a convenience */
    }
  }

  const shop = view?.shop || "the shop";
  const amount = view ? money(view.amount, view.currency) : "";
  const provider = view?.provider ?? "";
  const pname = PROVIDER_NAME[provider] ?? "";
  const color = PROVIDER_COLOR[provider] ?? HEADER;

  return (
    <div className="min-h-screen bg-[#eef3f0] px-3 py-4 text-[#1b1f1d] sm:py-10" style={{ fontFamily: '"Noto Sans Bengali","Noto Sans",Roboto,system-ui,sans-serif' }}>
      {DEMO && (
        <div className="mx-auto mb-3 w-full max-w-[480px] space-y-2 rounded-lg bg-amber-100 px-3 py-2 text-center text-xs text-amber-900">
          <p className="font-semibold">Preview only: nothing real is created or paid. Your website chooses the method before sending the customer here.</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {["bkash", "nagad", "rocket"].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  demoSwitch(p);
                  setTrx("");
                  setEditing(false);
                  setProblem("");
                  void refresh();
                }}
                className={`rounded-md border px-3 py-1 font-semibold ${provider === p ? "border-amber-900 bg-amber-900 text-white" : "border-amber-700"}`}
              >
                {PROVIDER_NAME[p]}
              </button>
            ))}
          </div>
          <p>Try any TrxID of 6+ letters or numbers. USEDTRX1 shows the "already used" message.</p>
        </div>
      )}
      <main className="mx-auto w-full max-w-[480px] overflow-hidden rounded-2xl bg-white shadow-lg">
        <header className="px-5 pb-4 pt-5 text-white" style={{ background: HEADER }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {view && <p className="text-3xl font-bold leading-tight">{amount}</p>}
              <p className="mt-0.5 truncate text-sm opacity-90">{view ? shop : tr("loading")}</p>
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-md bg-white/20 text-xs font-semibold" role="group" aria-label="Language">
              {(["en", "bn"] as Lang[]).map((l) => (
                <button key={l} type="button" onClick={() => changeLang(l)} aria-pressed={lang === l} className={`px-3 py-1.5 ${lang === l ? "bg-white text-[#1b1f1d]" : "text-white"}`}>
                  {l === "en" ? "EN" : "বাং"}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="space-y-5 p-5">
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
              <Notice icon="ok" title={tr("paidTitle")} body={tr("paidBody", { amount })} />
              {view.return_url && (
                <p className="text-center text-sm text-neutral-600">
                  {tr("returning", { shop })}{" "}
                  <a className="font-semibold underline" href={view.return_url} rel="noreferrer noopener">
                    {tr("returnNow")}
                  </a>
                </p>
              )}
            </>
          )}

          {screen === "ready" && view && view.status === "review" && <Notice icon="warn" title={tr("reviewTitle")} body={tr("reviewBody", { shop })} />}
          {screen === "ready" && view && view.status === "expired" && <Notice icon="bad" title={tr("expiredTitle")} body={tr("expiredBody", { shop })} />}
          {screen === "ready" && view && view.status === "cancelled" && <Notice icon="bad" title={tr("closedTitle")} body="" />}

          {screen === "ready" && view && view.status === "pending" && !view.provider && <Notice icon="bad" title={tr("notFoundTitle")} body={tr("badLink")} />}

          {screen === "ready" && view && view.status === "pending" && view.provider && (
            <>
              <p className="text-sm font-semibold text-red-700">{tr("amountNote")}</p>
              <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: left < 60 ? "#b3261e" : "#9a5b00" }}>
                <Clock className="size-4" /> {tr("expiresIn")}: <span className="tabular-nums">{clock(left)}</span>
              </p>

              <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-white" style={{ background: color }}>
                {LOGO[provider] ? (
                  <img src={LOGO[provider]} alt="" width={48} height={48} className="size-12 rounded-full bg-white" />
                ) : (
                  <span className="grid size-12 place-items-center rounded-full bg-white text-lg font-bold" style={{ color }}>
                    {pname.slice(0, 1)}
                  </span>
                )}
                <span className="text-lg font-semibold">
                  {pname.toUpperCase()} {tr("deposit")}
                </span>
              </div>

              {problem === "noWallet" && !view.wallet_number && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{tr("noWallet")}</p>}

              {view.wallet_number && (
                <>
                  <section className="space-y-2">
                    <p className="text-sm font-semibold">
                      {tr("walletNo")}
                      <span className="text-red-600"> *</span>
                    </p>
                    <p className="text-sm text-neutral-600">{tr(view.method === "cash_out" ? "cashOutOnly" : "sendMoneyOnly", { p: pname })}</p>
                    <div className="flex items-center justify-between rounded-lg bg-neutral-100 px-4 py-3">
                      <span className="text-xl font-semibold tabular-nums tracking-wide">{view.wallet_number}</span>
                      <button type="button" onClick={() => void copy(view.wallet_number ?? "")} className="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium" style={{ color: HEADER }} aria-label={tr("copy")}>
                        <Copy className="size-5" /> {copied ? tr("copied") : tr("copy")}
                      </button>
                    </div>
                  </section>

                  <section>
                    <h2 className="mb-1 text-sm font-semibold">{tr("stepsTitle")}</h2>
                    <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-800">
                      <li>{tr(view.method === "cash_out" ? "stepCash1" : "stepSend1", { p: pname })}</li>
                      <li>{tr(view.method === "cash_out" ? "stepCash2" : "stepSend2", { amount })}</li>
                      <li>{tr("step3")}</li>
                    </ol>
                  </section>

                  {view.trx_id && !editing ? (
                    <section className="space-y-3 rounded-xl border border-neutral-200 p-4 text-center">
                      <Loader2 className="mx-auto size-8 animate-spin" style={{ color: HEADER }} />
                      <h2 className="text-lg font-bold">{tr("checkingTitle")}</h2>
                      <p className="text-sm text-neutral-600">{tr("checkingBody")}</p>
                      <p className="text-sm">
                        {tr("yourTrx")}: <span className="font-mono font-semibold">{view.trx_id}</span>
                      </p>
                      <button type="button" onClick={() => { setEditing(true); setTrx(view.trx_id ?? ""); }} className="text-sm font-semibold underline" style={{ color: HEADER }}>
                        {tr("change")}
                      </button>
                    </section>
                  ) : (
                    <form onSubmit={submit} className="space-y-3">
                      <label htmlFor="trx" className="block text-sm font-semibold">
                        {tr("trxLabel")}
                        <span className="text-red-600"> *</span>
                      </label>
                      <button type="button" onClick={() => setHelp((h) => !h)} aria-expanded={help} className="flex items-center gap-1 text-sm font-medium text-blue-700">
                        {tr("trxHint")} <ChevronDown className={`size-4 transition ${help ? "rotate-180" : ""}`} />
                      </button>
                      {help && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{tr("trxHelp", { p: pname })}</p>}
                      <input
                        id="trx"
                        value={trx}
                        onChange={(e) => setTrx(e.target.value)}
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        maxLength={60}
                        placeholder={tr("trxPlaceholder")}
                        className="w-full rounded-lg border-2 px-4 py-3 text-lg outline-none focus:ring-2"
                        style={{ borderColor: problem && problem !== "failed" ? "#d93025" : "#e0443a" }}
                      />
                      {problem && problem !== "noWallet" && <p className="text-sm font-medium text-red-700" role="alert">{tr(problem)}</p>}
                      <div className="flex justify-center">
                        <button type="submit" disabled={busy || trx.trim().length < 6} className="rounded-xl border-2 border-neutral-900 px-14 py-3 text-base font-semibold text-neutral-900 disabled:opacity-40">
                          {busy ? tr("confirming") : tr("confirm")}
                        </button>
                      </div>
                    </form>
                  )}

                  <section className="space-y-1 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">
                    <p className="flex items-center gap-1.5 font-semibold text-red-700">
                      <AlertTriangle className="size-4" /> {tr("warnTitle")}
                    </p>
                    <p>{tr("warn1")}</p>
                    <p>{tr("warn2")}</p>
                    <p>{tr("wrongAmountHint")}</p>
                  </section>
                </>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center justify-center gap-1.5 border-t border-neutral-100 px-5 py-3 text-xs text-neutral-500">
          <ShieldCheck className="size-4" /> {tr("secure")}
        </footer>
      </main>
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
