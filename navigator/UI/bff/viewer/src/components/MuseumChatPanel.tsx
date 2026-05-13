import { useEffect, useMemo, useRef, useState } from "react";
import { useNavLang } from "../i18n/NavLangContext";
import { createModel, type Model, type KaldiRecognizer } from "vosk-browser";

const API_BASE = "/api";

/* ── Vosk STT model cache (module-level, shared across mounts) ── */

const VOSK_MODEL_BASE_URL =
  "https://raw.githubusercontent.com/gaialongoo/Mu.To/main/navigator/UI/bff/viewer/public";

type VoskModelCache = { lang: string; model: Model };
let voskModelCache: VoskModelCache | null = null;
let voskModelInflight: Promise<Model> | null = null;
let voskModelInflightLang: string | null = null;

function voskUrlFor(lang: string): string {
  if (lang === "fr") return `${VOSK_MODEL_BASE_URL}/vosk-model-fr.tar.gz`;
  if (lang === "en") return `${VOSK_MODEL_BASE_URL}/vosk-model-en.tar.gz`;
  return `${VOSK_MODEL_BASE_URL}/vosk-model-it.tar.gz`;
}
function voskLocalUrlFor(lang: string): string {
  if (lang === "fr") return "/vosk-model-fr.tar.gz";
  if (lang === "en") return "/vosk-model-en.tar.gz";
  return "/vosk-model-it.tar.gz";
}

async function loadVoskModelOnce(
  lang: string,
  onLoading?: (loading: boolean) => void
): Promise<Model> {
  const remoteUrl = voskUrlFor(lang);
  const localUrl = voskLocalUrlFor(lang);
  if (voskModelCache && voskModelCache.lang === remoteUrl) return voskModelCache.model;
  if (voskModelInflight && voskModelInflightLang === remoteUrl) return voskModelInflight;
  if (voskModelCache && voskModelCache.lang !== remoteUrl) {
    try { (voskModelCache.model as any)?.terminate?.(); } catch {}
    voskModelCache = null;
  }
  voskModelInflightLang = remoteUrl;
  onLoading?.(true);
  voskModelInflight = (async () => {
    try {
      const m = await Promise.race([
        createModel(remoteUrl, -1),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000)),
      ]);
      voskModelCache = { lang: remoteUrl, model: m };
      return m;
    } catch (errRemote) {
      try {
        const m2 = await Promise.race([
          createModel(localUrl, -1),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000)),
        ]);
        voskModelCache = { lang: remoteUrl, model: m2 };
        return m2;
      } catch { throw errRemote; }
    } finally {
      voskModelInflight = null;
      voskModelInflightLang = null;
      onLoading?.(false);
    }
  })();
  return voskModelInflight;
}

/* ── Types ── */

type ChatMessage = { role: "user" | "assistant"; text: string };

type Props = {
  museo: string;
  stanzaCorrente: string | null;
  oggettoCorrente: string | null;
  tappaCorrente: string | null;
  percorso: string[];
  onClose: () => void;
};

export default function MuseumChatPanel({
  museo,
  stanzaCorrente,
  oggettoCorrente,
  tappaCorrente,
  percorso,
  onClose,
}: Props) {
  const { t, lang } = useNavLang();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* ── TTS state ── */
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsBusyKey, setTtsBusyKey] = useState<string | null>(null);
  const [ttsPaused, setTtsPaused] = useState(false);
  const [ttsRate, setTtsRate] = useState(1);
  const [ttsRange, setTtsRange] = useState<{ start: number; end: number } | null>(null);
  const ttsRateRef = useRef(1);
  const ttsPausedRef = useRef(false);
  const ttsLiveRestartTimerRef = useRef<number | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const ttsKeyRef = useRef<string | null>(null);
  const ttsFullTextRef = useRef<string>("");
  const ttsCharIndexRef = useRef<number>(0);
  const ttsManualRemainingRef = useRef<string>("");
  const ttsPausingRef = useRef(false);
  const ttsUtteranceBaseRef = useRef<number>(0);
  const ttsFallbackTimerRef = useRef<number | null>(null);
  const ttsFallbackStartedRef = useRef(false);
  const ttsFallbackStartTsRef = useRef<number>(0);
  const ttsFallbackElapsedBeforePauseRef = useRef<number>(0);
  const ttsWordRangesRef = useRef<Array<{ start: number; end: number }>>([]);

  /* ── STT state ── */
  const [sttRecording, setSttRecording] = useState(false);
  const [sttStarting, setSttStarting] = useState(false);
  const [sttLoadingModel, setSttLoadingModel] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const [, setSttPreview] = useState<string>("");
  const voskModelRef = useRef<Model | null>(null);
  const voskModelLangRef = useRef<string>("");
  const recognizerRef = useRef<KaldiRecognizer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const zeroGainRef = useRef<GainNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const lastSttTextRef = useRef<string>("");
  const lastPartialRef = useRef<string>("");
  const silenceTimerRef = useRef<number | null>(null);
  const hasSpeechRef = useRef(false);
  const sttRecordingRef = useRef(false);

  const quickQuestions = useMemo(
    () => [
      t("museumQuickAccess"),
      t("museumQuickWc"),
      t("museumQuickShop"),
      t("museumQuickRoom"),
      t("museumQuickNext"),
    ],
    [t]
  );

  /* ── Sync refs ── */
  useEffect(() => { ttsRateRef.current = ttsRate; }, [ttsRate]);
  useEffect(() => { ttsPausedRef.current = ttsPaused; }, [ttsPaused]);

  /* ── Auto-focus, scroll, ESC ── */
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth > 900) {
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* ── TTS helpers ── */

  const waitForVoices = async () => {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      const existing = synth.getVoices?.() || [];
      if (existing.length > 0) return;
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => { if (done) return; done = true; try { synth.removeEventListener("voiceschanged", onChange as any); } catch {} resolve(); };
        const onChange = () => finish();
        try { synth.addEventListener("voiceschanged", onChange as any); } catch {}
        setTimeout(() => finish(), 600);
      });
    } catch {}
  };

  const stopTts = () => {
    if (ttsLiveRestartTimerRef.current) {
      try { window.clearTimeout(ttsLiveRestartTimerRef.current); } catch {}
      ttsLiveRestartTimerRef.current = null;
    }
    try { window.speechSynthesis?.cancel?.(); } catch {}
    if (ttsFallbackTimerRef.current) {
      window.clearInterval(ttsFallbackTimerRef.current);
      ttsFallbackTimerRef.current = null;
    }
    ttsFallbackStartedRef.current = false;
    ttsFallbackElapsedBeforePauseRef.current = 0;
    ttsWordRangesRef.current = [];
    setTtsBusyKey(null);
    ttsKeyRef.current = null;
    setTtsPaused(false);
    ttsPausingRef.current = false;
    setTtsRange(null);
    utteranceRef.current = null;
    ttsFullTextRef.current = "";
    ttsManualRemainingRef.current = "";
    ttsCharIndexRef.current = 0;
  };

  const buildWordRanges = (text: string) => {
    const s = String(text || "");
    const ranges: Array<{ start: number; end: number }> = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) ranges.push({ start: m.index, end: m.index + m[0].length });
    return ranges;
  };

  const approxElapsedMsForChar = (fullText: string, charIdx: number, rate: number) => {
    const ranges = buildWordRanges(fullText);
    if (!ranges.length) return 0;
    const cx = Math.max(0, Math.floor(charIdx));
    let wi = ranges.findIndex((r) => r.end > cx);
    if (wi < 0) wi = Math.max(0, ranges.length - 1);
    const wps = 2.5 * Math.max(0.6, Math.min(1.6, Number(rate) || 1));
    return (wi / Math.max(wps, 1e-6)) * 1000;
  };

  const startTtsHighlightFallback = (fullText: string, opts?: { resume?: boolean }) => {
    const resume = !!opts?.resume;
    if (ttsFallbackTimerRef.current) { try { window.clearInterval(ttsFallbackTimerRef.current); } catch {} ttsFallbackTimerRef.current = null; }
    const ranges = buildWordRanges(fullText);
    if (ranges.length < 2) return;
    if (!resume) {
      ttsFallbackElapsedBeforePauseRef.current = 0;
    } else {
      const rateSeed = Math.max(0.6, Math.min(1.6, Number(ttsRateRef.current) || 1));
      const acc = Number(ttsFallbackElapsedBeforePauseRef.current) || 0;
      const chNow = Number(ttsCharIndexRef.current) || 0;
      if (acc < 200 && fullText.trim().length > 0 && chNow > 0) {
        ttsFallbackElapsedBeforePauseRef.current = Math.max(acc, approxElapsedMsForChar(fullText, chNow, rateSeed));
      }
    }
    ttsWordRangesRef.current = ranges;
    ttsFallbackStartedRef.current = true;
    ttsFallbackStartTsRef.current = Date.now();
    const tick = () => {
      const rate = Math.max(0.6, Math.min(1.6, Number(ttsRateRef.current) || 1));
      const wps = 2.5 * rate;
      const elapsedMs = ttsFallbackElapsedBeforePauseRef.current + Math.max(0, Date.now() - ttsFallbackStartTsRef.current);
      const wordIdx = Math.floor((elapsedMs / 1000) * wps);
      const r = ranges[Math.max(0, Math.min(ranges.length - 1, wordIdx))];
      if (r) { setTtsRange(r); ttsCharIndexRef.current = r.end; }
    };
    ttsFallbackTimerRef.current = window.setInterval(tick, 120);
  };

  const startUtterance = async (text: string, key: string, { isResume }: { isResume: boolean }) => {
    const clean = String(text || "").trim();
    if (!clean) return;
    await waitForVoices();
    const synth = window.speechSynthesis;
    const voicesNow = synth.getVoices?.() || [];
    if (voicesNow.length === 0) {
      setTtsBusyKey(null); ttsKeyRef.current = null;
      setTtsError(t("listen") === "Listen" ? "No voices installed in this browser." : "Sintesi vocale non disponibile: nessuna voce installata nel browser.");
      return;
    }
    const desiredLang = lang === "en" || lang === "fr" || lang === "it" ? lang : "it";
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = desiredLang;
    u.rate = Math.max(0.6, Math.min(1.6, Number(ttsRateRef.current) || 1));
    try {
      const v = voicesNow.find((vv) => String(vv?.lang || "").toLowerCase().startsWith(`${desiredLang}-`))
             || voicesNow.find((vv) => String(vv?.lang || "").toLowerCase() === desiredLang)
             || null;
      if (v) u.voice = v as any;
    } catch {}

    let gotBoundary = false;
    const base = isResume ? Math.max(0, Math.min(ttsFullTextRef.current.length, ttsCharIndexRef.current || 0)) : 0;
    ttsUtteranceBaseRef.current = base;
    u.onboundary = (ev: any) => {
      gotBoundary = true;
      const idx = Number(ev?.charIndex);
      const len = Number(ev?.charLength || 1);
      if (!Number.isFinite(idx) || idx < 0) return;
      const start = ttsUtteranceBaseRef.current + idx;
      const end = ttsUtteranceBaseRef.current + idx + (Number.isFinite(len) && len > 0 ? len : 1);
      ttsCharIndexRef.current = end;
      setTtsRange({ start, end });
    };
    u.onstart = () => {
      ttsPausingRef.current = false;
      setTimeout(() => {
        if (!gotBoundary && ttsKeyRef.current === key) startTtsHighlightFallback(ttsFullTextRef.current, { resume: isResume });
      }, 250);
    };
    u.onend = () => {
      if (ttsPausingRef.current) return;
      setTtsBusyKey(null); ttsKeyRef.current = null; setTtsPaused(false); setTtsRange(null); utteranceRef.current = null;
      if (ttsFallbackTimerRef.current) { window.clearInterval(ttsFallbackTimerRef.current); ttsFallbackTimerRef.current = null; }
      ttsFallbackStartedRef.current = false; ttsFallbackElapsedBeforePauseRef.current = 0; ttsWordRangesRef.current = [];
      ttsFullTextRef.current = ""; ttsCharIndexRef.current = 0; ttsManualRemainingRef.current = "";
    };
    u.onerror = (ev: any) => {
      const errType = String(ev?.error || "").toLowerCase();
      if (ttsPausingRef.current || errType === "interrupted" || errType === "canceled") return;
      setTtsBusyKey(null); ttsKeyRef.current = null; setTtsError(t("listen") === "Listen" ? "Speech synthesis unavailable." : "Sintesi vocale non disponibile in questo browser."); setTtsPaused(false); setTtsRange(null); utteranceRef.current = null;
      if (ttsFallbackTimerRef.current) { window.clearInterval(ttsFallbackTimerRef.current); ttsFallbackTimerRef.current = null; }
      ttsFallbackStartedRef.current = false; ttsFallbackElapsedBeforePauseRef.current = 0; ttsWordRangesRef.current = [];
      ttsFullTextRef.current = ""; ttsCharIndexRef.current = 0; ttsManualRemainingRef.current = "";
    };
    utteranceRef.current = u;
    if (!isResume) synth.cancel();
    synth.speak(u);
  };

  const speakText = async (text: string, key: string) => {
    const clean = String(text || "").trim();
    if (!clean) return;
    if (ttsBusyKey === key) { stopTts(); return; }
    stopTts();
    setTtsError(null); setTtsBusyKey(key); ttsKeyRef.current = key; setTtsPaused(false); setTtsRange(null);
    if (ttsFallbackTimerRef.current) { window.clearInterval(ttsFallbackTimerRef.current); ttsFallbackTimerRef.current = null; }
    ttsFallbackStartedRef.current = false; ttsFallbackElapsedBeforePauseRef.current = 0; ttsWordRangesRef.current = [];
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") {
        ttsFullTextRef.current = clean; ttsCharIndexRef.current = 0; ttsManualRemainingRef.current = "";
        await startUtterance(clean, key, { isResume: false });
        setTimeout(() => {
          try {
            const synth = window.speechSynthesis;
            if (!synth.speaking && !synth.pending) {
              setTtsBusyKey(null); ttsKeyRef.current = null;
              setTtsError(t("listen") === "Listen" ? "Speech synthesis unavailable." : "Sintesi vocale non disponibile in questo browser.");
            }
          } catch { setTtsBusyKey(null); ttsKeyRef.current = null; }
        }, 500);
        return;
      }
    } catch {}
    setTtsBusyKey(null);
    setTtsError(t("listen") === "Listen" ? "Speech synthesis unavailable." : "Sintesi vocale non disponibile in questo browser.");
  };

  const pauseTts = () => {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      const idxFromRange = ttsRange?.end != null ? Number(ttsRange.end) : 0;
      const idx = Math.max(0, Math.min(ttsFullTextRef.current.length, Math.max(ttsCharIndexRef.current || 0, Number.isFinite(idxFromRange) ? idxFromRange : 0)));
      const rawAfter = String(ttsFullTextRef.current || "").slice(idx);
      const leadSkip = rawAfter.length - rawAfter.trimStart().length;
      const remaining = rawAfter.trimStart();
      if (remaining) {
        ttsManualRemainingRef.current = remaining;
        ttsCharIndexRef.current = Math.min(ttsFullTextRef.current.length, idx + leadSkip);
      }
      ttsPausingRef.current = true;
      synth.cancel();
      setTtsPaused(true);
      if (ttsFallbackTimerRef.current) { window.clearInterval(ttsFallbackTimerRef.current); ttsFallbackTimerRef.current = null; }
      if (ttsFallbackStartedRef.current) {
        ttsFallbackElapsedBeforePauseRef.current += Math.max(0, Date.now() - ttsFallbackStartTsRef.current);
      }
    } catch {}
  };

  const resumeTts = () => {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      setTtsPaused(false); ttsPausingRef.current = false;
      const key = ttsKeyRef.current;
      const remaining = String(ttsManualRemainingRef.current || "").trim();
      if (key && remaining) {
        ttsManualRemainingRef.current = "";
        void startUtterance(remaining, key, { isResume: true });
      } else {
        try { window.speechSynthesis.resume(); } catch {}
      }
      if (ttsFallbackStartedRef.current && ttsWordRangesRef.current.length > 0 && !ttsFallbackTimerRef.current) {
        ttsFallbackStartTsRef.current = Date.now();
        ttsFallbackTimerRef.current = window.setInterval(() => {
          const rate = Math.max(0.6, Math.min(1.6, Number(ttsRateRef.current) || 1));
          const wps = 2.5 * rate;
          const elapsedMs = ttsFallbackElapsedBeforePauseRef.current + Math.max(0, Date.now() - ttsFallbackStartTsRef.current);
          const wordIdx = Math.floor((elapsedMs / 1000) * wps);
          const r = ttsWordRangesRef.current[Math.max(0, Math.min(ttsWordRangesRef.current.length - 1, wordIdx))];
          if (r) setTtsRange(r);
        }, 120);
      }
    } catch {}
  };

  const estimateTtsSeconds = (text: string, rate: number) => {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
    const wps = 2.5 * Math.max(0.5, Math.min(2, Number(rate) || 1));
    return Math.max(1, Math.round(words / wps));
  };

  const renderHighlightedText = (text: string, key: string) => {
    const s = String(text || "");
    const isActive = ttsBusyKey === key && ttsRange && ttsRange.end > ttsRange.start;
    if (!isActive) return <>{s}</>;
    const start = Math.max(0, Math.min(s.length, ttsRange.start));
    const end = Math.max(start, Math.min(s.length, ttsRange.end));
    return (
      <>
        {s.slice(0, start)}
        <span style={{ background: "rgba(92,191,128,0.22)", padding: "0 2px", borderRadius: 3 }}>
          {s.slice(start, end)}
        </span>
        {s.slice(end)}
      </>
    );
  };

  // Live TTS rate change: restart utterance from current position with new rate
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const key = ttsKeyRef.current;
    if (!key) return;
    if (ttsPausedRef.current) return;
    const fullText = String(ttsFullTextRef.current || "");
    const idxFromRange = ttsRange?.end != null ? Number(ttsRange.end) : 0;
    const charIdx = Math.max(0, Math.min(fullText.length, Math.max(ttsCharIndexRef.current || 0, Number.isFinite(idxFromRange) ? idxFromRange : 0)));
    const rawTail = fullText.slice(charIdx);
    const leadingSkip = rawTail.length - rawTail.trimStart().length;
    const remaining = rawTail.trimStart();
    if (!remaining) return;
    ttsCharIndexRef.current = Math.min(fullText.length, charIdx + leadingSkip);
    if (ttsLiveRestartTimerRef.current) { try { window.clearTimeout(ttsLiveRestartTimerRef.current); } catch {} ttsLiveRestartTimerRef.current = null; }
    ttsPausingRef.current = true;
    try { window.speechSynthesis.cancel(); } catch {}
    if (ttsFallbackTimerRef.current) { try { window.clearInterval(ttsFallbackTimerRef.current); } catch {} ttsFallbackTimerRef.current = null; }
    if (ttsFallbackStartedRef.current) ttsFallbackElapsedBeforePauseRef.current += Math.max(0, Date.now() - ttsFallbackStartTsRef.current);
    ttsLiveRestartTimerRef.current = window.setTimeout(() => {
      ttsLiveRestartTimerRef.current = null;
      if (!ttsKeyRef.current || ttsPausedRef.current) { ttsPausingRef.current = false; return; }
      void startUtterance(remaining, key, { isResume: true });
    }, 120);
    return () => { if (ttsLiveRestartTimerRef.current) { try { window.clearTimeout(ttsLiveRestartTimerRef.current); } catch {} ttsLiveRestartTimerRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsRate]);

  /* ── STT helpers ── */

  const ensureVoskModel = async (): Promise<Model> => {
    const currentLang = (lang === "en" || lang === "fr" || lang === "it") ? lang : "it";
    const remoteModelUrl = voskUrlFor(currentLang);
    const localModelUrl = voskLocalUrlFor(currentLang);
    try {
      const m = await loadVoskModelOnce(currentLang, (l) => setSttLoadingModel(l));
      voskModelRef.current = m;
      voskModelLangRef.current = remoteModelUrl;
      return m;
    } catch (e: any) {
      const msg = e?.message || "Impossibile caricare il modello STT";
      const isIso = typeof window !== "undefined" ? (window as any).crossOriginIsolated : false;
      const hint = msg === "timeout"
        ? `Caricamento STT bloccato. Prova a ricaricare la pagina. (crossOriginIsolated=${isIso ? "true" : "false"}).`
        : `Controlla URL modello: ${remoteModelUrl} (o fallback ${localModelUrl}).`;
      setSttError(`${msg === "timeout" ? "STT timeout" : msg}. ${hint}`);
      throw e;
    }
  };

  // Preload STT model in background
  useEffect(() => {
    const currentLang = (lang === "en" || lang === "fr" || lang === "it") ? lang : "it";
    if (voskModelCache && voskModelCache.lang === voskUrlFor(currentLang)) {
      voskModelRef.current = voskModelCache.model;
      voskModelLangRef.current = voskModelCache.lang;
      return;
    }
    ensureVoskModel().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const stopRecording = async ({ autoSend }: { autoSend: boolean }) => {
    setSttRecording(false);
    sttRecordingRef.current = false;
    try { processorRef.current?.disconnect(); } catch {} processorRef.current = null;
    try { zeroGainRef.current?.disconnect(); } catch {} zeroGainRef.current = null;
    try { mediaStreamRef.current?.getTracks()?.forEach((t) => t.stop()); } catch {} mediaStreamRef.current = null;
    try { await audioContextRef.current?.close?.(); } catch {} audioContextRef.current = null;
    try { recognizerRef.current?.retrieveFinalResult?.(); } catch {}
    setTimeout(() => {
      const finalText = String(lastSttTextRef.current || lastPartialRef.current || "").trim();
      if (finalText) {
        if (autoSend) { setInput(""); setSttPreview(""); send(finalText); }
        else { setInput(finalText); setSttPreview(""); }
      }
      try { recognizerRef.current?.remove?.(); } catch {}
      recognizerRef.current = null;
      lastSttTextRef.current = ""; lastPartialRef.current = ""; hasSpeechRef.current = false;
    }, 150);
  };

  const toggleRecording = async () => {
    if (sttRecording) {
      if (silenceTimerRef.current) { window.clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
      await stopRecording({ autoSend: false });
      return;
    }
    setSttStarting(true); setSttError(null);
    lastSttTextRef.current = ""; lastPartialRef.current = ""; hasSpeechRef.current = false; setSttPreview("");
    try {
      if (typeof window !== "undefined" && !window.isSecureContext) throw new Error("Microfono richiede HTTPS (o localhost)");
      if (!navigator?.mediaDevices?.getUserMedia) throw new Error("Microfono non supportato in questo browser");
      const model = await ensureVoskModel();
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      mediaStreamRef.current = mediaStream;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      try { await audioContext.resume(); } catch {}
      const recognizer = new model.KaldiRecognizer(audioContext.sampleRate);
      recognizerRef.current = recognizer;
      const resetSilenceTimer = () => {
        if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = window.setTimeout(() => {
          const hasSomeText = String(lastSttTextRef.current || lastPartialRef.current || "").trim().length > 0;
          if (!hasSpeechRef.current || !hasSomeText) return;
          stopRecording({ autoSend: true }).catch(() => {});
        }, 1200);
      };
      recognizer.on("result", (m: any) => {
        const text = String(m?.result?.text || "").trim();
        if (text) { lastSttTextRef.current = text; hasSpeechRef.current = true; resetSilenceTimer(); }
      });
      recognizer.on("partialresult", (m: any) => {
        const partial = String(m?.result?.partial || "").trim();
        if (partial) {
          lastPartialRef.current = partial; hasSpeechRef.current = true; setSttPreview(partial);
          if (sttRecordingRef.current) setInput(partial);
          resetSilenceTimer();
        }
      });
      recognizer.on("error", (m: any) => setSttError(String(m?.error || "STT error")));
      const src = audioContext.createMediaStreamSource(mediaStream);
      const proc = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = proc;
      proc.onaudioprocess = (event) => { try { recognizer.acceptWaveform(event.inputBuffer); } catch {} };
      src.connect(proc);
      const g = audioContext.createGain(); g.gain.value = 0; zeroGainRef.current = g;
      proc.connect(g); g.connect(audioContext.destination);
      setSttRecording(true); sttRecordingRef.current = true; resetSilenceTimer();
    } catch (e: any) {
      setSttRecording(false); sttRecordingRef.current = false;
      setSttError(e?.message || "Permesso microfono negato");
      try { await stopRecording({ autoSend: false }); } catch {}
    } finally { setSttStarting(false); }
  };

  /* ── Cleanup on unmount ── */
  useEffect(() => {
    return () => {
      stopTts();
      if (silenceTimerRef.current) { window.clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
      try { processorRef.current?.disconnect(); } catch {}
      try { zeroGainRef.current?.disconnect(); } catch {}
      try { mediaStreamRef.current?.getTracks()?.forEach((t) => t.stop()); } catch {}
      try { audioContextRef.current?.close?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Send message ── */
  async function send(rawQuestion: string) {
    const question = rawQuestion.trim();
    if (!question || loading) return;
    setInput("");
    const newMsg: ChatMessage = { role: "user", text: question };
    setMessages((prev) => [...prev, newMsg]);
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/ai/museum-chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          museo,
          question,
          stanzaCorrente,
          oggettoCorrente,
          tappaCorrente,
          percorso,
          history: messages,
          navLang: lang,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.detail || d?.error || t("museumChatRequestFail"));
      const answer = String(d?.answer || "").trim() || t("museumChatNoAnswer");
      setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `${t("museumChatErrorPrefix")} ${err?.message || t("museumChatRequestFail")}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 900;

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("museumChatTitle")}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        zIndex: 10040,
        display: "flex",
        alignItems: isMobile ? "flex-end" : "center",
        justifyContent: "center",
        padding: isMobile ? 0 : 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isMobile ? "100%" : "min(640px, 96vw)",
          height: isMobile ? "min(82vh, 720px)" : "min(78vh, 720px)",
          background: "var(--bg, #0f0f10)",
          color: "var(--text, #e9e9e9)",
          border: "1px solid var(--border, rgba(255,255,255,0.12))",
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          borderBottomLeftRadius: isMobile ? 0 : 16,
          borderBottomRightRadius: isMobile ? 0 : 16,
          boxShadow: "0 20px 80px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            background:
              "linear-gradient(180deg, rgba(92,191,128,0.10) 0%, rgba(92,191,128,0.02) 100%)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-head)",
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--green, #5cbf80)",
                fontWeight: 700,
              }}
            >
              {t("museumChatTitle")}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-faint, rgba(255,255,255,0.6))",
                marginTop: 2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {t("museumChatSubtitle")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("museumChatClose")}
            title={t("museumChatClose")}
            style={{
              width: 32,
              height: 32,
              flexShrink: 0,
              borderRadius: 10,
              border: "1px solid rgba(224, 65, 56, 0.65)",
              background: "rgba(224, 65, 56, 0.18)",
              color: "#ff5b4f",
              fontSize: 18,
              fontWeight: 800,
              lineHeight: "28px",
              cursor: "pointer",
              boxShadow: "0 0 0 2px rgba(224,65,56,0.18)",
              padding: 0,
            }}
          >
            ✕
          </button>
        </header>

        {/* ── Messages ── */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {messages.length === 0 && (
            <div
              style={{
                color: "var(--text-faint, rgba(255,255,255,0.6))",
                fontSize: 13,
                lineHeight: 1.5,
                padding: "8px 4px",
              }}
            >
              {t("museumChatEmpty")}
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "86%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  background:
                    m.role === "user"
                      ? "rgba(92,191,128,0.20)"
                      : "rgba(92,191,128,0.08)",
                  border:
                    m.role === "user"
                      ? "1px solid rgba(92,191,128,0.45)"
                      : "1px solid rgba(92,191,128,0.18)",
                }}
              >
                <div style={{ display: "grid", gap: 6 }}>
                  <div>{renderHighlightedText(m.text, `msg:${i}`)}</div>
                  {m.role === "assistant" && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); speakText(m.text, `msg:${i}`); }}
                        style={{
                          border: `1px solid ${ttsBusyKey === `msg:${i}` ? "rgba(92,191,128,0.65)" : "rgba(92,191,128,0.25)"}`,
                          background: ttsBusyKey === `msg:${i}` ? "rgba(92,191,128,0.28)" : "rgba(92,191,128,0.08)",
                          color: "var(--green, #5cbf80)",
                          borderRadius: 14,
                          padding: "4px 8px",
                          fontFamily: "var(--font-head)",
                          fontSize: 10,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          cursor: "pointer",
                        }}
                      >
                        {ttsBusyKey === `msg:${i}` ? t("stop") : t("listen")}
                      </button>
                      {ttsBusyKey === `msg:${i}` && !ttsPaused && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); pauseTts(); }}
                          style={{
                            border: "1px solid rgba(255,255,255,0.12)",
                            background: "transparent",
                            color: "var(--text-faint, rgba(255,255,255,0.6))",
                            borderRadius: 14,
                            padding: "4px 8px",
                            fontFamily: "var(--font-head)",
                            fontSize: 10,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            cursor: "pointer",
                          }}
                        >
                          {t("pause")}
                        </button>
                      )}
                      {ttsBusyKey === `msg:${i}` && ttsPaused && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); resumeTts(); }}
                          style={{
                            border: "1px solid rgba(255,255,255,0.12)",
                            background: "transparent",
                            color: "var(--text-faint, rgba(255,255,255,0.6))",
                            borderRadius: 14,
                            padding: "4px 8px",
                            fontFamily: "var(--font-head)",
                            fontSize: 10,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            cursor: "pointer",
                          }}
                        >
                          {t("resume")}
                        </button>
                      )}
                      {ttsBusyKey === `msg:${i}` && (
                        <span style={{ fontSize: 10, color: "var(--text-faint, rgba(255,255,255,0.5))" }}>
                          {estimateTtsSeconds(m.text, ttsRate)}s
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div
              style={{
                color: "var(--text-faint, rgba(255,255,255,0.6))",
                fontSize: 13,
                fontStyle: "italic",
              }}
            >
              {t("museumChatThinking")}
            </div>
          )}
        </div>

        {/* ── TTS speed slider (visible when any TTS is active) ── */}
        {ttsBusyKey && (
          <div
            style={{
              padding: "6px 14px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "rgba(0,0,0,0.15)",
            }}
          >
            <span style={{ fontFamily: "var(--font-head)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--green, #5cbf80)", whiteSpace: "nowrap" }}>
              {t("ttsRate")}
            </span>
            <input
              type="range" min="0.8" max="1.4" step="0.05" value={ttsRate}
              onChange={(e) => setTtsRate(Number(e.target.value))}
              style={{ flex: 1, accentColor: "var(--green, #5cbf80)" }}
              aria-label={t("ttsRate")}
            />
            <span style={{ fontSize: 10, color: "var(--text-faint, rgba(255,255,255,0.5))", whiteSpace: "nowrap" }}>
              {ttsRate.toFixed(2)}×
            </span>
          </div>
        )}

        {/* ── Quick questions ── */}
        {messages.length === 0 && (
          <div
            style={{
              padding: "0 12px 8px 12px",
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {quickQuestions.map((q) => (
              <button
                type="button"
                key={q}
                onClick={() => send(q)}
                disabled={loading}
                style={{
                  border: "1px solid rgba(92,191,128,0.35)",
                  background: "rgba(92,191,128,0.08)",
                  color: "var(--green, #5cbf80)",
                  borderRadius: 999,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  letterSpacing: "0.02em",
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* ── Input form ── */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          style={{
            display: "flex",
            gap: 8,
            padding: 12,
            borderTop: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(0,0,0,0.25)",
            alignItems: "stretch",
          }}
        >
          {/* Microphone button */}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleRecording(); }}
            disabled={loading || sttLoadingModel || sttStarting}
            aria-label="Microfono"
            style={{
              border: sttRecording ? "1px solid rgba(224,90,74,0.55)" : "1px solid rgba(92,191,128,0.35)",
              borderRadius: 999,
              padding: 0,
              background: sttRecording ? "rgba(224,90,74,0.14)" : "rgba(92,191,128,0.08)",
              color: sttRecording ? "#e05a4a" : "var(--green, #5cbf80)",
              cursor: loading || sttLoadingModel || sttStarting ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 42,
              minWidth: 42,
              height: 38,
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            {sttStarting || sttLoadingModel ? (
              <span style={{ fontSize: 16, lineHeight: 1, color: "currentColor" }}>…</span>
            ) : sttRecording ? (
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false" style={{ display: "block" }}>
                <rect x="4" y="4" width="8" height="8" rx="2" fill="currentColor" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" style={{ display: "block" }}>
                <path
                  fill="currentColor"
                  d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm7-3a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.08A7 7 0 0 0 19 11Z"
                />
              </svg>
            )}
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("museumChatPlaceholder")}
            disabled={loading || sttRecording}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.04)",
              color: "var(--text, #e9e9e9)",
              fontSize: 14,
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid rgba(92,191,128,0.45)",
              background: loading || !input.trim()
                ? "rgba(92,191,128,0.10)"
                : "rgba(92,191,128,0.22)",
              color: "var(--green, #5cbf80)",
              fontFamily: "var(--font-head)",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            }}
          >
            {t("send")}
          </button>
        </form>

        {/* ── STT / TTS status messages ── */}
        {(sttError || ttsError || sttLoadingModel || sttStarting || sttRecording) && (
          <div style={{ padding: "4px 14px 8px", background: "rgba(0,0,0,0.25)" }}>
            {sttError && <p style={{ margin: 0, fontSize: 11, color: "#c32020" }}>{sttError}</p>}
            {!sttError && !sttRecording && typeof window !== "undefined" && !window.isSecureContext && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-faint, rgba(255,255,255,0.5))" }}>
                Microfono: serve HTTPS oppure localhost.
              </p>
            )}
            {ttsError && <p style={{ margin: 0, fontSize: 11, color: "#c32020" }}>{ttsError}</p>}
            {sttLoadingModel && !sttError && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-faint, rgba(255,255,255,0.5))" }}>
                Caricamento riconoscimento vocale…
              </p>
            )}
            {sttStarting && !sttError && !sttLoadingModel && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-faint, rgba(255,255,255,0.5))" }}>
                Avvio microfono…
              </p>
            )}
            {sttRecording && !sttError && !sttLoadingModel && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-faint, rgba(255,255,255,0.5))" }}>
                Sto ascoltando… premi ■ per fermare
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
