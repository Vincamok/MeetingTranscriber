# Roadmap

Évolutions planifiées par ordre de priorité. Les items sans version sont non planifiés.

---

## [0.3.0] — IA + MCP ✅ (livré)

- [x] Analyse IA multi-fournisseurs (Anthropic / OpenAI)
- [x] Intégration MCP : Linear, GitHub Issues, Notion, Jira, serveurs custom (SSE/stdio)
- [x] Page paramètres MCP
- [x] Clés API via UI (localStorage) ou .env

---

## [0.4.0] — Support vidéo, player, partage, IA étendue ✅ (livré)

- [x] Support vidéo (MP4, MKV, MOV, AVI)
- [x] Player audio synchronisé avec surlignage du segment actif
- [x] Renommage des locuteurs (inline + suggestion IA)
- [x] Partage public `/share/{token}`
- [x] Webhook fin de job
- [x] Templates de prompt IA (réunion, entretien, support, démo)
- [x] Analyse étendue : topics, sentiment, suggestion de noms
- [x] Langue auto-détectée + sélecteur UI

## [0.5.0] — Qualité & édition ✅ (livré)

- [x] **Édition manuelle** — corriger le texte d'un segment directement dans l'interface
- [x] **Commentaires par segment** — annoter un passage (comme Notion)
- [x] **Export DOCX** — Word stylisé avec analyse intégrée
- [x] **Chapitrage automatique IA** — titre + timestamp + résumé par chapitre

---

## [0.6.0] — Stockage & Auth ✅ (livré)

- [x] **DATA_DIR configurable** — volume Docker persistant pour jobs + audio
- [x] **Authentification JWT** — login page, token Bearer 24h, `AUTH_ENABLED` opt-in
- [x] **apiFetch centralisé** — headers auth injectés automatiquement dans le frontend

---

## [0.7.0] — Recherche, Tags, Auto-analyse ✅ (livré)

- [x] **Recherche full-text** — barre de recherche dans l'historique, debounce, résultats instantanés
- [x] **Tags** — étiqueter les jobs, filtre par tag avec couleurs
- [x] **Auto-analyse IA** — option dans les paramètres, se déclenche automatiquement post-transcription

---

## [0.8.0] — Mode temps réel ✅ (livré)

- [x] **Transcription temps réel** — WebSocket `/api/ws/transcribe`, blobs audio cumulatifs toutes les 4s
- [x] **Affichage live** — segments horodatés en temps réel pendant l'enregistrement
- [x] **Non-bloquant** — Whisper dans un executor thread, loop asyncio libre

---

## Non planifié (items obsolètes — déjà livrés dans des versions antérieures)

- [x] ~~Support vidéo~~ — livré en v0.4.0
- [x] ~~Webhook fin de job~~ — livré en v0.4.0
- [x] ~~Export DOCX~~ — livré en v0.5.0
