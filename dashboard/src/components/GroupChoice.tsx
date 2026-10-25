import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** A partner's link code: 3 lowercase letters and 4 digits (same rule as the database). */
export const GROUP_CODE = /^[a-z]{3}[0-9]{4}$/;

const NEW = "__new";

/**
 * Pick a wallet group: Main, a group that already exists, or type a new partner code.
 * `value` is "main" or a code; it is only a valid code while it matches GROUP_CODE, so a half-typed code never reaches the database.
 */
export function GroupChoice({
  groups,
  value,
  onChange,
  label,
}: {
  groups: string[];
  value: string;
  onChange: (group: string) => void;
  label: string;
}) {
  const known = value === "main" || groups.includes(value);
  const [typing, setTyping] = useState(!known);
  const [typed, setTyped] = useState(known ? "" : value);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Select
        value={typing ? NEW : value}
        onValueChange={(v) => {
          if (v === NEW) {
            setTyping(true);
            onChange(GROUP_CODE.test(typed) ? typed : "main");
          } else {
            setTyping(false);
            onChange(v);
          }
        }}
      >
        <SelectTrigger aria-label={label} className="h-8 w-[9.5rem] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="main">Main</SelectItem>
          {groups.filter((g) => g !== "main").map((g) => (
            <SelectItem key={g} value={g}>{g}</SelectItem>
          ))}
          <SelectItem value={NEW}>New partner code…</SelectItem>
        </SelectContent>
      </Select>
      {typing ? (
        <Input
          value={typed}
          onChange={(e) => {
            const t = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 7);
            setTyped(t);
            onChange(GROUP_CODE.test(t) ? t : "main");
          }}
          placeholder="e.g. dvw9166"
          aria-label={`${label}: new partner code`}
          maxLength={7}
          className="h-8 w-28 text-xs"
        />
      ) : null}
    </span>
  );
}
