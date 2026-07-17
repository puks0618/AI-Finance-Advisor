"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The Web Speech API's recognition side is non-standard and absent from lib.dom.d.ts (only the
// result-shaped interfaces ship there), so the constructor and instance shape are declared here.
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

// `error` is one of a fixed set of DOM strings ("not-allowed", "no-speech", "network", etc.) —
// see startListening's onerror handler below for which ones get a distinct message.
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

/**
 * Thin wrapper around SpeechRecognition (speech-to-text) and SpeechSynthesis (text-to-speech).
 * Pure progressive enhancement: every capability is feature-detected, and callers must check the
 * `*Supported` flags before showing voice controls — the chat itself never depends on this.
 */
export function useSpeech() {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const [micSupported, setMicSupported] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Support can only be determined client-side (no `window` during SSR), so this runs post-mount.
  // Deferred to a microtask (matching the .then()-chained setState pattern used elsewhere in this
  // app) rather than calling setState synchronously in the effect body.
  useEffect(() => {
    Promise.resolve().then(() => {
      setMicSupported(!!(window.SpeechRecognition || window.webkitSpeechRecognition));
      setSpeechSupported("speechSynthesis" in window);
    });
  }, []);

  const startListening = useCallback((onResult: (text: string, isFinal: boolean) => void) => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor || listening) return;

    setError(null);
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) final += transcript;
        else interim += transcript;
      }
      if (final.trim()) {
        onResult(final.trim(), true);
      } else if (interim.trim()) {
        onResult(interim.trim(), false);
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "no-speech" and "aborted" are routine (the user just didn't say anything, or stopped it
      // themselves) — surfacing those as errors would be noise, not signal. Permission and
      // service failures are the ones that leave the mic button looking silently broken.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access was blocked — you can still type.");
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        setError("Voice input had a problem — you can still type.");
      }
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }, []);

  const cancelSpeech = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  // Stop any in-flight recognition/speech if the component using this hook unmounts.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  return { micSupported, speechSupported, listening, error, startListening, stopListening, speak, cancelSpeech };
}
