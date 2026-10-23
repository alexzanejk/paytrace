import { PERIODS, dhakaDay, type DayRange, type PeriodId } from "@/lib/period";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export interface PeriodState {
  id: PeriodId;
  custom: DayRange;
}

/** Today / Yesterday / last 7 or 30 days / any dates. Days run 12:00 AM to 11:59 PM Bangladesh time. */
export function PeriodPicker({ value, onChange }: { value: PeriodState; onChange: (v: PeriodState) => void }) {
  const today = dhakaDay();
  return (
    <div className={`flex flex-wrap items-center gap-2 sm:w-auto ${value.id === "custom" ? "w-full" : "w-[calc(45%-0.25rem)]"}`}>
      <Select value={value.id} onValueChange={(id) => onChange({ ...value, id: id as PeriodId })}>
        <SelectTrigger className={value.id === "custom" ? "w-40" : "w-full sm:w-40"} aria-label="Period">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERIODS.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.id === "custom" ? (
        <>
          <Input
            type="date"
            className="w-40"
            aria-label="From date"
            max={today}
            value={value.custom.from}
            onChange={(e) => onChange({ ...value, custom: { ...value.custom, from: e.target.value } })}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            className="w-40"
            aria-label="To date"
            max={today}
            value={value.custom.to}
            onChange={(e) => onChange({ ...value, custom: { ...value.custom, to: e.target.value } })}
          />
        </>
      ) : null}
    </div>
  );
}

export const initialPeriod = (): PeriodState => ({ id: "today", custom: { from: dhakaDay(), to: dhakaDay() } });
