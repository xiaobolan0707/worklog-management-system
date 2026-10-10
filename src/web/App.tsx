import { BrowserRouter } from "react-router-dom";

import { AuthProvider } from "./auth/AuthProvider.js";
import { AppRouter } from "./router.js";
import "./styles.css";
import "./employee.css";

export function App() {
  return <BrowserRouter><AuthProvider><AppRouter /></AuthProvider></BrowserRouter>;
}
