import { useEffect, useState } from "react";

const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);

/** The address after "#/", split at "/": ["devices", "<phone id>", "wallets"]. Follows Back, Forward and links. */
export function useHashPath(): string[] {
  const [path, setPath] = useState<string[]>(read);
  useEffect(() => {
    const onHash = () => setPath(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return path;
}
