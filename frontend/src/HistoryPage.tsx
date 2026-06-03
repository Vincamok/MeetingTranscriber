import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "./api";

interface JobSummary {
  id: string;
  filename: string | null;
  title?: string;
  status: "processing" | "completed" | "error";
  created_at: string | null;
  completed_at: string | null;
  duration_ms: number;
  speakers: string[];
  word_count: number;
  error: string | null;
  has_audio: boolean;
  share_token: string | null;
  tags: string[];
  analysis_status: "running" | "completed" | "error" | null;
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}m${String(sec).padStart(2, "0")}s` : `${s}s`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  completed: { bg: "#EAF3DE", color: "#3B6D11", label: "Terminé" },
  processing: { bg: "#E6F1FB", color: "#0C447C", label: "En cours…" },
  error:      { bg: "#FCEBEB", color: "#A32D2D", label: "Erreur" },
};

const TAG_COLORS = ["#E6F1FB", "#EAF3DE", "#FAEEDA", "#FBEAF0", "#EEEDFE", "#f0f0f0"];

function tagColor(tag: string): { bg: string; color: string } {
  const idx = Math.abs([...tag].reduce((a, c) => a + c.charCodeAt(0), 0)) % TAG_COLORS.length;
  const bg = TAG_COLORS[idx];
  const colors = ["#0C447C", "#3B6D11", "#854F0B", "#72243E", "#3C3489", "#555"];
  return { bg, color: colors[idx] };
}

export default function HistoryPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchJobs = async (q?: string, tag?: string) => {
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (tag) params.set("tag", tag);
      const url = `/api/transcripts${params.toString() ? "?" + params.toString() : ""}`;
      const resp = await apiFetch(url);
      if (resp.ok) setJobs(await resp.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const id = setInterval(() => {
      if (jobs.some((j) => j.status === "processing" || j.analysis_status === "running")) {
        fetchJobs(search || undefined, activeTag || undefined);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [jobs.length]);

  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => fetchJobs(val || undefined, activeTag || undefined), 350);
  };

  const handleTagFilter = (tag: string | null) => {
    setActiveTag(tag);
    fetchJobs(search || undefined, tag || undefined);
  };

  const deleteJob = async (jobId: string) => {
    if (!confirm("Supprimer cette transcription ?")) return;
    setDeletingId(jobId);
    try {
      await apiFetch(`/api/transcribe/${jobId}`, { method: "DELETE" });
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } finally {
      setDeletingId(null);
    }
  };

  const exportJob = async (jobId: string, format: "txt" | "srt" | "json") => {
    const resp = await apiFetch(`/api/transcribe/${jobId}/export?format=${format}`);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `transcription-${jobId.slice(0, 8)}.${format}`;
    a.click();
  };

  const saveTags = async (jobId: string, tags: string[]) => {
    await apiFetch(`/api/transcribe/${jobId}/tags`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, tags } : j));
    setEditingTagsId(null);
    setTagInput("");
  };

  const addTag = (jobId: string, currentTags: string[]) => {
    const newTag = tagInput.trim();
    if (!newTag || currentTags.includes(newTag)) return;
    saveTags(jobId, [...currentTags, newTag]);
  };

  const removeTag = (jobId: string, currentTags: string[], tag: string) => {
    saveTags(jobId, currentTags.filter((t) => t !== tag));
  };

  // Collect all unique tags across all jobs
  const allTags = [...new Set(jobs.flatMap((j) => j.tags ?? []))];

  return (
    <div style={{ padding: "1.5rem 0", fontFamily: "system-ui, sans-serif", maxWidth: 720 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>📂 Historique</h1>
          <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Toutes les transcriptions</p>
        </div>
        <Link to="/" style={{ fontSize: 13, padding: "7px 14px", borderRadius: 8, border: "0.5px solid #ccc", textDecoration: "none", color: "#333" }}>
          + Nouvelle transcription
        </Link>
      </div>

      {/* Barre de recherche */}
      <div style={{ position: "relative", marginBottom: "0.75rem" }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#aaa" }}>🔍</span>
        <input
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Rechercher dans les transcriptions…"
          style={{ width: "100%", padding: "9px 12px 9px 34px", fontSize: 13, borderRadius: 10, border: "0.5px solid #ddd", boxSizing: "border-box", background: "#fff" }}
        />
        {search && (
          <button onClick={() => handleSearch("")}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#aaa" }}>
            ✕
          </button>
        )}
      </div>

      {/* Filtres par tag */}
      {allTags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "1rem" }}>
          <button onClick={() => handleTagFilter(null)}
            style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, border: "0.5px solid #ddd", background: activeTag === null ? "#333" : "transparent", color: activeTag === null ? "#fff" : "#555", cursor: "pointer" }}>
            Tous
          </button>
          {allTags.map((tag) => {
            const tc = tagColor(tag);
            const isActive = activeTag === tag;
            return (
              <button key={tag} onClick={() => handleTagFilter(isActive ? null : tag)}
                style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, border: `0.5px solid ${isActive ? tc.color : "#ddd"}`, background: isActive ? tc.bg : "transparent", color: isActive ? tc.color : "#555", cursor: "pointer", fontWeight: isActive ? 600 : 400 }}>
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "3rem", color: "#aaa", fontSize: 14 }}>Chargement…</div>
      )}

      {!loading && jobs.length === 0 && (
        <div style={{ textAlign: "center", padding: "3rem", color: "#aaa", fontSize: 14 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>{search || activeTag ? "🔍" : "🗂"}</div>
          {search || activeTag ? "Aucun résultat" : "Aucune transcription pour l'instant"}
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {jobs.map((job) => {
            const st = STATUS_STYLE[job.status] ?? STATUS_STYLE.error;
            const duration = job.duration_ms ? Math.round(job.duration_ms / 1000) : 0;
            const tags = job.tags ?? [];
            const isEditingTags = editingTagsId === job.id;
            return (
              <div key={job.id} style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "1rem 1.25rem" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Titre + statut */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {job.title || job.filename || "Enregistrement"}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: st.bg, color: st.color, flexShrink: 0 }}>
                        {st.label}
                      </span>
                    </div>

                    {job.status === "error" && job.error && (
                      <div style={{ fontSize: 12, color: "#A32D2D", marginBottom: 6 }}>{job.error}</div>
                    )}

                    {job.analysis_status && (
                      <div style={{ marginBottom: 6 }}>
                        <span style={{
                          fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 500,
                          background: job.analysis_status === "completed" ? "#EEEDFE" : job.analysis_status === "running" ? "#E6F1FB" : "#FCEBEB",
                          color: job.analysis_status === "completed" ? "#3C3489" : job.analysis_status === "running" ? "#0C447C" : "#A32D2D",
                        }}>
                          ✦ IA {job.analysis_status === "completed" ? "analysé" : job.analysis_status === "running" ? "en cours…" : "erreur"}
                        </span>
                      </div>
                    )}

                    {/* Tags */}
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                      {tags.map((tag) => {
                        const tc = tagColor(tag);
                        return (
                          <span key={tag} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: tc.bg, color: tc.color, display: "flex", alignItems: "center", gap: 4 }}>
                            {tag}
                            {isEditingTags && (
                              <button onClick={() => removeTag(job.id, tags, tag)}
                                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: tc.color, padding: 0, lineHeight: 1 }}>✕</button>
                            )}
                          </span>
                        );
                      })}
                      {isEditingTags ? (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <input
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") addTag(job.id, tags); if (e.key === "Escape") { setEditingTagsId(null); setTagInput(""); } }}
                            placeholder="Nouveau tag…"
                            autoFocus
                            style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, border: "0.5px solid #ccc", width: 120 }}
                          />
                          <button onClick={() => addTag(job.id, tags)}
                            style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, border: "none", background: "#333", color: "#fff", cursor: "pointer" }}>+</button>
                          <button onClick={() => { setEditingTagsId(null); setTagInput(""); }}
                            style={{ fontSize: 11, padding: "2px 6px", borderRadius: 20, border: "0.5px solid #ccc", background: "transparent", cursor: "pointer" }}>✓</button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingTagsId(job.id); setTagInput(""); }}
                          style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, border: "0.5px dashed #ccc", background: "transparent", color: "#aaa", cursor: "pointer" }}>
                          + Tag
                        </button>
                      )}
                    </div>

                    {/* Stats */}
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
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {job.status === "completed" && (
                      <>
                        {job.share_token && (
                          <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/share/${job.share_token}`); }}
                            style={{ padding: "4px 9px", fontSize: 11, borderRadius: 6, border: "0.5px solid #bbb", background: "transparent", cursor: "pointer" }}>
                            🔗
                          </button>
                        )}
                        {(["txt", "srt", "json"] as const).map((fmt) => (
                          <button key={fmt} onClick={() => exportJob(job.id, fmt)}
                            style={{ padding: "4px 9px", fontSize: 11, borderRadius: 6, border: "0.5px solid #bbb", background: "transparent", cursor: "pointer" }}>
                            ↓ {fmt.toUpperCase()}
                          </button>
                        ))}
                      </>
                    )}
                    <button onClick={() => deleteJob(job.id)} disabled={deletingId === job.id}
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
