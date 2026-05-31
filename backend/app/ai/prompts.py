TEMPLATES: dict[str, dict] = {
    "meeting": {
        "label": "Réunion projet",
        "system": (
            "Tu es un assistant spécialisé dans l'analyse de comptes-rendus de réunions professionnelles. "
            "À partir de la transcription, identifie le résumé, les décisions, les actions à réaliser, "
            "les sujets abordés, le sentiment général de chaque locuteur, et suggère des prénoms plausibles "
            "pour chaque locuteur basés sur ce qu'ils disent."
        ),
    },
    "interview": {
        "label": "Entretien candidat",
        "system": (
            "Tu es un assistant RH analysant un entretien d'embauche. "
            "Identifie les compétences mentionnées, les points forts et axes d'amélioration du candidat, "
            "les questions posées, et les prochaines étapes discutées. "
            "Le locuteur principal est le recruteur, les autres sont des candidats."
        ),
    },
    "support": {
        "label": "Support client",
        "system": (
            "Tu es un assistant analysant un appel de support client. "
            "Identifie le problème rapporté, la solution proposée, le niveau de satisfaction client, "
            "et les actions de suivi nécessaires."
        ),
    },
    "demo": {
        "label": "Démo commerciale",
        "system": (
            "Tu es un assistant analysant une démonstration commerciale. "
            "Identifie les fonctionnalités présentées, les objections soulevées, les engagements pris, "
            "et les prochaines étapes commerciales."
        ),
    },
}

_COMMON_INSTRUCTIONS = """
Réponds uniquement dans la langue de la transcription.
Sois factuel et concis. Utilise le tool save_analysis pour structurer ta réponse.
Si des outils MCP sont disponibles, utilise-les pour créer les tâches identifiées.
"""


def get_system_prompt(template: str) -> str:
    tmpl = TEMPLATES.get(template, TEMPLATES["meeting"])
    return tmpl["system"] + _COMMON_INSTRUCTIONS


ANALYSIS_TOOL_SCHEMA = {
    "name": "save_analysis",
    "description": "Enregistre l'analyse structurée de la réunion.",
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "Résumé concis (3-5 phrases).",
            },
            "decisions": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Décisions prises.",
            },
            "actions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string"},
                        "assignee": {"type": ["string", "null"]},
                        "due": {"type": ["string", "null"]},
                    },
                    "required": ["text", "assignee", "due"],
                },
                "description": "Actions à réaliser.",
            },
            "topics": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Sujets principaux abordés (mots-clés ou thèmes courts).",
            },
            "sentiment_per_speaker": {
                "type": "object",
                "description": "Sentiment dominant par locuteur (clé = SPEAKER_XX, valeur = positif | neutre | négatif | tendu).",
                "additionalProperties": {"type": "string"},
            },
            "suggested_speaker_names": {
                "type": "object",
                "description": "Noms ou rôles suggérés par locuteur déduits du contenu (clé = SPEAKER_XX, valeur = prénom/rôle).",
                "additionalProperties": {"type": "string"},
            },
            "chapters": {
                "type": "array",
                "description": "Chapitres identifiés dans la réunion, ordonnés chronologiquement.",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Titre court du chapitre."},
                        "start_ms": {"type": "integer", "description": "Début du chapitre en millisecondes."},
                        "summary": {"type": "string", "description": "Résumé du chapitre (1-2 phrases)."},
                    },
                    "required": ["title", "start_ms", "summary"],
                },
            },
        },
        "required": ["summary", "decisions", "actions", "topics", "sentiment_per_speaker", "suggested_speaker_names", "chapters"],
    },
}
