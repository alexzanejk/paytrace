import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import { PayPage } from "./PayPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PayPage />
  </StrictMode>,
);
