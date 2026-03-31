import React, { useState, useEffect, useImperativeHandle, forwardRef } from "react";

const Toast = forwardRef(function Toast(_, ref) {
  const [state, setState] = useState({ msg: "", type: "success", show: false });

  useImperativeHandle(ref, () => ({
    show(msg, type = "success") {
      setState({ msg, type, show: true });
      setTimeout(() => setState((s) => ({ ...s, show: false })), 3200);
    },
  }));

  return (
    <div
      style={{
        position: "fixed",
        bottom: 32,
        right: 32,
        padding: "14px 22px",
        background: "var(--bg-card)",
        border: `1px solid ${state.type === "error" ? "rgba(200,70,60,0.4)" : "var(--border)"}`,
        borderLeft: `3px solid ${state.type === "error" ? "#e05a4a" : "var(--gold)"}`,
        borderRadius: "var(--radius-lg)",
        fontFamily: "var(--font-head)",
        fontSize: 11,
        letterSpacing: "0.1em",
        color: "var(--text)",
        zIndex: 9000,
        boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        transform: state.show ? "translateY(0)" : "translateY(80px)",
        opacity: state.show ? 1 : 0,
        transition: "all 0.3s ease",
        pointerEvents: "none",
      }}
    >
      {state.msg}
    </div>
  );
});

export default Toast;