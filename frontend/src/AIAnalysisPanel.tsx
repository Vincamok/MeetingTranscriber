import { useEffect, useState } from "react";

interface Action {
  text: string;
  assignee: string | null;
  due: string | null;
}

interface McpResult {
  server: string;
  action: string;
  result: string;
}

interface Analysis {
  status: "running" | "completed" | "error";
  provider: string;
  summary: string;
  decisions: string[];
  actions: Action[];
  mcp_results: McpResult[];
  error: string | null;
  created_at: string | null;
}

interface Props {
  jobId: string;
  existingAnalysis?: Analysis | null;
  onAnalysisUpdate?: (analysis: Analysis) => void;
}

const LS_KEY_PROVIDER = "mt_ai_provider";
const LS_KEY_API_KEY = "mt_ai_api_key";

export default function AIAnalysisPanel({ jobId, existingAnalysis, onAnalysisUpdate }: Props) {
  const [provider, setProvider] = useState<string>(() => localStorage.getItem(LS_KEY_PROVIDER) || "anthropic");
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem(LS_KEY_API_KEY) || "");
  const [mcpServers, setMcpServers] = useState<Record<string, object>>({});
  const [selectedServers, setSelectedServers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(existingAnalysis ?? null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  // Charger les serveurs MCP disponibles
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        setMcpServers(s.mcp_servers ?? {});
        if (!localStorage.getItem(LS_KEY_PROVIDER) && s.default_provider) {
          setProvider(s.default_provider);
        }
      })
      .catch(() => {});
  }, []);

  // Persister provider + clé dans localStorage
  useEffect(() => { localStorage.setItem(LS_KEY_PROVIDER, provider); }, [provider]);
  useEffect(() => { localStorage.setItem(LS_KEY_API_KEY, apiKey); }, [apiKey]);

  // Polling si analyse en cours
  useEffect(() => {
    if (analysis?.status !== "running") return;
    const id = setInterval(async () => {
      const resp = await fetch(`/api/transcribe/${jobId}`);
      if (!resp.ok) return;
      const job = await resp.json();
      if (job.analysis) {
        setAnalysis(job.analysis);
        onAnalysisUpdate?.(job.analysis);
        if (job.analysis.status !== "running") clearInterval(id);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [analysis?.status, jobId, onAnalysisUpdate]);

  const toggleServer = (name: string) => {
    setSelectedServers((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]
    );
  };

  const launch = async () => {
    setError("");
    setLoading(true);
    try {
      const resp = await fetch(`/api/transcribe/${jobId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          api_key: apiKey || undefined,
          mcp_servers: selectedServers,
        }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(d.detail ?? resp.statusText);
      }
      setAnalysis({ status: "running", provider, summary: "", decisions: [], actions: [], mcp_results: [], error: null, created_at: null });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const hasMcpServers = Object.keys(mcpServers).length > 0;

  return (
    <div style={{ marginTop: "1.5rem", border: "0.5px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
      {/* Header — toujours visible */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem", background: "#fafafa", border: "none", cursor: "pointer", textAlign: "left" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>✦ Analyser avec IA</span>
          {analysis && (
            <span style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 500,
              background: analysis.status === "completed" ? "#EAF3DE" : analysis.status === "running" ? "#E6F1FB" : "#FCEBEB",
              color: analysis.status === "completed" ? "#3B6D11" : analysis.status === "running" ? "#0C447C" : "#A32D2D",
            }}>
              {analysis.status === "completed" ? "Terminé" : analysis.status === "running" ? "En cours…" : "Erreur"}
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, color: "#999" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "1.25rem", borderTop: "0.5px solid #eee" }}>

          {/* Résultats si analyse terminée */}
          {analysis?.status === "completed" && (
            <div style={{ marginBottom: "1.5rem" }}>
              {analysis.summary && (
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Résumé</div>
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: "#333", margin: 0 }}>{analysis.summary}</p>
                </div>
              )}

              {analysis.decisions.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Décisions</div>
                  <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                    {analysis.decisions.map((d, i) => (
                      <li key={i} style={{ fontSize: 14, lineHeight: 1.6, color: "#333", marginBottom: 2 }}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.actions.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Actions</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {analysis.actions.map((a, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, padding: "8px 10px", background: "#f9f9f9", borderRadius: 8, alignItems: "flex-start" }}>
                        <div style={{ flex: 1, fontSize: 14, color: "#333" }}>{a.text}</div>
                        {a.assignee && <div style={{ fontSize: 12, color: "#555", flexShrink: 0 }}>👤 {a.assignee}</div>}
                        {a.due && <div style={{ fontSize: 12, color: "#555", flexShrink: 0 }}>📅 {a.due}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analysis.mcp_results.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Actions MCP</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {analysis.mcp_results.map((r, i) => (
                      <div key={i} style={{ fontSize: 12, padding: "6px 10px", background: "#EAF3DE", borderRadius: 6, color: "#3B6D11" }}>
                        <strong>{r.server}</strong> → {r.action} : {r.result}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => setAnalysis(null)}
                style={{ marginTop: "1rem", fontSize: 12, padding: "5px 12px", borderRadius: 6, border: "0.5px solid #bbb", background: "transparent", cursor: "pointer" }}>
                Relancer une analyse
              </button>
            </div>
          )}

          {analysis?.status === "running" && (
            <div style={{ padding: "1rem", textAlign: "center", color: "#0C447C", fontSize: 14, marginBottom: "1rem" }}>
              ⏳ Analyse en cours…
            </div>
          )}

          {analysis?.status === "error" && (
            <div style={{ background: "#FCEBEB", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#A32D2D", marginBottom: "1rem" }}>
              Erreur : {analysis.error}
            </div>
          )}

          {/* Formulaire de lancement */}
          {!analysis || analysis.status === "error" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {error && (
                <div style={{ background: "#FCEBEB", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#A32D2D" }}>
                  {error}
                </div>
              )}

              {/* Provider */}
              <div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Fournisseur</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {["anthropic", "openai"].map((p) => (
                    <button
                      key={p}
                      onClick={() => setProvider(p)}
                      style={{
                        padding: "6px 14px", fontSize: 13, borderRadius: 8, cursor: "pointer",
                        border: provider === p ? "1.5px solid #333" : "0.5px solid #ddd",
                        background: provider === p ? "#333" : "transparent",
                        color: provider === p ? "#fff" : "#333",
                      }}>
                      {p === "anthropic" ? "Anthropic" : "OpenAI"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Clé API */}
              <div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                  Clé API {provider === "anthropic" ? "Anthropic" : "OpenAI"}
                  <span style={{ color: "#aaa", marginLeft: 6 }}>(stockée localement, laissez vide si configurée côté serveur)</span>
                </div>
                <input
                  type="password"
                  placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", fontSize: 13, fontFamily: "monospace", borderRadius: 8, border: "0.5px solid #ddd", boxSizing: "border-box" }}
                />
              </div>

              {/* Serveurs MCP */}
              {hasMcpServers && (
                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Serveurs MCP à utiliser</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {Object.keys(mcpServers).map((name) => (
                      <button
                        key={name}
                        onClick={() => toggleServer(name)}
                        style={{
                          padding: "5px 12px", fontSize: 12, borderRadius: 20, cursor: "pointer",
                          border: selectedServers.includes(name) ? "1.5px solid #0C447C" : "0.5px solid #ddd",
                          background: selectedServers.includes(name) ? "#E6F1FB" : "transparent",
                          color: selectedServers.includes(name) ? "#0C447C" : "#555",
                        }}>
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!hasMcpServers && (
                <p style={{ fontSize: 12, color: "#aaa", margin: 0 }}>
                  Aucun serveur MCP configuré.{" "}
                  <a href="/settings" style={{ color: "#0C447C" }}>Configurer</a>
                </p>
              )}

              <button
                onClick={launch}
                disabled={loading}
                style={{ alignSelf: "flex-start", padding: "9px 20px", fontSize: 14, borderRadius: 8, border: "1px solid #333", background: "#333", color: "#fff", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}>
                {loading ? "Lancement…" : "Lancer l'analyse"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
