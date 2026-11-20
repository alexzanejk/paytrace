import { useState } from "react";
import { Pencil } from "lucide-react";
import { sb } from "@/lib/supabase";
import { cleanName } from "@/lib/payNames";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Edit a Telegram person's site login (the name the owner pays under). The bot's names on that person's transactions
 *  follow at once; names the owner typed on the Payout page by hand stay. */
export function PersonName({ userId, siteUsername, onChanged }: { userId: number; siteUsername: string | null | undefined; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(siteUsername ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function save(value: string) {
    setBusy(true); setProblem("");
    const { error } = await sb.rpc("tg_user_set", { p_user: userId, p_site_username: value || null, p_note: null });
    setBusy(false);
    if (error) { setProblem(error.message); return; }
    setEditing(false);
    onChanged();
  }

  if (!editing) {
    return (
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setText(siteUsername ?? ""); setEditing(true); }} aria-label={siteUsername ? `Change the site login ${siteUsername}` : "Set this person's site login"}>
        <Pencil className="mr-1 h-3 w-3" aria-hidden /> {siteUsername ? "Change login" : "Set login"}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="site login, e.g. t9ceff6182" aria-label="Site login" className="h-7 w-48 text-xs" maxLength={64}
        onKeyDown={(e) => { if (e.key === "Enter") void save(cleanName(text)); if (e.key === "Escape") setEditing(false); }} autoFocus />
      <Button size="sm" className="h-7" disabled={busy || !cleanName(text)} onClick={() => save(cleanName(text))}>Save</Button>
      {siteUsername ? <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => save("")}>Clear</Button> : null}
      <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => setEditing(false)}>Back</Button>
      {problem ? <span className="text-xs text-status-bad">{problem}</span> : null}
    </span>
  );
}
