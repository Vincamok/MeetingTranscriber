import { useState } from "react";

const LS_TOKEN = "minta_jwt";

export function getToken(): string | null {
  return localStorage.getItem(LS_TOKEN);
}

export function clearToken() {
  localStorage.removeItem(LS_TOKEN);
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface Props {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error(d.detail ?? "Identifiants invalides");
      }
      const { token } = await resp.json();
      if (token) localStorage.setItem(LS_TOKEN, token);
      onLogin();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 16, padding: "2rem", width: 320, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎙</div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Minta</h1>
          <p style={{ fontSize: 13, color: "#888", marginTop: 4 }}>Connexion requise</p>
        </div>
        <form onSubmit={submit}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ fontSize: 12, color: "#555", display: "block", marginBottom: 4 }}>Nom d'utilisateur</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
              style={{ width: "100%", padding: "8px 10px", fontSize: 14, borderRadius: 8, border: "0.5px solid #ccc", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ fontSize: 12, color: "#555", display: "block", marginBottom: 4 }}>Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: "100%", padding: "8px 10px", fontSize: 14, borderRadius: 8, border: "0.5px solid #ccc", boxSizing: "border-box" }}
            />
          </div>
          {error && (
            <div style={{ background: "#FCEBEB", border: "0.5px solid #F09595", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#A32D2D", marginBottom: "1rem" }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{ width: "100%", padding: "10px", fontSize: 14, borderRadius: 8, border: "none", background: "#333", color: "#fff", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}
