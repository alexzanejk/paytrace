// The pay page can sit inside an iframe on a website, so customers stay on the website's own address. This is the only
// place that talks to the page around it. Messages carry no secrets: just the state, the website's own order number and
// the address to go to. The website listens for them (see the integration guide) and does the navigation itself.
const SOURCE = "deposit-page";

export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // reading window.top can throw across origins, which also means we are framed
  }
}

/** Mark the page as framed before it first paints, so the framed look (see pay.css) never flashes the standalone look. */
export function markFramed(): void {
  if (isFramed()) document.documentElement.dataset.framed = "1";
}

export function tellParent(message: Record<string, unknown>): void {
  if (!isFramed()) return;
  try {
    window.parent.postMessage({ source: SOURCE, ...message }, "*");
  } catch {
    /* nothing listens; the page still works */
  }
}

/** Send the customer to a website address. On its own it navigates; framed, it asks the website first (the reliable way, a
 *  browser only lets a frame move the whole window right after a click) and also tries to move the top window itself. */
export function leaveTo(url: string): void {
  if (!isFramed()) {
    window.location.assign(url);
    return;
  }
  tellParent({ type: "redirect", url });
  try {
    if (window.top) window.top.location.href = url;
  } catch {
    /* blocked: the message above, or the "Go back now" link (which targets the top window), still works */
  }
}

/** Tell the website how tall the page is, so it can size the frame and avoid a second scroll bar. */
export function reportHeight(): () => void {
  if (!isFramed() || typeof ResizeObserver === "undefined") return () => {};
  // "Full screen height" would be the frame's own height, so the frame could never shrink: drop it while framed (see pay.css).
  document.documentElement.dataset.framed = "1";
  let last = 0;
  const send = () => {
    const h = Math.ceil(document.body.getBoundingClientRect().height);
    if (h !== last) {
      last = h;
      tellParent({ type: "height", height: h });
    }
  };
  const ro = new ResizeObserver(send);
  ro.observe(document.body);
  send();
  return () => ro.disconnect();
}
