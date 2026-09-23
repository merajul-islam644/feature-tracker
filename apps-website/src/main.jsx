// Entry point — mounts <App /> on the #root div from index.html.
// Tailwind layers are loaded here so every component gets the design
// tokens; `index.css` is the only place to add global styles.
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
