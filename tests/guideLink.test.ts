import { GUIDE_LINK, guideText } from "../dashboard/src/lib/guideLink.ts";

let failed = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (!ok) { failed++; console.error("FAIL", name, got ?? ""); } else console.log("ok  ", name);
};

check("the link is the fixed https address of the guide", GUIDE_LINK === "https://dash.xn--bnq875cj52amsb.click/docs/");
const t = guideText("Title", "  a  \r\n\n\n\nb\t\n");
check("text starts with the title and the link", t.startsWith(`Title\n${GUIDE_LINK}\n\n`), t);
check("blank runs are squeezed and trailing spaces dropped", t.endsWith("a\n\nb\n"), JSON.stringify(t));

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("\nall passed");
