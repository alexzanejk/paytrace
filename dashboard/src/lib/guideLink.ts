/** The developer guide's one permanent address (owner 2026-11-10: "always don't change the link"). Every "Copy link" uses
 *  this, never the address the dashboard happens to be opened on, so the link sent to developers is always the same. */
export const GUIDE_LINK = "https://dash.xn--bnq875cj52amsb.click/docs/";

/** The whole guide as plain text for sharing instead of the link: tidied whitespace, the link on top. */
export function guideText(title: string, body: string): string {
  const tidy = body.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return `${title}\n${GUIDE_LINK}\n\n${tidy}\n`;
}
