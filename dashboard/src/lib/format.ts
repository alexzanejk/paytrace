/** Money, always two decimals, en-dash when there is nothing to show. */
export const tk = (n: number | null | undefined) =>
  n == null ? "–" : "Tk " + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Times are shown in Bangladesh time wherever the viewer happens to be. */
export const when = (t: string | null | undefined) =>
  t
    ? new Date(t).toLocaleString("en-GB", {
        timeZone: "Asia/Dhaka",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "–";

export const dhakaDate = (d: Date = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
