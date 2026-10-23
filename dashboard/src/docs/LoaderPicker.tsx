import { createElement, useEffect, useMemo, useState, type ReactNode } from "react";
import { LOADERS, loaderCode, type Loader } from "./loaders";

// Live previews of the loading animations. They use the very same CSS and markup the developer copies: the only changes are that
// the root selector #ld becomes a per-preview attribute (so six previews can sit on one page) and the preview box has a
// transform, which makes the animation's `position: fixed` stay inside the box instead of covering the whole guide.

const TAGS = new Set(["div", "p", "i", "span", "svg", "circle", "path", "g"]);

function toReact(node: ChildNode, key: number, text: string): ReactNode {
  if (node.nodeType === 3) return node.textContent?.trim() ? node.textContent : null;
  if (node.nodeType !== 1) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (!TAGS.has(tag)) return null;
  const props: Record<string, unknown> = { key };
  for (const a of Array.from(el.attributes)) {
    if (a.name === "id") continue;
    props[a.name === "class" ? "className" : a.name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = a.value;
  }
  if (el.id === "ld-text") return createElement(tag, props, text);
  return createElement(tag, props, ...Array.from(el.childNodes).map((c, i) => toReact(c, i, text)).filter((x) => x !== null));
}

function Preview({ loader }: { loader: Loader }) {
  const messages = Array.isArray(loader.sample) ? loader.sample : [loader.sample];
  const [round, setRound] = useState(0); // restarts the animation every few seconds
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setStep((s) => s + 1), 1800);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    setRound(Math.floor(step / 4));
  }, [step]);

  const css = useMemo(() => loader.css.replace(/#ld(?![-\w])/g, `[data-ld="${loader.id}"]`), [loader]);
  const tree = useMemo(() => new DOMParser().parseFromString(loader.markup, "text/html").body.childNodes, [loader]);
  const text = messages[Math.min(messages.length - 1, step % 4)];

  return (
    <div className="relative h-64 overflow-hidden rounded-lg border border-neutral-300 bg-neutral-100" style={{ transform: "translateZ(0)" }} aria-hidden>
      <div className="space-y-2 p-3">
        <div className="h-5 w-1/3 rounded bg-neutral-300" />
        <div className="h-10 rounded bg-white" />
        <div className="h-10 rounded bg-white" />
        <div className="h-8 w-2/3 rounded bg-neutral-300" />
        <div className="mt-6 h-10 rounded bg-red-500" />
      </div>
      <style>{css}</style>
      <div data-ld={loader.id} key={`${loader.id}-${round}`}>
        {Array.from(tree).map((n, i) => toReact(n, i, text))}
      </div>
    </div>
  );
}

/** Six loading animations to pick from: a live preview and the copy box for each. */
export function LoaderPicker({ renderCode }: { renderCode: (text: string) => ReactNode }) {
  return (
    <div className="grid gap-5">
      {LOADERS.map((l) => (
        <div key={l.id} className="grid gap-3 rounded-xl border border-neutral-200 p-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
          <div className="space-y-2">
            <Preview loader={l} />
          </div>
          <div className="min-w-0 space-y-2">
            <h3 className="text-lg font-semibold">{l.name}</h3>
            <p className="text-sm text-neutral-600">{l.note}</p>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-[#1f6f50]">Show the code to copy</summary>
              <div className="mt-2">{renderCode(loaderCode(l))}</div>
            </details>
          </div>
        </div>
      ))}
    </div>
  );
}
