"""
Meeting Transcriber — FastAPI backend (auto-hébergé)

Pipeline : faster-whisper (transcription) + pyannote.audio (diarisation)
Persistance : fichiers JSON dans JOB_DIR (un fichier par job)

Endpoints :
  GET  /api/health                          → état du service
  POST /api/upload                          → upload + lancement transcription
  GET  /api/transcribe/{id}                 → statut / résultat
  GET  /api/transcribe/{id}/export          → export TXT | SRT | JSON
  POST /api/transcribe/{id}/analyze         → déclenche l'analyse IA
  GET  /api/transcripts                     → liste tous les jobs
  DELETE /api/transcribe/{id}              → supprime un job
  GET  /api/settings                        → config IA/MCP
  PATCH /api/settings                       → met à jour config IA/MCP
"""

import asyncio
import json
import logging
import os
import shutil
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

import aiofiles
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel as PydanticModel
from pythonjsonlogger import jsonlogger

# ---------------------------------------------------------------------------
# Logging structuré JSON
# ---------------------------------------------------------------------------

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

handler = logging.StreamHandler()
handler.setFormatter(jsonlogger.JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
logging.basicConfig(level=LOG_LEVEL, handlers=[handler])
log = logging.getLogger("transcriber")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HF_TOKEN: str = os.getenv("HF_TOKEN", "")
WHISPER_MODEL: str = os.getenv("WHISPER_MODEL", "large-v3")
JOB_DIR = Path(os.getenv("JOB_DIR", "/tmp/transcriber/jobs"))
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/tmp/transcriber/uploads"))
INITIAL_PROMPT = "Transcription d'une réunion professionnelle en français."

SETTINGS_FILE = Path(os.getenv("SETTINGS_FILE", "/tmp/transcriber/settings.json"))

# Clés IA par défaut (depuis .env — jamais persistées dans settings.json)
AI_DEFAULT_PROVIDER: str = os.getenv("AI_DEFAULT_PROVIDER", "anthropic")
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")

JOB_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Détection device
# ---------------------------------------------------------------------------

def _detect_device() -> tuple[str, str]:
    """Retourne (device, compute_type)."""
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
# Chargement lazy des modèles (au premier job)
# ---------------------------------------------------------------------------

_whisper_model = None
_diarize_pipeline = None
_models_loaded = False
_models_error: Optional[str] = None


def _load_models():
    global _whisper_model, _diarize_pipeline, _models_loaded, _models_error
    if _models_loaded or _models_error:
        return

    if not HF_TOKEN:
        _models_error = "HF_TOKEN absent — diarisation indisponible"
        log.warning(_models_error)
        # Whisper seul peut fonctionner sans HF_TOKEN
        try:
            from faster_whisper import WhisperModel
            _whisper_model = WhisperModel(WHISPER_MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)
            log.info("whisper loaded (sans diarisation)", extra={"model": WHISPER_MODEL})
        except Exception as exc:
            _models_error = f"Chargement Whisper échoué : {exc}"
            log.error(_models_error)
        return

    try:
        from faster_whisper import WhisperModel
        _whisper_model = WhisperModel(WHISPER_MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)
        log.info("whisper loaded", extra={"model": WHISPER_MODEL})
    except Exception as exc:
        _models_error = f"Chargement Whisper échoué : {exc}"
        log.error(_models_error)
        return

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
        _diarize_pipeline = None

    _models_loaded = True


# ---------------------------------------------------------------------------
# Persistance jobs (fichiers JSON)
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


# ---------------------------------------------------------------------------
# Pipeline transcription
# ---------------------------------------------------------------------------

def _ms(seconds: float) -> int:
    return int(seconds * 1000)


def _srt_ts(ms: int) -> str:
    h = ms // 3_600_000
    m = (ms % 3_600_000) // 60_000
    s = (ms % 60_000) // 1000
    cs = ms % 1000
    return f"{h:02d}:{m:02d}:{s:02d},{cs:03d}"


def _run_pipeline(job_id: str, audio_path: Path):
    job = _load_job(job_id)
    try:
        _load_models()

        if _models_error and not _whisper_model:
            job["status"] = "error"
            job["error"] = _models_error
            _save_job(job)
            return

        log.info("pipeline start", extra={"job_id": job_id})

        # --- Whisper ---
        segments_iter, info = _whisper_model.transcribe(
            str(audio_path),
            language="fr",
            initial_prompt=INITIAL_PROMPT,
            word_timestamps=True,
        )
        segments = list(segments_iter)
        log.info("whisper done", extra={"job_id": job_id, "segments": len(segments)})

        # --- Pyannote (optionnel) ---
        utterances = []
        if _diarize_pipeline:
            import torch
            diarization = _diarize_pipeline(str(audio_path))

            # Associer chaque segment Whisper au locuteur dominant
            speaker_turns = [
                (turn.start, turn.end, speaker)
                for turn, _, speaker in diarization.itertracks(yield_label=True)
            ]

            for seg in segments:
                seg_start = seg.start
                seg_end = seg.end
                # Trouver le locuteur avec le plus grand overlap
                best_speaker = "SPEAKER_00"
                best_overlap = 0.0
                for t_start, t_end, spk in speaker_turns:
                    overlap = max(0.0, min(seg_end, t_end) - max(seg_start, t_start))
                    if overlap > best_overlap:
                        best_overlap = overlap
                        best_speaker = spk

                words = [
                    {"text": w.word, "start": _ms(w.start), "end": _ms(w.end)}
                    for w in (seg.words or [])
                ]
                utterances.append({
                    "speaker": best_speaker,
                    "start": _ms(seg_start),
                    "end": _ms(seg_end),
                    "text": seg.text.strip(),
                    "words": words,
                })
        else:
            # Pas de diarisation — locuteur unique
            for seg in segments:
                words = [
                    {"text": w.word, "start": _ms(w.start), "end": _ms(w.end)}
                    for w in (seg.words or [])
                ]
                utterances.append({
                    "speaker": "SPEAKER_00",
                    "start": _ms(seg.start),
                    "end": _ms(seg.end),
                    "text": seg.text.strip(),
                    "words": words,
                })

        full_text = " ".join(u["text"] for u in utterances)
        speakers = list(dict.fromkeys(u["speaker"] for u in utterances))
        duration_ms = utterances[-1]["end"] if utterances else 0

        job.update({
            "status": "completed",
            "completed_at": datetime.utcnow().isoformat(),
            "utterances": utterances,
            "text": full_text,
            "speakers": speakers,
            "duration_ms": duration_ms,
            "word_count": sum(len(u["words"]) for u in utterances),
        })
        log.info("pipeline done", extra={"job_id": job_id, "speakers": len(speakers)})

    except Exception as exc:
        log.exception("pipeline error", extra={"job_id": job_id})
        job["status"] = "error"
        job["error"] = str(exc)

    finally:
        _save_job(job)
        # Nettoyage fichier audio
        try:
            audio_path.unlink(missing_ok=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# App FastAPI
# ---------------------------------------------------------------------------

app = FastAPI(title="Meeting Transcriber API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", os.getenv("FRONTEND_ORIGIN", "")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    running = _running_jobs_count()
    return {
        "status": "ok",
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "whisper_model": WHISPER_MODEL,
        "models_loaded": _models_loaded,
        "models_error": _models_error,
        "hf_token_configured": bool(HF_TOKEN),
        "diarization_available": _diarize_pipeline is not None,
        "jobs_running": running,
    }


@app.post("/api/upload", status_code=202)
async def upload_audio(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """Reçoit un fichier audio, crée un job et lance le pipeline en arrière-plan."""
    if not HF_TOKEN and not _whisper_model:
        # Préchargement : on accepte sans HF_TOKEN mais on prévient
        pass  # Le pipeline gérera le cas

    job_id = str(uuid.uuid4())
    suffix = Path(file.filename or "audio").suffix or ".webm"
    audio_path = UPLOAD_DIR / f"{job_id}{suffix}"

    async with aiofiles.open(audio_path, "wb") as f:
        content = await file.read()
        await f.write(content)

    running = _running_jobs_count()
    job = {
        "id": job_id,
        "filename": file.filename,
        "status": "processing",
        "created_at": datetime.utcnow().isoformat(),
        "completed_at": None,
        "utterances": [],
        "text": "",
        "speakers": [],
        "duration_ms": 0,
        "word_count": 0,
        "error": None,
        "queue_position": running,
    }
    _save_job(job)

    background_tasks.add_task(_run_pipeline, job_id, audio_path)

    log.info("job created", extra={"job_id": job_id, "filename": file.filename})
    return {
        "id": job_id,
        "status": "processing",
        "queue_position": running,
        "message": (
            "Traitement en cours, votre fichier sera traité après les jobs en cours."
            if running > 0
            else "Traitement démarré."
        ),
    }


@app.get("/api/transcribe/{job_id}")
def get_job(job_id: str):
    return _load_job(job_id)


@app.get("/api/transcribe/{job_id}/export")
def export_job(job_id: str, format: Literal["txt", "srt", "json"] = Query("txt")):
    job = _load_job(job_id)
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail="Transcription non terminée")

    utterances = job.get("utterances", [])

    if format == "json":
        return job

    if format == "txt":
        lines = []
        for u in utterances:
            lines.append(f"[{u['speaker']}] {u['text']}")
        content = "\n".join(lines)
        return PlainTextResponse(content, media_type="text/plain; charset=utf-8",
                                 headers={"Content-Disposition": f'attachment; filename="{job_id}.txt"'})

    if format == "srt":
        blocks = []
        for i, u in enumerate(utterances, 1):
            blocks.append(
                f"{i}\n{_srt_ts(u['start'])} --> {_srt_ts(u['end'])}\n"
                f"[{u['speaker']}] {u['text']}\n"
            )
        content = "\n".join(blocks)
        return PlainTextResponse(content, media_type="text/plain; charset=utf-8",
                                 headers={"Content-Disposition": f'attachment; filename="{job_id}.srt"'})


@app.get("/api/transcripts")
def list_transcripts():
    jobs = _list_jobs()
    return [
        {
            "id": j["id"],
            "filename": j.get("filename"),
            "status": j["status"],
            "created_at": j.get("created_at"),
            "completed_at": j.get("completed_at"),
            "duration_ms": j.get("duration_ms", 0),
            "speakers": j.get("speakers", []),
            "word_count": j.get("word_count", 0),
            "error": j.get("error"),
            "analysis_status": j.get("analysis", {}).get("status") if j.get("analysis") else None,
        }
        for j in jobs
    ]


@app.delete("/api/transcribe/{job_id}", status_code=204)
def delete_job(job_id: str):
    p = _job_path(job_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Job introuvable")
    p.unlink()
    log.info("job deleted", extra={"job_id": job_id})


# ---------------------------------------------------------------------------
# Settings (config IA + MCP)
# ---------------------------------------------------------------------------

_DEFAULT_SETTINGS: dict = {
    "mcp_servers": {},
    "default_provider": AI_DEFAULT_PROVIDER,
}


def _load_settings() -> dict:
    if SETTINGS_FILE.exists():
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            saved = json.load(f)
        # Merge avec les défauts
        result = dict(_DEFAULT_SETTINGS)
        result.update(saved)
        return result
    return dict(_DEFAULT_SETTINGS)


def _save_settings(settings: dict):
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)


@app.get("/api/settings")
def get_settings():
    settings = _load_settings()
    # Injecter les infos sur les providers disponibles (sans exposer les clés)
    settings["providers_available"] = {
        "anthropic": bool(ANTHROPIC_API_KEY),
        "openai": bool(OPENAI_API_KEY),
    }
    return settings


class SettingsPatch(PydanticModel):
    mcp_servers: Optional[dict] = None
    default_provider: Optional[str] = None


@app.patch("/api/settings")
def patch_settings(patch: SettingsPatch):
    settings = _load_settings()
    if patch.mcp_servers is not None:
        settings["mcp_servers"] = patch.mcp_servers
    if patch.default_provider is not None:
        if patch.default_provider not in ("anthropic", "openai"):
            raise HTTPException(status_code=400, detail="Fournisseur inconnu")
        settings["default_provider"] = patch.default_provider
    _save_settings(settings)
    return settings


# ---------------------------------------------------------------------------
# Analyse IA
# ---------------------------------------------------------------------------

class AnalyzeRequest(PydanticModel):
    provider: str = "anthropic"
    api_key: Optional[str] = None
    mcp_servers: list[str] = []


async def _run_analysis_task(job_id: str, provider: str, api_key: str, active_servers: list[str]):
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
    )


@app.post("/api/transcribe/{job_id}/analyze", status_code=202)
async def analyze_job(job_id: str, req: AnalyzeRequest, background_tasks: BackgroundTasks):
    job = _load_job(job_id)
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail="Transcription non terminée")

    # Résolution de la clé API : body > .env
    provider = req.provider
    api_key = req.api_key or (ANTHROPIC_API_KEY if provider == "anthropic" else OPENAI_API_KEY)
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=f"Clé API {provider} absente. Fournissez api_key dans la requête ou configurez la variable d'environnement.",
        )

    background_tasks.add_task(_run_analysis_task, job_id, provider, api_key, req.mcp_servers)
    log.info("analysis requested", extra={"job_id": job_id, "provider": provider})
    return {"job_id": job_id, "analysis_status": "running"}
