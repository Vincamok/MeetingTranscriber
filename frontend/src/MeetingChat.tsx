import { useState, useRef, useEffect } from "react";
import { apiFetch } from "./api";

interface Message { role: "user" | "assistant"; content: string; }

interface Props {
  jobId: string;
  defaultProvider?: string;
}

export default function MeetingChat({ jobId, defaultProvider = "anthropic" }: Props) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState(defaultProvider);
  const [apiKey, setApiKey] = useState(() => {
    const k = provider === "anthropic" ? "minta_anthropic_key" : "minta_openai_key";
    return localStorage.getItem(k) ?? "";
  });
  const [showKeyInput, setShowKeyInput] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, loading]);

  const persistKey = (key: string, prov: string) => {
    const k = prov === "anthropic" ? "minta_anthropic_key" : "minta_openai_key";
    if (key) localStorage.setItem(k, key);
  };

  const send = async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    if (!apiKey) { setShowKeyInput(true); return; }
    setInput("");
    setError("");
    const newHistory: Message[] = [...history, { role: "user", content: msg }];
    setHistory(newHistory);
    setLoading(true);
    try {
      persistKey(apiKey, provider);
      const resp = await apiFetch(`/api/transcribe/${jobId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history, provider, api_key: apiKey }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error(d.detail ?? resp.statusText);
      }
      const { reply } = await resp.json();
      setHistory([...newHistory, { role: "assistant", content: reply }]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setHistory(history); // rollback
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: "1.5rem", borderTop: "0.5px solid #eee", paddingTop: "1rem" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 15, fontWeight: 500, color: "#333" }}>
        <span>💬 Chat avec l'IA</span>
        <span style={{ fontSize: 12, color: "#aaa" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ marginTop: "0.75rem" }}>
          {/* Provider + key row */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={provider} onChange={(e) => {
              setProvider(e.target.value);
              const k = e.target.value === "anthropic" ? "minta_anthropic_key" : "minta_openai_key";
              setApiKey(localStorage.getItem(k) ?? "");
            }} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "0.5px solid #ddd" }}>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </select>
            <button onClick={() => setShowKeyInput((s) => !s)}
              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "0.5px solid #bbb", background: "transparent", cursor: "pointer", color: "#666" }}>
              {apiKey ? "🔑 Clé configurée" : "🔑 Clé API"}
            </button>
            {history.length > 0 && (
              <button onClick={() => setHistory([])}
                style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "0.5px solid #bbb", background: "transparent", cursor: "pointer", color: "#666", marginLeft: "auto" }}>
                Effacer
              </button>
            )}
          </div>

          {showKeyInput && (
            <div style={{ marginBottom: 8, display: "flex", gap: 6 }}>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
                style={{ flex: 1, fontSize: 12, padding: "5px 8px", borderRadius: 6, border: "0.5px solid #ddd" }}
              />
              <button onClick={() => { persistKey(apiKey, provider); setShowKeyInput(false); }}
                style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, border: "none", background: "#333", color: "#fff", cursor: "pointer" }}>
                OK
              </button>
            </div>
          )}

          {/* Messages */}
          <div style={{ maxHeight: 340, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: 8, padding: "4px 0" }}>
            {history.length === 0 && (
              <p style={{ fontSize: 13, color: "#aaa", textAlign: "center", margin: "1rem 0" }}>
                Posez une question sur cette réunion…
              </p>
            )}
            {history.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "82%",
                background: m.role === "user" ? "#333" : "#f0f0f0",
                color: m.role === "user" ? "#fff" : "#333",
                padding: "8px 12px",
                borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}>
                {m.content}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: "flex-start", background: "#f0f0f0", padding: "8px 12px", borderRadius: "12px 12px 12px 2px", fontSize: 13, color: "#888" }}>
                …
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {error && (
            <div style={{ fontSize: 12, color: "#A32D2D", background: "#FCEBEB", borderRadius: 6, padding: "6px 10px", marginBottom: 8 }}>{error}</div>
          )}

          {/* Input */}
          <div style={{ display: "flex", gap: 6 }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Entrée pour envoyer, Shift+Entrée pour saut de ligne"
              rows={2}
              style={{ flex: 1, fontSize: 13, padding: "7px 10px", borderRadius: 8, border: "0.5px solid #ddd", resize: "none", fontFamily: "inherit" }}
            />
            <button onClick={send} disabled={loading || !input.trim()}
              style={{ padding: "0 14px", fontSize: 16, borderRadius: 8, border: "none", background: "#333", color: "#fff", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1 }}>
              ↑
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
