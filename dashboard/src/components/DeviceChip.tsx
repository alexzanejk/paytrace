import { deviceColor } from "@/lib/deviceColors";
import { cn } from "@/lib/utils";

/** A phone's name with a coloured initial, like a contact picture, so rows from different phones are easy to tell
 *  apart. (A plain dot would be confused with the green/red Online dot.) */
export function DeviceChip({ id, name, className }: { id: string | null | undefined; name: string; className?: string }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span className={cn("inline-flex max-w-full items-center gap-2 text-sm", className)} title={name}>
      <span
        aria-hidden
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
        style={{ background: deviceColor(id) }}
      >
        {initial}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}
