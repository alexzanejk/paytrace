import { useCallback, useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import type { Settings } from "@/lib/types";
import { isTabId, type TabId } from "@/lib/nav";
import { AppShell } from "@/components/AppShell";
import { Login } from "@/components/Login";
import { MfaChallenge } from "@/components/MfaChallenge";
import { needsSecondStep } from "@/lib/mfa";
import { Overview } from "@/pages/Overview";
import { Review } from "@/pages/Review";
import { Payments } from "@/pages/Payments";
import { Orders } from "@/pages/Orders";
import { Devices } from "@/pages/Devices";
import { Logs } from "@/pages/Logs";
import { ApiAccess } from "@/pages/ApiAccess";
import { SettingsPage } from "@/pages/SettingsPage";

type Phase = { name: "loading" } | { name: "login"; note?: string } | { name: "mfa" } | { name: "ready" };

const tabFromHash = (): TabId => {
  const raw = window.location.hash.replace(/^#\/?/, "");
  return isTabId(raw) ? raw : "overview";
};

export default function App() {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<TabId>(tabFromHash);

  const boot = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    if (!data.session) return setPhase({ name: "login" });
    // Password accepted, but two-step login is on and the code has not been entered yet.
    if (await needsSecondStep()) return setPhase({ name: "mfa" });
    const { data: admin } = await sb.from("admins").select("user_id").maybeSingle();
    if (!admin) {
      await sb.auth.signOut();
      return setPhase({ name: "login", note: "This account is not an admin." });
    }
    const { data: s } = await sb.from("settings").select("*").maybeSingle();
    setSettings(s as Settings | null);
    setPhase({ name: "ready" });
  }, []);

  useEffect(() => {
    void boot();
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setPhase({ name: "login" });
    });
    return () => sub.subscription.unsubscribe();
  }, [boot]);

  // The address bar follows the open section, so a reload or a bookmark returns to it.
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openTab = (next: TabId) => {
    setTab(next);
    window.location.hash = `#/${next}`;
  };

  if (phase.name === "loading") return <main className="p-6 text-muted-foreground">Loading…</main>;
  if (phase.name === "login") return <Login note={phase.note} onSignedIn={boot} />;
  if (phase.name === "mfa") return <MfaChallenge onVerified={boot} />;

  return (
    <AppShell tab={tab} onTab={openTab} onSignOut={() => void sb.auth.signOut()}>
      {tab === "overview" && <Overview />}
      {tab === "review" && <Review />}
      {tab === "payments" && <Payments />}
      {tab === "orders" && <Orders settings={settings} />}
      {tab === "devices" && <Devices />}
      {tab === "logs" && <Logs />}
      {tab === "api" && <ApiAccess />}
      {tab === "settings" && <SettingsPage onSaved={setSettings} />}
    </AppShell>
  );
}
