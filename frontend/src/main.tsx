import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

/*
 * Global style imports — modular SCSS architecture.
 * globals.css contains the Tailwind import and @theme inline, processed
 * by PostCSS. main.scss is the SCSS entry that @use-loads all style
 * modules in order.
 */
import "./app/globals.css";
import "./styles/main.scss";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
