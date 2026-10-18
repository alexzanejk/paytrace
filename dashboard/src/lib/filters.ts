// A one-shot hand-off between pages: "View transactions" on a phone opens Payments already filtered to it.
export interface PaymentsPreset {
  device?: string;
  provider?: string;
  from?: string;
  to?: string;
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
