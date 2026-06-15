# Minta — Roadmap

## v0.9.0 — UX Quick Wins
- **Timeline locuteurs** : vue horizontale (à la Descript) avec couleur par locuteur
- **Recherche in-transcript** : Ctrl+F pour surligner les occurrences dans la transcription
- **Raccourcis clavier lecteur** : Espace (play/pause), ←/→ (±5s), ↑/↓ (volume)
- **Score de confiance par mot** : surlignage des mots incertains (whisper word-level timestamps)
- **Prompt contextuel** : champ "vocabulaire/contexte" avant transcription pour améliorer la précision

## v1.0.0 — Exports & Intégrations
- **Export PDF** : compte-rendu mis en forme avec titre, date, locuteurs, transcription et analyse IA
- **Webhook configurable** : envoi POST (JSON) vers Zapier / n8n / Make à la fin de chaque transcription
- **Résumé par email** : notification SMTP optionnelle avec résumé et lien vers la transcription
- **Analyse IA multi-fournisseurs + MCP** : Anthropic / OpenAI + push vers Linear, GitHub Issues, Notion, Jira via MCP

## v1.1.0 — Transcripteur Vidéo Live
- **Lecteur vidéo intégré** : upload d'une vidéo (MP4, WebM, MOV…) et lecture dans le navigateur
- **Transcription synchronisée** : les sous-titres défilent en temps réel calés sur la position de lecture
- **Timeline texte** : bandeau sous la vidéo montrant la transcription avec curseur de position
- **Navigation par phrase** : clic sur une phrase → saute à ce timestamp dans la vidéo
- **Export SRT/VTT** : sous-titres prêts pour intégration dans un lecteur externe

## v1.2.0 — Ops & Fiabilité
- **Pré-chargement des modèles** : Whisper + pyannote chargés au démarrage (pas lazy-load)
- **Visibilité file d'attente** : position estimée + temps restant pour les jobs en processing
- **Auto-purge** : suppression automatique des jobs > N jours (`DATA_RETENTION_DAYS`)
- **Métriques** : endpoint `/api/metrics` (jobs traités, temps moyen, erreurs)

## v1.3.0 — Sécurité & Multi-utilisateurs
- **Multi-utilisateurs** : isolation des jobs par compte (chaque utilisateur voit uniquement ses données)
- **2FA TOTP** : activation optionnelle via application authenticator (TOTP RFC 6238)
- **Audit log** : traçabilité des actions (login, upload, suppression, export)

## v2.0.0 — Intelligence Contextuelle
- **Profils de transcription** : vocabulaires métier sauvegardés (médical, juridique, tech…)
- **Résumé automatique post-transcription** : déclenchement IA optionnel sans interaction manuelle
- **Détection de langue automatique** améliorée avec hint utilisateur
- **Diarization fine-tuning** : correction manuelle des locuteurs persistée dans le job
