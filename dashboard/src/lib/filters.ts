// A one-shot hand-off between pages: "View transactions" on a phone opens Payments already filtered to it.
export interface PaymentsPreset {
  device?: string;
  provider?: string;
  from?: string;
  to?: string;
  /** A TrxID or number to put in the page's own search box (from the search at the top of every page). */
  search?: string;
}

let pending: PaymentsPreset | null = null;

export function openPaymentsWith(preset: PaymentsPreset) {
  pending = preset;
  window.location.hash = "#/payments";
}

export function takePaymentsPreset(): PaymentsPreset | null {
  const p = pending;
  pending = null;
  return p;
}
