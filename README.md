# Meeting Transcriber

Application web de transcription de réunions avec diarisation des locuteurs, **100% auto-hébergée** — aucune dépendance à un service cloud externe.

## Stack

- **Frontend** : React 18 + Vite + TypeScript + React Router
- **Backend** : FastAPI (Python 3.12), faster-whisper, pyannote.audio 3.1
- **Infra** : Docker Compose (profils `cpu` / `gpu`)

## Structure

```
meeting-transcriber/
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx                  ← routeur
│   │   ├── MeetingTranscriber.tsx   ← page principale
│   │   └── HistoryPage.tsx          ← historique des jobs
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   └── vite.config.ts
├── backend/
│   ├── app/
│   │   └── main.py                  ← pipeline FastAPI
│   ├── Dockerfile                   ← profil CPU
│   ├── Dockerfile.gpu               ← profil GPU (CUDA 12.1)
│   └── requirements.txt
├── docker-compose.yml
└── .env.example
```

## Prérequis

- Token Hugging Face avec accès accepté à [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)
- Docker + Docker Compose (pour le mode prod)

## Démarrage rapide

### Dev local

```bash
# 1. Variables d'environnement
cp .env.example .env
# Éditer .env : renseigner HF_TOKEN

# 2. Backend
cd backend
pip install -r requirements.txt
HF_TOKEN=hf_xxx uvicorn app.main:app --reload

# 3. Frontend (autre terminal)
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### Docker Compose — profil CPU

```bash
cp .env.example .env  # renseigner HF_TOKEN
docker compose --profile cpu up -d --build
# Frontend → http://localhost:3000
# Backend  → http://localhost:8000
```

### Docker Compose — profil GPU

```bash
docker compose --profile gpu up -d --build
```

## Fonctionnalités

- [x] Enregistrement micro live avec visualisation waveform
- [x] Import fichier audio (MP3, WAV, M4A, WEBM)
- [x] Transcription locale via faster-whisper (modèle configurable)
- [x] Diarisation multi-locuteurs via pyannote.audio 3.1
- [x] Pipeline asynchrone — jobs persistés en JSON
- [x] Indicateur file d'attente si un job est déjà en cours
- [x] Export TXT / SRT (conforme HH:MM:SS,mmm) / JSON
- [x] Page historique avec statut, durée, nb locuteurs
- [x] Suppression de jobs depuis l'historique
- [x] Logging structuré JSON (`LOG_LEVEL` configurable)
- [x] `GET /api/health` enrichi (device, modèles, nb jobs)
- [ ] Édition manuelle de la transcription
- [ ] Lecture audio synchronisée avec la timeline
- [ ] Résumé automatique (API Anthropic)

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `HF_TOKEN` | — | Token Hugging Face (requis pour la diarisation) |
| `WHISPER_MODEL` | `large-v3` | Modèle Whisper : `tiny` `base` `small` `medium` `large-v3` |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Origine CORS autorisée |
| `LOG_LEVEL` | `INFO` | Niveau de log : `DEBUG` `INFO` `WARNING` `ERROR` |

## API — commandes curl de test

```bash
# Santé du service
curl http://localhost:8000/api/health

# Upload + lancement (retourne job_id)
curl -X POST http://localhost:8000/api/upload \
  -F "file=@mon_audio.mp3"

# Polling statut
curl http://localhost:8000/api/transcribe/<job_id>

# Export SRT
curl "http://localhost:8000/api/transcribe/<job_id>/export?format=srt" -o out.srt

# Liste tous les jobs
curl http://localhost:8000/api/transcripts

# Suppression
curl -X DELETE http://localhost:8000/api/transcribe/<job_id>
```

## Pistes d'évolution

Voir [ROADMAP.md](./ROADMAP.md) pour le détail des évolutions planifiées.
Voir [CHANGELOG.md](./CHANGELOG.md) pour l'historique des versions.
