# Meeting Transcriber

Outil d'enregistrement de réunions avec diarisation (séparation des voix) et transcription horodatée.

## Stack

- **Frontend** : React 18 + Vite + TypeScript
- **Backend** : FastAPI (Python 3.12) — proxy sécurisé vers AssemblyAI
- **API** : [AssemblyAI](https://www.assemblyai.com) (diarisation + transcription, free tier : 100h/mois)

## Structure

```
meeting-transcriber/
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── MeetingTranscriber.tsx   ← composant principal
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   └── vite.config.ts
├── backend/
│   ├── app/
│   │   └── main.py                  ← proxy FastAPI
│   ├── Dockerfile
│   └── requirements.txt
├── docker-compose.yml
└── .env.example
```

## Démarrage rapide

### Dev local

```bash
# 1. Clé API
cp .env.example .env
# Éditer .env avec ta clé AssemblyAI

# 2. Backend
cd backend
pip install -r requirements.txt
ASSEMBLYAI_API_KEY=xxx uvicorn app.main:app --reload

# 3. Frontend (autre terminal)
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### Docker Compose (prod)

```bash
cp .env.example .env
# Éditer .env

docker compose up -d --build
# Frontend → http://localhost:3000
# Backend  → http://localhost:8000
```

## Mode actuel

Le composant `MeetingTranscriber.tsx` appelle directement l'API AssemblyAI
depuis le navigateur (CORS ouvert par AssemblyAI). Pour sécuriser la clé,
basculer vers le backend : remplacer les `fetch("https://api.assemblyai.com/...")`
par `fetch("/api/upload")` et `fetch("/api/transcribe")`.

## Fonctionnalités

- [x] Enregistrement micro live avec visualisation waveform
- [x] Import fichier audio (MP3, WAV, M4A, WEBM)
- [x] Diarisation multi-locuteurs (AssemblyAI speaker_labels)
- [x] Transcription en français avec horodatage
- [x] Timeline colorée par locuteur
- [x] Stats : nb locuteurs, mots, durée, segments
- [ ] Export (TXT / SRT / JSON)
- [ ] Stockage historique (MinIO)
- [ ] Édition manuelle de la transcription
- [ ] Lecture audio synchronisée avec la timeline

## Pistes d'évolution

- Brancher sur MinIO pour stocker les enregistrements (cohérent avec stack Memorhia)
- Ajouter un modèle de résumé automatique via l'API Anthropic
- Authentification JWT pour multi-utilisateurs
