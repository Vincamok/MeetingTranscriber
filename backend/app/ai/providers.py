"""
Fournisseurs IA : abstraction commune + implémentations Anthropic / OpenAI.
Chaque provider gère sa propre boucle tool-use.
"""

import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from .mcp_client import MCPClient
from .prompts import ANALYSIS_TOOL_SCHEMA, SYSTEM_PROMPT

log = logging.getLogger("transcriber.ai")


@dataclass
class AnalysisResult:
    summary: str = ""
    decisions: list[str] = field(default_factory=list)
    actions: list[dict] = field(default_factory=list)
    mcp_results: list[dict] = field(default_factory=list)


def _build_transcript_text(utterances: list[dict]) -> str:
    lines = []
    for u in utterances:
        lines.append(f"[{u['speaker']}] {u['text']}")
    return "\n".join(lines)


class BaseProvider(ABC):
    @abstractmethod
    async def analyze(
        self,
        utterances: list[dict],
        mcp_client: MCPClient,
        active_servers: list[str],
    ) -> AnalysisResult:
        ...


# ---------------------------------------------------------------------------
# Anthropic
# ---------------------------------------------------------------------------

class AnthropicProvider(BaseProvider):
    def __init__(self, api_key: str):
        import anthropic
        self._client = anthropic.Anthropic(api_key=api_key)

    async def analyze(
        self,
        utterances: list[dict],
        mcp_client: MCPClient,
        active_servers: list[str],
    ) -> AnalysisResult:
        import anthropic

        transcript = _build_transcript_text(utterances)
        result = AnalysisResult()

        # Collecter les tools MCP + le tool d'analyse structurée
        mcp_tools_meta: dict[str, dict] = {}  # name → {server, tool}
        tools: list[dict] = []

        for server in active_servers:
            try:
                server_tools = await mcp_client.list_tools(server)
                for t in server_tools:
                    mcp_tools_meta[t["name"]] = {"server": t["_server"], "tool": t["_tool"]}
                    tools.append({
                        "name": t["name"],
                        "description": t["description"],
                        "input_schema": t["input_schema"],
                    })
            except Exception as exc:
                log.warning("mcp list_tools failed", extra={"server": server, "error": str(exc)})

        # Toujours inclure le tool d'analyse structurée en premier
        tools.insert(0, ANALYSIS_TOOL_SCHEMA)

        messages = [{"role": "user", "content": f"Voici la transcription de la réunion :\n\n{transcript}"}]

        # Boucle tool-use
        for _ in range(20):  # max iterations
            response = self._client.messages.create(
                model="claude-opus-4-8",
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                tools=tools,
                messages=messages,
            )
            log.debug("anthropic response", extra={"stop_reason": response.stop_reason})

            # Ajouter la réponse assistant aux messages
            messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason != "tool_use":
                break

            # Traiter les tool calls
            tool_results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue

                tool_name = block.name
                tool_input = block.input

                if tool_name == "save_analysis":
                    result.summary = tool_input.get("summary", "")
                    result.decisions = tool_input.get("decisions", [])
                    result.actions = tool_input.get("actions", [])
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": "Analyse enregistrée.",
                    })
                elif tool_name in mcp_tools_meta:
                    meta = mcp_tools_meta[tool_name]
                    try:
                        mcp_out = await mcp_client.call_tool(meta["server"], meta["tool"], tool_input)
                        result.mcp_results.append({
                            "server": meta["server"],
                            "action": meta["tool"],
                            "result": mcp_out,
                        })
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": mcp_out,
                        })
                    except Exception as exc:
                        log.warning("mcp call_tool failed", extra={"tool": tool_name, "error": str(exc)})
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": f"Erreur : {exc}",
                            "is_error": True,
                        })

            if tool_results:
                messages.append({"role": "user", "content": tool_results})

        return result


# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------

class OpenAIProvider(BaseProvider):
    def __init__(self, api_key: str):
        import openai
        self._client = openai.OpenAI(api_key=api_key)

    @staticmethod
    def _to_openai_tool(tool: dict) -> dict:
        return {
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool.get("description", ""),
                "parameters": tool.get("input_schema", {"type": "object", "properties": {}}),
            },
        }

    async def analyze(
        self,
        utterances: list[dict],
        mcp_client: MCPClient,
        active_servers: list[str],
    ) -> AnalysisResult:
        transcript = _build_transcript_text(utterances)
        result = AnalysisResult()

        mcp_tools_meta: dict[str, dict] = {}
        tools: list[dict] = []

        for server in active_servers:
            try:
                server_tools = await mcp_client.list_tools(server)
                for t in server_tools:
                    mcp_tools_meta[t["name"]] = {"server": t["_server"], "tool": t["_tool"]}
                    tools.append(self._to_openai_tool(t))
            except Exception as exc:
                log.warning("mcp list_tools failed", extra={"server": server, "error": str(exc)})

        tools.insert(0, self._to_openai_tool(ANALYSIS_TOOL_SCHEMA))

        messages: list[dict] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Voici la transcription de la réunion :\n\n{transcript}"},
        ]

        for _ in range(20):
            response = self._client.chat.completions.create(
                model="gpt-4o",
                tools=tools,
                messages=messages,
            )
            choice = response.choices[0]
            log.debug("openai response", extra={"finish_reason": choice.finish_reason})

            messages.append(choice.message)

            if choice.finish_reason != "tool_calls" or not choice.message.tool_calls:
                break

            tool_messages = []
            for tc in choice.message.tool_calls:
                tool_name = tc.function.name
                try:
                    tool_input = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    tool_input = {}

                if tool_name == "save_analysis":
                    result.summary = tool_input.get("summary", "")
                    result.decisions = tool_input.get("decisions", [])
                    result.actions = tool_input.get("actions", [])
                    tool_messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": "Analyse enregistrée.",
                    })
                elif tool_name in mcp_tools_meta:
                    meta = mcp_tools_meta[tool_name]
                    try:
                        mcp_out = await mcp_client.call_tool(meta["server"], meta["tool"], tool_input)
                        result.mcp_results.append({
                            "server": meta["server"],
                            "action": meta["tool"],
                            "result": mcp_out,
                        })
                        tool_messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": mcp_out,
                        })
                    except Exception as exc:
                        log.warning("mcp call_tool failed", extra={"tool": tool_name, "error": str(exc)})
                        tool_messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": f"Erreur : {exc}",
                        })

            messages.extend(tool_messages)

        return result


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def get_provider(provider_name: str, api_key: str) -> BaseProvider:
    if provider_name == "anthropic":
        return AnthropicProvider(api_key)
    if provider_name == "openai":
        return OpenAIProvider(api_key)
    raise ValueError(f"Fournisseur inconnu : {provider_name}")
