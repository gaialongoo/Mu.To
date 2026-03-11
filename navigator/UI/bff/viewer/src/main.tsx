import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const rootEl = document.getElementById("root")!;

function mount() {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// 🔒 se la sessione è già pronta → monta subito
if (document.cookie.includes("museo_session=")) {
  mount();
} else {
  // ⏳ aspetta la homepage
  window.addEventListener("museo-session-ready", mount, { once: true });
}
