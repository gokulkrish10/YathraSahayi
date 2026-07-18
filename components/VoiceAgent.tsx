"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Language } from "@/types";

type VoiceStatus = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "error";
type StopOptions = { discard?: boolean; nextStatus?: VoiceStatus };

interface Turn {
  role: "user" | "assistant";
  text: string;
  language: Language;
  time: string;
  sources?: SearchSource[];
  routeMapUrl?: string;
  routeProvider?: string;
  routeDistance?: string;
  routeDuration?: string;
}

interface SearchSource {
  title: string;
  url?: string;
  snippet: string;
  publishedDate?: string;
}

interface ProcessBrowserResponse {
  ok: boolean;
  data?: {
    sessionId: string;
    transcript: string;
    responseText: string;
    switchMessage?: string | null;
    detectedLanguage: Language;
    audioBase64?: string;
    contentType?: string;
    providers?: {
      stt?: string;
      tts?: string;
      llm?: string;
      search?: string;
    };
    route?: {
      provider?: string;
      mapUrl?: string;
      localizedTotalDistance?: string;
      localizedTotalDuration?: string;
    };
    sources?: SearchSource[];
    error?: string;
  };
  error?: string;
}

const QUICK_PROMPTS: {
  label: string;
  labelMl: string;
  lang: Language;
  displayText: string;
  intentType: "route" | "fare" | "schedule";
  origin?: string;
  destination?: string;
  timeContext?: string;
}[] = [
  {
    label: "Metro route",
    labelMl: "മെട്രോ റൂട്ട്",
    lang: "en",
    displayText: "Metro route from Edapally to Vyttila",
    intentType: "route",
    origin: "Edapally",
    destination: "Vyttila",
  },
  {
    label: "Auto fare (night)",
    labelMl: "ഓട്ടോ ചാർജ്",
    lang: "en",
    displayText: "Auto fare from Vyttila to Kakkanad at night",
    intentType: "fare",
    origin: "Vyttila",
    destination: "Kakkanad",
    timeContext: "night",
  },
  {
    label: "Last metro",
    labelMl: "അവസാന മെട്രോ",
    lang: "en",
    displayText: "Last metro from Palarivattom",
    intentType: "schedule",
    origin: "Palarivattom",
    timeContext: "last",
  },
  {
    label: "Manglish route",
    labelMl: "മംഗ്ലീഷ്",
    lang: "ml",
    displayText: "Enikku Lulu Mall pokanam",
    intentType: "route",
    destination: "Lulu Mall",
  },
];

const STATUS_COPY: Record<
  VoiceStatus,
  { eyebrow: string; title: string; detail: string; cta: string }
> = {
  idle: {
    eyebrow: "Ready",
    title: "Tap once to start the helpline call",
    detail: "Speak naturally. Sahayi will detect the language and keep the conversation going.",
    cta: "Start call",
  },
  listening: {
    eyebrow: "Live",
    title: "Listening... speak now",
    detail: "Pause when you finish. Sahayi will reply automatically.",
    cta: "End call",
  },
  transcribing: {
    eyebrow: "Transcribing",
    title: "Heard you",
    detail: "Turning your speech into text.",
    cta: "Transcribing",
  },
  thinking: {
    eyebrow: "Thinking",
    title: "Finding the answer",
    detail: "Checking routes, fares, schedules, and language context.",
    cta: "Thinking",
  },
  speaking: {
    eyebrow: "Speaking",
    title: "Sahayi is replying",
    detail: "The answer is on screen and playing as voice.",
    cta: "Speaking",
  },
  error: {
    eyebrow: "Needs attention",
    title: "Try again or use a demo prompt",
    detail: "Quick actions work even when microphone access is unavailable.",
    cta: "Retry mic",
  },
};

const MAX_RECORDING_MS = 25000;
const NO_SPEECH_TIMEOUT_MS = 9000;
const MIN_SPEECH_MS = 800;
const SILENCE_AFTER_SPEECH_MS = 1200;
const SPEECH_RMS_THRESHOLD = 0.025;

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function getTimestamp(): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function playBase64Audio(
  base64: string,
  contentType = "audio/wav",
  onAudio?: (audio: HTMLAudioElement) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(`data:${contentType};base64,${base64}`);
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    onAudio?.(audio);
    audio.onended = finish;
    audio.onpause = finish;
    audio.onerror = () => reject(new Error("Audio playback failed"));
    void audio.play().catch(reject);
  });
}

export default function VoiceAgent() {
  const [lastLanguage, setLastLanguage] = useState<Language | null>(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Turn[]>([]);

  const sessionIdRef = useRef(`browser-${Date.now()}`);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserFrameRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const callActiveRef = useRef(false);
  const discardRecordingRef = useRef(false);
  const hasHeardSpeechRef = useRef(false);
  const recordingStartedAtRef = useRef(0);

  const isBusy =
    voiceStatus === "transcribing" || voiceStatus === "thinking" || voiceStatus === "speaking";
  const statusCopy = STATUS_COPY[voiceStatus];

  const orbClassName = useMemo(() => {
    const classes = ["voice-orb", `voice-orb-${voiceStatus}`];
    if (isCallActive) classes.push("voice-orb-call-active");
    if (isBusy) classes.push("voice-orb-busy");
    return classes.join(" ");
  }, [isBusy, isCallActive, voiceStatus]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation, voiceStatus]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioContextRef.current?.close().catch(() => undefined);
      if (recordingTimeoutRef.current) {
        window.clearTimeout(recordingTimeoutRef.current);
      }
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
      }
      if (restartTimerRef.current) {
        window.clearTimeout(restartTimerRef.current);
      }
      if (analyserFrameRef.current) {
        window.cancelAnimationFrame(analyserFrameRef.current);
      }
    };
  }, []);

  const setCallActiveState = (active: boolean) => {
    callActiveRef.current = active;
    setIsCallActive(active);
  };

  const cleanupAudioMonitor = useCallback(() => {
    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (analyserFrameRef.current) {
      window.cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
  }, []);

  const stopListening = useCallback((options: StopOptions = {}) => {
    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    cleanupAudioMonitor();
    discardRecordingRef.current = Boolean(options.discard);

    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") {
      setVoiceStatus(options.nextStatus ?? "transcribing");
      recorder.stop();
    }
  }, [cleanupAudioMonitor]);

  const submitTurn = useCallback(
    async (payload: {
      audio?: Blob;
      text?: string;
      lang?: Language;
      intentType?: "route" | "fare" | "schedule";
      origin?: string;
      destination?: string;
      timeContext?: string;
      displayText?: string;
      continueAfterReply?: boolean;
    }) => {
      setError(null);
      setNotice(null);
      setVoiceStatus(payload.audio ? "transcribing" : "thinking");

      const formData = new FormData();
      formData.append("sessionId", sessionIdRef.current);
      if (payload.lang) {
        formData.append("language", payload.lang);
      }
      if (payload.text) {
        formData.append("text", payload.text);
      }
      if (payload.intentType) {
        formData.append("intentType", payload.intentType);
        if (payload.origin) formData.append("origin", payload.origin);
        if (payload.destination) formData.append("destination", payload.destination);
        if (payload.timeContext) formData.append("timeContext", payload.timeContext);
        formData.append("text", payload.displayText ?? payload.text ?? payload.intentType);
      }
      if (payload.audio) {
        formData.append("audio", payload.audio, "recording.webm");
        await delay(450);
        setVoiceStatus("thinking");
      }

      try {
        const response = await fetch("/api/voice/process-browser", {
          method: "POST",
          body: formData,
        });
        const result = (await response.json()) as ProcessBrowserResponse;

        if (!response.ok || !result.ok || !result.data) {
          throw new Error(result.error ?? "Voice processing failed");
        }

        const {
          transcript,
          responseText,
          detectedLanguage,
          audioBase64,
          contentType,
          sources,
          providers,
          route,
          error: pipelineError,
        } = result.data;

        if (transcript) {
          setConversation((prev) => [
            ...prev,
            { role: "user", text: transcript, language: detectedLanguage, time: getTimestamp() },
          ]);
        }

        setConversation((prev) => [
          ...prev,
          {
            role: "assistant",
            text: responseText,
            language: detectedLanguage,
            time: getTimestamp(),
            sources: sources?.slice(0, 3),
            routeMapUrl: route?.mapUrl,
            routeProvider: route?.provider,
            routeDistance: route?.localizedTotalDistance,
            routeDuration: route?.localizedTotalDuration,
          },
        ]);

        setLastLanguage(detectedLanguage);

        if (pipelineError) {
          setNotice("Text response shown. Voice service needs a valid Sarvam setup for audio.");
        }

        if (audioBase64) {
          setVoiceStatus("speaking");
          await playBase64Audio(audioBase64, contentType ?? "audio/wav", (audio) => {
            currentAudioRef.current = audio;
          });
          currentAudioRef.current = null;
        } else if (providers?.tts === "fallback") {
          setNotice("Text-only mode: add SARVAM_API_KEY in .env.local for spoken replies.");
        }

        if (payload.continueAfterReply && callActiveRef.current) {
          setVoiceStatus("idle");
          scheduleNextListen(550);
        } else {
          setVoiceStatus("idle");
        }
      } catch (err) {
        setVoiceStatus("error");
        setError(err instanceof Error ? err.message : "Something went wrong");
        if (payload.continueAfterReply) {
          setCallActiveState(false);
        }
      }
    },
    []
  );

  function scheduleNextListen(delayMs = 650) {
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
    }
    restartTimerRef.current = window.setTimeout(() => {
      if (callActiveRef.current) {
        void startListening();
      }
    }, delayMs);
  }

  function startSilenceMonitor(stream: MediaStream) {
    if (typeof AudioContext === "undefined") return;

    cleanupAudioMonitor();
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    const samples = new Uint8Array(analyser.fftSize);

    analyser.fftSize = 2048;
    source.connect(analyser);
    audioContextRef.current = audioContext;
    hasHeardSpeechRef.current = false;
    recordingStartedAtRef.current = Date.now();

    const monitor = () => {
      const recorder = mediaRecorderRef.current;
      if (!callActiveRef.current || recorder?.state !== "recording") return;

      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const centered = (samples[index] - 128) / 128;
        sum += centered * centered;
      }

      const rms = Math.sqrt(sum / samples.length);
      const elapsed = Date.now() - recordingStartedAtRef.current;

      if (rms > SPEECH_RMS_THRESHOLD) {
        hasHeardSpeechRef.current = true;
        if (silenceTimerRef.current) {
          window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      } else if (
        hasHeardSpeechRef.current &&
        elapsed > MIN_SPEECH_MS &&
        !silenceTimerRef.current
      ) {
        silenceTimerRef.current = window.setTimeout(() => {
          silenceTimerRef.current = null;
          stopListening();
        }, SILENCE_AFTER_SPEECH_MS);
      }

      if (!hasHeardSpeechRef.current && elapsed > NO_SPEECH_TIMEOUT_MS) {
        setNotice("I am still listening. Please speak a little closer to the microphone.");
        stopListening({ discard: true, nextStatus: "idle" });
        scheduleNextListen(900);
        return;
      }

      analyserFrameRef.current = window.requestAnimationFrame(monitor);
    };

    analyserFrameRef.current = window.requestAnimationFrame(monitor);
  }

  const startListening = async () => {
    setError(null);
    setNotice(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof MediaRecorder === "undefined") {
      setVoiceStatus("error");
      setError("Microphone recording is not supported in this browser. Use quick actions below.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      audioChunksRef.current = [];

      const mimeType = pickRecorderMime();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        cleanupAudioMonitor();
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;

        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          audioChunksRef.current = [];
          setVoiceStatus(callActiveRef.current ? "idle" : "idle");
          return;
        }

        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        audioChunksRef.current = [];

        if (blob.size > 0) {
          await submitTurn({ audio: blob, continueAfterReply: callActiveRef.current });
        } else {
          setVoiceStatus("error");
          setError("No audio captured. Tap the orb and speak clearly.");
          setCallActiveState(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setVoiceStatus("listening");
      startSilenceMonitor(stream);
      recordingTimeoutRef.current = window.setTimeout(() => {
        stopListening();
      }, MAX_RECORDING_MS);
    } catch {
      setVoiceStatus("error");
      setError("Microphone access was blocked. You can still use the quick demo prompts.");
      setCallActiveState(false);
    }
  };

  const endCall = () => {
    setCallActiveState(false);
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    if (voiceStatus === "listening") {
      stopListening({ discard: true, nextStatus: "idle" });
    } else {
      cleanupAudioMonitor();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setVoiceStatus("idle");
    }
    setNotice("Call ended. Tap the orb to start again.");
  };

  const handleOrbClick = () => {
    if (isCallActive) {
      endCall();
      return;
    }
    if (isBusy) return;
    setCallActiveState(true);
    void startListening();
  };

  const handleQuickAction = (prompt: (typeof QUICK_PROMPTS)[number]) => {
    if (isBusy || voiceStatus === "listening" || isCallActive) return;
    void submitTurn({
      lang: prompt.lang,
      intentType: prompt.intentType,
      origin: prompt.origin,
      destination: prompt.destination,
      timeContext: prompt.timeContext,
      displayText: prompt.displayText,
    });
  };

  return (
    <section className="voice-agent" aria-label="Yathra Sahayi voice assistant demo">
      <div className="hero-shell">
        <header className="voice-header">
          <p className="eyebrow">Kochi Metro helpline AI demo</p>
          <h1>യാത്ര സഹായി / Yathra Sahayi</h1>
          <p className="subtitle">Kochi Metro voice transit assistant</p>
          <p className="tagline">
            Speaks back in the same language it hears, with Malayalam-English switching across the call.
          </p>
        </header>

        <div className="language-signal" aria-live="polite">
          <span className="language-signal-dot" />
          <span>Auto language detection</span>
          <strong>
            {lastLanguage === "ml"
              ? "Replying in Malayalam"
              : lastLanguage === "en"
                ? "Replying in English"
                : "Malayalam / English"}
          </strong>
        </div>

        <div className="orb-stage">
          <button
            type="button"
            className={orbClassName}
            onClick={handleOrbClick}
            disabled={isBusy && !isCallActive}
            aria-pressed={isCallActive}
            aria-label={isCallActive ? "End live voice call" : "Start live voice call"}
          >
            <span className="orb-ring orb-ring-one" />
              <span className="orb-ring orb-ring-two" />
              <span className="orb-core">
                <span className="orb-mic" aria-hidden="true" />
              <span className="orb-text">{isCallActive ? "End call" : statusCopy.cta}</span>
              </span>
          </button>

          <div className="status-card" aria-live="polite">
            <span className="status-eyebrow">{statusCopy.eyebrow}</span>
            <h2>{statusCopy.title}</h2>
            <p>{statusCopy.detail}</p>
            <div className={isCallActive ? "call-state call-state-live" : "call-state"}>
              <span />
              {isCallActive ? "Live call active" : "One tap starts continuous listening"}
            </div>
            {voiceStatus === "listening" && (
              <div className="waveform" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={voiceStatus === "error" ? "demo-grid" : "demo-grid demo-grid-focused"}>
        <section className="conversation-card" aria-label="Conversation transcript">
          <div className="conversation-header">
            <div>
              <span className="section-kicker">Live transcript</span>
              <h2>Conversation flow</h2>
            </div>
            <span className={`status-pill status-pill-${voiceStatus}`}>{statusCopy.eyebrow}</span>
          </div>

          {error && <p className="voice-error">{error}</p>}
          {notice && <p className="voice-notice">{notice}</p>}

          <div className="conversation" aria-live="polite">
            {conversation.length === 0 && voiceStatus !== "listening" && (
              <div className="conversation-empty">
                <span>Try a natural question</span>
                <p>&quot;How do I go from Edapally to Kakkanad?&quot;</p>
              </div>
            )}

            {voiceStatus === "listening" && (
              <div className="listening-card">
                <span>Listening live</span>
                <p>Speak now. When you pause, Sahayi will answer automatically.</p>
              </div>
            )}

            {conversation.map((turn, index) => (
              <div
                key={`${turn.role}-${index}-${turn.time}`}
                className={turn.role === "user" ? "bubble user" : "bubble assistant"}
              >
                <span className="bubble-label">
                  {turn.role === "user" ? "You said" : "Sahayi replied"} · {turn.time}
                </span>
                <p>{turn.text}</p>
                {turn.role === "assistant" && turn.sources && turn.sources.length > 0 && (
                  <div className="bubble-sources" aria-label="Web search sources">
                    <span>Sources</span>
                    {turn.sources.map((source, sourceIndex) =>
                      source.url ? (
                        <a
                          key={`${source.url}-${sourceIndex}`}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {source.title}
                        </a>
                      ) : (
                        <small key={`${source.title}-${sourceIndex}`}>{source.title}</small>
                      )
                    )}
                  </div>
                )}
                {turn.role === "assistant" && turn.routeMapUrl && (
                  <div className="bubble-route-tools" aria-label="Route map">
                    <a href={turn.routeMapUrl} target="_blank" rel="noreferrer">
                      Open route map
                    </a>
                    <small>
                      {turn.routeProvider === "google" ? "Google Maps" : "Route"}
                      {turn.routeDuration ? ` · ${turn.routeDuration}` : ""}
                      {turn.routeDistance ? ` · ${turn.routeDistance}` : ""}
                    </small>
                  </div>
                )}
              </div>
            ))}
            <div ref={conversationEndRef} />
          </div>
        </section>

        {voiceStatus === "error" && (
          <aside className="quick-card" aria-label="Demo quick actions">
            <div className="quick-card-header">
              <span className="section-kicker">Fallback demos</span>
              <h2>Judge-ready prompts</h2>
            </div>
            <div className="quick-actions">
              {QUICK_PROMPTS.map((item) => (
                <button
                  key={item.displayText}
                  type="button"
                  className="quick-action"
                  disabled={isBusy || isCallActive}
                  onClick={() => handleQuickAction(item)}
                >
                  <span>{item.label} / {item.labelMl}</span>
                  <small>{item.displayText}</small>
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
