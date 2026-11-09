// The dashboard as an installed app (2026-11-09). Android Chrome (and desktop Chrome / Edge) offer an install prompt through the
// `beforeinstallprompt` event, which fires once, early, before any page of ours is on screen: so it is caught here at start-up
// and kept until the owner presses Install. iPhones have no such event; Safari's own Share > "Add to Home Screen" is the
// only way, so the page shows those steps instead. Nothing here stores anything.

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

/** Call once at start-up (main.tsx). */
export function watchInstall(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep Chrome's mini bar away; our own button asks
    deferred = e as InstallPrompt;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    changed();
  });
}

export const onInstallChange = (f: () => void): (() => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

export const canPrompt = (): boolean => deferred !== null;

/** Shows the browser's own "Install app?" question. true = installed. */
export async function promptInstall(): Promise<boolean> {
  const d = deferred;
  if (!d) return false;
  deferred = null;
  changed();
  await d.prompt();
  return (await d.userChoice).outcome === "accepted";
}

/** Already running as an installed app (home-screen icon), so no Install button is needed. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

/** Which way to install on this device. Pure, so it can be tested with any user-agent text. */
export type InstallWay = "installed" | "prompt" | "ios" | "android-menu" | "other";
export function installWay(ua: string, installed: boolean, prompt: boolean): InstallWay {
  if (installed) return "installed";
  if (prompt) return "prompt";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) return "ios";
  if (/Android/i.test(ua)) return "android-menu";
  return "other";
}

/** The Android dashboard app (a Trusted Web Activity built by GitHub, signed with the same key as the phone app). */
export const ANDROID_APP_URL = "https://github.com/alexzanejk/paytrace/releases/latest/download/paytrace-dashboard.apk";
