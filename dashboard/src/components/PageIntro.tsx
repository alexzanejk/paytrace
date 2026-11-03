import { useState } from "react";
import { BookOpen, X } from "lucide-react";
import type { PageIntro as Intro } from "@/lib/words";

/** "What is this page?" — three plain lines at the top of a page, with a link to the Help page.
 *
 *  Closing it is remembered per page in this browser only (a convenience, nothing depends on it), so a person who
 *  has read it is not shown it again, while a new team member on a new computer sees it. */
export function PageIntro({ id, intro, onHelp }: { id: string; intro: Intro; onHelp?: () => void }) {
  const key = `pt-intro-${id}`;
  const [shown, setShown] = useState<boolean>(() => {
    try { return localStorage.getItem(key) !== "closed"; } catch { return true; }
  });
  if (!shown) return null;
  return (
    <div role="note" className="mb-5 rounded-xl border border-status-info/30 bg-status-info-bg/40 p-4 text-sm">
      <div className="flex items-start gap-3">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-status-info" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{intro.what}</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
            {intro.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
          {onHelp ? (
            <button type="button" onClick={onHelp} className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline">
              What do all the words mean? Open Help
            </button>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Hide this explanation"
          title="Hide (it stays on the Help page)"
          onClick={() => {
            setShown(false);
            try { localStorage.setItem(key, "closed"); } catch { /* not important */ }
          }}
          className="rounded-md p-1 text-muted-foreground hover:bg-card hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
