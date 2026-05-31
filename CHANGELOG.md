# Changelog

Toutes les modifications notables sont documentées ici.
Format : [Semantic Versioning](https://semver.org/lang/fr/) — `MAJOR.MINOR.PATCH`

---

## [0.5.0] — 2026-05-31

### Ajouté
- **Édition manuelle de segments** — double-clic sur un segment pour corriger le texte ; badge `✏` indique les segments modifiés ; `PATCH /api/transcribe/{id}/segments`
- **Commentaires par segment** — icône 💬 au survol → saisie inline ; commentaire affiché sous le texte ; modifiable
- **Export DOCX** — bouton `↓ DOCX` dans la barre d'export ; document Word stylisé avec couleurs par locuteur et sections d'analyse
- **Chapitrage automatique IA** — l'IA découpe la réunion en chapitres (`title`, `start_ms`, `summary`) ; affichés dans le panneau Analyse avec horodatage

---

## [0.4.0] — 2026-05-31

### Ajouté
- **Nom** : l'outil s'appelle désormais **Minta**
- **Détection automatique de la langue** — Whisper détecte la langue si `language=auto` (défaut) ; sélecteur UI (fr, en, es, de, it, pt, ja, zh, auto)
- **Support vidéo** — MP4, MKV, MOV, AVI, M4V acceptés ; ffmpeg extrait la piste audio avant la transcription
- **Player audio synchronisé** — barre de lecture avec seek par clic ; segment actif surligné en jaune en temps réel
- **Renommage des locuteurs** — clic sur le badge → édition inline ; `PATCH /api/transcribe/{id}/speakers`
- **Partage public** — `POST /api/transcribe/{id}/share` génère un token ; page `/share/{token}` en lecture seule sans nav
- **Webhook fin de job** — URL configurable dans les paramètres ; POST JSON envoyé à la fin de chaque transcription
- **Templates de prompt IA** — Réunion projet / Entretien candidat / Support client / Démo commerciale
- **Analyse IA étendue** : topics (sujets), sentiment par locuteur, suggestion de noms de locuteurs par l'IA
- **Bouton "Appliquer" les noms suggérés** par l'IA directement dans le panneau analyse
- **Audio conservé** dans `/tmp/minta/audio/` pour le player ; `GET /api/transcribe/{id}/audio` ; supprimé avec le job
- Lien 🔗 dans l'historique si partage activé
- `SharePage.tsx` — page publique de transcription partagée

### Modifié
- Répertoire de données : `/tmp/transcriber/` → `/tmp/minta/`
- Backend version : 0.4.0, titre API : "Minta API"
- `_run_pipeline` : extraction vidéo ffmpeg, conservation audio, langue dynamique, webhook post-job
- `ai/prompts.py` : TEMPLATES multi-types, schema étendu (topics, sentiment, suggested_speaker_names)
- `ai/providers.py` : AnalysisResult étendu, get_system_prompt(template) par provider
- `ai/analyzer.py` : passage du template au provider
- `SettingsPage.tsx` : + champ webhook URL

### Reporté (trop complexe pour cette itération)
- Amélioration audio (demucs/noisereduce — couche ML lourde)
- Calendrier Google/Outlook (OAuth2)
- Authentification JWT
- Fusion multi-fichiers
- Commentaires par segment
- Édition manuelle du texte

---

## [0.3.0] — 2026-05-31

### Ajouté
- Analyse IA multi-fournisseurs (Anthropic Claude / OpenAI GPT-4o), déclenchée manuellement
- Intégration MCP : connexion à des serveurs MCP stdio (npx) ou SSE pour pousser tâches et décisions
- Support natif des serveurs Linear, GitHub Issues, Notion, Jira, et tout serveur MCP custom (ex: Loom)
- `POST /api/transcribe/{id}/analyze` — lance l'analyse en arrière-plan
- `GET /api/settings` + `PATCH /api/settings` — configuration IA/MCP persistée dans `/tmp/transcriber/settings.json`
- `AIAnalysisPanel.tsx` — panneau pliable avec choix provider, clé API, sélection MCP, résultats (résumé / décisions / actions / logs MCP)
- `SettingsPage.tsx` — page `/settings` pour gérer les serveurs MCP (add/edit/remove, stdio et SSE)
- Navigation : icône ⚙️ dans la barre vers `/settings` ; lien actif mis en gras
- Variables d'env : `AI_DEFAULT_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- Badge "✦ IA analysé / en cours / erreur" dans l'historique
- nodejs + npm ajoutés dans les deux Dockerfiles (requis pour MCP stdio via npx)
- Clés API stockées dans `localStorage` côté client, jamais persistées sur le serveur

### Modifié
- `backend/requirements.txt` : + `anthropic`, `openai`, `mcp`
- `docker-compose.yml` : + variables AI_DEFAULT_PROVIDER, ANTHROPIC_API_KEY, OPENAI_API_KEY
- Backend version bumped à 0.3.0

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
