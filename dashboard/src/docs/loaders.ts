// "Submitting your deposit request..." animations a website can show the moment the customer presses Next.
// Every one is a block of plain HTML + CSS + a few lines of JavaScript that defines the same two functions, showLoading(text) and
// hideLoading(), so the Next-button code in the guide works with any of them. The guide shows the code and a live preview of each.
// Plain data only (no JSX) so the same strings feed the copy box, the preview and the tests.

export interface Loader {
  id: string;
  name: string;
  note: string;
  css: string;
  /** Markup that goes inside <div id="ld">; the message goes into the element with id="ld-text". */
  markup: string;
  script: string;
  /** What the preview types into the message. */
  sample: string | string[];
}

const SIMPLE_SCRIPT = `const ld = document.getElementById("ld");
const ldText = document.getElementById("ld-text");
function showLoading(text) { ldText.textContent = text; ld.hidden = false; }
function hideLoading() { ld.hidden = true; }`;

const CYCLING_SCRIPT = `const ld = document.getElementById("ld");
const ldText = document.getElementById("ld-text");
let ldTimer;
// showLoading("one message")  or  showLoading(["first", "then this", "then this"]): the message changes every 1.8 s.
function showLoading(messages) {
  const list = Array.isArray(messages) ? messages : [messages];
  let i = 0;
  clearInterval(ldTimer);
  ldText.textContent = list[0];
  ld.hidden = false;
  if (list.length > 1) ldTimer = setInterval(() => { i = Math.min(i + 1, list.length - 1); ldText.textContent = list[i]; }, 1800);
}
function hideLoading() { clearInterval(ldTimer); ld.hidden = true; }`;

const ARROWS = `<svg class="b-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="21"/><path d="M14 20a11 11 0 0 1 19-4M34 12v5h-5M34 28a11 11 0 0 1-19 4M14 36v-5h5"/></svg>`;

export const LOADERS: Loader[] = [
  {
    id: "toast",
    name: "1. Soft dark box",
    note: "A small dark box with a thin ring, fading in over the page. The page behind stays visible. Fits any phone width.",
    css: `#ld { --ld-accent: #8ec9ff; position: fixed; left: 50%; top: 50%; z-index: 99999; transform: translate(-50%, -50%);
      box-sizing: border-box; width: max-content; min-width: 168px; max-width: min(300px, calc(100vw - 40px)); padding: 24px 22px 20px;
      border-radius: 14px; background: rgba(36, 38, 42, .9); color: rgba(255, 255, 255, .92); text-align: center;
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Bengali", sans-serif; animation: ld-a-in .18s ease-out both; }
#ld[hidden] { display: none; }
#ld p { margin: 0; overflow-wrap: anywhere; }
#ld .a-ring { display: block; box-sizing: border-box; width: 36px; height: 36px; margin: 0 auto 14px; border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, .18); border-top-color: var(--ld-accent); animation: ld-a-spin .9s linear infinite; }
@keyframes ld-a-spin { to { transform: rotate(360deg); } }
@keyframes ld-a-in { from { opacity: 0; transform: translate(-50%, -48%) scale(.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@media (prefers-reduced-motion: reduce) { #ld { animation: none; } #ld .a-ring { animation-duration: 3s; } }`,
    markup: `<i class="a-ring"></i>
<p id="ld-text"></p>`,
    script: SIMPLE_SCRIPT,
    sample: "জমা অনুরোধ জমা দেওয়া হচ্ছে…",
  },
  {
    id: "card",
    name: "2. White card on a dimmed page",
    note: "The page dims softly and a white card with a thin teal two-arrow icon appears. Clean and familiar.",
    css: `#ld { --ld-accent: #19b3a6; position: fixed; inset: 0; z-index: 99999; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
      padding: 20px; background: rgba(15, 23, 42, .42); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Bengali", sans-serif; animation: ld-b-fade .18s ease-out both; }
#ld[hidden] { display: none; }
#ld p { margin: 0; overflow-wrap: anywhere; }
#ld .b-card { box-sizing: border-box; width: 100%; max-width: 300px; padding: 26px 20px 22px; border-radius: 10px; background: #fff;
      color: #5b6470; text-align: center; box-shadow: 0 12px 40px rgba(15, 23, 42, .22); animation: ld-b-pop .2s ease-out both; }
#ld .b-icon { display: block; width: 44px; height: 44px; margin: 0 auto 14px; color: var(--ld-accent); animation: ld-b-spin 1.4s linear infinite; }
@keyframes ld-b-spin { to { transform: rotate(360deg); } }
@keyframes ld-b-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ld-b-pop { from { opacity: 0; transform: translateY(6px) scale(.97); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { #ld, #ld .b-card { animation: none; } #ld .b-icon { animation-duration: 4s; } }`,
    markup: `<div class="b-card">
  ${ARROWS}
  <p id="ld-text"></p>
</div>`,
    script: SIMPLE_SCRIPT,
    sample: "পেমেন্ট পরিষেবা প্রদানকারীর সঙ্গে সংযোগ করা হচ্ছে…",
  },
  {
    id: "full",
    name: "3. Clean full screen",
    note: "A plain white screen with a thin green ring and the message. Hides the page completely, so nothing can be tapped by mistake.",
    css: `#ld { --ld-accent: #0f5f3f; position: fixed; inset: 0; z-index: 99999; box-sizing: border-box; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 18px; padding: 24px; background: #fff; color: #3f4650; text-align: center;
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Bengali", sans-serif; animation: ld-c-fade .2s ease-out both; }
#ld[hidden] { display: none; }
#ld p { max-width: 280px; margin: 0; overflow-wrap: anywhere; }
#ld .c-ring { box-sizing: border-box; width: 40px; height: 40px; border-radius: 50%; border: 3px solid rgba(15, 95, 63, .14);
      border-top-color: var(--ld-accent); animation: ld-c-spin .9s linear infinite; }
@keyframes ld-c-spin { to { transform: rotate(360deg); } }
@keyframes ld-c-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { #ld { animation: none; } #ld .c-ring { animation-duration: 3s; } }`,
    markup: `<i class="c-ring"></i>
<p id="ld-text"></p>`,
    script: SIMPLE_SCRIPT,
    sample: "Submitting your deposit request…",
  },
  {
    id: "bar",
    name: "4. Top bar with a small label",
    note: "A thin moving bar at the top and a small pill with the message. The page stays visible and usable.",
    css: `#ld { --ld-accent: #1f6feb; position: fixed; left: 0; right: 0; top: 0; z-index: 99999; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Bengali", sans-serif; }
#ld[hidden] { display: none; }
#ld p { margin: 0; overflow-wrap: anywhere; }
#ld .d-bar { height: 2px; background: rgba(31, 111, 235, .15); overflow: hidden; }
#ld .d-bar i { display: block; width: 35%; height: 100%; border-radius: 2px; background: var(--ld-accent); animation: ld-d 1.1s ease-in-out infinite; }
#ld .d-pill { box-sizing: border-box; width: max-content; max-width: calc(100vw - 32px); margin: 12px auto 0; padding: 8px 16px; border-radius: 999px;
      background: #fff; color: #3f4650; font-size: 13px; box-shadow: 0 2px 12px rgba(15, 23, 42, .16), 0 0 0 1px rgba(15, 23, 42, .06);
      animation: ld-d-in .2s ease-out both; }
@keyframes ld-d { 0% { transform: translateX(-100%); } 100% { transform: translateX(290%); } }
@keyframes ld-d-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { #ld .d-bar i { animation: none; width: 100%; opacity: .6; } #ld .d-pill { animation: none; } }`,
    markup: `<div class="d-bar"><i></i></div>
<div class="d-pill"><p id="ld-text"></p></div>`,
    script: SIMPLE_SCRIPT,
    sample: "Submitting your deposit request…",
  },
  {
    id: "sheet",
    name: "5. Bottom sheet with dots",
    note: "A white sheet slides up from the bottom with three soft dots. Feels like a phone app and respects the phone's bottom edge.",
    css: `#ld { --ld-accent: #2563eb; position: fixed; inset: 0; z-index: 99999; display: flex; align-items: flex-end; background: rgba(15, 23, 42, .38);
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Bengali", sans-serif; animation: ld-e-fade .2s ease-out both; }
#ld[hidden] { display: none; }
#ld p { margin: 0; overflow-wrap: anywhere; }
#ld .e-sheet { box-sizing: border-box; width: 100%; padding: 12px 20px calc(28px + env(safe-area-inset-bottom, 0px)); border-radius: 16px 16px 0 0;
      background: #fff; color: #3f4650; text-align: center; animation: ld-e-up .26s cubic-bezier(.2, .8, .2, 1) both; }
#ld .e-grip { width: 36px; height: 4px; margin: 0 auto 20px; border-radius: 2px; background: #d5d9e0; }
#ld .e-dots { display: flex; justify-content: center; gap: 8px; margin-bottom: 14px; }
#ld .e-dots i { width: 9px; height: 9px; border-radius: 50%; background: var(--ld-accent); animation: ld-e 1s ease-in-out infinite; }
#ld .e-dots i:nth-child(2) { animation-delay: .15s; }
#ld .e-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes ld-e { 0%, 80%, 100% { transform: scale(.6); opacity: .45; } 40% { transform: scale(1); opacity: 1; } }
@keyframes ld-e-up { from { transform: translateY(100%); } to { transform: none; } }
@keyframes ld-e-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { #ld, #ld .e-sheet, #ld .e-dots i { animation: none; } }`,
    markup: `<div class="e-sheet">
  <div class="e-grip"></div>
  <div class="e-dots"><i></i><i></i><i></i></div>
  <p id="ld-text"></p>
</div>`,
    script: SIMPLE_SCRIPT,
    sample: "Submitting your deposit request…",
  },
  {
    id: "steps",
    name: "6. Card with changing messages",
    note: "A white card whose message changes while the customer waits (for example 'Submitting', 'Connecting', 'Almost ready') with a thin progress line. Best when the wait can last a few seconds.",
    css: `#ld { --ld-accent: #16a34a; position: fixed; inset: 0; z-index: 99999; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
      padding: 20px; background: rgba(15, 23, 42, .42); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Bengali", sans-serif; animation: ld-f-fade .18s ease-out both; }
#ld[hidden] { display: none; }
#ld p { margin: 0; overflow-wrap: anywhere; }
#ld .f-card { box-sizing: border-box; width: 100%; max-width: 300px; padding: 24px 20px 20px; border-radius: 10px; background: #fff; color: #5b6470;
      text-align: center; box-shadow: 0 12px 40px rgba(15, 23, 42, .22); animation: ld-f-pop .2s ease-out both; }
#ld .f-ring { display: block; box-sizing: border-box; width: 30px; height: 30px; margin: 0 auto 14px; border-radius: 50%;
      border: 2px solid rgba(22, 163, 74, .16); border-top-color: var(--ld-accent); animation: ld-f-spin .9s linear infinite; }
#ld .f-bar { height: 3px; margin-top: 18px; border-radius: 2px; background: #e8ebef; overflow: hidden; }
#ld .f-bar i { display: block; width: 0; height: 100%; background: var(--ld-accent); animation: ld-f 6s ease-out forwards; }
@keyframes ld-f-spin { to { transform: rotate(360deg); } }
@keyframes ld-f { to { width: 92%; } }
@keyframes ld-f-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ld-f-pop { from { opacity: 0; transform: translateY(6px) scale(.97); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { #ld, #ld .f-card { animation: none; } #ld .f-ring { animation-duration: 3s; } }`,
    markup: `<div class="f-card">
  <i class="f-ring"></i>
  <p id="ld-text"></p>
  <div class="f-bar"><i></i></div>
</div>`,
    script: CYCLING_SCRIPT,
    sample: ["Submitting your deposit request…", "Connecting to the payment provider…", "Almost ready…"],
  },
];

/** The block a developer pastes once into the page that has the Next button. */
export function loaderCode(l: Loader): string {
  return `<!-- Loading animation: ${l.name.replace(/^\d+\.\s*/, "")}. Paste this once into the page that has your Next button. -->
<style>
${l.css}
</style>

<div id="ld" role="status" aria-live="polite" hidden>
${l.markup.split("\n").map((line) => "  " + line).join("\n")}
</div>

<script>
${l.script}
</script>`;
}
