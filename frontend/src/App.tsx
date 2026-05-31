import { BrowserRouter, Route, Routes, Link, useLocation } from "react-router-dom";
import MeetingTranscriber from "./MeetingTranscriber";
import HistoryPage from "./HistoryPage";
import SettingsPage from "./SettingsPage";
import SharePage from "./SharePage";

function Nav() {
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
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 1rem" }}>
        <Nav />
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
