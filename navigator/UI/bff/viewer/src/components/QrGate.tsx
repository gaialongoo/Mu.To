import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { useNavLang } from "../i18n/NavLangContext";
import { markObjectUnlocked, validateQrCode } from "../utils/qrUnlock";

type QrGateProps = {
  museo: string;
  oggetto: string;
  objectTitle?: string;
  onSuccess: () => void;
  onClose: () => void;
};

type Phase = "starting" | "scanning" | "validating" | "permission-denied" | "no-camera" | "error";

export default function QrGate({
  museo,
  oggetto,
  objectTitle,
  onSuccess,
  onClose,
}: QrGateProps) {
  const { t } = useNavLang();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const lastSubmittedRef = useRef<string>("");
  const validatingRef = useRef(false);
  const mountedRef = useRef(true);

  const [phase, setPhase] = useState<Phase>("starting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [shake, setShake] = useState(false);
  const [hasFlash, setHasFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const handleDecode = async (result: QrScanner.ScanResult) => {
      const codice = String(result?.data || "").trim();
      if (!codice) return;
      if (validatingRef.current) return;
      if (codice === lastSubmittedRef.current) return;
      lastSubmittedRef.current = codice;

      validatingRef.current = true;
      if (mountedRef.current) setPhase("validating");

      const res = await validateQrCode({ codice, museo, oggetto });

      if (!mountedRef.current) return;

      if (res.ok) {
        markObjectUnlocked(museo, oggetto);
        try {
          scannerRef.current?.stop();
        } catch {
          /* ignora */
        }
        onSuccess();
        return;
      }

      validatingRef.current = false;
      setPhase("scanning");
      setErrorMsg(res.message || t("qrError"));
      setShake(true);
      try {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate?.(180);
        }
      } catch {
        /* ignora */
      }
      window.setTimeout(() => {
        if (mountedRef.current) setShake(false);
      }, 500);
      window.setTimeout(() => {
        // dopo un attimo permetti di riprovare con lo stesso codice
        lastSubmittedRef.current = "";
      }, 1500);
    };

    const scanner = new QrScanner(videoEl, handleDecode, {
      preferredCamera: "environment",
      highlightScanRegion: true,
      highlightCodeOutline: true,
      maxScansPerSecond: 8,
      returnDetailedScanResult: true,
    });
    scannerRef.current = scanner;

    QrScanner.hasCamera()
      .then((ok) => {
        if (cancelled) return;
        if (!ok) {
          setPhase("no-camera");
          return;
        }
        return scanner.start().then(() => {
          if (cancelled) return;
          setPhase("scanning");
          scanner.hasFlash().then((flashOk) => {
            if (cancelled) return;
            setHasFlash(flashOk);
          }).catch(() => {});
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (/permission|denied|NotAllowed/i.test(msg)) {
          setPhase("permission-denied");
        } else if (/NotFound|no camera/i.test(msg)) {
          setPhase("no-camera");
        } else {
          setPhase("error");
          setErrorMsg(msg);
        }
      });

    return () => {
      cancelled = true;
      try {
        scanner.stop();
      } catch {
        /* ignora */
      }
      try {
        scanner.destroy();
      } catch {
        /* ignora */
      }
      scannerRef.current = null;
    };
  }, [museo, oggetto, onSuccess, t]);

  const toggleFlash = async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      await scanner.toggleFlash();
      setFlashOn(scanner.isFlashOn());
    } catch {
      /* ignora */
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("qrTitle")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 11000,
        background: "rgba(0,0,0,0.92)",
        display: "flex",
        flexDirection: "column",
        color: "#fff",
        fontFamily: "var(--font-head, system-ui, sans-serif)",
      }}
    >
      <div
        style={{
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          borderBottom: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.16em", opacity: 0.7, textTransform: "uppercase" }}>
            {t("qrTitle")}
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {objectTitle || oggetto}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("qrCancel")}
          style={{
            border: "1px solid rgba(255,255,255,0.3)",
            background: "transparent",
            color: "#fff",
            padding: "8px 14px",
            borderRadius: 999,
            cursor: "pointer",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          ✕ {t("qrCancel")}
        </button>
      </div>

      <div
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: shake ? "translateX(0)" : undefined,
          animation: shake ? "muto-qr-shake 0.45s ease" : undefined,
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            background: "#000",
          }}
        />

        {phase === "starting" && (
          <div style={overlayBoxStyle}>{t("qrLoading")}</div>
        )}
        {phase === "validating" && (
          <div style={overlayBoxStyle}>{t("qrChecking")}</div>
        )}
        {phase === "permission-denied" && (
          <div style={overlayBoxStyle}>
            <div style={{ marginBottom: 8 }}>{t("qrPermissionDenied")}</div>
            <button
              type="button"
              onClick={onClose}
              style={primaryButtonStyle}
            >
              {t("qrCancel")}
            </button>
          </div>
        )}
        {phase === "no-camera" && (
          <div style={overlayBoxStyle}>
            <div style={{ marginBottom: 8 }}>{t("qrNoCamera")}</div>
            <button type="button" onClick={onClose} style={primaryButtonStyle}>
              {t("qrCancel")}
            </button>
          </div>
        )}
        {phase === "error" && (
          <div style={overlayBoxStyle}>
            <div style={{ marginBottom: 8 }}>{errorMsg || t("qrError")}</div>
            <button type="button" onClick={onClose} style={primaryButtonStyle}>
              {t("qrCancel")}
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          padding: "14px 18px 22px",
          borderTop: "1px solid rgba(255,255,255,0.12)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 13, opacity: 0.85, textAlign: "center", maxWidth: 480 }}>
          {t("qrInstructions")}
        </div>
        {phase === "scanning" && errorMsg && (
          <div
            style={{
              fontSize: 12,
              color: "#ffb4a8",
              background: "rgba(224,90,74,0.16)",
              border: "1px solid rgba(224,90,74,0.4)",
              padding: "6px 12px",
              borderRadius: 999,
            }}
          >
            {errorMsg}
          </div>
        )}
        {hasFlash && (
          <button
            type="button"
            onClick={toggleFlash}
            style={{
              border: "1px solid rgba(255,255,255,0.3)",
              background: flashOn ? "rgba(255,210,90,0.2)" : "transparent",
              color: "#fff",
              padding: "8px 16px",
              borderRadius: 999,
              fontSize: 12,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {flashOn ? t("qrFlashOff") : t("qrFlashOn")}
          </button>
        )}
      </div>

      <style>
        {`
          @keyframes muto-qr-shake {
            10%, 90% { transform: translate3d(-2px, 0, 0); }
            20%, 80% { transform: translate3d(4px, 0, 0); }
            30%, 50%, 70% { transform: translate3d(-6px, 0, 0); }
            40%, 60% { transform: translate3d(6px, 0, 0); }
          }
        `}
      </style>
    </div>
  );
}

const overlayBoxStyle: React.CSSProperties = {
  position: "absolute",
  inset: "auto",
  background: "rgba(0,0,0,0.65)",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 14,
  padding: "16px 22px",
  fontSize: 14,
  textAlign: "center",
  maxWidth: "85%",
};

const primaryButtonStyle: React.CSSProperties = {
  marginTop: 6,
  border: "none",
  background: "#185FA5",
  color: "#fff",
  padding: "10px 16px",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
};
