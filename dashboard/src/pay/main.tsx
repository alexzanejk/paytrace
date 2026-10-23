import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import "@/index.css";
import "./pay.css";
import { PayPage } from "./PayPage";
import { markFramed } from "./embed";

markFramed();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PayPage />
  </StrictMode>,
);
