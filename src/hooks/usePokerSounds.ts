import { useCallback, useRef } from "react";
import { useSoundContext } from "@/context/SoundContext";

function getAudioCtx(): AudioContext | null {
  try {
    return new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  } catch { return null; }
}

function resumeCtx(ctx: AudioContext) {
  if (ctx.state === "suspended") ctx.resume();
}

function playTone(ctx: AudioContext, freq: number, type: OscillatorType, startTime: number, duration: number, gainPeak: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

export function usePokerSounds() {
  const ctxRef = useRef<AudioContext | null>(null);
  const { muted, volume, toggleMute, setVolume } = useSoundContext();

  const getCtx = useCallback((): AudioContext | null => {
    if (!ctxRef.current) ctxRef.current = getAudioCtx();
    if (ctxRef.current) resumeCtx(ctxRef.current);
    return ctxRef.current;
  }, []);

  const vol = volume / 100;

  const playDeal = useCallback(() => {
    if (muted) return;
    const ctx = getCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    playTone(ctx, 900, "sine", now, 0.08, 0.15 * vol);
    playTone(ctx, 1100, "sine", now + 0.04, 0.07, 0.06 * vol);
  }, [getCtx, muted, vol]);

  const playChip = useCallback(() => {
    if (muted) return;
    const ctx = getCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    playTone(ctx, 600, "triangle", now, 0.12, 0.2 * vol);
    playTone(ctx, 800, "triangle", now + 0.05, 0.06, 0.05 * vol);
  }, [getCtx, muted, vol]);

  const playWin = useCallback(() => {
    if (muted) return;
    const ctx = getCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    [523, 659, 784, 1047].forEach((freq, i) => {
      playTone(ctx, freq, "sine", now + i * 0.13, 0.25, 0.35 * vol);
    });
    playTone(ctx, 1047, "sine", now + 4 * 0.13, 0.5, 0.2 * vol);
  }, [getCtx, muted, vol]);

  const playLose = useCallback(() => {
    if (muted) return;
    const ctx = getCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    playTone(ctx, 400, "sawtooth", now, 0.18, 0.25 * vol);
    playTone(ctx, 300, "sawtooth", now + 0.18, 0.2, 0.25 * vol);
    playTone(ctx, 220, "sawtooth", now + 0.36, 0.25, 0.35 * vol);
  }, [getCtx, muted, vol]);

  const playFold = useCallback(() => {
    if (muted) return;
    const ctx = getCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    playTone(ctx, 350, "triangle", now, 0.18, 0.18 * vol);
    playTone(ctx, 280, "triangle", now + 0.12, 0.15, 0.2 * vol);
  }, [getCtx, muted, vol]);

  const playCheck = useCallback(() => {
    if (muted) return;
    const ctx = getCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    playTone(ctx, 700, "sine", now, 0.08, 0.12 * vol);
  }, [getCtx, muted, vol]);

  return { playDeal, playChip, playWin, playLose, playFold, playCheck, muted, toggleMute, volume, setVolume };
}
