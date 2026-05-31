# Roadmap

Évolutions planifiées par ordre de priorité. Les items sans version sont non planifiés.

---

## [0.3.0] — Qualité & édition

- [ ] **Édition manuelle** — corriger le texte d'un segment directement dans l'interface
- [ ] **Renommage des locuteurs** — remplacer "Locuteur A" par un vrai prénom, persisté dans le job
- [ ] **Lecture audio synchronisée** — clic sur un segment → seek dans le player audio

---

## [0.4.0] — Intelligence

- [ ] **Résumé automatique** — appel à l'API Anthropic (Claude) pour générer un résumé structuré (décisions, actions, participants)
- [ ] **Détection de langue automatique** — laisser Whisper détecter la langue sans forcer `fr`
- [ ] **Chapitrage automatique** — découper la transcription en thèmes/sections

---

## [0.5.0] — Stockage & multi-utilisateurs

- [ ] **Stockage objet MinIO** — archiver les fichiers audio liés à chaque job
- [ ] **Authentification JWT** — comptes utilisateurs, isolation des jobs par utilisateur
- [ ] **Partage de transcription** — lien public en lecture seule pour un job

---

## Non planifié

- [ ] **Support vidéo** — extraire la piste audio d'un fichier MP4/MKV via ffmpeg
- [ ] **Webhook fin de job** — notifier une URL externe quand la transcription est terminée
- [ ] **Mode temps réel** — transcription en streaming via WebSocket pendant l'enregistrement
- [ ] **Export DOCX** — mise en forme Word avec styles par locuteur
