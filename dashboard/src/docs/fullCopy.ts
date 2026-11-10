import { createContext } from "react";

/** True while the guide is being copied as text: every code tab is shown, copy buttons and live previews are left out. */
export const FullCopy = createContext(false);
