import { useState } from "react";
import { must, sb } from "@/lib/supabase";
import { when } from "@/lib/format";
import { PROVIDER_LABEL, type EventRow } from "@/lib/types";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { EmptyRow } from "@/components/Empty";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ALL = "all";
const KINDS = [
  "created",
  "duplicate",
  "matched",
  "review",
  "claim",
  "manual_match",
  "parse_failed",
  "ignored",
  "rejected_sender",
  "balance_unconfirmed",
  "test",
  "device_pair_request",
  "device_approved",
  "device_revoked",
  "phone_silent",
  "phone_recovered",
  "phone_problem",
  "error",
];

export function Logs() {
  const [kind, setKind] = useState(ALL);

  const { data, error, loading } = useQuery(
    async () => {
      let q = sb.from("events").select("*").order("at", { ascending: false }).limit(200);
      if (kind !== ALL) q = q.eq("kind", kind);
      return must(await q) as EventRow[];
    },
    [kind],
    { refreshMs: 20000 },
  );

  const rows = data ?? [];

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-56" aria-label="Event type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All events</SelectItem>
            {KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {k.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          “parse failed” rows hold the original SMS text, so the reader can be fixed.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time (BD)</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow cols={4} text="No events yet." />
          ) : (
            rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{when(e.at)}</TableCell>
                <TableCell>
                  <Badge tone={
                    e.kind === "error" || e.kind === "parse_failed" || e.kind === "rejected_sender" || e.kind === "phone_silent"
                      ? "bad"
                      : e.kind === "balance_unconfirmed" || e.kind === "phone_problem"
                        ? "warn"
                        : e.kind === "phone_recovered"
                          ? "ok"
                          : "idle"
                  }>
                    {e.kind.replace(/_/g, " ")}
                  </Badge>
                </TableCell>
                <TableCell>{e.provider ? (PROVIDER_LABEL[e.provider] ?? e.provider) : "–"}</TableCell>
                <TableCell className="max-w-md whitespace-normal break-words font-mono text-xs text-muted-foreground">
                  {JSON.stringify(e.detail)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Screen>
  );
}
