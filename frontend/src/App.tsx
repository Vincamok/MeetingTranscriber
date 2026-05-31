import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, Link, useLocation } from "react-router-dom";
import MeetingTranscriber from "./MeetingTranscriber";
import HistoryPage from "./HistoryPage";
import SettingsPage from "./SettingsPage";
import SharePage from "./SharePage";
import LoginPage, { getToken, clearToken } from "./LoginPage";

function Nav({ onLogout, authEnabled }: { onLogout: () => void; authEnabled: boolean }) {
  const { pathname } = useLocation();
  const link = (to: string, label: string) => (
    <Link to={to} style={{ fontSize: 13, textDecoration: "none", fontWeight: pathname === to ? 600 : 400, color: pathname === to ? "#333" : "#777" }}>
      {label}
    </Link>
  );
  return (
    <nav style={{ display: "flex", gap: 16, padding: "1rem 0", borderBottom: "0.5px solid #eee", marginBottom: "0.5rem", alignItems: "center" }}>
      {link("/", "🎙 Transcription")}
      {link("/history", "📂 Historique")}
      <span style={{ flex: 1 }} />
      {link("/settings", "⚙️")}
      {authEnabled && (
        <button onClick={onLogout}
          style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "0.5px solid #ccc", background: "transparent", cursor: "pointer", color: "#666" }}>
          Déconnexion
        </button>
      )}
    </nav>
  );
}

export default function App() {
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => {
        const enabled: boolean = data.auth_enabled ?? false;
        setAuthEnabled(enabled);
        if (!enabled) {
          setAuthenticated(true);
        } else {
          setAuthenticated(!!getToken());
        }
      })
      .catch(() => setAuthenticated(!authEnabled))
      .finally(() => setChecking(false));
  }, []);

  const handleLogout = () => {
    clearToken();
    setAuthenticated(false);
  };

  if (checking) return null;

  // Share page is always public (no auth gate)
  if (window.location.pathname.startsWith("/share/")) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/share/:token" element={<SharePage />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (!authenticated) {
    return <LoginPage onLogin={() => setAuthenticated(true)} />;
  }

  return (
    <BrowserRouter>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 1rem" }}>
        <Nav onLogout={handleLogout} authEnabled={authEnabled} />
        <Routes>
          <Route path="/" element={<MeetingTranscriber />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/share/:token" element={<SharePage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
