import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { sb } from "@/lib/supabase";
import { buildNumber, versionCounts, versionState } from "@/lib/appVersion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** Small badge beside a phone's version: green when it is on the newest build, amber when it is behind. */
export function VersionChip({ version, newest }: { version: string | undefined; newest: number | null }) {
  if (!version) return null;
  const state = versionState(version, newest);
  if (state === "behind") {
    return (
      <span className="rounded-full bg-status-warn-bg px-2 py-0.5 font-medium text-status-warn" title={`The newest app is v1.0.${newest}. This phone needs the update.`}>
        v{version} · update to 1.0.{newest}
      </span>
    );
  }
  if (state === "current") {
    return <span className="rounded-full bg-status-ok-bg px-2 py-0.5 font-medium text-status-ok" title="This phone has the newest app">v{version} · up to date</span>;
  }
  return <span>v{version}</span>;
}

/** The newest app version, and how many phones are on it. The owner types the build number after each new build. */
export function AppVersionCard({
  newest,
  notes,
  versions,
  onChanged,
}: {
  newest: number | null;
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
        {err ? <p role="alert" className="text-xs text-destructive">{err}</p> : null}
        {notes ? <p className="text-xs text-muted-foreground">{notes}</p> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {newest
          ? `${c.current} of ${versions.length} phones up to date${c.behind ? ` · ${c.behind} behind` : ""}${c.unknown ? ` · ${c.unknown} not reported` : ""}`
          : "Set the newest build number to see which phones are behind."}
      </p>
    </Card>
  );
}
