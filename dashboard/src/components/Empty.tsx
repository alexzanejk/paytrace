import { TableCell, TableRow } from "@/components/ui/table";

export function EmptyRow({ cols, text = "Nothing here yet." }: { cols: number; text?: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-8 text-center text-muted-foreground">
        {text}
      </TableCell>
    </TableRow>
  );
}
