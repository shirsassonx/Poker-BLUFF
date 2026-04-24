import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

const MUTE_KEY = "poker_muted";
const VOLUME_KEY = "poker_volume";

interface SoundContextValue {
  muted: boolean;
  volume: number;
  toggleMute: () => void;
  setVolume: (v: number) => void;
}

const SoundContext = createContext<SoundContextValue | null>(null);

export function SoundProvider({ children }: { children: ReactNode }) {
  const [muted, setMuted] = useState<boolean>(() => {
    try { return localStorage.getItem(MUTE_KEY) === "true"; } catch { return false; }
  });
  const [volume, setVolumeState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(VOLUME_KEY);
      if (stored !== null) { const n = Number(stored); if (!isNaN(n)) return Math.min(100, Math.max(0, n)); }
    } catch {}
    return 75;
  });
  const toggleMute = useCallback(() => {
    setMuted(prev => { const next = !prev; try { localStorage.setItem(MUTE_KEY, String(next)); } catch {} return next; });
  }, []);
  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(100, Math.max(0, Math.round(v)));
    setVolumeState(clamped);
    try { localStorage.setItem(VOLUME_KEY, String(clamped)); } catch {}
  }, []);
  return <SoundContext.Provider value={{ muted, volume, toggleMute, setVolume }}>{children}</SoundContext.Provider>;
}

export function useSoundContext(): SoundContextValue {
  const ctx = useContext(SoundContext);
  if (!ctx) throw new Error("useSoundContext must be used within a SoundProvider");
  return ctx;
}
