import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

/*
 * Global style imports — SCSS 模块化架构
 * globals.css 包含 Tailwind 导入与 @theme inline，由 PostCSS 处理
 * main.scss 为 SCSS 入口，通过 @use 按序加载所有样式模块
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
