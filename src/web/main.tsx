import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./neumorphic.css";
// 换皮预览：必须排在 neumorphic.css 之后。删掉下面两行即可完整还原现有外观。
import "./pearl-skin.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
