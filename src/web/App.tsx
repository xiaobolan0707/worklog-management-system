import { BrowserRouter } from "react-router-dom";

import { AuthProvider } from "./auth/AuthProvider.js";
import { AppRouter } from "./router.js";
import { ToastProvider } from "./components/motion/index.js";
import "./styles.css";
import "./employee.css";
import "./admin.css";
import "./archives.css";
import "./components/motion/motion.css";

export function App() {
  return <ToastProvider><BrowserRouter><AuthProvider><AppRouter /></AuthProvider></BrowserRouter></ToastProvider>;
}
