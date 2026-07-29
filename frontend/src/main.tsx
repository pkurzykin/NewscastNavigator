import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/stories.css";
import "./styles/scenario.css";
import "./styles/history.css";
import "./styles/production.css";
import "./styles/corrections.css";
import "./styles/external-approval.css";
import "./styles/notifications.css";
import "./styles/admin.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
