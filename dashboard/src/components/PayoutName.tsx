import { useState } from "react";
import { Pencil, UserRound } from "lucide-react";
import { sb } from "@/lib/supabase";
import { cleanName, nameSource, type PaymentName } from "@/lib/payNames";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** The name on a transaction in the Payout list (owner 2026-11-20): shown when the Telegram bot sorted it, with "Set name"
 *  when it did not. The owner can change or clear it; a cleared name goes back to the bot's, if any. Changes nothing
 *  about money. */
export function PayoutName({ paymentId, name, onChanged }: { paymentId: string; name: PaymentName | undefined; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function save(value: string) {
    setBusy(true); setProblem("");
    const { error } = await sb.rpc("set_payment_name", { p_payment: paymentId, p_name: value });
    setBusy(false);
    if (error) { setProblem(error.message); return; }
    setEditing(false);
    onChanged();
  }

  if (editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="@username or name"
          aria-label="Name for this transaction"
          className="h-7 w-44 text-xs"
          maxLength={64}
          onKeyDown={(e) => { if (e.key === "Enter") void save(cleanName(text)); if (e.key === "Escape") setEditing(false); }}
          autoFocus
        />
        <Button size="sm" className="h-7" disabled={busy || !cleanName(text)} onClick={() => save(cleanName(text))}>Save</Button>
        {name?.name ? <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => save("")}>Clear</Button> : null}
        <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => setEditing(false)}>Back</Button>
        {problem ? <span className="text-xs text-status-bad">{problem}</span> : null}
      </span>
    );
  }
  if (name?.name) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setText(name.name ?? ""); setEditing(true); }}
        className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs hover:bg-accent"
        title={`${nameSource(name)}. Tap to change.`}
        aria-label={`Paid to ${name.name}, ${nameSource(name)}. Change`}
      >
        <UserRound className="h-3 w-3" aria-hidden />
        <span className="font-medium">{name.name}</span>
        <span className="text-muted-foreground">· {nameSource(name)}</span>
        <Pencil className="h-3 w-3 text-muted-foreground" aria-hidden />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setText(""); setEditing(true); }}
      className="inline-flex items-center gap-1 rounded-md border border-dashed border-input px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label="Set a name for this transaction"
    >
      <UserRound className="h-3 w-3" aria-hidden /> Set name
    </button>
  );
}
