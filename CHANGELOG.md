# Changelog

Toutes les modifications notables sont documentées ici.
Format : [Semantic Versioning](https://semver.org/lang/fr/) — `MAJOR.MINOR.PATCH`

---

## [0.2.0] — 2026-05-31

### Ajouté
- Pipeline local faster-whisper + pyannote.audio 3.1 (remplacement du proxy AssemblyAI)
- Jobs asynchrones avec persistance fichier JSON dans `/tmp/transcriber/jobs/`
- `POST /api/upload` — upload audio + lancement pipeline en arrière-plan
- `GET /api/transcribe/{id}` — polling statut / résultat
- `GET /api/transcribe/{id}/export?format=txt|srt|json` — export côté backend (SRT conforme `HH:MM:SS,mmm`)
- `GET /api/transcripts` — liste de tous les jobs
- `DELETE /api/transcribe/{id}` — suppression d'un job
- `GET /api/health` enrichi : device CUDA détecté, modèles chargés, nb jobs en cours
- `Dockerfile.gpu` — profil GPU (CUDA 12.1 + torch cu121)
- `docker-compose.yml` avec profils `cpu` / `gpu` et volumes persistants
- Variables d'environnement `HF_TOKEN`, `WHISPER_MODEL`, `LOG_LEVEL`
- Logging structuré JSON via `python-json-logger`
- `initial_prompt` Whisper pour améliorer la ponctuation française
- Page `/history` : liste des jobs avec statut, durée, nb locuteurs, nb mots
- Bouton Supprimer par job depuis l'historique
- Auto-refresh de l'historique si des jobs sont en cours
- Indicateur file d'attente si un job est déjà en traitement
- Navigation SPA via React Router (`/` et `/history`)
- Boutons export TXT / SRT / JSON dans l'interface principale et l'historique
- `.gitignore`

### Modifié
- Frontend : suppression du champ clé API AssemblyAI, appels redirigés vers `/api/...`
- `backend/Dockerfile` : ajout de `ffmpeg`
- `backend/requirements.txt` : remplacement de `httpx` par faster-whisper, pyannote, aiofiles, python-json-logger
- README mis à jour (stack auto-hébergée, variables d'env, commandes curl)

### Supprimé
- Proxy AssemblyAI (`httpx` + `ASSEMBLYAI_API_KEY`)
- Doublon `MeetingTranscriber.tsx` à la racine du dépôt

---

## [0.1.0] — 2026-05-30

### Ajouté
- Enregistrement micro live avec visualisation waveform canvas
- Import fichier audio (MP3, WAV, M4A, WEBM) par clic ou drag-and-drop
- Proxy FastAPI vers AssemblyAI (upload + transcription + polling)
- Diarisation multi-locuteurs via `speaker_labels` AssemblyAI
- Transcription en français avec horodatage par segment
- Timeline colorée par locuteur (jusqu'à 5 couleurs)
- Stats : nb locuteurs, mots, durée, segments
- Docker Compose mono-profil (backend + frontend Nginx)
