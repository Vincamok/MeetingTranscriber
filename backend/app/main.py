"""
Minta — FastAPI backend (auto-hébergé)

Pipeline : faster-whisper (transcription) + pyannote.audio (diarisation)
Persistance : fichiers JSON dans JOB_DIR (un fichier par job)
Audio      : conservé dans AUDIO_DIR pour le player synchronisé

Endpoints :
  GET  /api/health
  POST /api/upload                          → upload audio/vidéo + lancement
  GET  /api/transcribe/{id}                 → statut / résultat
  GET  /api/transcribe/{id}/audio           → stream audio pour le player
  GET  /api/transcribe/{id}/export          → export TXT | SRT | JSON
  POST /api/transcribe/{id}/analyze         → déclenche l'analyse IA
  PATCH /api/transcribe/{id}/speakers       → renommer les locuteurs
  POST /api/transcribe/{id}/share           → créer un lien de partage
  GET  /api/share/{token}                   → vue publique d'une transcription
  GET  /api/transcripts                     → liste tous les jobs
  DELETE /api/transcribe/{id}              → supprime un job + audio
  GET  /api/settings
  PATCH /api/settings
"""

import json
import logging
import os
import secrets
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

import aiofiles
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel as PydanticModel
from pythonjsonlogger import jsonlogger

# ---------------------------------------------------------------------------
# Logging structuré JSON
# ---------------------------------------------------------------------------

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
handler = logging.StreamHandler()
handler.setFormatter(jsonlogger.JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
logging.basicConfig(level=LOG_LEVEL, handlers=[handler])
log = logging.getLogger("minta")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HF_TOKEN: str = os.getenv("HF_TOKEN", "")
WHISPER_MODEL: str = os.getenv("WHISPER_MODEL", "large-v3")
BASE_DIR = Path(os.getenv("DATA_DIR", "/tmp/minta"))
JOB_DIR = BASE_DIR / "jobs"
UPLOAD_DIR = BASE_DIR / "uploads"
AUDIO_DIR = BASE_DIR / "audio"
SETTINGS_FILE = BASE_DIR / "settings.json"

AI_DEFAULT_PROVIDER: str = os.getenv("AI_DEFAULT_PROVIDER", "anthropic")
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")

for _d in (JOB_DIR, UPLOAD_DIR, AUDIO_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# Extensions vidéo — ffmpeg extraira la piste audio
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".m4v", ".wmv", ".flv"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".webm", ".ogg", ".flac", ".aac", ".opus"}

INITIAL_PROMPT = "Transcription d'une réunion professionnelle."

# ---------------------------------------------------------------------------
# Détection device
# ---------------------------------------------------------------------------

def _detect_device() -> tuple[str, str]:
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda", "float16"
    except ImportError:
        pass
    return "cpu", "int8"

DEVICE, COMPUTE_TYPE = _detect_device()
log.info("device detected", extra={"device": DEVICE, "compute_type": COMPUTE_TYPE})

# ---------------------------------------------------------------------------
# Chargement lazy des modèles
# ---------------------------------------------------------------------------

_whisper_model = None
_diarize_pipeline = None
_models_loaded = False
_models_error: Optional[str] = None


def _load_models():
    global _whisper_model, _diarize_pipeline, _models_loaded, _models_error
    if _models_loaded or _models_error:
        return

    try:
        from faster_whisper import WhisperModel
        _whisper_model = WhisperModel(WHISPER_MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)
        log.info("whisper loaded", extra={"model": WHISPER_MODEL})
    except Exception as exc:
        _models_error = f"Chargement Whisper échoué : {exc}"
        log.error(_models_error)
        return

    if not HF_TOKEN:
        log.warning("HF_TOKEN absent — diarisation indisponible")
    else:
        try:
            from pyannote.audio import Pipeline
            _diarize_pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=HF_TOKEN,
            )
            if DEVICE == "cuda":
                import torch
                _diarize_pipeline.to(torch.device("cuda"))
            log.info("pyannote loaded")
        except Exception as exc:
            log.warning("pyannote non disponible", extra={"error": str(exc)})

    _models_loaded = True


# ---------------------------------------------------------------------------
# Persistance jobs
# ---------------------------------------------------------------------------

def _job_path(job_id: str) -> Path:
    return JOB_DIR / f"{job_id}.json"


def _save_job(job: dict):
    with open(_job_path(job["id"]), "w", encoding="utf-8") as f:
        json.dump(job, f, ensure_ascii=False, indent=2)


def _load_job(job_id: str) -> dict:
    p = _job_path(job_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Job introuvable")
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def _list_jobs() -> list[dict]:
    jobs = []
    for p in sorted(JOB_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            with open(p, encoding="utf-8") as f:
                jobs.append(json.load(f))
        except Exception:
            pass
    return jobs


def _running_jobs_count() -> int:
    return sum(1 for j in _list_jobs() if j.get("status") == "processing")


def _find_audio(job_id: str) -> Optional[Path]:
    for ext in list(AUDIO_EXTENSIONS) + [".wav"]:
        p = AUDIO_DIR / f"{job_id}{ext}"
        if p.exists():
            return p
    return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ms(seconds: float) -> int:
    return int(seconds * 1000)


def _srt_ts(ms: int) -> str:
    h = ms // 3_600_000
    m = (ms % 3_600_000) // 60_000
    s = (ms % 60_000) // 1000
    cs = ms % 1000
    return f"{h:02d}:{m:02d}:{s:02d},{cs:03d}"


def _extract_audio(src: Path, dst: Path) -> Path:
    """Extrait la piste audio d'un fichier vidéo en WAV via ffmpeg."""
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", str(dst)],
        capture_output=True, timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg extraction échouée : {result.stderr.decode()[:500]}")
    return dst


def _fire_webhook(webhook_url: str, job: dict):
    """Envoie une notification HTTP POST vers le webhook configuré."""
    try:
        import urllib.request
        payload = json.dumps({
            "job_id": job["id"],
            "status": job["status"],
            "filename": job.get("filename"),
            "duration_ms": job.get("duration_ms", 0),
            "speakers": job.get("speakers", []),
            "word_count": job.get("word_count", 0),
        }).encode()
        req = urllib.request.Request(webhook_url, data=payload,
                                      headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=10)
        log.info("webhook fired", extra={"url": webhook_url, "job_id": job["id"]})
    except Exception as exc:
        log.warning("webhook failed", extra={"url": webhook_url, "error": str(exc)})


# ---------------------------------------------------------------------------
# Pipeline transcription
# ---------------------------------------------------------------------------

def _run_pipeline(job_id: str, raw_path: Path, language: str):
    job = _load_job(job_id)
    audio_path = raw_path

    try:
        _load_models()

        if not _whisper_model:
            job["status"] = "error"
            job["error"] = _models_error or "Modèle non chargé"
            _save_job(job)
            return

        log.info("pipeline start", extra={"job_id": job_id})

        # Extraction audio si vidéo
        if raw_path.suffix.lower() in VIDEO_EXTENSIONS:
            wav_path = UPLOAD_DIR / f"{job_id}.wav"
            audio_path = _extract_audio(raw_path, wav_path)
            raw_path.unlink(missing_ok=True)
            log.info("video extracted", extra={"job_id": job_id})

        # Copie vers AUDIO_DIR pour le player
        audio_dest = AUDIO_DIR / f"{job_id}{audio_path.suffix}"
        import shutil
        shutil.copy2(audio_path, audio_dest)

        # Whisper — language=None → auto-détection
        whisper_lang = None if language == "auto" else language
        prompt = INITIAL_PROMPT if not whisper_lang or whisper_lang == "fr" else ""

        segments_iter, info = _whisper_model.transcribe(
            str(audio_path),
            language=whisper_lang,
            initial_prompt=prompt or None,
            word_timestamps=True,
        )
        segments = list(segments_iter)
        detected_language = info.language
        log.info("whisper done", extra={"job_id": job_id, "segments": len(segments), "lang": detected_language})

        # Pyannote (optionnel)
        utterances = []
        if _diarize_pipeline:
            diarization = _diarize_pipeline(str(audio_path))
            speaker_turns = [
                (turn.start, turn.end, speaker)
                for turn, _, speaker in diarization.itertracks(yield_label=True)
            ]
            for seg in segments:
                best_speaker, best_overlap = "SPEAKER_00", 0.0
                for t_start, t_end, spk in speaker_turns:
                    overlap = max(0.0, min(seg.end, t_end) - max(seg.start, t_start))
                    if overlap > best_overlap:
                        best_overlap, best_speaker = overlap, spk
                utterances.append({
                    "speaker": best_speaker,
                    "start": _ms(seg.start), "end": _ms(seg.end),
                    "text": seg.text.strip(),
                    "words": [{"text": w.word, "start": _ms(w.start), "end": _ms(w.end)} for w in (seg.words or [])],
                })
        else:
            for seg in segments:
                utterances.append({
                    "speaker": "SPEAKER_00",
                    "start": _ms(seg.start), "end": _ms(seg.end),
                    "text": seg.text.strip(),
                    "words": [{"text": w.word, "start": _ms(w.start), "end": _ms(w.end)} for w in (seg.words or [])],
                })

        speakers = list(dict.fromkeys(u["speaker"] for u in utterances))
        job.update({
            "status": "completed",
            "completed_at": datetime.utcnow().isoformat(),
            "language": detected_language,
            "utterances": utterances,
            "text": " ".join(u["text"] for u in utterances),
            "speakers": speakers,
            "speaker_names": {s: f"Locuteur {chr(65 + i)}" for i, s in enumerate(speakers)},
            "duration_ms": utterances[-1]["end"] if utterances else 0,
            "word_count": sum(len(u["words"]) for u in utterances),
            "has_audio": True,
        })
        log.info("pipeline done", extra={"job_id": job_id, "speakers": len(speakers)})

    except Exception as exc:
        log.exception("pipeline error", extra={"job_id": job_id})
        job["status"] = "error"
        job["error"] = str(exc)

    finally:
        _save_job(job)
        try:
            audio_path.unlink(missing_ok=True)
        except Exception:
            pass

        # Webhook
        settings = _load_settings()
        if wh := settings.get("webhook_url"):
            _fire_webhook(wh, job)


# ---------------------------------------------------------------------------
# App FastAPI
# ---------------------------------------------------------------------------

app = FastAPI(title="Minta API", version="0.4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", os.getenv("FRONTEND_ORIGIN", "")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "app": "Minta",
        "version": "0.4.0",
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "whisper_model": WHISPER_MODEL,
        "models_loaded": _models_loaded,
        "models_error": _models_error,
        "hf_token_configured": bool(HF_TOKEN),
        "diarization_available": _diarize_pipeline is not None,
        "jobs_running": _running_jobs_count(),
    }


@app.post("/api/upload", status_code=202)
async def upload_audio(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    language: str = Form("auto"),
):
    """Reçoit un fichier audio ou vidéo, crée un job et lance le pipeline."""
    job_id = str(uuid.uuid4())
    suffix = Path(file.filename or "audio").suffix.lower() or ".webm"
    raw_path = UPLOAD_DIR / f"{job_id}{suffix}"

    async with aiofiles.open(raw_path, "wb") as f:
        content = await file.read()
        await f.write(content)

    running = _running_jobs_count()
    job = {
        "id": job_id,
        "filename": file.filename,
        "language": language,
        "status": "processing",
        "created_at": datetime.utcnow().isoformat(),
        "completed_at": None,
        "utterances": [],
        "text": "",
        "speakers": [],
        "speaker_names": {},
        "duration_ms": 0,
        "word_count": 0,
        "error": None,
        "queue_position": running,
        "has_audio": False,
        "share_token": None,
    }
    _save_job(job)

    background_tasks.add_task(_run_pipeline, job_id, raw_path, language)
    log.info("job created", extra={"job_id": job_id, "filename": file.filename, "language": language})
    return {
        "id": job_id,
        "status": "processing",
        "queue_position": running,
        "message": (
            "Traitement en cours, votre fichier sera traité après les jobs en cours."
            if running > 0 else "Traitement démarré."
        ),
    }


@app.get("/api/transcribe/{job_id}")
def get_job(job_id: str):
    return _load_job(job_id)


@app.get("/api/transcribe/{job_id}/audio")
def get_audio(job_id: str):
    _load_job(job_id)  # vérifie que le job existe
    audio = _find_audio(job_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Fichier audio non disponible")
    media_type = "audio/wav" if audio.suffix == ".wav" else f"audio/{audio.suffix.lstrip('.')}"
    return FileResponse(audio, media_type=media_type, filename=audio.name)


@app.get("/api/transcribe/{job_id}/export")
def export_job(job_id: str, format: Literal["txt", "srt", "json"] = Query("txt")):
    job = _load_job(job_id)
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail="Transcription non terminée")

    utterances = job.get("utterances", [])
    speaker_names: dict = job.get("speaker_names", {})

    def spk_label(spk: str) -> str:
        return speaker_names.get(spk, spk)

    if format == "json":
        return job

    if format == "txt":
        lines = [f"[{spk_label(u['speaker'])}] {u['text']}" for u in utterances]
        content = "\n".join(lines)
        return PlainTextResponse(content, media_type="text/plain; charset=utf-8",
                                 headers={"Content-Disposition": f'attachment; filename="{job_id}.txt"'})

    if format == "srt":
        blocks = []
        for i, u in enumerate(utterances, 1):
            blocks.append(f"{i}\n{_srt_ts(u['start'])} --> {_srt_ts(u['end'])}\n[{spk_label(u['speaker'])}] {u['text']}\n")
        return PlainTextResponse("\n".join(blocks), media_type="text/plain; charset=utf-8",
                                 headers={"Content-Disposition": f'attachment; filename="{job_id}.srt"'})


class SpeakerNamesUpdate(PydanticModel):
    speaker_names: dict[str, str]


@app.patch("/api/transcribe/{job_id}/speakers")
def update_speaker_names(job_id: str, body: SpeakerNamesUpdate):
    job = _load_job(job_id)
    job["speaker_names"] = {**job.get("speaker_names", {}), **body.speaker_names}
    _save_job(job)
    return {"speaker_names": job["speaker_names"]}


@app.post("/api/transcribe/{job_id}/share")
def create_share(job_id: str):
    job = _load_job(job_id)
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail="Transcription non terminée")
    if not job.get("share_token"):
        job["share_token"] = secrets.token_urlsafe(24)
        _save_job(job)
    return {"share_token": job["share_token"], "url": f"/share/{job['share_token']}"}


@app.get("/api/share/{token}")
def get_shared(token: str):
    for job in _list_jobs():
        if job.get("share_token") == token:
            return {k: job[k] for k in ("id", "filename", "language", "utterances", "text",
                                         "speakers", "speaker_names", "duration_ms", "word_count",
                                         "completed_at") if k in job}
    raise HTTPException(status_code=404, detail="Lien de partage introuvable ou expiré")


@app.get("/api/transcripts")
def list_transcripts():
    return [
        {
            "id": j["id"],
            "filename": j.get("filename"),
            "language": j.get("language"),
            "status": j["status"],
            "created_at": j.get("created_at"),
            "completed_at": j.get("completed_at"),
            "duration_ms": j.get("duration_ms", 0),
            "speakers": j.get("speakers", []),
            "speaker_names": j.get("speaker_names", {}),
            "word_count": j.get("word_count", 0),
            "error": j.get("error"),
            "has_audio": j.get("has_audio", False),
            "share_token": j.get("share_token"),
            "analysis_status": j.get("analysis", {}).get("status") if j.get("analysis") else None,
        }
        for j in _list_jobs()
    ]


@app.delete("/api/transcribe/{job_id}", status_code=204)
def delete_job(job_id: str):
    p = _job_path(job_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Job introuvable")
    p.unlink()
    audio = _find_audio(job_id)
    if audio:
        audio.unlink(missing_ok=True)
    log.info("job deleted", extra={"job_id": job_id})


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

_DEFAULT_SETTINGS: dict = {
    "mcp_servers": {},
    "default_provider": AI_DEFAULT_PROVIDER,
    "webhook_url": "",
}


def _load_settings() -> dict:
    if SETTINGS_FILE.exists():
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            saved = json.load(f)
        return {**_DEFAULT_SETTINGS, **saved}
    return dict(_DEFAULT_SETTINGS)


def _save_settings(settings: dict):
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)


@app.get("/api/settings")
def get_settings():
    settings = _load_settings()
    settings["providers_available"] = {
        "anthropic": bool(ANTHROPIC_API_KEY),
        "openai": bool(OPENAI_API_KEY),
    }
    return settings


class SettingsPatch(PydanticModel):
    mcp_servers: Optional[dict] = None
    default_provider: Optional[str] = None
    webhook_url: Optional[str] = None


@app.patch("/api/settings")
def patch_settings(patch: SettingsPatch):
    settings = _load_settings()
    if patch.mcp_servers is not None:
        settings["mcp_servers"] = patch.mcp_servers
    if patch.default_provider is not None:
        if patch.default_provider not in ("anthropic", "openai"):
            raise HTTPException(status_code=400, detail="Fournisseur inconnu")
        settings["default_provider"] = patch.default_provider
    if patch.webhook_url is not None:
        settings["webhook_url"] = patch.webhook_url
    _save_settings(settings)
    return settings


# ---------------------------------------------------------------------------
# Analyse IA
# ---------------------------------------------------------------------------

class AnalyzeRequest(PydanticModel):
    provider: str = "anthropic"
    api_key: Optional[str] = None
    mcp_servers: list[str] = []
    template: str = "meeting"


async def _run_analysis_task(job_id: str, provider: str, api_key: str, active_servers: list[str], template: str):
    from .ai.analyzer import run_analysis
    job = _load_job(job_id)
    settings = _load_settings()
    await run_analysis(
        job=job,
        save_job_fn=_save_job,
        provider_name=provider,
        api_key=api_key,
        mcp_servers_config=settings.get("mcp_servers", {}),
        active_server_names=active_servers,
        template=template,
    )


@app.post("/api/transcribe/{job_id}/analyze", status_code=202)
async def analyze_job(job_id: str, req: AnalyzeRequest, background_tasks: BackgroundTasks):
    job = _load_job(job_id)
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail="Transcription non terminée")

    provider = req.provider
    api_key = req.api_key or (ANTHROPIC_API_KEY if provider == "anthropic" else OPENAI_API_KEY)
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=f"Clé API {provider} absente. Fournissez api_key dans la requête ou configurez la variable d'environnement.",
        )

    background_tasks.add_task(_run_analysis_task, job_id, provider, api_key, req.mcp_servers, req.template)
    log.info("analysis requested", extra={"job_id": job_id, "provider": provider, "template": req.template})
    return {"job_id": job_id, "analysis_status": "running"}
