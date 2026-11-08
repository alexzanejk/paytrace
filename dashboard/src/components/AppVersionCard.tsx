import { useState } from "react";
import { AlertTriangle, Check, Pencil, X } from "lucide-react";
import { sb } from "@/lib/supabase";
import { buildNumber, outdatedLine, outdatedPhones, versionCounts, versionState } from "@/lib/appVersion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** Small badge beside a phone's version: green when it is on the newest build, amber "Outdated app" when it is behind. */
export function VersionChip({ version, newest }: { version: string | undefined; newest: number | null }) {
  if (!version) return null;
  const state = versionState(version, newest);
  if (state === "behind") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-warn-bg px-2 py-0.5 font-semibold text-status-warn" title={`The newest app is v1.0.${newest}. Update this phone from the app's Settings, or install the download link.`}>
        <AlertTriangle className="h-3 w-3" aria-hidden /> Outdated app v{version} · newest 1.0.{newest}
      </span>
    );
  }
  if (state === "current") {
    return <span className="rounded-full bg-status-ok-bg px-2 py-0.5 font-medium text-status-ok" title="This phone has the newest app">v{version} · up to date</span>;
  }
  return <span>v{version}</span>;
}

/** The amber card at the top of the Phones page when any phone runs an older app (owner 2026-11-08). Nothing when all are current. */
export function OutdatedCard({ phones, newest }: { phones: Array<{ name: string | null; version: string | null | undefined }>; newest: number | null }) {
  const list = outdatedPhones(phones, newest);
  if (!newest || list.length === 0) return null;
  return (
    <Card className="mb-4 border-status-warn/40 bg-status-warn-bg p-4 text-sm" role="alert">
      <p className="flex items-center gap-2 font-semibold text-status-warn"><AlertTriangle className="h-4 w-4" aria-hidden /> Outdated app on {list.length} phone{list.length === 1 ? "" : "s"}</p>
      <ul className="mt-1 space-y-0.5">
        {list.map((o) => (
          <li key={o.name + o.version}>
            <span className="font-medium">{o.name}</span> runs v{o.version}, {o.behindBy} build{o.behindBy === 1 ? "" : "s"} behind v1.0.{newest}.
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">
        An old app misses the newest fixes (for example reading which SIM a message came in on). On the phone: Settings, Check for updates; or install the download link from the owner guide.
      </p>
      <span className="sr-only">{outdatedLine(list, newest)}</span>
    </Card>
  );
}

/** The newest app version, and how many phones are on it. Read from the download link (GitHub release) by itself; the owner
 *  can still type a number, which counts when it is higher. */
export function AppVersionCard({
  newest,
  fromLink,
  notes,
  versions,
  onChanged,
}: {
  newest: number | null;
  fromLink: number | null;
  notes: string | null;
  versions: Array<string | undefined>;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(newest ? String(newest) : "");
  const [err, setErr] = useState("");
  const c = versionCounts(versions, newest);

  async function save() {
    const n = buildNumber(value);
    if (n === null || n < 1) {
      setErr("Type the build number, for example 64 or 1.0.64.");
      return;
    }
    const { error } = await sb.rpc("set_app_release", { p_version_code: n, p_notes: null });
    if (error) {
      setErr(error.message);
      return;
    }
    setErr("");
    setEditing(false);
    onChanged();
  }

  return (
    <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">Newest phone app</p>
        {editing ? (
          <form className="mt-1 flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Input autoFocus value={value} inputMode="numeric" onChange={(e) => setValue(e.target.value)} aria-label="Newest build number" className="h-9 w-32" />
            <Button type="submit" size="icon" variant="ghost" aria-label="Save"><Check /></Button>
            <Button type="button" size="icon" variant="ghost" aria-label="Cancel" onClick={() => { setEditing(false); setErr(""); }}><X /></Button>
          </form>
        ) : (
          <p className="flex items-center gap-1 text-lg font-semibold">
            {newest ? `v1.0.${newest}` : "not set"}
            <Button size="icon" variant="ghost" aria-label="Change the newest version" onClick={() => setEditing(true)}><Pencil /></Button>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {fromLink ? `Read from the download link (release v1.0.${fromLink}).` : "The download link could not be read just now; this is the number typed last."}
        </p>
        {err ? <p role="alert" className="text-xs text-destructive">{err}</p> : null}
        {notes ? <p className="text-xs text-muted-foreground">{notes}</p> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {newest
          ? `${c.current} of ${versions.length} phones up to date${c.behind ? ` · ${c.behind} outdated` : ""}${c.unknown ? ` · ${c.unknown} not reported` : ""}`
          : "Set the newest build number to see which phones are behind."}
      </p>
    </Card>
  );
}
