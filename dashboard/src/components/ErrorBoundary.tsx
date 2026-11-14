import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** One page that fails must not blank the whole dashboard (owner 2026-11-14, step 5): the menu, the search box and
 *  every other page keep working, and the page that failed says so, with the error's own words so it can be reported.
 *  `whole` is the outermost net (nothing else is on screen, so it offers a reload). */
export class ErrorBoundary extends Component<{ children: ReactNode; whole?: boolean }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept in the browser's console for whoever looks into it; nothing is sent anywhere.
    console.error("A dashboard page failed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const box = (
      <Card className="flex items-start gap-3 border-status-bad p-4 text-sm" role="alert">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-status-bad" aria-hidden />
        <div className="min-w-0 space-y-2">
          <p className="font-semibold">{this.props.whole ? "The dashboard could not be shown." : "This page could not be shown."}</p>
          <p className="text-muted-foreground">
            {this.props.whole ? "Nothing was changed. Reload to try again." : "Nothing was changed, and the other pages still work. Try again, or open another page from the menu."}
          </p>
          <p className="break-words rounded-lg bg-muted p-2 font-mono text-xs">{error.message || String(error)}</p>
          <div className="flex flex-wrap gap-2">
            {this.props.whole ? null : <Button size="sm" onClick={() => this.setState({ error: null })}>Try again</Button>}
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Reload the dashboard</Button>
          </div>
        </div>
      </Card>
    );
    return this.props.whole ? <main className="mx-auto max-w-xl p-6">{box}</main> : box;
  }
}
