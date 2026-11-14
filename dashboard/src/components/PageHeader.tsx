import { useId, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";

/** The same title block on every page: what this is in one short line, and the page's controls. The longer
 *  explanation sits behind the "?" beside the title (owner 2026-11-14, step 5: the pages opened with a paragraph). */
export function PageHeader({ title, description, help, actions }: { title: string; description?: string; help?: ReactNode; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-xl font-semibold tracking-tight">
            {title}
            {help ? (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls={id}
                aria-label={open ? `Hide the explanation of ${title}` : `What is ${title}?`}
                className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <CircleHelp className="h-[18px] w-[18px]" aria-hidden />
              </button>
            ) : null}
          </h2>
          {description ? <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {help && open ? (
        <div id={id} className="mt-3 max-w-2xl space-y-1.5 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
          {help}
        </div>
      ) : null}
    </div>
  );
}
