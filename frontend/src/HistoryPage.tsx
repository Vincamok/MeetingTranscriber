import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface JobSummary {
  id: string;
  filename: string | null;
  status: "processing" | "completed" | "error";
  created_at: string | null;
  completed_at: string | null;
  duration_ms: number;
  speakers: string[];
  word_count: number;
  error: string | null;
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m${String(sec).padStart(2, "0")}s` : `${s}s`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  completed: { bg: "#EAF3DE", color: "#3B6D11", label: "Terminé" },
  processing: { bg: "#E6F1FB", color: "#0C447C", label: "En cours…" },
  error:      { bg: "#FCEBEB", color: "#A32D2D", label: "Erreur" },
};

export default function HistoryPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      const resp = await fetch("/api/transcripts");
      if (resp.ok) setJobs(await resp.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    // Rafraîchissement auto si des jobs sont en cours
    const id = setInterval(() => {
      if (jobs.some((j) => j.status === "processing")) fetchJobs();
    }, 5000);
    return () => clearInterval(id);
  }, [jobs.length]);

  const deleteJob = async (jobId: string) => {
    if (!confirm("Supprimer cette transcription ?")) return;
    setDeletingId(jobId);
    try {
      await fetch(`/api/transcribe/${jobId}`, { method: "DELETE" });
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } finally {
      setDeletingId(null);
    }
  };

  const exportJob = async (jobId: string, format: "txt" | "srt" | "json") => {
    const resp = await fetch(`/api/transcribe/${jobId}/export?format=${format}`);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcription-${jobId.slice(0, 8)}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: "1.5rem 0", fontFamily: "system-ui, sans-serif", maxWidth: 720 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>📂 Historique</h1>
          <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Toutes les transcriptions</p>
        </div>
        <Link to="/" style={{ fontSize: 13, padding: "7px 14px", borderRadius: 8, border: "0.5px solid #ccc", textDecoration: "none", color: "#333" }}>
          + Nouvelle transcription
        </Link>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: "3rem", color: "#aaa", fontSize: 14 }}>Chargement…</div>
      )}

      {!loading && jobs.length === 0 && (
        <div style={{ textAlign: "center", padding: "3rem", color: "#aaa", fontSize: 14 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🗂</div>
          Aucune transcription pour l'instant
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {jobs.map((job) => {
            const st = STATUS_STYLE[job.status] ?? STATUS_STYLE.error;
            const duration = job.duration_ms ? Math.round(job.duration_ms / 1000) : 0;
            return (
              <div key={job.id} style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "1rem 1.25rem" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  {/* Infos principales */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {job.filename ?? "Enregistrement"}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: st.bg, color: st.color, flexShrink: 0 }}>
                        {st.label}
                      </span>
                    </div>

                    {job.status === "error" && job.error && (
                      <div style={{ fontSize: 12, color: "#A32D2D", marginBottom: 6 }}>{job.error}</div>
                    )}

                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      {[
                        { label: "Date", val: fmtDate(job.created_at) },
                        { label: "Durée", val: duration ? fmtSec(duration) : "—" },
                        { label: "Locuteurs", val: job.speakers.length || "—" },
                        { label: "Mots", val: job.word_count || "—" },
                      ].map(({ label, val }) => (
                        <div key={label}>
                          <div style={{ fontSize: 10, color: "#999", marginBottom: 1 }}>{label}</div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{val}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                    {job.status === "completed" && (
                      <>
                        {(["txt", "srt", "json"] as const).map((fmt) => (
                          <button key={fmt} onClick={() => exportJob(job.id, fmt)}
                            style={{ padding: "4px 9px", fontSize: 11, borderRadius: 6, border: "0.5px solid #bbb", background: "transparent", cursor: "pointer" }}>
                            ↓ {fmt.toUpperCase()}
                          </button>
                        ))}
                      </>
                    )}
                    <button
                      onClick={() => deleteJob(job.id)}
                      disabled={deletingId === job.id}
                      style={{ padding: "4px 9px", fontSize: 11, borderRadius: 6, border: "0.5px solid #F09595", color: "#A32D2D", background: "transparent", cursor: "pointer", opacity: deletingId === job.id ? 0.5 : 1 }}>
                      {deletingId === job.id ? "…" : "Supprimer"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
