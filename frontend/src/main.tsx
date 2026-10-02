import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

/*
 * The globals.css import must precede main.scss: globals.css carries the Tailwind
 * import and @theme inline consumed by PostCSS, and main.scss @use-loads the
 * style modules.
 */
import "./styles/globals.css";
import "./styles/main.scss";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
