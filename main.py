"""
Meeting Transcriber — FastAPI backend

Rôle : proxy sécurisé vers AssemblyAI pour éviter d'exposer la clé API
côté client, et stocker les transcriptions (optionnel, via MinIO).

Endpoints :
  POST /api/upload        → upload audio vers AssemblyAI
  POST /api/transcribe    → soumettre une transcription
  GET  /api/transcribe/{id} → polling du statut
  GET  /api/transcripts   → liste des transcriptions sauvegardées (si MinIO activé)
"""

import os
import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY", "")
ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2"

app = FastAPI(title="Meeting Transcriber API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", os.getenv("FRONTEND_ORIGIN", "")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def aai_headers() -> dict:
    if not ASSEMBLYAI_API_KEY:
        raise HTTPException(status_code=500, detail="ASSEMBLYAI_API_KEY non configurée")
    return {"authorization": ASSEMBLYAI_API_KEY}


@app.get("/api/health")
def health():
    return {"status": "ok", "assemblyai_configured": bool(ASSEMBLYAI_API_KEY)}


@app.post("/api/upload")
async def upload_audio(file: UploadFile = File(...)):
    """Upload un fichier audio vers AssemblyAI et retourne l'upload_url."""
    content = await file.read()
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{ASSEMBLYAI_BASE}/upload",
            headers={**aai_headers(), "Content-Type": "application/octet-stream"},
            content=content,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


class TranscribeRequest(BaseModel):
    audio_url: str
    language_code: str = "fr"
    speaker_labels: bool = True
    speakers_expected: Optional[int] = None


@app.post("/api/transcribe")
async def start_transcription(req: TranscribeRequest):
    """Soumet une transcription avec diarisation."""
    payload = {
        "audio_url": req.audio_url,
        "language_code": req.language_code,
        "speaker_labels": req.speaker_labels,
    }
    if req.speakers_expected:
        payload["speakers_expected"] = req.speakers_expected

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{ASSEMBLYAI_BASE}/transcript",
            headers={**aai_headers(), "Content-Type": "application/json"},
            json=payload,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


@app.get("/api/transcribe/{transcript_id}")
async def poll_transcription(transcript_id: str):
    """Polling du statut d'une transcription."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{ASSEMBLYAI_BASE}/transcript/{transcript_id}",
            headers=aai_headers(),
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()
