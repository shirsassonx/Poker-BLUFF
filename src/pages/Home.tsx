import { useLocation } from "wouter";

export default function Home() {
  const [, navigate] = useLocation();
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100vh",
      background: "#0a0a14", color: "#fff", fontFamily: "monospace",
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🃏</div>
      <h1 style={{ fontSize: 28, letterSpacing: 6, color: "#00f7ff", textShadow: "0 0 20px #00f7ff", marginBottom: 8 }}>
        POKER BLUFF
      </h1>
      <p style={{ color: "#666", letterSpacing: 2, fontSize: 11, marginBottom: 40 }}>
        TEXAS HOLD'EM VS AI BOT
      </p>
      <button
        onClick={() => navigate("/game")}
        style={{
          padding: "16px 48px", fontSize: 13, fontWeight: "bold",
          letterSpacing: 4, color: "#00ff9d", background: "#00ff9d18",
          border: "3px solid #00ff9d", boxShadow: "0 0 30px #00ff9d44",
          cursor: "pointer",
        }}
      >
        PLAY NOW
      </button>
    </div>
  );
}
