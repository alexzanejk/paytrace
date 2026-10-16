import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page the browser does not treat as secure: fall back to a hidden text box.
    try {
      const box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(box);
      return ok;
    } catch {
      return false;
    }
  }
}

/** One tap copies the text and the button says so, so the owner knows it worked. */
export function CopyButton({
  text,
  label,
  variant = "outline",
  size = "sm",
}: {
  text: string | (() => string);
  label: string;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  async function onClick() {
    const ok = await copyText(typeof text === "function" ? text() : text);
    setState(ok ? "done" : "failed");
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <Button type="button" variant={variant} size={size} onClick={() => void onClick()}>
      {state === "done" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {state === "done" ? "Copied" : state === "failed" ? "Could not copy: select it by hand" : label}
    </Button>
  );
}
