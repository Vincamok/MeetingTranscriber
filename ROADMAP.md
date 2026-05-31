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

## [0.5.0] — Qualité & édition

- [ ] **Édition manuelle** — corriger le texte d'un segment directement dans l'interface
- [ ] **Commentaires par segment** — annoter un passage (comme Notion)

---

## [0.5.0] — Intelligence avancée

- [ ] **Détection de langue automatique** — laisser Whisper détecter la langue sans forcer `fr`
- [ ] **Chapitrage automatique** — découper la transcription en thèmes/sections via IA
- [ ] **Templates de prompt** — choisir le type d'analyse (réunion projet, entretien, support client…)

---

## [0.6.0] — Stockage & multi-utilisateurs

- [ ] **Stockage objet MinIO** — archiver les fichiers audio liés à chaque job
- [ ] **Authentification JWT** — comptes utilisateurs, isolation des jobs par utilisateur
- [ ] **Partage de transcription** — lien public en lecture seule pour un job

---

## Non planifié

- [ ] **Support vidéo** — extraire la piste audio d'un fichier MP4/MKV via ffmpeg
- [ ] **Webhook fin de job** — notifier une URL externe quand la transcription est terminée
- [ ] **Mode temps réel** — transcription en streaming via WebSocket pendant l'enregistrement
- [ ] **Export DOCX** — mise en forme Word avec styles par locuteur
