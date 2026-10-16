import { useState } from "react";
import { Smartphone } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { when } from "@/lib/format";
import type { Device } from "@/lib/types";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { EmptyRow } from "@/components/Empty";
import { Confirm } from "@/components/Confirm";
import { DeviceHealthBadge } from "@/components/DeviceHealthBadge";
import { DeviceDetails } from "@/components/DeviceDetails";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function Devices() {
  const [failed, setFailed] = useState<Record<string, string>>({});

  const { data, error, loading, refresh } = useQuery(
    async () =>
      must(
        await sb
          .from("devices")
          .select("*")
          .neq("status", "revoked")
          .order("created_at", { ascending: false })
          .limit(200),
      ) as Device[],
    [],
    { refreshMs: 10000 },
  );

  async function setStatus(device: Device, status: "approved" | "revoked") {
    const { error } = await sb.rpc("set_device_status", { p_device_id: device.id, p_status: status });
    if (error) setFailed((f) => ({ ...f, [device.id]: error.message }));
    else {
      setFailed((f) => ({ ...f, [device.id]: "" }));
      refresh();
    }
  }

  const devices = data ?? [];
  const pending = devices.filter((d) => d.status === "pending");
  const approved = devices.filter((d) => d.status === "approved");
  // Two phones showing the same code would make "approve the right one" impossible.
  const sharedCode = (code: string) => pending.filter((d) => d.pair_code === code).length > 1;

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <div className="mb-5 flex max-w-3xl items-start gap-2 rounded-card border border-border bg-card p-4">
        <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">
          Install the app on a phone and open it. The phone shows a code. Approve that code here — nothing needs to be
          typed on the phone. Only approve a code you can see on your own phone right now.
        </p>
      </div>

      <h3 className="mb-2 text-base font-semibold">Waiting for approval</h3>
      <Table className="mb-6">
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Asked (BD)</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pending.length === 0 ? (
            <EmptyRow cols={4} text="No phone is waiting." />
          ) : (
            pending.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-mono text-base font-semibold">{d.pair_code}</TableCell>
                <TableCell>{d.name || "–"}</TableCell>
                <TableCell>{when(d.created_at)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    {sharedCode(d.pair_code) ? (
                      <span className="text-sm text-destructive">
                        Two requests share this code. Reject both and ask again on the phone.
                      </span>
                    ) : (
                      <Confirm
                        title={`Approve the phone showing ${d.pair_code}?`}
                        description="Only do this if the same code is on your own phone right now. An approved phone can send payment messages to your server."
                        confirmLabel="Approve"
                        onConfirm={() => setStatus(d, "approved")}
                      >
                        <Button size="sm">Approve</Button>
                      </Confirm>
                    )}
                    <Confirm
                      title="Reject this request?"
                      description="The phone will not be able to send anything. It can ask again later."
                      confirmLabel="Reject"
                      onConfirm={() => setStatus(d, "revoked")}
                    >
                      <Button size="sm" variant="outline">
                        Reject
                      </Button>
                    </Confirm>
                    {failed[d.id] ? <span className="text-xs text-destructive">{failed[d.id]}</span> : null}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <h3 className="mb-2 text-base font-semibold">Connected phones</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Health</TableHead>
            <TableHead>Reported by the phone</TableHead>
            <TableHead>Approved (BD)</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {approved.length === 0 ? (
            <EmptyRow cols={6} text="No phone is connected yet." />
          ) : (
            approved.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-mono text-xs">{d.pair_code}</TableCell>
                <TableCell>{d.name || "–"}</TableCell>
                <TableCell>
                  <DeviceHealthBadge device={d} />
                </TableCell>
                <TableCell>
                  <DeviceDetails info={d.info} />
                </TableCell>
                <TableCell>{when(d.approved_at)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Confirm
                      title={`Remove ${d.name || d.pair_code}?`}
                      description="It stops sending payments immediately. To use it again you would approve a new code on that phone."
                      confirmLabel="Remove"
                      onConfirm={() => setStatus(d, "revoked")}
                    >
                      <Button size="sm" variant="outline">
                        Remove
                      </Button>
                    </Confirm>
                    {failed[d.id] ? <span className="text-xs text-destructive">{failed[d.id]}</span> : null}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Screen>
  );
}
