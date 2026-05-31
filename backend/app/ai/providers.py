"""
Fournisseurs IA : abstraction commune + implémentations Anthropic / OpenAI.
"""

import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from .mcp_client import MCPClient
from .prompts import ANALYSIS_TOOL_SCHEMA, get_system_prompt

log = logging.getLogger("minta.ai")


@dataclass
class AnalysisResult:
    summary: str = ""
    decisions: list[str] = field(default_factory=list)
    actions: list[dict] = field(default_factory=list)
    topics: list[str] = field(default_factory=list)
    sentiment_per_speaker: dict[str, str] = field(default_factory=dict)
    suggested_speaker_names: dict[str, str] = field(default_factory=dict)
    mcp_results: list[dict] = field(default_factory=list)


def _build_transcript(utterances: list[dict]) -> str:
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
        template: str,
    ) -> AnalysisResult: ...


# ---------------------------------------------------------------------------
# Anthropic
# ---------------------------------------------------------------------------

class AnthropicProvider(BaseProvider):
    def __init__(self, api_key: str):
        import anthropic
        self._client = anthropic.Anthropic(api_key=api_key)

    async def analyze(self, utterances, mcp_client, active_servers, template) -> AnalysisResult:
        transcript = _build_transcript(utterances)
        result = AnalysisResult()
        system = get_system_prompt(template)

        mcp_meta: dict[str, dict] = {}
        tools: list[dict] = [ANALYSIS_TOOL_SCHEMA]

        for server in active_servers:
            try:
                for t in await mcp_client.list_tools(server):
                    mcp_meta[t["name"]] = {"server": t["_server"], "tool": t["_tool"]}
                    tools.append({"name": t["name"], "description": t["description"], "input_schema": t["input_schema"]})
            except Exception as exc:
                log.warning("mcp list_tools failed", extra={"server": server, "error": str(exc)})

        messages = [{"role": "user", "content": f"Transcription :\n\n{transcript}"}]

        for _ in range(20):
            resp = self._client.messages.create(
                model="claude-opus-4-8", max_tokens=4096,
                system=system, tools=tools, messages=messages,
            )
            messages.append({"role": "assistant", "content": resp.content})
            if resp.stop_reason != "tool_use":
                break

            tool_results = []
            for block in resp.content:
                if block.type != "tool_use":
                    continue
                if block.name == "save_analysis":
                    inp = block.input
                    result.summary = inp.get("summary", "")
                    result.decisions = inp.get("decisions", [])
                    result.actions = inp.get("actions", [])
                    result.topics = inp.get("topics", [])
                    result.sentiment_per_speaker = inp.get("sentiment_per_speaker", {})
                    result.suggested_speaker_names = inp.get("suggested_speaker_names", {})
                    tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": "OK"})
                elif block.name in mcp_meta:
                    meta = mcp_meta[block.name]
                    try:
                        out = await mcp_client.call_tool(meta["server"], meta["tool"], block.input)
                        result.mcp_results.append({"server": meta["server"], "action": meta["tool"], "result": out})
                        tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": out})
                    except Exception as exc:
                        tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": f"Erreur : {exc}", "is_error": True})

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
    def _wrap(tool: dict) -> dict:
        return {"type": "function", "function": {
            "name": tool["name"],
            "description": tool.get("description", ""),
            "parameters": tool.get("input_schema", {"type": "object", "properties": {}}),
        }}

    async def analyze(self, utterances, mcp_client, active_servers, template) -> AnalysisResult:
        transcript = _build_transcript(utterances)
        result = AnalysisResult()
        system = get_system_prompt(template)

        mcp_meta: dict[str, dict] = {}
        tools = [self._wrap(ANALYSIS_TOOL_SCHEMA)]

        for server in active_servers:
            try:
                for t in await mcp_client.list_tools(server):
                    mcp_meta[t["name"]] = {"server": t["_server"], "tool": t["_tool"]}
                    tools.append(self._wrap(t))
            except Exception as exc:
                log.warning("mcp list_tools failed", extra={"server": server, "error": str(exc)})

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Transcription :\n\n{transcript}"},
        ]

        for _ in range(20):
            resp = self._client.chat.completions.create(model="gpt-4o", tools=tools, messages=messages)
            choice = resp.choices[0]
            messages.append(choice.message)
            if choice.finish_reason != "tool_calls" or not choice.message.tool_calls:
                break

            tool_msgs = []
            for tc in choice.message.tool_calls:
                try:
                    inp = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    inp = {}
                if tc.function.name == "save_analysis":
                    result.summary = inp.get("summary", "")
                    result.decisions = inp.get("decisions", [])
                    result.actions = inp.get("actions", [])
                    result.topics = inp.get("topics", [])
                    result.sentiment_per_speaker = inp.get("sentiment_per_speaker", {})
                    result.suggested_speaker_names = inp.get("suggested_speaker_names", {})
                    tool_msgs.append({"role": "tool", "tool_call_id": tc.id, "content": "OK"})
                elif tc.function.name in mcp_meta:
                    meta = mcp_meta[tc.function.name]
                    try:
                        out = await mcp_client.call_tool(meta["server"], meta["tool"], inp)
                        result.mcp_results.append({"server": meta["server"], "action": meta["tool"], "result": out})
                        tool_msgs.append({"role": "tool", "tool_call_id": tc.id, "content": out})
                    except Exception as exc:
                        tool_msgs.append({"role": "tool", "tool_call_id": tc.id, "content": f"Erreur : {exc}"})
            messages.extend(tool_msgs)

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
