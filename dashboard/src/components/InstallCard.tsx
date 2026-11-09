import { useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { ANDROID_APP_URL, canPrompt, installWay, isInstalled, onInstallChange, promptInstall, type InstallWay } from "@/lib/install";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Which way this device installs the dashboard, kept current as the browser's install offer comes and goes. */
export function useInstallWay(): InstallWay {
  const read = () => installWay(navigator.userAgent, isInstalled(), canPrompt());
  const [way, setWay] = useState<InstallWay>(read);
  useEffect(() => onInstallChange(() => setWay(read())), []);
  return way;
}

/** Sidebar button: shown only while the dashboard is not yet installed. With the browser's own offer it installs at once;
 *  otherwise it opens Settings, where the steps for this device are. */
export function InstallButton({ onDone }: { onDone?: () => void }) {
  const way = useInstallWay();
  if (way === "installed") return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-start"
      onClick={async () => {
        if (way === "prompt") await promptInstall();
        else window.location.hash = "#/settings";
        onDone?.();
      }}
    >
      <Download aria-hidden /> Install app
    </Button>
  );
}

/** Settings card: the dashboard on a phone, Android or iPhone. */
export function InstallCard() {
  const way = useInstallWay();
  const [note, setNote] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" aria-hidden /> The dashboard as an app</CardTitle>
        <CardDescription>Its own icon on the home screen, full screen, always the newest version. Same login as here.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {way === "installed" ? (
          <p className="font-medium text-status-ok">✓ You are using the installed app.</p>
        ) : way === "prompt" ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={async () => setNote((await promptInstall()) ? "Installed. Open PayTrace from your home screen." : "Not installed. You can press it again any time.")}
            >
              <Download aria-hidden /> Install app
            </Button>
            {note ? <span className="text-muted-foreground">{note}</span> : null}
          </div>
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            {way === "ios" ? (
              <>
                <li>Open this dashboard in <strong className="text-foreground">Safari</strong> (not Chrome) on the iPhone.</li>
                <li>Tap the <strong className="text-foreground">Share</strong> button (the square with an arrow).</li>
                <li>Choose <strong className="text-foreground">Add to Home Screen</strong>, then <strong className="text-foreground">Add</strong>.</li>
              </>
            ) : way === "android-menu" ? (
              <>
                <li>Open this dashboard in <strong className="text-foreground">Chrome</strong>.</li>
                <li>Tap the <strong className="text-foreground">⋮</strong> menu, then <strong className="text-foreground">Install app</strong> (or "Add to Home screen").</li>
              </>
            ) : (
              <>
                <li>On a computer in Chrome or Edge: the install icon at the right end of the address bar.</li>
                <li>On a phone: open this page there and come back to this card.</li>
              </>
            )}
          </ol>
        )}
        <div className="rounded-lg border border-border p-3">
          <p className="font-medium">Android: the PayTrace Dashboard app</p>
          <p className="mt-0.5 text-muted-foreground">
            A real Android app with the same dashboard inside, built and signed by GitHub like the phone app. Install it once; what it shows is
            always the newest dashboard. Android asks to allow installing from your browser the first time.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-2">
            <a href={ANDROID_APP_URL} rel="noopener">
              <Download aria-hidden /> Download the Android app
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
