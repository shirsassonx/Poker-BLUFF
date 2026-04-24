import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { usePokerSounds } from "../hooks/usePokerSounds";

// ── Types ─────────────────────────────────────────────────────────────────────
type Suit = "♠" | "♥" | "♦" | "♣";
type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A";
interface Card {
  suit: Suit;
  rank: Rank;
  value: number;
}
type Phase = "idle" | "preflop" | "flop" | "turn" | "river" | "showdown";
type BotAction = "fold" | "check" | "call" | "raise";
interface PendingRaise {
  toCall: number;
  pot: number;
  botChips: number;
  ptr: number;
  d: Card[];
  fromPhase: Phase;
}

// ── Deck ──────────────────────────────────────────────────────────────────────
const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS: { rank: Rank; value: number }[] = [
  { rank: "2", value: 2 },
  { rank: "3", value: 3 },
  { rank: "4", value: 4 },
  { rank: "5", value: 5 },
  { rank: "6", value: 6 },
  { rank: "7", value: 7 },
  { rank: "8", value: 8 },
  { rank: "9", value: 9 },
  { rank: "10", value: 10 },
  { rank: "J", value: 11 },
  { rank: "Q", value: 12 },
  { rank: "K", value: 13 },
  { rank: "A", value: 14 },
];
const RED: Suit[] = ["♥", "♦"];
const INITIAL_CHIPS = 2000;
const BIG_BLIND = 20;
const SMALL_BLIND = 10;

function buildDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    RANKS.map(({ rank, value }) => ({ suit, rank, value })),
  );
}
function shuffle(d: Card[]): Card[] {
  const a = [...d];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Hand evaluator ────────────────────────────────────────────────────────────
function combos5(arr: Card[]): Card[][] {
  if (arr.length < 5) return [];
  if (arr.length === 5) return [arr];
  const out: Card[][] = [];
  for (let i = 0; i < arr.length - 4; i++)
    for (let j = i + 1; j < arr.length - 3; j++)
      for (let k = j + 1; k < arr.length - 2; k++)
        for (let l = k + 1; l < arr.length - 1; l++)
          for (let m = l + 1; m < arr.length; m++)
            out.push([arr[i], arr[j], arr[k], arr[l], arr[m]]);
  return out;
}
interface HandResult {
  rank: number;
  name: string;
  tb: number[];
}
function evalHand(c: Card[]): HandResult {
  const vals = c.map((x) => x.value).sort((a, b) => b - a);
  const suits = c.map((x) => x.suit);
  const vc: Record<number, number> = {};
  vals.forEach((v) => (vc[v] = (vc[v] ?? 0) + 1));
  const cnts = Object.values(vc).sort((a, b) => b - a);
  const uv = [...new Set(vals)].sort((a, b) => b - a);
  const flush = suits.every((s) => s === suits[0]);
  const str = uv.length === 5 && uv[0] - uv[4] === 4;
  const wheel = JSON.stringify(uv) === JSON.stringify([14, 5, 4, 3, 2]);
  if (flush && (str || wheel))
    return {
      rank: 8,
      name: "STRAIGHT FLUSH",
      tb: wheel ? [5, 4, 3, 2, 1] : vals,
    };
  if (cnts[0] === 4) return { rank: 7, name: "FOUR OF A KIND", tb: vals };
  if (cnts[0] === 3 && cnts[1] === 2)
    return { rank: 6, name: "FULL HOUSE", tb: vals };
  if (flush) return { rank: 5, name: "FLUSH", tb: vals };
  if (str || wheel)
    return { rank: 4, name: "STRAIGHT", tb: wheel ? [5, 4, 3, 2, 1] : vals };
  if (cnts[0] === 3) return { rank: 3, name: "THREE OF A KIND", tb: vals };
  if (cnts[0] === 2 && cnts[1] === 2)
    return { rank: 2, name: "TWO PAIR", tb: vals };
  if (cnts[0] === 2) return { rank: 1, name: "PAIR", tb: vals };
  return { rank: 0, name: "HIGH CARD", tb: vals };
}
function best7(cards: Card[]): HandResult {
  const cs = combos5(cards);
  if (!cs.length) return evalHand(cards.slice(0, 5));
  let best = evalHand(cs[0]);
  for (const c of cs.slice(1)) {
    const h = evalHand(c);
    if (h.rank > best.rank) {
      best = h;
      continue;
    }
    if (h.rank === best.rank) {
      for (let i = 0; i < h.tb.length; i++) {
        if (h.tb[i] > best.tb[i]) {
          best = h;
          break;
        }
        if (h.tb[i] < best.tb[i]) break;
      }
    }
  }
  return best;
}
function getBestCards(hand: Card[], community: Card[]): Card[] {
  const all = [...hand, ...community];
  const cs = combos5(all);
  if (!cs.length) return all.slice(0, 5);
  let bestRes = evalHand(cs[0]),
    bestCards = cs[0];
  for (const combo of cs.slice(1)) {
    const h = evalHand(combo);
    if (h.rank > bestRes.rank) {
      bestRes = h;
      bestCards = combo;
      continue;
    }
    if (h.rank === bestRes.rank) {
      for (let i = 0; i < h.tb.length; i++) {
        if (h.tb[i] > bestRes.tb[i]) {
          bestRes = h;
          bestCards = combo;
          break;
        }
        if (h.tb[i] < bestRes.tb[i]) break;
      }
    }
  }
  return bestCards;
}
const cardKey = (c: Card) => c.rank + c.suit;

function compareHands(
  p: Card[],
  b: Card[],
  com: Card[],
): "player" | "bot" | "tie" {
  const ph = best7([...p, ...com]),
    bh = best7([...b, ...com]);
  if (ph.rank > bh.rank) return "player";
  if (bh.rank > ph.rank) return "bot";
  for (let i = 0; i < ph.tb.length; i++) {
    if (ph.tb[i] > bh.tb[i]) return "player";
    if (bh.tb[i] > ph.tb[i]) return "bot";
  }
  return "tie";
}

// ── Bot AI ────────────────────────────────────────────────────────────────────
function botDecide(
  pot: number,
  toCall: number,
  chips: number,
): { action: BotAction; amount: number } {
  const r = Math.random();
  if (r < 0.12 && toCall > 0) return { action: "fold", amount: 0 };
  if (r < 0.35 && toCall === 0) return { action: "check", amount: 0 };
  if (r < 0.7)
    return {
      action: "call",
      amount: Math.min(Math.max(toCall, BIG_BLIND), chips),
    };
  const minRaise = Math.max(toCall * 2, BIG_BLIND * 2);
  const raise = Math.min(Math.max(minRaise, Math.floor(pot * 0.5)), chips);
  if (raise <= 0 || chips <= toCall)
    return { action: "call", amount: Math.min(toCall, chips) };
  return { action: "raise", amount: raise };
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Orbitron:wght@700;900&display=swap');

* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

@keyframes dealCard {
  0%   { transform: translateY(-40px) scale(0.8) rotate(-4deg); opacity: 0; }
  70%  { transform: translateY(3px) scale(1.03) rotate(0.5deg); opacity: 1; }
  100% { transform: translateY(0) scale(1) rotate(0deg); opacity: 1; }
}
@keyframes flipCard {
  0%   { transform: rotateY(90deg) scale(0.85); opacity: 0; }
  55%  { transform: rotateY(-5deg) scale(1.04); opacity: 1; }
  100% { transform: rotateY(0deg) scale(1); opacity: 1; }
}
@keyframes winGlow {
  0%,100% { box-shadow: 0 2px 12px rgba(0,0,0,0.3), 0 0 14px rgba(245,195,24,0.9), 0 0 30px rgba(245,195,24,0.5); }
  50%     { box-shadow: 0 2px 12px rgba(0,0,0,0.3), 0 0 26px rgba(245,195,24,1),   0 0 52px rgba(245,195,24,0.7); }
}
@keyframes stepReveal {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes popIn {
  0%   { transform: translate(-50%,-50%) scale(0.75); opacity: 0; }
  65%  { transform: translate(-50%,-50%) scale(1.06); opacity: 1; }
  100% { transform: translate(-50%,-50%) scale(1); opacity: 1; }
}
@keyframes slideUp {
  0%   { transform: translateY(100%); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}
@keyframes confettiFall {
  0%   { transform: translateY(-10px) rotate(0deg); opacity: 1; }
  100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
}
@keyframes pulse {
  0%,100% { opacity: 1; }
  50%     { opacity: 0.65; }
}
@keyframes allInFlash {
  0%,100% { box-shadow: 0 0 8px #f5c318, 0 0 18px rgba(245,195,24,0.5); }
  50%     { box-shadow: 0 0 20px #f5c318, 0 0 40px rgba(245,195,24,0.8); }
}
@keyframes chipFly {
  0%   { transform: translate(-50%, 0) scale(1); opacity: 1; }
  80%  { transform: translate(-50%, -120px) scale(0.5); opacity: 0.8; }
  100% { transform: translate(-50%, -150px) scale(0.2); opacity: 0; }
}
@keyframes gpulse {
  0%,100% { box-shadow: 0 0 0 2px #f5c318, 0 0 18px #ffaa00; }
  50%     { box-shadow: 0 0 0 2px #f5c318, 0 0 32px #ffaa00, 0 0 50px rgba(255,170,0,0.3); }
}
@keyframes revealIn {
  0%   { opacity: 0; transform: translateY(4px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes ytpulse {
  0%,100% { text-shadow: 0 0 6px rgba(0,229,212,0.3); }
  50%     { text-shadow: 0 0 16px rgba(0,229,212,0.9), 0 0 30px rgba(0,229,212,0.5); }
}
@keyframes popAction {
  from { transform: scale(0.7); opacity: 0; }
  to   { transform: scale(1);   opacity: 1; }
}

.deal      { animation: dealCard 0.32s cubic-bezier(.25,.46,.45,.94) both; }
.flip      { animation: flipCard 0.38s cubic-bezier(.25,.46,.45,.94) both; }
.pop-in    { animation: popIn 0.35s cubic-bezier(.25,.46,.45,.94) both; }
.chip-fly  { animation: chipFly 0.42s ease forwards; }
.win-card {
  background: rgba(255, 215, 0, 0.07) !important;
  border: 1.5px solid rgba(245, 195, 24, 0.85) !important;
  box-shadow: none !important;
}
.win-card-dim {
  opacity: 0.32 !important;
  filter: grayscale(35%) !important;
  transition: opacity 0.25s ease, filter 0.25s ease;
}
.step-reveal { animation: stepReveal 0.22s ease both; }
.reveal-in { animation: revealIn 0.3s ease both; }
.yt-anim   { animation: ytpulse 1.2s ease-in-out infinite; }
.pop-action{ animation: popAction 0.25s ease both; }

input[type=range] {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, #9b30ff var(--pct,50%), rgba(255,255,255,0.15) var(--pct,50%));
  cursor: pointer;
  width: 100%;
}
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: radial-gradient(circle, #c060ff, #9b30ff);
  box-shadow: 0 0 10px rgba(155,48,255,0.8);
  cursor: pointer;
}
input[type=range]::-moz-range-thumb {
  width: 20px; height: 20px;
  border-radius: 50%;
  background: radial-gradient(circle, #c060ff, #9b30ff);
  box-shadow: 0 0 10px rgba(155,48,255,0.8);
  cursor: pointer;
  border: none;
}
`;

// ── Card Face ─────────────────────────────────────────────────────────────────
function CardFace({
  card,
  size = "md",
  delay = 0,
  flip = false,
  highlight = false,
  dimmed = false,
}: {
  card: Card;
  size?: "sm" | "md" | "lg" | "xl" | "sdp" | "sdb";
  delay?: number;
  flip?: boolean;
  highlight?: boolean;
  dimmed?: boolean;
}) {
  const isRed = RED.includes(card.suit);
  const color = isRed ? "#c0021a" : "#0d0d1a";
  const dim =
    size === "xl"
      ? { w: 68, h: 96, corner: 17, suit: 13, center: 36, r: 8 }
      : size === "lg"
        ? { w: 52, h: 74, corner: 13, suit: 11, center: 28, r: 7 }
        : size === "sdp"
          ? { w: 48, h: 70, corner: 12, suit: 9, center: 25, r: 6 }
          : size === "sdb"
            ? { w: 42, h: 60, corner: 10, suit: 8, center: 22, r: 5 }
            : size === "sm"
              ? { w: 38, h: 54, corner: 10, suit: 8, center: 20, r: 5 }
              : { w: 46, h: 64, corner: 12, suit: 10, center: 24, r: 6 };
  return (
    <div
      className={`${flip ? "flip" : "deal"}${highlight ? " win-card" : ""}${dimmed ? " win-card-dim" : ""}`}
      style={{
        width: dim.w,
        height: dim.h,
        flexShrink: 0,
        background: "linear-gradient(160deg,#ffffff 0%,#f5f0e8 100%)",
        borderRadius: dim.r,
        border: highlight
          ? "1.5px solid rgba(245, 195, 24, 0.85)"
          : dimmed
            ? "1.5px solid rgba(0,0,0,0.08)"
            : "1.5px solid #ccc8be",
        boxShadow: highlight
          ? "none"
          : dimmed
            ? "none"
            : "0 4px 14px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.3)",
        position: "relative",
        animationDelay: `${delay}s`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 3,
          left: 4,
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        <div
          style={{
            fontSize: dim.corner,
            fontWeight: 700,
            color,
            fontFamily: "Rajdhani,sans-serif",
            letterSpacing: -0.5,
          }}
        >
          {card.rank}
        </div>
        <div style={{ fontSize: dim.suit, color, lineHeight: 1 }}>
          {card.suit}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: dim.center,
          color,
          userSelect: "none",
          lineHeight: 1,
        }}
      >
        {card.suit}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 3,
          right: 4,
          transform: "rotate(180deg)",
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        <div
          style={{
            fontSize: dim.corner,
            fontWeight: 700,
            color,
            fontFamily: "Rajdhani,sans-serif",
            letterSpacing: -0.5,
          }}
        >
          {card.rank}
        </div>
        <div style={{ fontSize: dim.suit, color, lineHeight: 1 }}>
          {card.suit}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "40%",
          background:
            "linear-gradient(180deg,rgba(255,255,255,0.55) 0%,transparent 100%)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function CardBack({
  size = "md",
}: {
  size?: "sm" | "md" | "lg" | "xl" | "sdp" | "sdb";
}) {
  const dim =
    size === "xl"
      ? { w: 68, h: 96, r: 8 }
      : size === "lg"
        ? { w: 52, h: 74, r: 7 }
        : size === "sdp"
          ? { w: 48, h: 70, r: 6 }
          : size === "sdb"
            ? { w: 42, h: 60, r: 5 }
            : size === "sm"
              ? { w: 38, h: 54, r: 5 }
              : { w: 46, h: 64, r: 6 };
  return (
    <div
      className="deal"
      style={{
        width: dim.w,
        height: dim.h,
        flexShrink: 0,
        background:
          "linear-gradient(145deg,#1e2a5e 0%,#0d1a3e 55%,#1e2a5e 100%)",
        borderRadius: dim.r,
        border: "2px solid rgba(155,48,255,0.4)",
        boxShadow: "0 3px 10px rgba(0,0,0,0.6)",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "repeating-linear-gradient(45deg,rgba(255,255,255,0.03) 0,rgba(255,255,255,0.03) 2px,transparent 2px,transparent 9px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 4,
          border: "1px solid rgba(155,48,255,0.2)",
          borderRadius: dim.r - 2,
        }}
      />
      <span style={{ fontSize: 20, opacity: 0.15, color: "#fff" }}>♠</span>
    </div>
  );
}

function EmptySlot({
  size = "md",
}: {
  size?: "sm" | "md" | "lg" | "xl" | "sdp" | "sdb";
}) {
  const dim =
    size === "xl"
      ? { w: 68, h: 96, r: 8 }
      : size === "lg"
        ? { w: 52, h: 74, r: 7 }
        : size === "sdp"
          ? { w: 48, h: 70, r: 6 }
          : size === "sdb"
            ? { w: 42, h: 60, r: 5 }
            : size === "sm"
              ? { w: 38, h: 54, r: 5 }
              : { w: 46, h: 64, r: 6 };
  return (
    <div
      style={{
        width: dim.w,
        height: dim.h,
        border: "1.5px dashed rgba(255,255,255,0.1)",
        borderRadius: dim.r,
        background: "rgba(0,0,0,0.1)",
      }}
    />
  );
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function Confetti() {
  const COLS = [
    "#f5c318",
    "#27ae60",
    "#e74c3c",
    "#3498db",
    "#9b59b6",
    "#1abc9c",
    "#fff",
    "#ff6b35",
  ];
  const pieces = Array.from({ length: 32 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 1.4,
    dur: 1.8 + Math.random() * 1.6,
    size: 5 + Math.random() * 8,
    color: COLS[Math.floor(Math.random() * COLS.length)],
    round: Math.random() > 0.5 ? "50%" : "2px",
  }));
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9990,
        overflow: "hidden",
      }}
    >
      {pieces.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            left: `${p.left}%`,
            top: -12,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.round,
            animation: `confettiFall ${p.dur}s ${p.delay}s ease-in forwards`,
          }}
        />
      ))}
    </div>
  );
}

// ── Result Overlay ────────────────────────────────────────────────────────────
function ResultOverlay({
  winner,
  message,
  potWon,
  onClose,
}: {
  winner: "player" | "bot" | "tie";
  message: string;
  potWon: number;
  onClose: () => void;
}) {
  const isWin = winner === "player",
    isTie = winner === "tie";
  const accent = isWin ? "#27ae60" : isTie ? "#3498db" : "#e63946";
  const bg = isWin
    ? "linear-gradient(145deg,#0d2e1a,#1a4a2a)"
    : isTie
      ? "linear-gradient(145deg,#0d1e3a,#1a2e50)"
      : "linear-gradient(145deg,#2a0d0d,#3d1515)";
  return (
    <>
      {isWin && <Confetti />}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9991,
          background: "rgba(0,0,0,0.82)",
          backdropFilter: "blur(6px)",
        }}
      />
      <div
        className="pop-in"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          zIndex: 9999,
          width: "min(90vw,320px)",
          background: bg,
          border: `2.5px solid ${accent}`,
          borderRadius: 18,
          padding: "30px 22px 24px",
          textAlign: "center",
          boxShadow: `0 24px 64px rgba(0,0,0,0.6),0 0 40px ${accent}44`,
        }}
      >
        <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 12 }}>
          {isWin ? "🏆" : isTie ? "🤝" : "💀"}
        </div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 900,
            letterSpacing: 3,
            color: accent,
            fontFamily: "Orbitron,sans-serif",
            textShadow: `0 0 20px ${accent}99`,
            marginBottom: 8,
          }}
        >
          {isWin ? "YOU WIN!" : isTie ? "TIE" : "BOT WINS"}
        </div>
        {isWin && potWon > 0 && (
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "#f5c318",
              marginBottom: 8,
              animation: "pulse 0.8s ease infinite",
              textShadow: "0 0 12px rgba(245,195,24,0.8)",
              fontFamily: "Orbitron,sans-serif",
            }}
          >
            +{potWon.toLocaleString()}
          </div>
        )}
        <div
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.72)",
            marginBottom: 22,
            lineHeight: 1.6,
            padding: "0 8px",
            fontFamily: "Rajdhani,sans-serif",
          }}
        >
          {message}
        </div>
        <button
          onClick={onClose}
          style={{
            width: "100%",
            padding: "14px 0",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 2,
            color: "#fff",
            background: `linear-gradient(135deg,${accent}cc,${accent})`,
            border: "none",
            borderRadius: 12,
            cursor: "pointer",
            fontFamily: "Rajdhani,sans-serif",
            boxShadow: `0 6px 20px ${accent}66`,
          }}
        >
          CONTINUE ▶
        </button>
      </div>
    </>
  );
}

// ── Hand Name Badge ───────────────────────────────────────────────────────────
function HandBadge({
  name,
  winner = false,
}: {
  name: string;
  winner?: boolean;
}) {
  return (
    <div
      className="reveal-in"
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "3px 12px",
        background: winner ? "rgba(245,195,24,0.18)" : "rgba(0,229,212,0.12)",
        border: `1px solid ${winner ? "rgba(245,195,24,0.6)" : "rgba(0,229,212,0.35)"}`,
        color: winner ? "#f5c318" : "#00e5d4",
        borderRadius: 10,
        letterSpacing: 1,
        fontFamily: "Rajdhani,sans-serif",
        textShadow: winner ? "0 0 8px rgba(245,195,24,0.7)" : "none",
        boxShadow: winner ? "0 0 10px rgba(245,195,24,0.3)" : "none",
      }}
    >
      {name}
    </div>
  );
}

// ── Hand description helpers ───────────────────────────────────────────────────
function rankNameSingular(v: number): string {
  const n: Record<number, string> = {
    2: "Two",
    3: "Three",
    4: "Four",
    5: "Five",
    6: "Six",
    7: "Seven",
    8: "Eight",
    9: "Nine",
    10: "Ten",
    11: "Jack",
    12: "Queen",
    13: "King",
    14: "Ace",
  };
  return n[v] ?? String(v);
}
function rankNamePlural(v: number): string {
  const n: Record<number, string> = {
    2: "Twos",
    3: "Threes",
    4: "Fours",
    5: "Fives",
    6: "Sixes",
    7: "Sevens",
    8: "Eights",
    9: "Nines",
    10: "Tens",
    11: "Jacks",
    12: "Queens",
    13: "Kings",
    14: "Aces",
  };
  return n[v] ?? String(v);
}
function describeKicker(result: HandResult, bestCards: Card[]): string {
  const vals = bestCards.map((c) => c.value);
  const vc: Record<number, number> = {};
  vals.forEach((v) => (vc[v] = (vc[v] ?? 0) + 1));
  const pairs = Object.entries(vc)
    .filter(([, c]) => c === 2)
    .map(([v]) => Number(v))
    .sort((a, b) => b - a);
  const tripVal = Number(Object.entries(vc).find(([, c]) => c === 3)?.[0] ?? 0);
  const quadVal = Number(Object.entries(vc).find(([, c]) => c === 4)?.[0] ?? 0);
  switch (result.name) {
    case "PAIR": {
      const k = vals.filter((v) => v !== pairs[0]).sort((a, b) => b - a);
      return k.length ? `kicker: ${rankNameSingular(k[0])}` : "";
    }
    case "TWO PAIR": {
      const k = vals.filter((v) => !pairs.includes(v)).sort((a, b) => b - a);
      return k.length ? `kicker: ${rankNameSingular(k[0])}` : "";
    }
    case "THREE OF A KIND": {
      const k = vals.filter((v) => v !== tripVal).sort((a, b) => b - a);
      return k.length >= 2
        ? `kickers: ${rankNameSingular(k[0])}, ${rankNameSingular(k[1])}`
        : "";
    }
    case "FOUR OF A KIND": {
      const k = vals.filter((v) => v !== quadVal).sort((a, b) => b - a);
      return k.length ? `kicker: ${rankNameSingular(k[0])}` : "";
    }
    default:
      return "";
  }
}
function describeHandCombo(result: HandResult, bestCards: Card[]): string {
  const vals = bestCards.map((c) => c.value);
  const vc: Record<number, number> = {};
  vals.forEach((v) => (vc[v] = (vc[v] ?? 0) + 1));
  const pairs = Object.entries(vc)
    .filter(([, c]) => c === 2)
    .map(([v]) => Number(v))
    .sort((a, b) => b - a);
  const trips = Object.entries(vc)
    .filter(([, c]) => c === 3)
    .map(([v]) => Number(v));
  const quads = Object.entries(vc)
    .filter(([, c]) => c === 4)
    .map(([v]) => Number(v));
  const sorted = [...vals].sort((a, b) => a - b);
  switch (result.name) {
    case "HIGH CARD":
      return rankNameSingular(Math.max(...vals));
    case "PAIR":
      return rankNamePlural(pairs[0]);
    case "TWO PAIR":
      return `${rankNamePlural(pairs[0])} + ${rankNamePlural(pairs[1])}`;
    case "THREE OF A KIND":
      return rankNamePlural(trips[0]);
    case "STRAIGHT":
      return `${rankNameSingular(sorted[0])} to ${rankNameSingular(sorted[4])}`;
    case "FLUSH":
      return `${bestCards[0].suit} Flush`;
    case "FULL HOUSE":
      return `${rankNamePlural(trips[0])} full of ${rankNamePlural(pairs[0])}`;
    case "FOUR OF A KIND":
      return rankNamePlural(quads[0]);
    case "STRAIGHT FLUSH":
      return `${rankNameSingular(sorted[0])} to ${rankNameSingular(sorted[4])}`;
    default:
      return "";
  }
}

// ── Showdown Panel ─────────────────────────────────────────────────────────────
function ShowdownPanel({
  step,
  winner,
  handName,
  botHandName,
  playerDesc,
  botDesc,
  playerKicker,
  botKicker,
  potWon,
  onContinue,
  onReload,
  needsReload,
}: {
  step: number;
  winner: string;
  handName: string;
  botHandName: string;
  playerDesc: string;
  botDesc: string;
  playerKicker: string;
  botKicker: string;
  potWon: number;
  onContinue: () => void;
  onReload: () => void;
  needsReload: boolean;
}) {
  const isWin = winner === "player",
    isTie = winner === "tie";
  const resultColor = isWin ? "#27ae60" : isTie ? "#4dc3ff" : "#e63946";
  const resultText = isWin ? "YOU WIN" : isTie ? "DRAW" : "BOT WINS";
  const resultEmoji = isWin ? "🏆" : isTie ? "🤝" : "💀";

  return (
    <div
      style={{
        padding: "8px 14px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 7,
      }}
    >
      {/* Two-column hand comparison */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 24px 1fr",
          gap: 4,
          alignItems: "start",
        }}
      >
        {/* YOU */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 8,
            padding: "6px 8px",
            border:
              step >= 4
                ? "1px solid rgba(245,195,24,0.2)"
                : "1px solid transparent",
          }}
        >
          <div
            style={{
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: 2,
              color: "rgba(255,255,255,0.4)",
            }}
          >
            YOU
          </div>
          {step >= 4 ? (
            <div className="step-reveal">
              <div
                style={{
                  fontFamily: "Orbitron,sans-serif",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#f5c318",
                  lineHeight: 1.3,
                }}
              >
                {handName}
              </div>
              {playerDesc && (
                <div
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.75)",
                    fontFamily: "Rajdhani,sans-serif",
                    fontWeight: 600,
                    lineHeight: 1.2,
                  }}
                >
                  {playerDesc}
                </div>
              )}
              {playerKicker && (
                <div
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.4)",
                    fontFamily: "Rajdhani,sans-serif",
                    fontWeight: 600,
                    fontStyle: "italic",
                  }}
                >
                  {playerKicker}
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.18)",
                fontFamily: "Rajdhani,sans-serif",
                marginTop: 2,
              }}
            >
              —
            </div>
          )}
        </div>

        {/* VS */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: 10,
          }}
        >
          <div
            style={{
              fontFamily: "Orbitron,sans-serif",
              fontSize: 8,
              fontWeight: 700,
              color: "rgba(255,255,255,0.2)",
              letterSpacing: 1,
            }}
          >
            VS
          </div>
        </div>

        {/* BOT */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 8,
            padding: "6px 8px",
            border:
              step >= 7
                ? "1px solid rgba(155,48,255,0.25)"
                : "1px solid transparent",
          }}
        >
          <div
            style={{
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: 2,
              color: "rgba(255,255,255,0.4)",
            }}
          >
            BOT
          </div>
          {step >= 7 ? (
            <div className="step-reveal">
              <div
                style={{
                  fontFamily: "Orbitron,sans-serif",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#9b30ff",
                  lineHeight: 1.3,
                }}
              >
                {botHandName}
              </div>
              {botDesc && (
                <div
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.75)",
                    fontFamily: "Rajdhani,sans-serif",
                    fontWeight: 600,
                    lineHeight: 1.2,
                  }}
                >
                  {botDesc}
                </div>
              )}
              {botKicker && (
                <div
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.4)",
                    fontFamily: "Rajdhani,sans-serif",
                    fontWeight: 600,
                    fontStyle: "italic",
                  }}
                >
                  {botKicker}
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.18)",
                fontFamily: "Rajdhani,sans-serif",
                marginTop: 2,
              }}
            >
              —
            </div>
          )}
        </div>
      </div>

      {/* Final result + button */}
      {step >= 8 ? (
        <div
          className="step-reveal"
          style={{ display: "flex", flexDirection: "column", gap: 7 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "7px 0",
              borderTop: `1px solid ${resultColor}33`,
              borderBottom: `1px solid ${resultColor}33`,
            }}
          >
            <span style={{ fontSize: 20 }}>{resultEmoji}</span>
            <div>
              <div
                style={{
                  fontFamily: "Orbitron,sans-serif",
                  fontSize: 17,
                  fontWeight: 900,
                  color: resultColor,
                  letterSpacing: 2,
                  lineHeight: 1,
                }}
              >
                {resultText}
              </div>
              {isWin && potWon > 0 && (
                <div
                  style={{
                    fontFamily: "Orbitron,sans-serif",
                    fontSize: 11,
                    color: "#f5c318",
                    fontWeight: 700,
                    marginTop: 1,
                  }}
                >
                  +{potWon.toLocaleString()}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {needsReload && (
              <button
                onClick={onReload}
                style={{
                  flex: 1,
                  height: 44,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#fff",
                  background: "#27ae60",
                  border: "none",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontFamily: "Rajdhani,sans-serif",
                  letterSpacing: 1,
                }}
              >
                💰 BUY CHIPS
              </button>
            )}
            <button
              onClick={onContinue}
              disabled={needsReload}
              style={{
                flex: 2,
                height: 44,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 2,
                color: needsReload ? "rgba(255,255,255,0.3)" : "#fff",
                background: needsReload
                  ? "rgba(255,255,255,0.05)"
                  : "linear-gradient(135deg,#00c4d4,#00e5d4)",
                border: "none",
                borderRadius: 10,
                cursor: needsReload ? "not-allowed" : "pointer",
                fontFamily: "Rajdhani,sans-serif",
                boxShadow: needsReload
                  ? "none"
                  : "0 4px 16px rgba(0,229,212,0.4)",
              }}
            >
              🃏 DEAL NEXT HAND
            </button>
          </div>
        </div>
      ) : (
        <div style={{ height: 51 }} />
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function HoldemTable() {
  const [, navigate] = useLocation();

  const cssRef = useRef(false);
  if (!cssRef.current) {
    cssRef.current = true;
    const el = document.createElement("style");
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  const sounds = usePokerSounds();
  const { muted, toggleMute } = sounds;

  const haptic = (style: "light" | "medium" | "heavy" = "light") => {
    try {
      (window as any).Telegram?.WebApp?.hapticFeedback?.impactOccurred(style);
    } catch {}
  };
  const hapticNotify = (type: "success" | "error" | "warning") => {
    try {
      (window as any).Telegram?.WebApp?.hapticFeedback?.notificationOccurred(
        type,
      );
    } catch {}
  };

  const [deck, setDeck] = useState<Card[]>([]);
  const [playerHand, setPlayerHand] = useState<Card[]>([]);
  const [botHand, setBotHand] = useState<Card[]>([]);
  const [community, setCommunity] = useState<Card[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [deckPtr, setDeckPtr] = useState(0);
  const [playerChips, setPlayerChips] = useState(INITIAL_CHIPS);
  const [botChips, setBotChips] = useState(INITIAL_CHIPS);
  const [pot, setPot] = useState(0);
  const [currentBet, setCurrentBet] = useState(0);
  const [betInput, setBetInput] = useState(BIG_BLIND * 2);
  const [handName, setHandName] = useState("");
  const [botHandName, setBotHandName] = useState("");
  const [message, setMessage] = useState("Press DEAL to start");
  const [botFolded, setBotFolded] = useState(false);
  const [botActionLabel, setBotActionLabel] = useState("");
  const [showdown, setShowdown] = useState(false);
  const [winner, setWinner] = useState<"player" | "bot" | "tie" | "">("");
  const [overlay, setOverlay] = useState(false);
  const [overlayMsg, setOverlayMsg] = useState("");
  const [potWon, setPotWon] = useState(0);
  const [playerWinKeys, setPlayerWinKeys] = useState<Set<string>>(new Set());
  const [botWinKeys, setBotWinKeys] = useState<Set<string>>(new Set());
  const [pendingBotRaise, setPendingBotRaise] = useState<PendingRaise | null>(
    null,
  );
  const [flyingChips, setFlyingChips] = useState<{ id: number }[]>([]);
  const [showdownStep, setShowdownStep] = useState(0);
  const [playerHandDesc, setPlayerHandDesc] = useState("");
  const [botHandDesc, setBotHandDesc] = useState("");
  const [playerHandKicker, setPlayerHandKicker] = useState("");
  const [botHandKicker, setBotHandKicker] = useState("");

  const chipIdRef = useRef(0);
  const [tgId, setTgId] = useState<number | null>(null);
  const peakPlayerChips = useRef(INITIAL_CHIPS);
  const peakBotChips = useRef(INITIAL_CHIPS);
  const allInAutoRef = useRef("");

  useEffect(() => {
    peakPlayerChips.current = Math.max(peakPlayerChips.current, playerChips);
  }, [playerChips]);
  useEffect(() => {
    peakBotChips.current = Math.max(peakBotChips.current, botChips);
  }, [botChips]);

  const spawnChip = useCallback(() => {
    const id = ++chipIdRef.current;
    setFlyingChips((prev) => [...prev, { id }]);
  }, []);

  useEffect(() => {
    const uid =
      (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id ?? null;
    if (!uid) return;
    setTgId(uid);
    fetch(`/api/player/profile?telegramId=${uid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.chips === "number")
          setPlayerChips(data.chips > 0 ? data.chips : INITIAL_CHIPS);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (playerHand.length < 2) return;
    const all = [...playerHand, ...community];
    setHandName(all.length >= 5 ? best7(all).name : evalHand(playerHand).name);
  }, [playerHand, community]);

  useEffect(() => {
    if (community.length > 0) sounds.playDeal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community.length]);

  useEffect(() => {
    if (!overlay || !winner) return;
    if (winner === "player") {
      sounds.playWin();
      hapticNotify("success");
    } else if (winner === "bot") {
      sounds.playLose();
      hapticNotify("error");
    } else hapticNotify("warning");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  useEffect(() => {
    if (phase !== "showdown") {
      setShowdownStep(0);
      return;
    }
    if (botFolded) {
      setShowdownStep(8);
      return;
    }
    setShowdownStep(1);
    const t1 = setTimeout(() => setShowdownStep(2), 300);
    const t2 = setTimeout(() => setShowdownStep(3), 600);
    const t3 = setTimeout(() => setShowdownStep(4), 900);
    const t4 = setTimeout(() => setShowdownStep(5), 1200);
    const t5 = setTimeout(() => setShowdownStep(6), 1500);
    const t6 = setTimeout(() => setShowdownStep(7), 1800);
    const t7 = setTimeout(() => setShowdownStep(8), 2100);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
      clearTimeout(t6);
      clearTimeout(t7);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, botFolded]);

  const saveChips = useCallback((chips: number, tid: number | null) => {
    if (!tid) return;
    fetch("/api/player/chips", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramId: tid, chips }),
    }).catch(() => {});
  }, []);

  const sendGameResult = useCallback(
    (
      tid: number | null,
      result: "player" | "bot" | "tie",
      hn: string,
      won: number,
    ) => {
      if (!tid) return;
      fetch("/api/telegram/game-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramId: tid,
          winner: result,
          handName: hn,
          potWon: won,
        }),
      }).catch(() => {});
    },
    [],
  );

  const advancePhase = useCallback(
    (
      fromPhase: Phase,
      ptr: number,
      d: Card[],
      currentPot: number,
      currentBotChips: number,
    ) => {
      setCurrentBet(0);
      setBetInput(BIG_BLIND * 2);
      setPendingBotRaise(null);
      if (fromPhase === "preflop") {
        setCommunity([d[ptr], d[ptr + 1], d[ptr + 2]]);
        setDeckPtr(ptr + 3);
        setPhase("flop");
        setMessage("Flop — your action");
      } else if (fromPhase === "flop") {
        setCommunity((prev) => [...prev, d[ptr]]);
        setDeckPtr(ptr + 1);
        setPhase("turn");
        setMessage("Turn — your action");
      } else if (fromPhase === "turn") {
        setCommunity((prev) => [...prev, d[ptr]]);
        setDeckPtr(ptr + 1);
        setPhase("river");
        setMessage("River — your action");
      } else if (fromPhase === "river") {
        setPhase("showdown");
        setShowdown(true);
        setCommunity((prev) => {
          const com = prev;
          setPlayerHand((ph) => {
            setBotHand((bh) => {
              const result = compareHands(ph, bh, com);
              const pB = best7([...ph, ...com]),
                bB = best7([...bh, ...com]);
              const pBestCards = getBestCards(ph, com);
              const bBestCards = getBestCards(bh, com);
              setPlayerWinKeys(new Set(pBestCards.map(cardKey)));
              setBotWinKeys(new Set(bBestCards.map(cardKey)));
              setHandName(pB.name);
              setBotHandName(bB.name);
              setPlayerHandDesc(describeHandCombo(pB, pBestCards));
              setBotHandDesc(describeHandCombo(bB, bBestCards));
              setPlayerHandKicker(describeKicker(pB, pBestCards));
              setBotHandKicker(describeKicker(bB, bBestCards));
              setWinner(result);
              let msg = "",
                won = 0;
              if (result === "player") {
                setPlayerChips((p) => {
                  const next = p + currentPot;
                  setTimeout(() => saveChips(next, tgId), 300);
                  return next;
                });
                setPot(0);
                msg = `${pB.name} beats ${bB.name}!`;
                won = currentPot;
              } else if (result === "bot") {
                setBotChips(currentBotChips + currentPot);
                setPot(0);
                msg = `Bot wins with ${bB.name} vs your ${pB.name}`;
                setPlayerChips((p) => {
                  setTimeout(() => saveChips(p, tgId), 300);
                  return p;
                });
              } else {
                const half = Math.floor(currentPot / 2);
                setPlayerChips((p) => {
                  const next = p + half;
                  setTimeout(() => saveChips(next, tgId), 300);
                  return next;
                });
                setBotChips(currentBotChips + half);
                setPot(0);
                msg = `Both have ${pB.name}`;
                won = half;
              }
              setPotWon(won);
              setOverlayMsg(msg);
              setTimeout(() => setOverlay(true), 2800);
              sendGameResult(
                tgId,
                result,
                result === "player"
                  ? pB.name
                  : result === "bot"
                    ? bB.name
                    : pB.name,
                won,
              );
              return bh;
            });
            return ph;
          });
          return com;
        });
      }
    },
    [tgId, saveChips, sendGameResult],
  );

  const getBotDelay = () =>
    ({ fast: 300, normal: 900, slow: 1800 })[
      (localStorage.getItem("botSpeed") ?? "normal") as
        | "fast"
        | "normal"
        | "slow"
    ] ?? 900;

  const runBotTurn = useCallback(
    (
      currentPot: number,
      toCall: number,
      currentBotChips: number,
      ptr: number,
      _com: Card[],
      d: Card[],
      fromPhase: Phase,
    ) => {
      setTimeout(() => {
        const { action, amount } = botDecide(
          currentPot,
          toCall,
          currentBotChips,
        );
        setBotActionLabel(action.toUpperCase());
        if (action === "fold") {
          setBotFolded(true);
          setPhase("showdown");
          setShowdown(true);
          setWinner("player");
          setPlayerChips((p) => p + currentPot);
          setPot(0);
          setPotWon(currentPot);
          setOverlayMsg("Bot folded — the pot is yours!");
          setTimeout(() => setOverlay(true), 300);
          sendGameResult(tgId, "player", "Bot folded", currentPot);
          return;
        }
        if (action === "check") {
          advancePhase(fromPhase, ptr, d, currentPot, currentBotChips);
          return;
        }
        if (action === "call") {
          const paid = Math.min(amount, currentBotChips);
          const newPot = currentPot + paid,
            newBotChips = currentBotChips - paid;
          spawnChip();
          setPot(newPot);
          setBotChips(newBotChips);
          advancePhase(fromPhase, ptr, d, newPot, newBotChips);
          return;
        }
        if (action === "raise") {
          const paid = Math.min(amount, currentBotChips);
          const newPot = currentPot + paid,
            newBotChips = currentBotChips - paid;
          spawnChip();
          setPot(newPot);
          setBotChips(newBotChips);
          setCurrentBet(paid);
          setMessage(`Bot raises ${paid} — call or fold?`);
          setPendingBotRaise({
            toCall: paid,
            pot: newPot,
            botChips: newBotChips,
            ptr,
            d,
            fromPhase,
          });
        }
      }, getBotDelay());
    },
    [advancePhase, spawnChip, tgId, sendGameResult],
  );

  const dealNewHand = useCallback(() => {
    haptic("medium");
    sounds.playDeal();
    const d = shuffle(buildDeck());
    setDeck(d);
    setDeckPtr(4);
    setPlayerHand([d[0], d[2]]);
    setBotHand([d[1], d[3]]);
    setCommunity([]);
    setPhase("preflop");
    setShowdown(false);
    setBotFolded(false);
    setBotActionLabel("");
    setWinner("");
    setOverlay(false);
    setBotHandName("");
    setHandName("");
    setPlayerWinKeys(new Set());
    setBotWinKeys(new Set());
    setShowdownStep(0);
    setPlayerHandDesc("");
    setBotHandDesc("");
    setPlayerHandKicker("");
    setBotHandKicker("");
    allInAutoRef.current = "";
    setPendingBotRaise(null);
    setPot(BIG_BLIND + SMALL_BLIND);
    setPlayerChips((p) => p - SMALL_BLIND);
    setBotChips((p) => p - BIG_BLIND);
    setCurrentBet(BIG_BLIND);
    setBetInput(BIG_BLIND * 2);
    setMessage("Pre-flop — call, raise or fold");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sounds]);

  const isActing = phase !== "showdown" && phase !== "idle";
  const playerAllIn = playerChips === 0 && isActing;
  const needsReload = playerChips < BIG_BLIND && phase === "showdown";

  const handleFold = () => {
    if (!isActing) return;
    haptic("heavy");
    sounds.playFold();
    hapticNotify("error");
    setPendingBotRaise(null);
    setBotChips(botChips + pot);
    setPot(0);
    setPhase("showdown");
    setShowdown(true);
    setWinner("bot");
    setPotWon(0);
    setOverlayMsg("You folded. Better luck next hand!");
    setTimeout(() => setOverlay(true), 200);
    sendGameResult(tgId, "bot", "You folded", 0);
  };
  const handleCheck = () => {
    if (!isActing || pendingBotRaise) return;
    haptic("light");
    sounds.playCheck();
    setRaiseOpen(false);

    setMessage("You check.");
    runBotTurn(pot, 0, botChips, deckPtr, community, deck, phase);
    };

    setMessage("You check.");
    runBotTurn(pot, 0, botChips, deckPtr, community, deck, phase);
  };
  const handleCall = () => {
    if (!isActing) return;
    haptic("medium");
    sounds.playChip();
    spawnChip();
    if (pendingBotRaise) {
      const {
        toCall,
        pot: rPot,
        botChips: rBotChips,
        ptr,
        d,
        fromPhase,
      } = pendingBotRaise;
      const paid = Math.min(toCall, playerChips);
      setPlayerChips((p) => p - paid);
      const newPot = rPot + paid;
      setPot(newPot);
      setMessage(`You call ${paid}.`);
      advancePhase(fromPhase, ptr, d, newPot, rBotChips);
      return;
    }
    const toCall =
      phase === "preflop" ? BIG_BLIND - SMALL_BLIND : currentBet || BIG_BLIND;
    const amount = Math.min(toCall, playerChips);
    setPlayerChips((p) => p - amount);
    const newPot = pot + amount;
    setPot(newPot);
    setMessage(`You call ${BIG_BLIND}.`);
    runBotTurn(newPot, 0, botChips, deckPtr, community, deck, phase);
  };
  const handleRaise = () => {
    if (!isActing || betInput <= 0 || pendingBotRaise) return;
    haptic("heavy");
    sounds.playChip();
    const amount = Math.min(betInput, playerChips);
    if (amount <= 0) return;
    spawnChip();
    setPlayerChips((p) => p - amount);
    const newPot = pot + amount;
    setPot(newPot);
    setCurrentBet(amount);
    setMessage(`You raise ${amount}.`);
    runBotTurn(newPot, amount, botChips, deckPtr, community, deck, phase);
  };
  const handleAllIn = () => {
    if (!isActing || playerChips === 0) return;
    haptic("heavy");
    sounds.playChip();
    const amount = playerChips;
    spawnChip();
    setPlayerChips(0);
    const newPot = pot + amount;
    setPot(newPot);
    setCurrentBet(amount);
    setBetInput(amount);
    setMessage("You go ALL-IN!");
    runBotTurn(newPot, amount, botChips, deckPtr, community, deck, phase);
  };

  // slider percentage for CSS custom property
  const sliderPct =
    playerChips > BIG_BLIND
      ? Math.round(((betInput - BIG_BLIND) / (playerChips - BIG_BLIND)) * 100)
      : 0;

  const callAmount = pendingBotRaise
    ? Math.min(pendingBotRaise.toCall, playerChips)
    : phase === "preflop"
      ? BIG_BLIND
      : currentBet || BIG_BLIND;

  const isCheckable =
    currentBet === 0 && phase !== "preflop" && !pendingBotRaise;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      dir="ltr"
      style={{
        display: "flex",
        flexDirection: "column",
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "#070714",
        backgroundImage:
          "radial-gradient(ellipse 100% 50% at 50% 0%,rgba(100,0,200,0.15) 0%,transparent 60%)",
        maxWidth: 480,
        margin: "0 auto",
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        fontFamily: "Rajdhani,sans-serif",
      }}
    >
      {/* ResultOverlay suppressed — showdown handled inline in ShowdownPanel */}

      {/* ── HEADER ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "#0d0d1f",
          borderBottom: "1px solid rgba(155,48,255,0.25)",
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        {/* Menu button */}
        <button
          onClick={() => {
            haptic("light");
            navigate("/");
          }}
          style={{
            width: 40,
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 18,
                  height: 2,
                  background: "rgba(255,255,255,0.7)",
                  borderRadius: 1,
                }}
              />
            ))}
          </div>
        </button>

        {/* POKER BLUFF logo — Orbitron, exact reference style */}
        <div
          style={{
            border: "2px solid #9b30ff",
            borderRadius: 10,
            padding: "4px 16px",
            boxShadow:
              "0 0 18px rgba(155,48,255,0.55), inset 0 0 10px rgba(155,48,255,0.1)",
            textAlign: "center",
            lineHeight: 1.1,
          }}
        >
          <div
            style={{
              fontFamily: "Orbitron,sans-serif",
              fontSize: 17,
              fontWeight: 900,
              color: "#00e5d4",
              letterSpacing: 2,
              textShadow: "0 0 12px #00e5d4, 0 0 24px rgba(0,229,212,0.5)",
            }}
          >
            POKER
          </div>
          <div
            style={{
              fontFamily: "Orbitron,sans-serif",
              fontSize: 17,
              fontWeight: 900,
              color: "#9b30ff",
              letterSpacing: 2,
              textShadow: "0 0 12px #9b30ff, 0 0 24px rgba(155,48,255,0.6)",
            }}
          >
            BLUFF
          </div>
        </div>

        {/* Chips + mute */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "rgba(155,48,255,0.15)",
              border: "1px solid rgba(155,48,255,0.3)",
              borderRadius: 20,
              padding: "4px 10px",
            }}
          >
            <span style={{ fontSize: 14 }}>🪙</span>
            <span
              style={{
                fontFamily: "Orbitron,sans-serif",
                fontSize: 12,
                fontWeight: 700,
                color: "#f5c318",
              }}
            >
              {playerChips.toLocaleString()}
            </span>
          </div>
          <button
            onClick={() => {
              haptic("light");
              toggleMute();
            }}
            style={{
              width: 28,
              height: 20,
              fontSize: 14,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </div>

      {/* ── STATS BAR ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "7px 12px",
          gap: 8,
          background: "#0d0d1f",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          flexShrink: 0,
        }}
      >
        {/* Chips left */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "linear-gradient(135deg,#f5c318,#ffaa00)",
              boxShadow: "0 0 8px rgba(245,195,24,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            🪙
          </div>
          <div>
            <div
              style={{
                fontSize: 8,
                color: "rgba(255,255,255,0.4)",
                letterSpacing: 1.5,
                fontWeight: 700,
              }}
            >
              CHIPS
            </div>
            <div
              style={{
                fontFamily: "Orbitron,sans-serif",
                fontSize: 14,
                fontWeight: 700,
                color: "#fff",
              }}
            >
              {playerChips.toLocaleString()}
            </div>
          </div>
        </div>

        {/* BIG POT — center */}
        {pot > 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(30,15,0,0.85)",
              border: "1px solid rgba(255,170,0,0.4)",
              borderRadius: 10,
              padding: "4px 14px",
              boxShadow: "0 0 10px rgba(255,170,0,0.2)",
            }}
          >
            <span style={{ fontSize: 13 }}>🪙</span>
            <div>
              <div
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: 1.5,
                  color: "rgba(255,255,255,0.4)",
                }}
              >
                POT
              </div>
              <div
                style={{
                  fontFamily: "Orbitron,sans-serif",
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#f5c318",
                  lineHeight: 1,
                }}
              >
                {pot.toLocaleString()}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}

        {/* Phase + diamonds */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 3,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 10 }}>💎</span>
            <span
              style={{
                fontFamily: "Orbitron,sans-serif",
                fontSize: 11,
                fontWeight: 700,
                color: "rgba(255,255,255,0.6)",
              }}
            >
              0
            </span>
          </div>
          {phase !== "idle" && (
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 1.5,
                color: phase === "showdown" ? "#f5c318" : "#00e5d4",
                background:
                  phase === "showdown"
                    ? "rgba(245,195,24,0.1)"
                    : "rgba(0,229,212,0.1)",
                border: `1px solid ${phase === "showdown" ? "rgba(245,195,24,0.3)" : "rgba(0,229,212,0.3)"}`,
                borderRadius: 6,
                padding: "2px 8px",
              }}
            >
              {phase.toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* ── TABLE AREA ── */}
      <div
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          background: "#07070f",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 4,
          paddingBottom: 4,
        }}
      >
        {/* Purple ambient glow behind table */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 90% 80% at 50% 40%,rgba(80,0,180,0.18) 0%,transparent 70%)",
            pointerEvents: "none",
          }}
        />

        {/* ── BOT AREA (above table) ── */}
        <div
          style={{
            position: "relative",
            zIndex: 5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 3,
            flexShrink: 0,
            marginBottom: -6,
          }}
        >
          {/* Bot chip count */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "rgba(255,255,255,0.7)",
              background: "rgba(0,0,0,0.6)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              padding: "2px 10px",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#ff4444",
                display: "inline-block",
              }}
            />
            {botChips.toLocaleString()}
          </div>

          {/* Bot avatar */}
          <div style={{ position: "relative" }}>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: "50%",
                background: "radial-gradient(circle,#1e1e3e,#0d0d20)",
                border: "3px solid #9b30ff",
                boxShadow:
                  "0 0 8px rgba(155,48,255,0.42), 0 0 16px rgba(155,48,255,0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <rect
                  x="4"
                  y="8"
                  width="16"
                  height="11"
                  rx="2.5"
                  fill="#7c3aed"
                  opacity="0.95"
                />
                <rect
                  x="7"
                  y="11"
                  width="3"
                  height="2.5"
                  rx="1.25"
                  fill="#00e5d4"
                />
                <rect
                  x="14"
                  y="11"
                  width="3"
                  height="2.5"
                  rx="1.25"
                  fill="#00e5d4"
                />
                <rect
                  x="9.5"
                  y="14"
                  width="5"
                  height="1.5"
                  rx="0.75"
                  fill="#cc44ff"
                  opacity="0.9"
                />
                <rect
                  x="10"
                  y="4"
                  width="4"
                  height="4"
                  rx="1.5"
                  fill="#5b21b6"
                />
                <circle cx="12" cy="4" r="1.5" fill="#00e5d4" opacity="0.9" />
                <line
                  x1="4"
                  y1="13.5"
                  x2="2"
                  y2="13.5"
                  stroke="#7c3aed"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <line
                  x1="20"
                  y1="13.5"
                  x2="22"
                  y2="13.5"
                  stroke="#7c3aed"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            {/* Online dot */}
            <div
              style={{
                position: "absolute",
                bottom: 2,
                right: 2,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#00e676",
                border: "2px solid #07070f",
              }}
            />
          </div>

          {/* Bot name + action */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#00e5d4" }}>
              betaperiod74
            </span>
            {botChips === 0 && isActing && (
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "2px 7px",
                  background: "rgba(245,195,24,0.2)",
                  border: "1px solid #f5c318",
                  color: "#f5c318",
                  borderRadius: 6,
                  animation: "allInFlash 1s ease infinite",
                }}
              >
                ALL-IN
              </div>
            )}
            {botActionLabel && (
              <div
                className="pop-action"
                style={{
                  padding: "2px 8px",
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 1,
                  background:
                    botActionLabel === "FOLD"
                      ? "rgba(230,57,70,0.2)"
                      : botActionLabel === "RAISE"
                        ? "rgba(255,100,0,0.2)"
                        : "rgba(0,180,255,0.2)",
                  border: `1px solid ${botActionLabel === "FOLD" ? "#e63946" : botActionLabel === "RAISE" ? "#ff6400" : "#00b4ff"}`,
                  color:
                    botActionLabel === "FOLD"
                      ? "#e63946"
                      : botActionLabel === "RAISE"
                        ? "#ff9944"
                        : "#44ccff",
                }}
              >
                {botActionLabel}
              </div>
            )}
          </div>

          {/* Bot cards */}
          <div style={{ display: "flex", gap: 5 }}>
            {phase === "idle" ? (
              <>
                <EmptySlot size="sdb" />
                <EmptySlot size="sdb" />
              </>
            ) : showdown && !botFolded ? (
              botHand.map((c, i) => {
                const isWinCard = botWinKeys.has(cardKey(c));
                const highlightNow = showdownStep >= 6 && isWinCard;
                const dimNow =
                  showdownStep >= 6 && !isWinCard && botWinKeys.size > 0;
                return (
                  <CardFace
                    key={i}
                    card={c}
                    size="sdb"
                    delay={i * 0.1}
                    flip
                    highlight={highlightNow}
                    dimmed={dimNow}
                  />
                );
              })
            ) : botFolded ? (
              <>
                <EmptySlot size="sdb" />
                <EmptySlot size="sdb" />
              </>
            ) : (
              <>
                <CardBack size="sdb" />
                <CardBack size="sdb" />
              </>
            )}
          </div>
          {showdown && !botFolded && botHandName && showdownStep >= 7 && (
            <HandBadge name={botHandName} winner={winner === "bot"} />
          )}
        </div>

        {/* ── POKER TABLE OVAL ── */}
        <div
          style={{
            width: "92%",
            maxWidth: 400,
            height: 188,
            background:
              "radial-gradient(ellipse 90% 80% at 50% 45%,#217a46 0%,#165f36 45%,#0f4526 100%)",
            borderRadius: "50%",
            border: "10px solid #6b3c10",
            boxShadow:
              "0 0 0 3px #9a5a1e, 0 0 30px rgba(155,48,255,0.42), 0 0 60px rgba(155,48,255,0.18), inset 0 0 30px rgba(0,0,0,0.35)",
            position: "relative",
            flexShrink: 0,
            zIndex: 2,
          }}
        >
          {/* Purple neon ring */}
          <div
            style={{
              position: "absolute",
              inset: -18,
              borderRadius: "50%",
              boxShadow:
                "0 0 18px rgba(155,48,255,0.24), 0 0 36px rgba(155,48,255,0.12)",
              pointerEvents: "none",
            }}
          />

          {/* Table watermark */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%,-50%)",
              fontFamily: "Orbitron,sans-serif",
              fontSize: 11,
              fontWeight: 900,
              color: "rgba(255,255,255,0.04)",
              letterSpacing: 3,
              whiteSpace: "nowrap",
              textAlign: "center",
              lineHeight: 1.4,
              pointerEvents: "none",
            }}
          >
            POKER
            <br />
            BLUFF
          </div>

          {/* Community cards */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%,-50%)",
              display: "flex",
              gap: 5,
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2].map((i) =>
                community[i] ? (
                  <CardFace
                    key={i}
                    card={community[i]}
                    size="sm"
                    delay={i * 0.07}
                    highlight={
                      playerWinKeys.has(cardKey(community[i])) ||
                      botWinKeys.has(cardKey(community[i]))
                    }
                  />
                ) : (
                  <EmptySlot key={i} size="sm" />
                ),
              )}
            </div>
            <div style={{ width: 4 }} />
            {community[3] ? (
              <CardFace
                card={community[3]}
                size="sm"
                delay={0.07}
                highlight={
                  playerWinKeys.has(cardKey(community[3])) ||
                  botWinKeys.has(cardKey(community[3]))
                }
              />
            ) : (
              <EmptySlot size="sm" />
            )}
            {community[4] ? (
              <CardFace
                card={community[4]}
                size="sm"
                delay={0.1}
                highlight={
                  playerWinKeys.has(cardKey(community[4])) ||
                  botWinKeys.has(cardKey(community[4]))
                }
              />
            ) : (
              <EmptySlot size="sm" />
            )}
          </div>

          {/* POT on table (when active) */}
          {pot > 0 && isActing && (
            <div
              style={{
                position: "absolute",
                bottom: "12%",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: "rgba(0,0,0,0.5)",
                borderRadius: 10,
                padding: "2px 10px",
              }}
            >
              <span style={{ fontSize: 11 }}>🪙</span>
              <div
                style={{
                  fontFamily: "Orbitron,sans-serif",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#f5c318",
                  lineHeight: 1,
                }}
              >
                {pot.toLocaleString()}
              </div>
            </div>
          )}

          {/* Flying chips */}
          {flyingChips.map((c) => (
            <div
              key={c.id}
              className="chip-fly"
              onAnimationEnd={() =>
                setFlyingChips((prev) => prev.filter((x) => x.id !== c.id))
              }
              style={{
                position: "absolute",
                left: "50%",
                bottom: "20%",
                fontSize: 16,
                pointerEvents: "none",
                zIndex: 10,
              }}
            >
              🪙
            </div>
          ))}
        </div>

        {/* ── PLAYER AREA (below table) ── */}
        <div
          style={{
            position: "relative",
            zIndex: 5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 3,
            flexShrink: 0,
            marginTop: -6,
          }}
        >
          {/* YOUR TURN badge */}
          {isActing && !playerAllIn && (
            <div
              className="yt-anim"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "#00e5d4",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 2,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 1,
                  background: "linear-gradient(90deg,transparent,#00e5d4)",
                }}
              />
              {pendingBotRaise
                ? `🚀 BOT RAISES ${pendingBotRaise.toCall}`
                : "YOUR TURN"}
              <div
                style={{
                  width: 28,
                  height: 1,
                  background: "linear-gradient(90deg,#00e5d4,transparent)",
                }}
              />
            </div>
          )}

          {/* Player hand cards + avatar */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 10,
              position: "relative",
            }}
          >
            {/* D badge */}
            {phase !== "idle" && (
              <div
                style={{
                  position: "absolute",
                  left: -8,
                  bottom: 8,
                  zIndex: 6,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.15)",
                  border: "2px solid rgba(255,255,255,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 700,
                  color: "#fff",
                }}
              >
                D
              </div>
            )}

            {/* Player avatar */}
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: "radial-gradient(circle,#2a1a0a,#1a0e05)",
                border: "3px solid #f5c318",
                boxShadow: "0 0 10px rgba(245,195,24,0.36)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                flexShrink: 0,
              }}
            >
              👤
            </div>

            {/* Player cards */}
            {phase === "idle" ? (
              <>
                <EmptySlot size="sdp" />
                <EmptySlot size="sdp" />
              </>
            ) : (
              playerHand.map((c, i) => {
                const isWinCard = playerWinKeys.has(cardKey(c));
                const sz: "sdp" | "lg" = phase === "showdown" ? "sdp" : "lg";
                const highlightNow =
                  phase === "showdown"
                    ? showdownStep >= 3 && isWinCard
                    : isWinCard;
                const dimNow =
                  phase === "showdown" && showdownStep >= 3 && !isWinCard;
                return (
                  <CardFace
                    key={i}
                    card={c}
                    size={sz}
                    delay={i * 0.1}
                    highlight={highlightNow}
                    dimmed={dimNow}
                  />
                );
              })
            )}
          </div>

          {/* Hand badges */}
          {showdown && handName && showdownStep >= 4 && (
            <HandBadge name={handName} winner={winner === "player"} />
          )}
          {!showdown && handName && phase !== "idle" && (
            <HandBadge name={handName} />
          )}

          {/* Player chip counter */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(0,0,0,0.7)",
              border: `1px solid ${playerAllIn ? "rgba(245,195,24,0.5)" : "rgba(77,195,255,0.35)"}`,
              borderRadius: 16,
              padding: "3px 14px",
              boxShadow: playerAllIn ? "0 0 14px rgba(245,195,24,0.4)" : "none",
            }}
          >
            {playerAllIn && (
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "2px 7px",
                  background: "rgba(245,195,24,0.2)",
                  border: "1px solid #f5c318",
                  color: "#f5c318",
                  borderRadius: 8,
                  animation: "allInFlash 1s ease infinite",
                }}
              >
                ALL-IN
              </div>
            )}
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: "#4dc3ff",
                boxShadow: "0 0 8px #4dc3ff",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: "Orbitron,sans-serif",
                fontSize: 13,
                fontWeight: 700,
                color: "#fff",
              }}
            >
              {playerChips.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* ── ACTION BUTTONS ── */}
      <div
        style={{
          background: "#09091a",
          borderTop: "1px solid rgba(155,48,255,0.2)",
          padding: phase === "showdown" ? "0" : "10px 10px 6px",
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        {phase === "showdown" ? (
          <ShowdownPanel
            step={showdownStep}
            winner={winner}
            handName={handName}
            botHandName={botHandName}
            playerDesc={playerHandDesc}
            botDesc={botHandDesc}
            playerKicker={playerHandKicker}
            botKicker={botHandKicker}
            potWon={potWon}
            onContinue={() => {
              haptic("medium");
              dealNewHand();
            }}
            onReload={() => {
              haptic("medium");
              sounds.playChip();
              setPlayerChips(INITIAL_CHIPS);
              setBotChips(INITIAL_CHIPS);
              setPot(0);
              setPhase("idle");
              setOverlay(false);
              setPlayerHand([]);
              setBotHand([]);
              setCommunity([]);
              setShowdownStep(0);
              setMessage("Press DEAL to start");
            }}
            needsReload={needsReload}
          />
        ) : null}

        {/* Main button row */}
        {phase === "idle" ? (
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            {needsReload && (
              <button
                onClick={() => {
                  haptic("medium");
                  sounds.playChip();
                  setPlayerChips(INITIAL_CHIPS);
                  setBotChips(INITIAL_CHIPS);
                  setPot(0);
                  setPhase("idle");
                  setOverlay(false);
                  setPlayerHand([]);
                  setBotHand([]);
                  setCommunity([]);
                  setMessage("Press DEAL to start");
                }}
                style={{
                  flex: 1,
                  height: 54,
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#fff",
                  background: "#27ae60",
                  border: "none",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontFamily: "Rajdhani,sans-serif",
                  letterSpacing: 1,
                  boxShadow: "0 4px 20px rgba(39,174,96,0.5)",
                }}
              >
                💰 BUY CHIPS
              </button>
            )}
            <button
              onClick={dealNewHand}
              disabled={playerChips < BIG_BLIND}
              style={{
                flex: 1,
                height: 54,
                fontSize: 16,
                fontWeight: 700,
                color:
                  playerChips < BIG_BLIND ? "rgba(255,255,255,0.3)" : "#fff",
                background:
                  playerChips < BIG_BLIND
                    ? "rgba(255,255,255,0.05)"
                    : "linear-gradient(135deg,#00c4d4,#00e5d4)",
                border: "none",
                borderRadius: 10,
                cursor: playerChips < BIG_BLIND ? "not-allowed" : "pointer",
                letterSpacing: 2,
                fontFamily: "Rajdhani,sans-serif",
                boxShadow:
                  playerChips < BIG_BLIND
                    ? "none"
                    : "0 4px 20px rgba(0,229,212,0.4)",
              }}
            >
              🃏 DEAL
            </button>
          </div>
        ) : pendingBotRaise ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 2fr",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <button
              onClick={handleFold}
              style={{
                height: 54,
                fontSize: 15,
                fontWeight: 700,
                color: "#fff",
                background: "linear-gradient(135deg,#c0021a,#e63946)",
                border: "none",
                borderRadius: 10,
                cursor: "pointer",
                fontFamily: "Rajdhani,sans-serif",
                letterSpacing: 1,
                boxShadow: "0 4px 20px rgba(230,57,70,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 16 }}>✕</span> FOLD
            </button>
            <button
              onClick={handleCall}
              style={{
                height: 54,
                fontSize: 15,
                fontWeight: 700,
                color: "#fff",
                background: "linear-gradient(135deg,#009da8,#00e5d4)",
                border: "none",
                borderRadius: 10,
                cursor: "pointer",
                fontFamily: "Rajdhani,sans-serif",
                letterSpacing: 1,
                boxShadow: "0 4px 20px rgba(0,229,212,0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 14 }}>🪙</span> CALL {callAmount}
            </button>
          </div>
        ) : playerAllIn ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 2fr 1fr",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <button
              disabled
              style={{
                height: 54,
                fontSize: 14,
                fontWeight: 700,
                color: "rgba(255,255,255,0.25)",
                background: "rgba(255,255,255,0.04)",
                border: "none",
                borderRadius: 10,
                cursor: "not-allowed",
                fontFamily: "Rajdhani,sans-serif",
              }}
            >
              FOLD
            </button>
            <button
              disabled
              style={{
                height: 54,
                fontSize: 14,
                fontWeight: 700,
                color: "rgba(255,255,255,0.25)",
                background: "rgba(255,255,255,0.04)",
                border: "none",
                borderRadius: 10,
                cursor: "not-allowed",
                fontFamily: "Rajdhani,sans-serif",
              }}
            >
              CALL
            </button>
            <div
              style={{
                height: 54,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                fontSize: 10,
                fontWeight: 700,
                color: "#f5c318",
                background: "rgba(245,195,24,0.15)",
                border: "2px solid #f5c318",
                borderRadius: 10,
                boxShadow: "0 0 14px rgba(245,195,24,0.45)",
                animation: "allInFlash 1s ease infinite",
                fontFamily: "Rajdhani,sans-serif",
              }}
            >
              ALL-IN
              <br />✦
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 2fr 1fr 1fr",
              gap: 8,
              marginBottom: 8,
            }}
          >
            {/* FOLD */}
            <button
              onClick={handleFold}
              disabled={!isActing}
              style={{
                height: 54,
                fontSize: 14,
                fontWeight: 700,
                color: !isActing ? "rgba(255,255,255,0.25)" : "#fff",
                background: !isActing
                  ? "rgba(255,255,255,0.04)"
                  : "linear-gradient(135deg,#c0021a,#e63946)",
                border: "none",
                borderRadius: 10,
                cursor: !isActing ? "not-allowed" : "pointer",
                fontFamily: "Rajdhani,sans-serif",
                letterSpacing: 1,
                boxShadow: !isActing
                  ? "none"
                  : "0 4px 18px rgba(230,57,70,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              {isActing && <span style={{ fontSize: 14 }}>✕</span>}
              <span>FOLD</span>
            </button>

            {/* CALL / CHECK */}
            {isCheckable ? (
              <button
                onClick={handleCheck}
                disabled={!isActing}
                style={{
                  height: 54,
                  fontSize: 14,
                  fontWeight: 700,
                  color: !isActing ? "rgba(255,255,255,0.25)" : "#fff",
                  background: !isActing
                    ? "rgba(255,255,255,0.04)"
                    : "linear-gradient(135deg,#009da8,#00e5d4)",
                  border: "none",
                  borderRadius: 10,
                  cursor: !isActing ? "not-allowed" : "pointer",
                  fontFamily: "Rajdhani,sans-serif",
                  letterSpacing: 1,
                  boxShadow: !isActing
                    ? "none"
                    : "0 4px 18px rgba(0,229,212,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                }}
              >
                <span style={{ fontSize: 14 }}>✓</span> CHECK
              </button>
            ) : (
              <button
                onClick={handleCall}
                disabled={!isActing}
                style={{
                  height: 54,
                  fontSize: 13,
                  fontWeight: 700,
                  color: !isActing ? "rgba(255,255,255,0.25)" : "#fff",
                  background: !isActing
                    ? "rgba(255,255,255,0.04)"
                    : "linear-gradient(135deg,#009da8,#00e5d4)",
                  border: "none",
                  borderRadius: 10,
                  cursor: !isActing ? "not-allowed" : "pointer",
                  fontFamily: "Rajdhani,sans-serif",
                  letterSpacing: 1,
                  boxShadow: !isActing
                    ? "none"
                    : "0 4px 18px rgba(0,229,212,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 12 }}>🪙</span> CALL {callAmount}
              </button>
            )}

            {/* RAISE */}
            <button
              onClick={handleRaise}
              disabled={!isActing || pendingBotRaise != null}
              style={{
                height: 54,
                fontSize: 13,
                fontWeight: 700,
                color: !isActing ? "rgba(255,255,255,0.25)" : "#fff",
                background: !isActing
                  ? "rgba(255,255,255,0.04)"
                  : "linear-gradient(135deg,#7b20df,#9b30ff)",
                border: "none",
                borderRadius: 10,
                cursor: !isActing ? "not-allowed" : "pointer",
                fontFamily: "Rajdhani,sans-serif",
                letterSpacing: 1,
                boxShadow: !isActing
                  ? "none"
                  : "0 4px 18px rgba(155,48,255,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <span style={{ fontSize: 14 }}>↑</span> RAISE
            </button>

            {/* Raise amount box */}
            <div
              style={{
                height: 54,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(155,48,255,0.15)",
                border: "2px solid rgba(155,48,255,0.4)",
                borderRadius: 10,
                padding: "2px 4px",
              }}
            >
              <div
                style={{
                  fontFamily: "Orbitron,sans-serif",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#cc88ff",
                  lineHeight: 1,
                }}
              >
                {betInput}
              </div>
              <div
                style={{
                  fontSize: 8,
                  color: "rgba(255,255,255,0.35)",
                  letterSpacing: 0.5,
                  marginTop: 2,
                  fontWeight: 700,
                }}
              >
                RAISE
              </div>
            </div>
          </div>
        )}

        {/* ── RAISE SLIDER (always visible when playing) ── */}
        {isActing && !pendingBotRaise && !playerAllIn && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "2px 0 4px",
            }}
          >
            <button
              onClick={() => setBetInput(Math.max(BIG_BLIND, betInput - 10))}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "#fff",
                fontSize: 16,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              −
            </button>
            <div
              style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.35)",
                fontWeight: 700,
                letterSpacing: 1,
                flexShrink: 0,
              }}
            >
              MIN
            </div>
            <div style={{ flex: 1, position: "relative" }}>
              <input
                type="range"
                dir="ltr"
                min={BIG_BLIND}
                max={Math.max(playerChips, BIG_BLIND)}
                step={10}
                value={betInput}
                onChange={(e) => setBetInput(Number(e.target.value))}
                style={{ "--pct": `${sliderPct}%` } as React.CSSProperties}
              />
            </div>
            <div
              style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.35)",
                fontWeight: 700,
                letterSpacing: 1,
                flexShrink: 0,
              }}
            >
              MAX
            </div>
            <button
              onClick={() => setBetInput(Math.min(playerChips, betInput + 10))}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "#fff",
                fontSize: 16,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              +
            </button>
          </div>
        )}

        {/* POT / ½ POT quick buttons */}
        {isActing && !pendingBotRaise && !playerAllIn && pot > 0 && (
          <div style={{ display: "flex", gap: 6, paddingBottom: 4 }}>
            <button
              onClick={handleAllIn}
              style={{
                flex: 1,
                height: 32,
                fontSize: 11,
                fontWeight: 700,
                color: "#f5c318",
                background: "rgba(245,195,24,0.1)",
                border: "1px solid rgba(245,195,24,0.35)",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "Rajdhani,sans-serif",
                letterSpacing: 1,
              }}
            >
              ALL-IN
            </button>
            <button
              onClick={() =>
                setBetInput(Math.min(playerChips, Math.max(BIG_BLIND, pot)))
              }
              style={{
                flex: 1,
                height: 32,
                fontSize: 11,
                fontWeight: 700,
                color: "#cc88ff",
                background: "rgba(155,48,255,0.1)",
                border: "1px solid rgba(155,48,255,0.3)",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "Rajdhani,sans-serif",
                letterSpacing: 1,
              }}
            >
              POT
            </button>
            <button
              onClick={() =>
                setBetInput(
                  Math.min(
                    playerChips,
                    Math.max(BIG_BLIND, Math.floor(pot * 0.5)),
                  ),
                )
              }
              style={{
                flex: 1,
                height: 32,
                fontSize: 11,
                fontWeight: 700,
                color: "#cc88ff",
                background: "rgba(155,48,255,0.1)",
                border: "1px solid rgba(155,48,255,0.3)",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "Rajdhani,sans-serif",
                letterSpacing: 1,
              }}
            >
              ½ POT
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
