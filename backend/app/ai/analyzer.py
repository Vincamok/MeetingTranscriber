"""
Orchestration de l'analyse IA d'un job de transcription.
Appelé en tâche de fond par FastAPI BackgroundTasks.
"""

import logging
from datetime import datetime

from .mcp_client import MCPClient
from .providers import get_provider

log = logging.getLogger("transcriber.ai")


async def run_analysis(
    job: dict,
    save_job_fn,
    provider_name: str,
    api_key: str,
    mcp_servers_config: dict,
    active_server_names: list[str],
) -> None:
    """
    Exécute l'analyse IA du job et met à jour job['analysis'] via save_job_fn.

    job                  : dict complet du job (déjà chargé)
    save_job_fn          : callable(job) pour persister les modifications
    provider_name        : "anthropic" | "openai"
    api_key              : clé API du fournisseur
    mcp_servers_config   : dict complet des configs MCP (depuis settings)
    active_server_names  : serveurs à activer pour cette analyse
    """
    job_id = job["id"]

    job["analysis"] = {
        "status": "running",
        "provider": provider_name,
        "summary": "",
        "decisions": [],
        "actions": [],
        "mcp_results": [],
        "error": None,
        "created_at": datetime.utcnow().isoformat(),
    }
    save_job_fn(job)

    mcp_client = MCPClient()
    connected_servers = []

    try:
        # Connexion aux serveurs MCP demandés
        for name in active_server_names:
            config = mcp_servers_config.get(name)
            if not config:
                log.warning("mcp server not configured", extra={"server": name, "job_id": job_id})
                continue
            try:
                await mcp_client.connect(name, config)
                connected_servers.append(name)
            except Exception as exc:
                log.warning("mcp server skipped", extra={"server": name, "error": str(exc), "job_id": job_id})

        provider = get_provider(provider_name, api_key)
        result = await provider.analyze(
            utterances=job.get("utterances", []),
            mcp_client=mcp_client,
            active_servers=connected_servers,
        )

        job["analysis"].update({
            "status": "completed",
            "summary": result.summary,
            "decisions": result.decisions,
            "actions": result.actions,
            "mcp_results": result.mcp_results,
        })
        log.info("analysis completed", extra={"job_id": job_id, "provider": provider_name})

    except Exception as exc:
        log.exception("analysis error", extra={"job_id": job_id})
        job["analysis"].update({"status": "error", "error": str(exc)})

    finally:
        await mcp_client.disconnect_all()
        save_job_fn(job)
