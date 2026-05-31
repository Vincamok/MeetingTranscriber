import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const SPEAKER_COLORS = [
  { bg: "#E6F1FB", text: "#0C447C" },
  { bg: "#EAF3DE", text: "#3B6D11" },
  { bg: "#FAEEDA", text: "#854F0B" },
  { bg: "#FBEAF0", text: "#72243E" },
  { bg: "#EEEDFE", text: "#3C3489" },
];

function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(`/api/share/${token}`)
      .then((r) => { if (!r.ok) throw new Error("Introuvable"); return r.json(); })
      .then(setJob)
      .catch(() => setError("Ce lien de partage est invalide ou a expiré."));
  }, [token]);

  if (error) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#A32D2D", fontSize: 14 }}>
        {error}
      </div>
    );
  }
  if (!job) {
    return <div style={{ padding: "3rem", textAlign: "center", color: "#aaa" }}>Chargement…</div>;
  }

  const utterances = job.utterances ?? [];
  const speakers: string[] = job.speakers ?? [];
  const speakerMap = Object.fromEntries(speakers.map((s: string, i: number) => [s, i]));
  const speakerNames: Record<string, string> = job.speaker_names ?? {};

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>🎙 Minta — Transcription partagée</h1>
        </div>
        <p style={{ fontSize: 13, color: "#888", marginTop: 6 }}>
          {job.filename && <><strong>{job.filename}</strong> · </>}
          {job.language && <>{job.language.toUpperCase()} · </>}
          {job.completed_at && new Date(job.completed_at).toLocaleDateString("fr-FR")}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {utterances.map((u: any, idx: number) => {
          const si = speakerMap[u.speaker] ?? 0;
          const color = SPEAKER_COLORS[si % SPEAKER_COLORS.length];
          const displayName = speakerNames[u.speaker] ?? `Locuteur ${String.fromCharCode(65 + si)}`;
          return (
            <div key={idx} style={{ display: "flex", gap: 12, padding: "10px 12px", borderRadius: 8 }}>
              <div style={{ flexShrink: 0, width: 90 }}>
                <div style={{ fontSize: 11, fontFamily: "monospace", color: "#888", marginBottom: 4 }}>{fmtMs(u.start)}</div>
                <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: color.bg, color: color.text }}>
                  {displayName}
                </span>
              </div>
              <div style={{ fontSize: 14, color: "#333", lineHeight: 1.6, flex: 1 }}>{u.text}</div>
            </div>
          );
        })}
      </div>

      {utterances.length === 0 && (
        <div style={{ textAlign: "center", padding: "2rem", color: "#aaa" }}>Transcription vide.</div>
      )}
    </div>
  );
}
