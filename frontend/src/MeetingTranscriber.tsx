import { useState, useRef, useEffect, useCallback, MutableRefObject } from "react";
import AIAnalysisPanel from "./AIAnalysisPanel";
import MeetingChat from "./MeetingChat";
import { apiFetch } from "./api";

const SPEAKER_COLORS = [
  { bg: "#E6F1FB", text: "#0C447C" },
  { bg: "#EAF3DE", text: "#3B6D11" },
  { bg: "#FAEEDA", text: "#854F0B" },
  { bg: "#FBEAF0", text: "#72243E" },
  { bg: "#EEEDFE", text: "#3C3489" },
];

const LANGUAGES = [
  { value: "auto", label: "Auto-détection" },
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Português" },
  { value: "ja", label: "日本語" },
  { value: "zh", label: "中文" },
];

const ACCEPT = "audio/*,video/mp4,video/x-matroska,video/avi,video/quicktime,video/x-msvideo,.mkv,.avi,.mov,.mp4,.m4v";

interface Word { text: string; start: number; end: number; }
interface Utterance { speaker: string; start: number; end: number; text: string; words: Word[]; comment?: string; edited?: boolean; }
interface Analysis {
  status: "running" | "completed" | "error";
  provider: string; template: string;
  summary: string; decisions: string[];
  actions: { text: string; assignee: string | null; due: string | null }[];
  topics: string[];
  sentiment_per_speaker: Record<string, string>;
  suggested_speaker_names: Record<string, string>;
  chapters: { title: string; start_ms: number; summary: string }[];
  mcp_results: { server: string; action: string; result: string }[];
  error: string | null; created_at: string | null;
}
interface Job {
  id: string; status: "processing" | "completed" | "error";
  utterances: Utterance[]; text: string; speakers: string[];
  speaker_names: Record<string, string>;
  title?: string; filename?: string;
  duration_ms: number; word_count: number; language?: string;
  error?: string | null; queue_position?: number; message?: string;
  has_audio?: boolean; share_token?: string | null;
  analysis?: Analysis | null;
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function fmtSec(s: number): string {
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}m${String(sec).padStart(2, "0")}s` : `${s}s`;
}

interface Props {
  onRecordingChange?: (v: boolean) => void;
  onAnalyzingChange?: (v: boolean) => void;
  resetRef?: MutableRefObject<(() => void) | null>;
}

export default function MeetingTranscriber({ onRecordingChange, onAnalyzingChange, resetRef }: Props = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [hasAudio, setHasAudio] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [language, setLanguage] = useState("auto");
  const [numSpeakers, setNumSpeakers] = useState(0);
  const [status, setStatus] = useState("Prêt à enregistrer");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [queueMessage, setQueueMessage] = useState("");
  const [currentMs, setCurrentMs] = useState(0);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sharing, setSharing] = useState(false);
  const [editingSegment, setEditingSegment] = useState<number | null>(null);
  const [editSegmentValue, setEditSegmentValue] = useState("");
  const [commentingSegment, setCommentingSegment] = useState<number | null>(null);
  const [commentValue, setCommentValue] = useState("");
  const [liveUtterances, setLiveUtterances] = useState<Utterance[]>([]);
  const [liveLanguage, setLiveLanguage] = useState<string>("");
  const [wsConnected, setWsConnected] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioBlobRef = useRef<Blob | null>(null);
  const uploadedFileRef = useRef<File | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const playerSrcRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsSendIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const drawWave = useCallback(() => {
    const canvas = canvasRef.current, analyzer = analyzerRef.current;
    if (!canvas || !analyzer) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    const data = new Uint8Array(analyzer.frequencyBinCount);
    const frame = () => {
      animFrameRef.current = requestAnimationFrame(frame);
      analyzer.getByteTimeDomainData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#333"; ctx.lineWidth = 1.5; ctx.beginPath();
      const sliceW = canvas.width / data.length; let x = 0;
      data.forEach((d, i) => {
        const y = (d / 128) * (canvas.height / 2);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); x += sliceW;
      }); ctx.stroke();
    }; frame();
  }, []);

  const _connectWs = (lang: string) => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const token = localStorage.getItem("minta_jwt") ?? "";
    const url = `${proto}://${host}/api/ws/transcribe?language=${lang}${token ? `&token=${token}` : ""}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => { setWsConnected(false); wsRef.current = null; };
    ws.onerror = () => setWsConnected(false);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string);
        if (msg.type === "partial" && Array.isArray(msg.utterances)) {
          setLiveUtterances(msg.utterances);
          if (msg.language) setLiveLanguage(msg.language);
        }
      } catch { /* ignore */ }
    };
    wsRef.current = ws;
  };

  const _disconnectWs = () => {
    if (wsSendIntervalRef.current) { clearInterval(wsSendIntervalRef.current); wsSendIntervalRef.current = null; }
    if (wsRef.current) {
      try { wsRef.current.send(JSON.stringify({ type: "stop" })); } catch { /* ignore */ }
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsConnected(false);
  };

  const startRecording = async () => {
    setError(""); setLiveUtterances([]); setLiveLanguage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtxRef.current = new AudioContext();
      analyzerRef.current = audioCtxRef.current.createAnalyser();
      analyzerRef.current.fftSize = 256;
      audioCtxRef.current.createMediaStreamSource(stream).connect(analyzerRef.current);
      drawWave();
      audioChunksRef.current = [];
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.onstop = () => {
        audioBlobRef.current = new Blob(audioChunksRef.current, { type: "audio/webm" });
        uploadedFileRef.current = null; setUploadedFileName(""); setHasAudio(true);
        setStatus("Enregistrement terminé");
      };
      // Collecte les chunks toutes les 200ms pour construire des blobs cumulatifs
      mediaRecorderRef.current.start(200);
      setIsRecording(true); setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setStatus("Enregistrement en cours...");

      // Connexion WebSocket et envoi du blob cumulatif toutes les 4s
      _connectWs(language);
      wsSendIntervalRef.current = setInterval(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const chunks = audioChunksRef.current;
        if (chunks.length === 0) return;
        const blob = new Blob(chunks, { type: "audio/webm" });
        blob.arrayBuffer().then((buf) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(buf);
        });
      }, 4000);
    } catch (e: unknown) {
      setError("Accès micro refusé : " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const stopRecording = () => {
    _disconnectWs();
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    cancelAnimationFrame(animFrameRef.current); setIsRecording(false);
    canvasRef.current?.getContext("2d")?.clearRect(0, 0, 9999, 9999);
  };

  const handleFile = (file: File) => {
    uploadedFileRef.current = file; audioBlobRef.current = null;
    setUploadedFileName(`${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
    setHasAudio(true); setError("");
  };

  // Player setup
  const setupPlayer = useCallback((jobId: string, blob?: Blob) => {
    if (playerRef.current) {
      playerRef.current.pause();
      if (playerSrcRef.current) URL.revokeObjectURL(playerSrcRef.current);
    }
    const audio = new Audio();
    if (blob) {
      const url = URL.createObjectURL(blob);
      playerSrcRef.current = url;
      audio.src = url;
    } else {
      audio.src = `/api/transcribe/${jobId}/audio`;
      playerSrcRef.current = null;
    }
    audio.ontimeupdate = () => setCurrentMs(Math.floor(audio.currentTime * 1000));
    playerRef.current = audio;
  }, []);

  const seekTo = (ms: number) => {
    if (!playerRef.current) return;
    playerRef.current.currentTime = ms / 1000;
    playerRef.current.play().catch(() => {});
    setCurrentMs(ms);
  };

  const pollJob = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const resp = await apiFetch(`/api/transcribe/${jobId}`);
        if (!resp.ok) return;
        const data: Job = await resp.json();
        if (data.status === "completed" || data.status === "error") {
          clearInterval(pollRef.current!);
          setProgress(100); setProgressLabel(data.status === "completed" ? "Terminé !" : "Erreur");
          setAnalyzing(false);
          if (data.status === "error") setError("Erreur : " + (data.error ?? "inconnue"));
          setJob(data);
          if (data.status === "completed") {
            const blob = audioBlobRef.current || (uploadedFileRef.current ? uploadedFileRef.current : undefined);
            setupPlayer(jobId, blob);
          }
        } else {
          setProgressLabel("Transcription en cours...");
          setProgress((p) => Math.min(p + 3, 90));
        }
      } catch { /* réseau — on réessaie */ }
    }, 3000);
  }, [setupPlayer]);

  const analyzeAudio = async () => {
    const fileToSend = uploadedFileRef.current || audioBlobRef.current;
    if (!fileToSend) { setError("Aucun audio disponible."); return; }
    setError(""); setJob(null); setQueueMessage(""); setAnalyzing(true); setProgress(10);
    setProgressLabel("Upload du fichier audio...");
    try {
      const form = new FormData();
      form.append("file", fileToSend, uploadedFileRef.current?.name ?? "recording.webm");
      form.append("language", language);
      form.append("num_speakers", String(numSpeakers));
      const resp = await apiFetch("/api/upload", { method: "POST", body: form });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(d.detail ?? resp.statusText);
      }
      const data = await resp.json();
      setProgress(30); setProgressLabel(data.message ?? "Transcription démarrée...");
      if (data.queue_position > 0) setQueueMessage(data.message);
      pollJob(data.id);
    } catch (e: unknown) {
      setError("Erreur : " + (e instanceof Error ? e.message : String(e)));
      setAnalyzing(false);
    }
  };

  const exportTranscript = async (format: "txt" | "srt" | "json" | "docx") => {
    if (!job) return;
    const resp = await apiFetch(`/api/transcribe/${job.id}/export?format=${format}`);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `transcription.${format}`; a.click();
    URL.revokeObjectURL(url);
  };

  const saveNameEdit = async () => {
    if (!job || !editingName) return;
    const newNames = { ...job.speaker_names, [editingName]: editValue };
    await apiFetch(`/api/transcribe/${job.id}/speakers`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker_names: newNames }),
    });
    setJob({ ...job, speaker_names: newNames });
    setEditingName(null);
  };

  const saveSegmentEdit = async (idx: number) => {
    if (!job) return;
    await apiFetch(`/api/transcribe/${job.id}/segments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: [{ index: idx, text: editSegmentValue }] }),
    });
    setJob((j) => {
      if (!j) return j;
      const u = [...j.utterances];
      u[idx] = { ...u[idx], text: editSegmentValue, edited: true };
      return { ...j, utterances: u };
    });
    setEditingSegment(null);
  };

  const saveComment = async (idx: number) => {
    if (!job) return;
    await apiFetch(`/api/transcribe/${job.id}/segments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: [{ index: idx, comment: commentValue }] }),
    });
    setJob((j) => {
      if (!j) return j;
      const u = [...j.utterances];
      u[idx] = { ...u[idx], comment: commentValue };
      return { ...j, utterances: u };
    });
    setCommentingSegment(null);
  };

  const saveTitle = async () => {
    if (!job) return;
    const t = titleValue.trim();
    if (!t) { setEditingTitle(false); return; }
    await apiFetch(`/api/transcribe/${job.id}/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t }),
    });
    setJob({ ...job, title: t });
    setEditingTitle(false);
  };

  const createShare = async () => {
    if (!job) return;
    setSharing(true);
    const resp = await apiFetch(`/api/transcribe/${job.id}/share`, { method: "POST" });
    if (resp.ok) {
      const { share_token } = await resp.json();
      setJob({ ...job, share_token });
    }
    setSharing(false);
  };

  // Propager isRecording / isAnalyzing vers App
  useEffect(() => { onRecordingChange?.(isRecording); }, [isRecording, onRecordingChange]);
  useEffect(() => { onAnalyzingChange?.(analyzing); }, [analyzing, onAnalyzingChange]);

  // Exposer la fonction reset pour "Nouvelle transcription"
  useEffect(() => {
    if (!resetRef) return;
    resetRef.current = () => {
      stopRecording();
      if (pollRef.current) clearInterval(pollRef.current);
      setJob(null); setError(""); setAnalyzing(false); setProgress(0);
      setProgressLabel(""); setQueueMessage(""); setHasAudio(false);
      setUploadedFileName(""); audioBlobRef.current = null; uploadedFileRef.current = null;
      setLiveUtterances([]); setLiveLanguage("");
    };
  });

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    if (playerSrcRef.current) URL.revokeObjectURL(playerSrcRef.current);
    _disconnectWs();
  }, []);

  // Quand le job est complété, on efface le live transcript (remplacé par le résultat final)
  useEffect(() => {
    if (job?.status === "completed") setLiveUtterances([]);
  }, [job?.status]);

  const utterances = job?.utterances ?? [];
  const speakers = job?.speakers ?? [];
  const speakerMap = Object.fromEntries(speakers.map((s, i) => [s, i]));
  const speakerNames = job?.speaker_names ?? {};
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div style={{ padding: "1.5rem 0", fontFamily: "system-ui, sans-serif", maxWidth: 680 }}>
      <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          {job ? (
            editingTitle ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input value={titleValue} onChange={(e) => setTitleValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
                  autoFocus
                  style={{ fontSize: 18, fontWeight: 500, padding: "2px 8px", borderRadius: 6, border: "1px solid #bbb", width: 280 }} />
                <button onClick={saveTitle}
                  style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "none", background: "#333", color: "#fff", cursor: "pointer" }}>✓</button>
                <button onClick={() => setEditingTitle(false)}
                  style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "0.5px solid #bbb", background: "transparent", cursor: "pointer" }}>✕</button>
              </div>
            ) : (
              <h1 onClick={() => { setEditingTitle(true); setTitleValue(job.title || job.filename || "Réunion"); }}
                title="Cliquer pour renommer"
                style={{ fontSize: 20, fontWeight: 500, margin: 0, cursor: "text", display: "flex", alignItems: "center", gap: 8 }}>
                {job.title || job.filename || "Réunion"}
                <span style={{ fontSize: 12, color: "#ccc" }}>✏</span>
              </h1>
            )
          ) : (
            <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>🎙 Minta</h1>
          )}
          <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Transcription locale · faster-whisper + pyannote · 100% auto-hébergé</p>
        </div>
        {job && (
          <button onClick={() => {
            if (pollRef.current) clearInterval(pollRef.current);
            setJob(null); setError(""); setAnalyzing(false); setProgress(0);
            setProgressLabel(""); setQueueMessage(""); setHasAudio(false);
            setUploadedFileName(""); audioBlobRef.current = null; uploadedFileRef.current = null;
            setLiveUtterances([]); setLiveLanguage("");
          }}
            style={{ fontSize: 12, padding: "5px 12px", borderRadius: 8, border: "0.5px solid #ddd", background: "transparent", cursor: "pointer", color: "#666", whiteSpace: "nowrap", flexShrink: 0 }}>
            + Nouvelle transcription
          </button>
        )}
      </div>

      {/* Recorder */}
      <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "1.25rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1rem" }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#D85A30", flexShrink: 0, animation: isRecording ? "pulse 1s infinite" : "none" }} />
          <span style={{ fontSize: 22, fontWeight: 500, fontFamily: "monospace", letterSpacing: 2 }}>{mm}:{ss}</span>
          <span style={{ fontSize: 13, color: "#666", marginLeft: "auto" }}>{status}</span>
        </div>
        <div style={{ height: 56, borderRadius: 8, background: "#f5f5f5", overflow: "hidden", marginBottom: "1rem" }}>
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={startRecording} disabled={isRecording} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 13, borderRadius: 8, border: "1px solid #333", background: "#333", color: "#fff", cursor: isRecording ? "not-allowed" : "pointer", opacity: isRecording ? 0.4 : 1 }}>⏺ Enregistrer</button>
          <button onClick={stopRecording} disabled={!isRecording} style={{ padding: "8px 16px", fontSize: 13, borderRadius: 8, border: "0.5px solid #ccc", background: "transparent", cursor: !isRecording ? "not-allowed" : "pointer", opacity: !isRecording ? 0.4 : 1 }}>⏹ Arrêter</button>
          {/* Langue */}
          <select value={language} onChange={(e) => setLanguage(e.target.value)}
            style={{ marginLeft: "auto", padding: "7px 10px", fontSize: 12, borderRadius: 8, border: "0.5px solid #ddd", background: "#fafafa" }}>
            {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <select value={numSpeakers} onChange={(e) => setNumSpeakers(Number(e.target.value))}
            title="Nombre de locuteurs (améliore la diarisation)"
            style={{ padding: "7px 10px", fontSize: 12, borderRadius: 8, border: "0.5px solid #ddd", background: "#fafafa" }}>
            <option value={0}>👥 Auto</option>
            {[2,3,4,5,6,7,8].map((n) => <option key={n} value={n}>{n} locuteurs</option>)}
          </select>
          <button onClick={analyzeAudio} disabled={!hasAudio || analyzing}
            style={{ padding: "8px 16px", fontSize: 13, borderRadius: 8, border: "0.5px solid #E24B4A", color: "#A32D2D", background: "transparent", cursor: (!hasAudio || analyzing) ? "not-allowed" : "pointer", opacity: (!hasAudio || analyzing) ? 0.4 : 1 }}>
            ✦ Analyser
          </button>
        </div>
      </div>

      {/* Upload */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "1rem 0", color: "#aaa", fontSize: 12 }}>
        <div style={{ flex: 1, borderTop: "0.5px solid #ddd" }} />
        ou importer un fichier
        <div style={{ flex: 1, borderTop: "0.5px solid #ddd" }} />
      </div>
      <div onClick={() => document.getElementById("fileInput")?.click()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onDragOver={(e) => e.preventDefault()}
        style={{ border: "0.5px dashed #bbb", borderRadius: 12, padding: "1.5rem", textAlign: "center", cursor: "pointer" }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>🎵</div>
        <p style={{ fontSize: 13, color: "#666" }}>Cliquez ou glissez un fichier audio ou vidéo</p>
        <p style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>MP3, WAV, M4A, WEBM, MP4, MKV, MOV — jusqu'à 500MB</p>
        {uploadedFileName && <p style={{ fontSize: 13, fontWeight: 500, marginTop: 4 }}>{uploadedFileName}</p>}
      </div>
      <input type="file" id="fileInput" accept={ACCEPT} style={{ display: "none" }}
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />

      {queueMessage && !error && (
        <div style={{ background: "#FFF8E1", border: "0.5px solid #FFD54F", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#795B00", margin: "0.5rem 0" }}>⏳ {queueMessage}</div>
      )}
      {error && (
        <div style={{ background: "#FCEBEB", border: "0.5px solid #F09595", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#A32D2D", margin: "0.5rem 0" }}>{error}</div>
      )}
      {analyzing && (
        <div style={{ margin: "1rem 0" }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{progressLabel}</div>
          <div style={{ height: 4, background: "#eee", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", background: "#333", borderRadius: 2, width: `${progress}%`, transition: "width 0.3s" }} />
          </div>
        </div>
      )}

      {/* Transcript */}
      <div style={{ marginTop: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>📋 Transcription</h2>
            {job?.language && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "#f0f0f0", color: "#666" }}>{job.language}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {utterances.length > 0 && (
              <>
                {(["txt", "srt", "json", "docx"] as const).map((fmt) => (
                  <button key={fmt} onClick={() => exportTranscript(fmt)}
                    style={{ padding: "3px 10px", fontSize: 11, borderRadius: 6, border: "0.5px solid #bbb", background: "transparent", cursor: "pointer" }}>
                    ↓ {fmt.toUpperCase()}
                  </button>
                ))}
                {!job?.share_token ? (
                  <button onClick={createShare} disabled={sharing}
                    style={{ padding: "3px 10px", fontSize: 11, borderRadius: 6, border: "0.5px solid #bbb", background: "transparent", cursor: "pointer" }}>
                    🔗 Partager
                  </button>
                ) : (
                  <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/share/${job.share_token}`); }}
                    style={{ padding: "3px 10px", fontSize: 11, borderRadius: 6, border: "0.5px solid #3B6D11", color: "#3B6D11", background: "#EAF3DE", cursor: "pointer" }}>
                    ✓ Lien copié
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Player synchronisé */}
        {job?.status === "completed" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#f9f9f9", borderRadius: 10, marginBottom: "1rem" }}>
            <button onClick={() => playerRef.current?.paused ? playerRef.current?.play() : playerRef.current?.pause()}
              style={{ fontSize: 18, background: "none", border: "none", cursor: "pointer", lineHeight: 1 }}>▶</button>
            <span style={{ fontSize: 12, fontFamily: "monospace", color: "#555", minWidth: 50 }}>{fmtMs(currentMs)}</span>
            <div style={{ flex: 1, height: 4, background: "#ddd", borderRadius: 2, cursor: "pointer" }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                const dur = job.duration_ms;
                seekTo(Math.floor(ratio * dur));
              }}>
              <div style={{ height: "100%", background: "#333", borderRadius: 2, width: `${job.duration_ms ? (currentMs / job.duration_ms) * 100 : 0}%` }} />
            </div>
            <span style={{ fontSize: 12, fontFamily: "monospace", color: "#555" }}>{fmtMs(job.duration_ms)}</span>
          </div>
        )}

        {/* Stats */}
        {utterances.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: "1rem" }}>
            {[
              { label: "Locuteurs", val: speakers.length },
              { label: "Mots", val: job?.word_count ?? 0 },
              { label: "Durée", val: fmtSec(Math.round((job?.duration_ms ?? 0) / 1000)) },
              { label: "Segments", val: utterances.length },
            ].map(({ label, val }) => (
              <div key={label} style={{ background: "#f5f5f5", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 500 }}>{val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Live transcript (pendant l'enregistrement) */}
        {utterances.length === 0 && liveUtterances.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#E24B4A", animation: "pulse 1s infinite" }} />
              <span style={{ fontSize: 12, color: "#666" }}>
                Transcription en direct{liveLanguage ? ` · ${liveLanguage}` : ""}
                {wsConnected ? "" : " · en attente…"}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, opacity: 0.9 }}>
              {liveUtterances.map((u, idx) => (
                <div key={idx} style={{ display: "flex", gap: 12, padding: "8px 12px", borderRadius: 8, background: "#f9f9f9" }}>
                  <div style={{ flexShrink: 0, width: 70, fontSize: 11, fontFamily: "monospace", color: "#aaa", paddingTop: 2 }}>{fmtMs(u.start)}</div>
                  <div style={{ fontSize: 14, color: "#444", lineHeight: 1.6, flex: 1 }}>{u.text}</div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "#aaa", marginTop: 8 }}>
              Aperçu temps réel — la transcription finale avec identification des locuteurs sera disponible après avoir cliqué sur "Analyser".
            </p>
          </div>
        )}

        {utterances.length === 0 && liveUtterances.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "#aaa", fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎤</div>
            Enregistrez ou importez un fichier audio/vidéo, puis cliquez sur Analyser
          </div>
        ) : utterances.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {utterances.map((u, idx) => {
              const si = speakerMap[u.speaker] ?? 0;
              const color = SPEAKER_COLORS[si % SPEAKER_COLORS.length];
              const isActive = currentMs >= u.start && currentMs < u.end;
              const displayName = speakerNames[u.speaker] ?? `Locuteur ${String.fromCharCode(65 + si)}`;
              const isEditingSeg = editingSegment === idx;
              const isCommentingSeg = commentingSegment === idx;
              return (
                <div key={idx}
                  style={{ display: "flex", gap: 12, padding: "10px 12px", borderRadius: 8,
                    background: isActive ? "#fffde7" : "transparent",
                    outline: isActive ? "1.5px solid #FFD54F" : "none",
                    position: "relative" }}
                  onMouseEnter={(e) => { (e.currentTarget.querySelector(".seg-actions") as HTMLElement | null)?.style && ((e.currentTarget.querySelector(".seg-actions") as HTMLElement).style.opacity = "1"); }}
                  onMouseLeave={(e) => { (e.currentTarget.querySelector(".seg-actions") as HTMLElement | null)?.style && ((e.currentTarget.querySelector(".seg-actions") as HTMLElement).style.opacity = "0"); }}>
                  <div style={{ flexShrink: 0, width: 90 }}>
                    <div style={{ fontSize: 11, fontFamily: "monospace", color: "#888", marginBottom: 4, cursor: "pointer" }}
                      onClick={() => seekTo(u.start)}>{fmtMs(u.start)}</div>
                    {editingName === u.speaker ? (
                      <div style={{ display: "flex", gap: 4 }}>
                        <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveNameEdit(); if (e.key === "Escape") setEditingName(null); }}
                          autoFocus
                          style={{ width: 70, fontSize: 11, padding: "2px 4px", borderRadius: 4, border: "1px solid #bbb" }} />
                        <button onClick={saveNameEdit} style={{ fontSize: 10, padding: "2px 4px", borderRadius: 4, border: "none", background: "#333", color: "#fff", cursor: "pointer" }}>✓</button>
                      </div>
                    ) : (
                      <span onClick={(e) => { e.stopPropagation(); setEditingName(u.speaker); setEditValue(displayName); }}
                        title="Cliquer pour renommer"
                        style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: color.bg, color: color.text, cursor: "text" }}>
                        {displayName}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, color: "#333", lineHeight: 1.6, flex: 1 }}>
                    {isEditingSeg ? (
                      <div onClick={(e) => e.stopPropagation()}>
                        <textarea value={editSegmentValue} onChange={(e) => setEditSegmentValue(e.target.value)}
                          style={{ width: "100%", fontSize: 14, lineHeight: 1.6, borderRadius: 6, border: "1px solid #bbb", padding: "4px 6px", resize: "vertical", fontFamily: "inherit" }}
                          rows={3} autoFocus />
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button onClick={() => saveSegmentEdit(idx)}
                            style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "none", background: "#333", color: "#fff", cursor: "pointer" }}>✓ Enregistrer</button>
                          <button onClick={() => setEditingSegment(null)}
                            style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "0.5px solid #bbb", background: "transparent", cursor: "pointer" }}>Annuler</button>
                        </div>
                      </div>
                    ) : (
                      <span onDoubleClick={(e) => { e.stopPropagation(); setEditingSegment(idx); setEditSegmentValue(u.text); }}
                        title="Double-clic pour modifier"
                        style={{ cursor: "text" }}>
                        {u.text}
                        {u.edited && <span style={{ fontSize: 10, color: "#aaa", marginLeft: 6 }}>✏</span>}
                      </span>
                    )}
                    {isCommentingSeg ? (
                      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 6 }}>
                        <textarea value={commentValue} onChange={(e) => setCommentValue(e.target.value)}
                          placeholder="Ajouter un commentaire..."
                          style={{ width: "100%", fontSize: 12, borderRadius: 6, border: "1px solid #bbb", padding: "4px 6px", resize: "vertical", fontFamily: "inherit" }}
                          rows={2} autoFocus />
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button onClick={() => saveComment(idx)}
                            style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "none", background: "#333", color: "#fff", cursor: "pointer" }}>💬 Sauvegarder</button>
                          <button onClick={() => setCommentingSegment(null)}
                            style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "0.5px solid #bbb", background: "transparent", cursor: "pointer" }}>Annuler</button>
                        </div>
                      </div>
                    ) : u.comment ? (
                      <div style={{ fontSize: 12, color: "#888", fontStyle: "italic", marginTop: 4, borderLeft: "2px solid #ddd", paddingLeft: 8 }}
                        onClick={(e) => { e.stopPropagation(); setCommentingSegment(idx); setCommentValue(u.comment ?? ""); }}>
                        💬 {u.comment}
                      </div>
                    ) : null}
                  </div>
                  {/* Hover actions */}
                  <div className="seg-actions" style={{ position: "absolute", top: 8, right: 8, opacity: 0, transition: "opacity 0.15s", display: "flex", gap: 4 }}>
                    {!isEditingSeg && (
                      <button onClick={(e) => { e.stopPropagation(); setEditingSegment(idx); setEditSegmentValue(u.text); }}
                        title="Modifier le texte"
                        style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "0.5px solid #ccc", background: "#fff", cursor: "pointer" }}>✏</button>
                    )}
                    {!isCommentingSeg && (
                      <button onClick={(e) => { e.stopPropagation(); setCommentingSegment(idx); setCommentValue(u.comment ?? ""); }}
                        title="Ajouter un commentaire"
                        style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "0.5px solid #ccc", background: "#fff", cursor: "pointer" }}>💬</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Analyse IA */}
      {job?.status === "completed" && (
        <AIAnalysisPanel
          jobId={job.id}
          existingAnalysis={job.analysis ?? null}
          speakerNames={speakerNames}
          onAnalysisUpdate={(analysis) => setJob((j) => j ? { ...j, analysis } : j)}
          onApplySpeakerNames={async (names) => {
            await apiFetch(`/api/transcribe/${job.id}/speakers`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ speaker_names: names }),
            });
            setJob((j) => j ? { ...j, speaker_names: { ...j.speaker_names, ...names } } : j);
          }}
        />
      )}

      {/* Chat IA */}
      {job?.status === "completed" && <MeetingChat jobId={job.id} />}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
}
