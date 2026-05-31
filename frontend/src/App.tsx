import { BrowserRouter, Route, Routes, Link } from "react-router-dom";
import MeetingTranscriber from "./MeetingTranscriber";
import HistoryPage from "./HistoryPage";

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 1rem" }}>
        <nav style={{ display: "flex", gap: 16, padding: "1rem 0", borderBottom: "0.5px solid #eee", marginBottom: "0.5rem" }}>
          <Link to="/" style={{ fontSize: 13, color: "#333", textDecoration: "none", fontWeight: 500 }}>
            🎙 Transcription
          </Link>
          <Link to="/history" style={{ fontSize: 13, color: "#666", textDecoration: "none" }}>
            📂 Historique
          </Link>
        </nav>
        <Routes>
          <Route path="/" element={<MeetingTranscriber />} />
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
