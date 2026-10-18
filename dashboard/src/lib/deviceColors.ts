/** A steady colour for each phone, so the same phone looks the same everywhere. The name is always shown too. */
export function deviceHue(id: string | null | undefined): number {
  if (!id) return 0;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h ^ id.charCodeAt(i), 2654435761) >>> 0);
  h ^= h >>> 15; // spreads similar ids across the whole colour wheel
  return (h >>> 0) % 360;
}

export const deviceColor = (id: string | null | undefined) =>
  id ? `hsl(${deviceHue(id)} 62% 52%)` : "var(--color-muted-foreground)";

/** Brand-ish colours for the four providers. */
export const PROVIDER_COLOR: Record<string, string> = {
  bkash: "#e2136e",
  nagad: "#f6921e",
  rocket: "#8c3494",
  upay: "#0b8a5c",
};
