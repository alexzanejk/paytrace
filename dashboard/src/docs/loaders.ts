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

const ARROWS = `<svg class="b-icon" viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="none" stroke="#19b3a6" stroke-width="3"/><path d="M14 20a11 11 0 0 1 19-4M34 12v5h-5M34 28a11 11 0 0 1-19 4M14 36v-5h5" fill="none" stroke="#19b3a6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const LOADERS: Loader[] = [
  {
    id: "toast",
    name: "1. Dark box with a ring",
    note: "A small dark box in the middle of the screen with a white spinning ring. The page behind stays visible.",
    css: `#ld { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 99999;
      min-width: 180px; max-width: 80vw; padding: 22px 24px; border-radius: 12px;
      background: rgba(32, 32, 32, .92); color: #fff; text-align: center; font: 14px/1.45 system-ui, sans-serif; }
#ld[hidden] { display: none; }
#ld p { margin: 0; }
#ld .a-ring { display: block; width: 34px; height: 34px; margin: 0 auto 12px; border-radius: 50%;
      border: 3px solid rgba(255, 255, 255, .25); border-top-color: #fff; animation: ld-a .8s linear infinite; }
@keyframes ld-a { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { #ld .a-ring { animation-duration: 3s; } }`,
    markup: `<i class="a-ring"></i>
<p id="ld-text"></p>`,
    script: SIMPLE_SCRIPT,
    sample: "জমা অনুরোধ জমা দেওয়া হচ্ছে…",
  },
  {
    id: "card",
    name: "2. White card on a dimmed page",
    note: "The page dims and a white card with a teal two-arrow spinner appears in the middle.",
    css: `#ld { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, .45); font: 14px/1.45 system-ui, sans-serif; }
#ld[hidden] { display: none; }
#ld p { margin: 0; }
#ld .b-card { width: 78vw; max-width: 320px; padding: 24px 18px; border-radius: 8px; background: #fff; color: #555;
      text-align: center; box-shadow: 0 8px 30px rgba(0, 0, 0, .25); }
#ld .b-icon { display: block; width: 46px; height: 46px; margin: 0 auto 14px; animation: ld-b 1.4s linear infinite; }
@keyframes ld-b { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { #ld .b-icon { animation-duration: 4s; } }`,
    markup: `<div class="b-card">
  ${ARROWS}
  <p id="ld-text"></p>
</div>`,
    script: SIMPLE_SCRIPT,
    sample: "পেমেন্ট পরিষেবা প্রদানকারীর সঙ্গে সংযোগ করা হচ্ছে…",
  },
  {
    id: "glow",
    name: "3. Full screen with pulses",
    note: "The whole screen turns green with rings that pulse outward. Hides the page completely.",
    css: `#ld { position: fixed; inset: 0; z-index: 99999; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 26px; padding: 24px; background: linear-gradient(160deg, #0b3d2e, #1b7f5c); color: #fff; text-align: center;
      font: 15px/1.45 system-ui, sans-serif; }
#ld[hidden] { display: none; }
#ld p { margin: 0; }
#ld .c-orb { position: relative; width: 64px; height: 64px; }
#ld .c-orb i { position: absolute; inset: 0; border: 3px solid rgba(255, 255, 255, .7); border-radius: 50%; animation: ld-c 1.8s ease-out infinite; }
#ld .c-orb i:nth-child(2) { animation-delay: .6s; }
#ld .c-orb i:nth-child(3) { animation-delay: 1.2s; }
@keyframes ld-c { 0% { transform: scale(.3); opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { #ld .c-orb i { animation: none; opacity: .7; } }`,
    markup: `<div class="c-orb"><i></i><i></i><i></i></div>
<p id="ld-text"></p>`,
    script: SIMPLE_SCRIPT,
    sample: "Submitting your deposit request…",
  },
  {
    id: "bar",
    name: "4. Top bar with a small label",
    note: "A thin moving bar at the top and a small label under it. The page stays visible and untouched.",
    css: `#ld { position: fixed; left: 0; right: 0; top: 0; z-index: 99999; font: 13px/1.4 system-ui, sans-serif; }
#ld[hidden] { display: none; }
#ld p { margin: 0; }
#ld .d-bar { height: 3px; background: rgba(0, 0, 0, .08); overflow: hidden; }
#ld .d-bar i { display: block; width: 40%; height: 100%; background: #e11d2e; animation: ld-d 1.1s ease-in-out infinite; }
#ld .d-pill { width: max-content; max-width: 86vw; margin: 10px auto 0; padding: 8px 14px; border-radius: 999px;
      background: #fff; color: #333; box-shadow: 0 4px 14px rgba(0, 0, 0, .18); }
@keyframes ld-d { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
@media (prefers-reduced-motion: reduce) { #ld .d-bar i { animation: none; width: 100%; opacity: .6; } }`,
    markup: `<div class="d-bar"><i></i></div>
<div class="d-pill"><p id="ld-text"></p></div>`,
    script: SIMPLE_SCRIPT,
    sample: "Submitting your deposit request…",
  },
  {
    id: "sheet",
    name: "5. Bottom sheet with dots",
    note: "A white sheet slides up from the bottom with three bouncing dots. Feels like a phone app.",
    css: `#ld { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .35);
      font: 14px/1.45 system-ui, sans-serif; }
#ld[hidden] { display: none; }
#ld p { margin: 0; }
#ld .e-sheet { width: 100%; padding: 26px 20px 34px; border-radius: 18px 18px 0 0; background: #fff; color: #333;
      text-align: center; animation: ld-e-up .25s ease-out; }
#ld .e-dots { display: flex; justify-content: center; gap: 8px; margin-bottom: 14px; }
#ld .e-dots i { width: 10px; height: 10px; border-radius: 50%; background: #2563eb; animation: ld-e 1s ease-in-out infinite; }
#ld .e-dots i:nth-child(2) { animation-delay: .15s; }
#ld .e-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes ld-e { 0%, 80%, 100% { transform: scale(.6); opacity: .5; } 40% { transform: scale(1); opacity: 1; } }
@keyframes ld-e-up { from { transform: translateY(100%); } to { transform: none; } }
@media (prefers-reduced-motion: reduce) { #ld .e-dots i, #ld .e-sheet { animation: none; } }`,
    markup: `<div class="e-sheet">
  <div class="e-dots"><i></i><i></i><i></i></div>
  <p id="ld-text"></p>
</div>`,
    script: SIMPLE_SCRIPT,
    sample: "Submitting your deposit request…",
  },
  {
    id: "steps",
    name: "6. Card with changing messages and a progress bar",
    note: "A white card whose message changes while the customer waits (for example 'Submitting', then 'Connecting', then 'Almost ready') with a slowly filling bar. Best when the wait can be a few seconds.",
    css: `#ld { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, .45); font: 14px/1.45 system-ui, sans-serif; }
#ld[hidden] { display: none; }
#ld p { margin: 0; }
#ld .f-card { width: 78vw; max-width: 320px; padding: 24px 18px 20px; border-radius: 10px; background: #fff; color: #444;
      text-align: center; box-shadow: 0 8px 30px rgba(0, 0, 0, .25); }
#ld .f-ring { display: block; width: 30px; height: 30px; margin: 0 auto 14px; border-radius: 50%;
      border: 3px solid #d1fae5; border-top-color: #16a34a; animation: ld-f-spin .9s linear infinite; }
#ld .f-bar { height: 4px; margin-top: 16px; border-radius: 2px; background: #e5e7eb; overflow: hidden; }
#ld .f-bar i { display: block; height: 100%; width: 0; background: #16a34a; animation: ld-f 6s ease-out forwards; }
@keyframes ld-f-spin { to { transform: rotate(360deg); } }
@keyframes ld-f { to { width: 92%; } }
@media (prefers-reduced-motion: reduce) { #ld .f-ring { animation-duration: 3s; } }`,
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
