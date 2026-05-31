SYSTEM_PROMPT = """Tu es un assistant spécialisé dans l'analyse de comptes-rendus de réunions professionnelles.

À partir de la transcription fournie, tu dois :

1. Rédiger un **résumé** concis (3-5 phrases) des points essentiels abordés.
2. Lister les **décisions** prises durant la réunion (si aucune, retourner une liste vide).
3. Lister les **actions** à réaliser : pour chaque action, indiquer le texte, le responsable (si mentionné, sinon null) et la date limite (si mentionnée, sinon null).

Si des outils MCP sont disponibles, utilise-les pour créer les tâches identifiées dans les outils de suivi appropriés. Utilise les outils de façon ciblée : ne crée des éléments que si le contenu de la réunion le justifie clairement.

Réponds uniquement en français.
Sois factuel et concis. Ne reformule pas ce qui est déjà dans la transcription.
"""

ANALYSIS_TOOL_SCHEMA = {
    "name": "save_analysis",
    "description": "Enregistre le résumé structuré de la réunion (résumé, décisions, actions).",
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "Résumé concis de la réunion (3-5 phrases).",
            },
            "decisions": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Liste des décisions prises durant la réunion.",
            },
            "actions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "Description de l'action."},
                        "assignee": {"type": ["string", "null"], "description": "Responsable (null si non précisé)."},
                        "due": {"type": ["string", "null"], "description": "Date limite (null si non précisée)."},
                    },
                    "required": ["text", "assignee", "due"],
                },
                "description": "Liste des actions identifiées.",
            },
        },
        "required": ["summary", "decisions", "actions"],
    },
}
