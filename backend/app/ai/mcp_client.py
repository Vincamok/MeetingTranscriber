"""
Gestion des connexions aux serveurs MCP (stdio et SSE).
Expose une interface uniforme : list_tools / call_tool.
"""

import asyncio
import logging
from contextlib import AsyncExitStack
from typing import Any

log = logging.getLogger("transcriber.mcp")


class MCPClient:
    def __init__(self):
        self._sessions: dict[str, Any] = {}
        self._exit_stack = AsyncExitStack()

    async def connect(self, server_name: str, config: dict) -> None:
        """Connecte un serveur MCP par son nom et sa config."""
        server_type = config.get("type", "stdio")
        try:
            if server_type == "stdio":
                await self._connect_stdio(server_name, config)
            elif server_type == "sse":
                await self._connect_sse(server_name, config)
            else:
                raise ValueError(f"Type MCP inconnu : {server_type}")
            log.info("mcp connected", extra={"server": server_name, "type": server_type})
        except Exception as exc:
            log.warning("mcp connection failed", extra={"server": server_name, "error": str(exc)})
            raise

    async def _connect_stdio(self, name: str, config: dict) -> None:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        params = StdioServerParameters(
            command=config["command"],
            args=config.get("args", []),
            env=config.get("env"),
        )
        read, write = await self._exit_stack.enter_async_context(stdio_client(params))
        session = await self._exit_stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        self._sessions[name] = session

    async def _connect_sse(self, name: str, config: dict) -> None:
        from mcp import ClientSession
        from mcp.client.sse import sse_client

        read, write = await self._exit_stack.enter_async_context(
            sse_client(config["url"], headers=config.get("headers", {}))
        )
        session = await self._exit_stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        self._sessions[name] = session

    async def list_tools(self, server_name: str) -> list[dict]:
        """Retourne les tools d'un serveur au format Anthropic (input_schema)."""
        session = self._sessions.get(server_name)
        if not session:
            return []
        result = await session.list_tools()
        tools = []
        for tool in result.tools:
            tools.append({
                "name": f"{server_name}__{tool.name}",
                "description": tool.description or "",
                "input_schema": tool.inputSchema or {"type": "object", "properties": {}},
                "_server": server_name,
                "_tool": tool.name,
            })
        return tools

    async def call_tool(self, server_name: str, tool_name: str, arguments: dict) -> str:
        """Appelle un tool MCP et retourne le résultat en texte."""
        session = self._sessions.get(server_name)
        if not session:
            raise RuntimeError(f"Serveur MCP '{server_name}' non connecté")
        result = await session.call_tool(tool_name, arguments)
        parts = []
        for content in result.content:
            if hasattr(content, "text"):
                parts.append(content.text)
            else:
                parts.append(str(content))
        return "\n".join(parts) if parts else "(aucun résultat)"

    async def disconnect_all(self) -> None:
        await self._exit_stack.aclose()
        self._sessions.clear()
