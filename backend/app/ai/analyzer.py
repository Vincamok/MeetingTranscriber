"""
Orchestration de l'analyse IA d'un job de transcription.
"""

import logging
from datetime import datetime

from .mcp_client import MCPClient
from .providers import get_provider

log = logging.getLogger("minta.ai")


async def run_analysis(
    job: dict,
    save_job_fn,
    provider_name: str,
    api_key: str,
    mcp_servers_config: dict,
    active_server_names: list[str],
    template: str = "meeting",
) -> None:
    job_id = job["id"]
    job["analysis"] = {
        "status": "running",
        "provider": provider_name,
        "template": template,
        "summary": "",
        "decisions": [],
        "actions": [],
        "topics": [],
        "sentiment_per_speaker": {},
        "suggested_speaker_names": {},
        "mcp_results": [],
        "error": None,
        "created_at": datetime.utcnow().isoformat(),
    }
    save_job_fn(job)

    mcp_client = MCPClient()
    connected_servers = []

    try:
        for name in active_server_names:
            config = mcp_servers_config.get(name)
            if not config:
                log.warning("mcp server not configured", extra={"server": name})
                continue
            try:
                await mcp_client.connect(name, config)
                connected_servers.append(name)
            except Exception as exc:
                log.warning("mcp server skipped", extra={"server": name, "error": str(exc)})

        provider = get_provider(provider_name, api_key)
        result = await provider.analyze(
            utterances=job.get("utterances", []),
            mcp_client=mcp_client,
            active_servers=connected_servers,
            template=template,
        )

        job["analysis"].update({
            "status": "completed",
            "summary": result.summary,
            "decisions": result.decisions,
            "actions": result.actions,
            "topics": result.topics,
            "sentiment_per_speaker": result.sentiment_per_speaker,
            "suggested_speaker_names": result.suggested_speaker_names,
            "mcp_results": result.mcp_results,
        })
        log.info("analysis completed", extra={"job_id": job_id, "provider": provider_name})

    except Exception as exc:
        log.exception("analysis error", extra={"job_id": job_id})
        job["analysis"].update({"status": "error", "error": str(exc)})

    finally:
        await mcp_client.disconnect_all()
        save_job_fn(job)
