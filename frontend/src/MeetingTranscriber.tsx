import { useState, useRef, useEffect, useCallback } from "react";
import AIAnalysisPanel from "./AIAnalysisPanel";

const SPEAKER_COLORS = [
  { bg: "#E6F1FB", text: "#0C447C" },
  { bg: "#EAF3DE", text: "#3B6D11" },
  { bg: "#FAEEDA", text: "#854F0B" },
  { bg: "#FBEAF0", text: "#72243E" },
  { bg: "#EEEDFE", text: "#3C3489" },
];

const SPEAKER_NAMES = ["Locuteur A", "Locuteur B", "Locuteur C", "Locuteur D", "Locuteur E"];

interface Word {
  text: string;
  start: number;
  end: number;
}

interface Utterance {
  speaker: string;
  start: number;
  end: number;
  text: string;
  words: Word[];
}

interface Analysis {
  status: "running" | "completed" | "error";
  provider: string;
  summary: string;
  decisions: string[];
  actions: { text: string; assignee: string | null; due: string | null }[];
  mcp_results: { server: string; action: string; result: string }[];
  error: string | null;
  created_at: string | null;
}

interface Job {
  id: string;
  status: "processing" | "completed" | "error";
  utterances: Utterance[];
  text: string;
  speakers: string[];
  duration_ms: number;
  word_count: number;
  error?: string | null;
  queue_position?: number;
  message?: string;
  analysis?: Analysis | null;
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m${String(sec).padStart(2, "0")}s` : `${s}s`;
}

export default function MeetingTranscriber() {
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [hasAudio, setHasAudio] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [status, setStatus] = useState("Prêt à enregistrer");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [queueMessage, setQueueMessage] = useState("");

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

  const drawWave = useCallback(() => {
    const canvas = canvasRef.current;
    const analyzer = analyzerRef.current;
    if (!canvas || !analyzer) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    const data = new Uint8Array(analyzer.frequencyBinCount);
    const frame = () => {
      animFrameRef.current = requestAnimationFrame(frame);
      analyzer.getByteTimeDomainData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const sliceW = canvas.width / data.length;
      let x = 0;
      data.forEach((d, i) => {
        const y = (d / 128) * (canvas.height / 2);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += sliceW;
      });
      ctx.stroke();
    };
    frame();
  }, []);

  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtxRef.current = new AudioContext();
      analyzerRef.current = audioCtxRef.current.createAnalyser();
      analyzerRef.current.fftSize = 256;
      const src = audioCtxRef.current.createMediaStreamSource(stream);
      src.connect(analyzerRef.current);
      drawWave();

      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = () => {
        audioBlobRef.current = new Blob(audioChunksRef.current, { type: "audio/webm" });
        uploadedFileRef.current = null;
        setUploadedFileName("");
        setHasAudio(true);
        setStatus("Enregistrement terminé");
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setStatus("Enregistrement en cours...");
    } catch (e: unknown) {
      setError("Accès micro refusé : " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    cancelAnimationFrame(animFrameRef.current);
    setIsRecording(false);
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleFile = (file: File) => {
    uploadedFileRef.current = file;
    audioBlobRef.current = null;
    setUploadedFileName(`${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
    setHasAudio(true);
    setError("");
  };

  const playback = () => {
    const blob = audioBlobRef.current || uploadedFileRef.current;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    new Audio(url).play();
  };

  const pollJob = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/transcribe/${jobId}`);
        if (!resp.ok) return;
        const data: Job = await resp.json();
        if (data.status === "completed" || data.status === "error") {
          clearInterval(pollRef.current!);
          setProgress(100);
          setProgressLabel(data.status === "completed" ? "Terminé !" : "Erreur");
          setAnalyzing(false);
          if (data.status === "error") setError("Erreur pipeline : " + (data.error ?? "inconnue"));
          setJob(data);
        } else {
          setProgressLabel("Transcription en cours...");
          setProgress((p) => Math.min(p + 3, 90));
        }
      } catch {
        // réseau — on réessaie au prochain tick
      }
    }, 3000);
  }, []);

  const analyzeAudio = async () => {
    const fileToSend = uploadedFileRef.current || audioBlobRef.current;
    if (!fileToSend) { setError("Aucun audio disponible."); return; }

    setError("");
    setJob(null);
    setQueueMessage("");
    setAnalyzing(true);
    setProgress(10);
    setProgressLabel("Upload du fichier audio...");

    try {
      const form = new FormData();
      form.append("file", fileToSend, uploadedFileRef.current?.name ?? "recording.webm");

      const uploadResp = await fetch("/api/upload", { method: "POST", body: form });
      if (!uploadResp.ok) {
        const detail = await uploadResp.json().catch(() => ({ detail: uploadResp.statusText }));
        throw new Error(detail.detail ?? uploadResp.statusText);
      }
      const data = await uploadResp.json();
      setProgress(30);
      setProgressLabel(data.message ?? "Transcription démarrée...");
      if (data.queue_position > 0) setQueueMessage(data.message);

      pollJob(data.id);
    } catch (e: unknown) {
      setError("Erreur : " + (e instanceof Error ? e.message : String(e)));
      setAnalyzing(false);
    }
  };

  const exportTranscript = async (format: "txt" | "srt" | "json") => {
    if (!job) return;
    const resp = await fetch(`/api/transcribe/${job.id}/export?format=${format}`);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcription.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const utterances = job?.utterances ?? [];
  const speakers = job?.speakers ?? [];
  const speakerMap = Object.fromEntries(speakers.map((s, i) => [s, i]));
  const totalWords = job?.word_count ?? 0;
  const duration = job?.duration_ms ? Math.round(job.duration_ms / 1000) : 0;

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div style={{ padding: "1.5rem 0", fontFamily: "system-ui, sans-serif", maxWidth: 680 }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>🎙 Meeting Transcriber</h1>
        <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
          Transcription locale — faster-whisper + pyannote, 100% auto-hébergé
        </p>
      </div>

      {/* Recorder */}
      <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "1.25rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1rem" }}>
          <div style={{
            width: 10, height: 10, borderRadius: "50%", background: "#D85A30", flexShrink: 0,
            animation: isRecording ? "pulse 1s infinite" : "none",
          }} />
          <span style={{ fontSize: 22, fontWeight: 500, fontFamily: "monospace", letterSpacing: 2 }}>{mm}:{ss}</span>
          <span style={{ fontSize: 13, color: "#666", marginLeft: "auto" }}>{status}</span>
        </div>

        <div style={{ height: 56, borderRadius: 8, background: "#f5f5f5", overflow: "hidden", marginBottom: "1rem" }}>
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={startRecording} disabled={isRecording}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 13, borderRadius: 8, border: "1px solid #333", background: "#333", color: "#fff", cursor: isRecording ? "not-allowed" : "pointer", opacity: isRecording ? 0.4 : 1 }}>
            ⏺ Enregistrer
          </button>
          <button onClick={stopRecording} disabled={!isRecording}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 13, borderRadius: 8, border: "0.5px solid #ccc", background: "transparent", cursor: !isRecording ? "not-allowed" : "pointer", opacity: !isRecording ? 0.4 : 1 }}>
            ⏹ Arrêter
          </button>
          <button onClick={playback} disabled={!hasAudio}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 13, borderRadius: 8, border: "0.5px solid #ccc", background: "transparent", cursor: !hasAudio ? "not-allowed" : "pointer", opacity: !hasAudio ? 0.4 : 1 }}>
            ▶ Écouter
          </button>
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

      <div
        onClick={() => document.getElementById("fileInput")?.click()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onDragOver={(e) => e.preventDefault()}
        style={{ border: "0.5px dashed #bbb", borderRadius: 12, padding: "1.5rem", textAlign: "center", cursor: "pointer" }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>🎵</div>
        <p style={{ fontSize: 13, color: "#666" }}>Cliquez ou glissez un fichier audio</p>
        <p style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>MP3, WAV, M4A, WEBM — jusqu'à 100MB</p>
        {uploadedFileName && <p style={{ fontSize: 13, fontWeight: 500, marginTop: 4 }}>{uploadedFileName}</p>}
      </div>
      <input type="file" id="fileInput" accept="audio/*" style={{ display: "none" }}
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />

      {/* Queue notice */}
      {queueMessage && !error && (
        <div style={{ background: "#FFF8E1", border: "0.5px solid #FFD54F", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#795B00", margin: "0.5rem 0" }}>
          ⏳ {queueMessage}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: "#FCEBEB", border: "0.5px solid #F09595", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#A32D2D", margin: "0.5rem 0" }}>
          {error}
        </div>
      )}

      {/* Progress */}
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
          <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>📋 Transcription</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {speakers.map((s, i) => (
              <span key={s} style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: SPEAKER_COLORS[i % SPEAKER_COLORS.length].bg, color: SPEAKER_COLORS[i % SPEAKER_COLORS.length].text }}>
                {SPEAKER_NAMES[i] || `Locuteur ${s}`}
              </span>
            ))}
            {utterances.length > 0 && (
              <>
                {(["txt", "srt", "json"] as const).map((fmt) => (
                  <button key={fmt} onClick={() => exportTranscript(fmt)}
                    style={{ padding: "3px 10px", fontSize: 11, borderRadius: 6, border: "0.5px solid #bbb", background: "transparent", cursor: "pointer" }}>
                    ↓ {fmt.toUpperCase()}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        {utterances.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: "1rem" }}>
            {[
              { label: "Locuteurs", val: speakers.length },
              { label: "Mots", val: totalWords },
              { label: "Durée", val: fmtSec(duration) },
              { label: "Segments", val: utterances.length },
            ].map(({ label, val }) => (
              <div key={label} style={{ background: "#f5f5f5", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 500 }}>{val}</div>
              </div>
            ))}
          </div>
        )}

        {utterances.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "#aaa", fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎤</div>
            Enregistrez ou importez un fichier audio, puis cliquez sur Analyser
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {utterances.map((u, idx) => {
              const si = speakerMap[u.speaker] ?? 0;
              const color = SPEAKER_COLORS[si % SPEAKER_COLORS.length];
              return (
                <div key={idx} style={{ display: "flex", gap: 12, padding: "10px 12px", borderRadius: 8 }}>
                  <div style={{ flexShrink: 0, width: 80 }}>
                    <div style={{ fontSize: 11, fontFamily: "monospace", color: "#888", marginBottom: 4 }}>{fmtMs(u.start)}</div>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: color.bg, color: color.text }}>
                      {SPEAKER_NAMES[si] || `Loc. ${u.speaker}`}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, color: "#333", lineHeight: 1.6, flex: 1 }}>{u.text}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Analyse IA */}
      {job?.status === "completed" && (
        <AIAnalysisPanel
          jobId={job.id}
          existingAnalysis={job.analysis ?? null}
          onAnalysisUpdate={(analysis) => setJob((j) => j ? { ...j, analysis } : j)}
        />
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
}
