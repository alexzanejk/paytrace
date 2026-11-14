import { useEffect, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { searchHash } from "@/lib/globalSearch";
import { cn } from "@/lib/utils";

/** The search box at the top of every page (owner 2026-11-14): type a TrxID, a phone number or an order number and
 *  press Enter; the answer is its own page (`#/search/<what was typed>`), so Back returns to where you were. */
export function GlobalSearchBox({ id, current, className }: { id: string; current: string; className?: string }) {
  const [text, setText] = useState(current);
  // Following a link or pressing Back changes what is being searched; the box shows it.
  useEffect(() => setText(current), [current]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const typed = text.trim();
    if (!typed) return;
    window.location.hash = searchHash(typed);
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  return (
    <form role="search" onSubmit={submit} className={cn("relative min-w-0", className)}>
      <label htmlFor={id} className="sr-only">Search a TrxID, phone number or order number</label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id={id}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search TrxID, number or order"
        className="h-10 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
      />
    </form>
  );
}
