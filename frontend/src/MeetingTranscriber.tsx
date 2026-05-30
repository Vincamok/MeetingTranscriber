import { useState, useRef, useEffect, useCallback } from "react";

const SPEAKER_COLORS = [
  { bg: "#E6F1FB", text: "#0C447C", label: "blue" },
  { bg: "#EAF3DE", text: "#3B6D11", label: "green" },
  { bg: "#FAEEDA", text: "#854F0B", label: "amber" },
  { bg: "#FBEAF0", text: "#72243E", label: "pink" },
  { bg: "#EEEDFE", text: "#3C3489", label: "purple" },
];

const SPEAKER_NAMES = ["Locuteur A", "Locuteur B", "Locuteur C", "Locuteur D", "Locuteur E"];

interface Utterance {
  speaker: string;
  start: number;
  end: number;
  text: string;
  words: { text: string; start: number; end: number }[];
}

interface TranscriptResult {
  utterances: Utterance[];
  text: string;
  status: string;
  error?: string;
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
  const [apiKey, setApiKey] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [hasAudio, setHasAudio] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [status, setStatus] = useState("Prêt à enregistrer");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<TranscriptResult | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioBlobRef = useRef<Blob | null>(null);
  const uploadedFileRef = useRef<File | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

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

  const analyzeAudio = async () => {
    if (!apiKey || apiKey.length < 10) { setError("Entrez votre clé API AssemblyAI."); return; }
    const fileToSend = uploadedFileRef.current || audioBlobRef.current;
    if (!fileToSend) { setError("Aucun audio disponible."); return; }

    setError("");
    setAnalyzing(true);
    setProgress(5);
    setProgressLabel("Upload du fichier audio...");

    try {
      const uploadResp = await fetch("https://api.assemblyai.com/v2/upload", {
        method: "POST",
        headers: { authorization: apiKey, "Content-Type": "application/octet-stream" },
        body: fileToSend,
      });
      if (!uploadResp.ok) throw new Error(`Upload échoué: ${uploadResp.status}`);
      const { upload_url } = await uploadResp.json();
      setProgress(30);
      setProgressLabel("Transcription et diarisation en cours...");

      const transcriptResp = await fetch("https://api.assemblyai.com/v2/transcript", {
        method: "POST",
        headers: { authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ audio_url: upload_url, speaker_labels: true, language_code: "fr" }),
      });
      if (!transcriptResp.ok) throw new Error(`Transcription échouée: ${transcriptResp.status}`);
      const { id } = await transcriptResp.json();

      let result: TranscriptResult & { status: string };
      let attempts = 0;
      while (true) {
        await new Promise((r) => setTimeout(r, 2500));
        const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
          headers: { authorization: apiKey },
        });
        result = await poll.json();
        attempts++;
        setProgress(Math.min(30 + attempts * 8, 92));
        setProgressLabel(`Traitement (${result.status})...`);
        if (result.status === "completed" || result.status === "error") break;
        if (attempts > 40) throw new Error("Timeout");
      }

      if (result!.status === "error") throw new Error(result!.error);
      setProgress(100);
      setProgressLabel("Terminé !");
      setTranscript(result!);
    } catch (e: unknown) {
      setError("Erreur : " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const utterances = transcript?.utterances || [];
  const speakers = [...new Set(utterances.map((u) => u.speaker))];
  const speakerMap = Object.fromEntries(speakers.map((s, i) => [s, i]));
  const totalWords = utterances.reduce((acc, u) => acc + u.words.length, 0);
  const duration = utterances.length > 0 ? Math.round(utterances[utterances.length - 1].end / 1000) : 0;

  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");

  return (
    <div style={{ padding: "1.5rem 0", fontFamily: "system-ui, sans-serif", maxWidth: 680 }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>🎙 Meeting Transcriber</h1>
        <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
          Enregistrement, séparation des voix et transcription horodatée
        </p>
      </div>

      {/* API Key */}
      <div style={{ display: "flex", gap: 8, marginBottom: "1.5rem", alignItems: "center" }}>
        <input
          type="password"
          placeholder="Clé API AssemblyAI"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "0.5px solid #ccc", fontSize: 13, fontFamily: "monospace" }}
        />
        <span style={{
          fontSize: 11, padding: "3px 8px", borderRadius: 20, fontWeight: 500,
          background: apiKey.length > 10 ? "#EAF3DE" : "#FCEBEB",
          color: apiKey.length > 10 ? "#3B6D11" : "#A32D2D",
        }}>
          {apiKey.length > 10 ? "Connecté" : "Non connecté"}
        </span>
      </div>

      {/* Recorder */}
      <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "1.25rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1rem" }}>
          <div style={{
            width: 10, height: 10, borderRadius: "50%", background: "#D85A30", flexShrink: 0,
            animation: isRecording ? "pulse 1s infinite" : "none",
          }} />
          <span style={{ fontSize: 22, fontWeight: 500, fontFamily: "monospace", letterSpacing: 2 }}>{m}:{s}</span>
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
          <button onClick={playback} disabled={!hasAudio} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 13, borderRadius: 8, border: "0.5px solid #ccc", background: "transparent", cursor: !hasAudio ? "not-allowed" : "pointer", opacity: !hasAudio ? 0.4 : 1 }}>
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
      <input type="file" id="fileInput" accept="audio/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />

      {/* Error */}
      {error && <div style={{ background: "#FCEBEB", border: "0.5px solid #F09595", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#A32D2D", margin: "0.5rem 0" }}>{error}</div>}

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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>📋 Transcription</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {speakers.map((s, i) => (
              <span key={s} style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: SPEAKER_COLORS[i % SPEAKER_COLORS.length].bg, color: SPEAKER_COLORS[i % SPEAKER_COLORS.length].text }}>
                {SPEAKER_NAMES[i] || `Locuteur ${s}`}
              </span>
            ))}
          </div>
        </div>

        {utterances.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: "1rem" }}>
            {[{ label: "Locuteurs", val: speakers.length }, { label: "Mots", val: totalWords }, { label: "Durée", val: fmtSec(duration) }, { label: "Segments", val: utterances.length }].map(({ label, val }) => (
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
                <div key={idx} style={{ display: "flex", gap: 12, padding: "10px 12px", borderRadius: 8, border: "0.5px solid transparent", transition: "background 0.1s" }}>
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

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
}
