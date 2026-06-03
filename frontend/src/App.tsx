import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Route, Routes, Link, useLocation, useNavigate } from "react-router-dom";
import MeetingTranscriber from "./MeetingTranscriber";
import HistoryPage from "./HistoryPage";
import SettingsPage from "./SettingsPage";
import SharePage from "./SharePage";
import LoginPage, { getToken, clearToken } from "./LoginPage";

function Nav({
  onLogout,
  authEnabled,
  isRecording,
  isAnalyzing,
  onNewRecording,
}: {
  onLogout: () => void;
  authEnabled: boolean;
  isRecording: boolean;
  isAnalyzing: boolean;
  onNewRecording: () => void;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const link = (to: string, label: string) => (
    <Link to={to} style={{ fontSize: 13, textDecoration: "none", fontWeight: pathname === to ? 600 : 400, color: pathname === to ? "#333" : "#777" }}>
      {label}
    </Link>
  );

  const handleNew = () => {
    onNewRecording();
    navigate("/");
  };

  return (
    <nav style={{ display: "flex", gap: 16, padding: "1rem 0", borderBottom: "0.5px solid #eee", marginBottom: "0.5rem", alignItems: "center" }}>
      {link("/", "🎙 Transcription")}
      {link("/history", "📂 Historique")}

      {/* Indicateur enregistrement/analyse en cours */}
      {(isRecording || isAnalyzing) && pathname !== "/" && (
        <button onClick={() => navigate("/")}
          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, padding: "3px 8px", borderRadius: 20,
            background: isRecording ? "#FBEAE9" : "#FFF8E1",
            color: isRecording ? "#A32D2D" : "#795B00",
            border: `0.5px solid ${isRecording ? "#F09595" : "#FFD54F"}`,
            cursor: "pointer" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: isRecording ? "#E24B4A" : "#F9A825", animation: "pulse 1s infinite", display: "inline-block" }} />
          {isRecording ? "Enregistrement en cours" : "Analyse en cours"}
        </button>
      )}

      <span style={{ flex: 1 }} />

      {/* Bouton nouvelle transcription quand on est sur l'historique ou les settings */}
      {pathname !== "/" && (
        <button onClick={handleNew}
          style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "0.5px solid #333", background: "#333", color: "#fff", cursor: "pointer" }}>
          + Nouvelle transcription
        </button>
      )}

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

function AppRoutes({ onLogout, authEnabled }: { onLogout: () => void; authEnabled: boolean }) {
  const { pathname } = useLocation();
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const resetRef = useRef<(() => void) | null>(null);

  const handleNewRecording = () => {
    if (resetRef.current) resetRef.current();
  };

  return (
    <>
      <Nav
        onLogout={onLogout}
        authEnabled={authEnabled}
        isRecording={isRecording}
        isAnalyzing={isAnalyzing}
        onNewRecording={handleNewRecording}
      />

      {/* MeetingTranscriber toujours monté pour préserver l'état (enregistrement, polling) */}
      <div style={{ display: pathname === "/" ? "block" : "none" }}>
        <MeetingTranscriber
          onRecordingChange={setIsRecording}
          onAnalyzingChange={setIsAnalyzing}
          resetRef={resetRef}
        />
      </div>

      <Routes>
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/share/:token" element={<SharePage />} />
        {/* "/" est géré par le div always-mounted ci-dessus */}
        <Route path="/" element={null} />
      </Routes>
    </>
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
        <AppRoutes onLogout={handleLogout} authEnabled={authEnabled} />
      </div>
    </BrowserRouter>
  );
}
