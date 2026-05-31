import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "./api";

interface McpServerConfig {
  type: "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface Settings {
  mcp_servers: Record<string, McpServerConfig>;
  default_provider: string;
  webhook_url: string;
  auto_analyze: boolean;
  auto_analyze_template: string;
  providers_available?: Record<string, boolean>;
}

const EMPTY_STDIO: McpServerConfig = { type: "stdio", command: "npx", args: [], env: {} };
const EMPTY_SSE: McpServerConfig = { type: "sse", url: "" };

const PRESETS: Record<string, McpServerConfig> = {
  linear: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@linear/mcp-server"],
    env: { LINEAR_API_KEY: "" },
  },
  github: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: "" },
  },
  notion: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-notion"],
    env: { NOTION_TOKEN: "" },
  },
  jira: {
    type: "stdio",
    command: "npx",
    args: ["-y", "jira-mcp"],
    env: { JIRA_URL: "", JIRA_TOKEN: "" },
  },
};

function EnvEditor({
  env,
  onChange,
}: {
  env: Record<string, string>;
  onChange: (env: Record<string, string>) => void;
}) {
  const entries = Object.entries(env);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            value={k}
            readOnly
            style={{ width: 160, padding: "5px 8px", fontSize: 12, fontFamily: "monospace", borderRadius: 6, border: "0.5px solid #ddd", background: "#f5f5f5" }}
          />
          <input
            type="password"
            placeholder="valeur"
            value={v}
            onChange={(e) => onChange({ ...env, [k]: e.target.value })}
            style={{ flex: 1, padding: "5px 8px", fontSize: 12, fontFamily: "monospace", borderRadius: 6, border: "0.5px solid #ddd" }}
          />
        </div>
      ))}
      <button
        onClick={() => {
          const key = prompt("Nom de la variable d'environnement :");
          if (key && !env[key]) onChange({ ...env, [key]: "" });
        }}
        style={{ alignSelf: "flex-start", fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "0.5px solid #bbb", background: "transparent", cursor: "pointer" }}>
        + Variable
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPreset, setNewPreset] = useState("linear");
  const [newType, setNewType] = useState<"stdio" | "sse">("stdio");
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => setError("Impossible de charger la configuration."));
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError("");
    try {
      const resp = await apiFetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mcp_servers: settings.mcp_servers,
          default_provider: settings.default_provider,
          webhook_url: settings.webhook_url,
          auto_analyze: settings.auto_analyze,
          auto_analyze_template: settings.auto_analyze_template,
        }),
      });
      if (!resp.ok) throw new Error((await resp.json()).detail);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const addServer = () => {
    if (!newName.trim() || !settings) return;
    const config = newName in PRESETS ? { ...PRESETS[newName] } : newType === "stdio" ? { ...EMPTY_STDIO } : { ...EMPTY_SSE };
    setSettings({ ...settings, mcp_servers: { ...settings.mcp_servers, [newName.trim()]: config } });
    setNewName("");
  };

  const updateServer = (name: string, updated: McpServerConfig) => {
    if (!settings) return;
    setSettings({ ...settings, mcp_servers: { ...settings.mcp_servers, [name]: updated } });
  };

  const removeServer = (name: string) => {
    if (!settings) return;
    const { [name]: _, ...rest } = settings.mcp_servers;
    setSettings({ ...settings, mcp_servers: rest });
  };

  if (!settings) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#aaa", fontSize: 14 }}>
        {error || "Chargement…"}
      </div>
    );
  }

  return (
    <div style={{ padding: "1.5rem 0", fontFamily: "system-ui, sans-serif", maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>⚙️ Paramètres</h1>
          <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Configuration IA et serveurs MCP</p>
        </div>
        <Link to="/" style={{ fontSize: 13, padding: "7px 14px", borderRadius: 8, border: "0.5px solid #ccc", textDecoration: "none", color: "#333" }}>
          ← Retour
        </Link>
      </div>

      {error && (
        <div style={{ background: "#FCEBEB", border: "0.5px solid #F09595", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#A32D2D", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {/* Fournisseur par défaut */}
      <section style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "1.25rem", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 1rem" }}>Fournisseur IA par défaut</h2>
        <div style={{ display: "flex", gap: 10 }}>
          {["anthropic", "openai"].map((p) => {
            const available = settings.providers_available?.[p];
            return (
              <button
                key={p}
                onClick={() => setSettings({ ...settings, default_provider: p })}
                style={{
                  padding: "8px 16px", fontSize: 13, borderRadius: 8, cursor: "pointer",
                  border: settings.default_provider === p ? "1.5px solid #333" : "0.5px solid #ddd",
                  background: settings.default_provider === p ? "#333" : "transparent",
                  color: settings.default_provider === p ? "#fff" : "#333",
                }}>
                {p === "anthropic" ? "Anthropic (Claude)" : "OpenAI (GPT-4o)"}
                {available !== undefined && (
                  <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>
                    {available ? "✓ clé .env" : "⚠ clé manquante"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 12, color: "#888", marginTop: 10 }}>
          Les clés API peuvent être saisies dans l'interface d'analyse (stockées dans votre navigateur uniquement).
        </p>
      </section>

      {/* Webhook */}
      <section style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "1.25rem", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 0.5rem" }}>Webhook fin de job</h2>
        <p style={{ fontSize: 12, color: "#888", margin: "0 0 0.75rem" }}>
          URL notifiée par POST JSON quand une transcription se termine.
        </p>
        <input
          type="url"
          placeholder="https://hooks.example.com/minta"
          value={settings.webhook_url ?? ""}
          onChange={(e) => setSettings({ ...settings, webhook_url: e.target.value })}
          style={{ width: "100%", padding: "8px 12px", fontSize: 13, borderRadius: 8, border: "0.5px solid #ddd", boxSizing: "border-box" }}
        />
      </section>

      {/* Auto-analyse */}
      <section style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "1.25rem", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 0.5rem" }}>Analyse IA automatique</h2>
        <p style={{ fontSize: 12, color: "#888", margin: "0 0 1rem" }}>
          Lancer automatiquement l'analyse IA dès qu'une transcription est terminée.
          Utilise la clé API configurée dans <code>.env</code>.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: "1rem" }}>
          <input
            type="checkbox"
            checked={settings.auto_analyze ?? false}
            onChange={(e) => setSettings({ ...settings, auto_analyze: e.target.checked })}
            style={{ width: 16, height: 16, cursor: "pointer" }}
          />
          <span style={{ fontSize: 14 }}>Activer l'analyse automatique</span>
        </label>
        {settings.auto_analyze && (
          <div>
            <label style={{ fontSize: 12, color: "#555", display: "block", marginBottom: 4 }}>Template d'analyse</label>
            <select
              value={settings.auto_analyze_template ?? "meeting"}
              onChange={(e) => setSettings({ ...settings, auto_analyze_template: e.target.value })}
              style={{ padding: "7px 10px", fontSize: 13, borderRadius: 8, border: "0.5px solid #ddd", background: "#fafafa" }}>
              <option value="meeting">Réunion projet</option>
              <option value="interview">Entretien candidat</option>
              <option value="support">Support client</option>
              <option value="demo">Démo commerciale</option>
            </select>
          </div>
        )}
      </section>

      {/* Serveurs MCP */}
      <section style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "1.25rem", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 1rem" }}>Serveurs MCP</h2>

        {Object.keys(settings.mcp_servers).length === 0 && (
          <p style={{ fontSize: 13, color: "#aaa", marginBottom: "1rem" }}>Aucun serveur configuré.</p>
        )}

        {Object.entries(settings.mcp_servers).map(([name, config]) => (
          <div key={name} style={{ border: "0.5px solid #eee", borderRadius: 10, padding: "1rem", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{name}</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "#f0f0f0", color: "#666" }}>
                  {config.type}
                </span>
                <button
                  onClick={() => removeServer(name)}
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "0.5px solid #F09595", color: "#A32D2D", background: "transparent", cursor: "pointer" }}>
                  Supprimer
                </button>
              </div>
            </div>

            {config.type === "stdio" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    placeholder="commande"
                    value={config.command ?? ""}
                    onChange={(e) => updateServer(name, { ...config, command: e.target.value })}
                    style={{ flex: 1, padding: "5px 8px", fontSize: 12, fontFamily: "monospace", borderRadius: 6, border: "0.5px solid #ddd" }}
                  />
                  <input
                    placeholder="args (séparés par des espaces)"
                    value={(config.args ?? []).join(" ")}
                    onChange={(e) => updateServer(name, { ...config, args: e.target.value.split(" ").filter(Boolean) })}
                    style={{ flex: 2, padding: "5px 8px", fontSize: 12, fontFamily: "monospace", borderRadius: 6, border: "0.5px solid #ddd" }}
                  />
                </div>
                {config.env && Object.keys(config.env).length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Variables d'environnement</div>
                    <EnvEditor
                      env={config.env}
                      onChange={(env) => updateServer(name, { ...config, env })}
                    />
                  </div>
                )}
              </div>
            ) : (
              <input
                placeholder="URL SSE (https://...)"
                value={config.url ?? ""}
                onChange={(e) => updateServer(name, { ...config, url: e.target.value })}
                style={{ width: "100%", padding: "5px 8px", fontSize: 12, fontFamily: "monospace", borderRadius: 6, border: "0.5px solid #ddd", boxSizing: "border-box" }}
              />
            )}
          </div>
        ))}

        {/* Ajouter un serveur */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: "0.5px solid #eee" }}>
          <input
            placeholder="Nom du serveur (ex: linear)"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (PRESETS[e.target.value]) setNewPreset(e.target.value);
            }}
            list="server-presets"
            style={{ flex: 1, minWidth: 160, padding: "7px 10px", fontSize: 13, borderRadius: 8, border: "0.5px solid #ddd" }}
          />
          <datalist id="server-presets">
            {Object.keys(PRESETS).map((p) => <option key={p} value={p} />)}
          </datalist>
          {!PRESETS[newName] && (
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as "stdio" | "sse")}
              style={{ padding: "7px 10px", fontSize: 13, borderRadius: 8, border: "0.5px solid #ddd" }}>
              <option value="stdio">stdio</option>
              <option value="sse">SSE</option>
            </select>
          )}
          <button
            onClick={addServer}
            disabled={!newName.trim()}
            style={{ padding: "7px 14px", fontSize: 13, borderRadius: 8, border: "1px solid #333", background: "#333", color: "#fff", cursor: "pointer", opacity: !newName.trim() ? 0.4 : 1 }}>
            + Ajouter
          </button>
        </div>
      </section>

      {/* Sauvegarde */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        {saved && <span style={{ fontSize: 13, color: "#3B6D11", alignSelf: "center" }}>✓ Enregistré</span>}
        <button
          onClick={save}
          disabled={saving}
          style={{ padding: "9px 20px", fontSize: 14, borderRadius: 8, border: "1px solid #333", background: "#333", color: "#fff", cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
