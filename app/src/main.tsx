import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

document.documentElement.classList.add("widget-host");

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("The application root element is missing.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
