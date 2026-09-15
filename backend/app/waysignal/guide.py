"""MCP host for source summaries. No model key is needed for this first native slice."""
from typing import Literal

from fastapi import HTTPException
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import settings
from app.waysignal.domain import AssessmentInput, Coordinate


class GuideInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["reports", "route", "status"]
    route: AssessmentInput | None = None
    route_geometry: list[Coordinate] | None = Field(default=None, max_length=10000)
    request_id: str | None = Field(default=None, max_length=40)


async def source_summary(payload: GuideInput, authorization: str) -> dict:
    if payload.action == "route":
        if payload.route is None:
            raise HTTPException(422, "Choose a destination first.")
        name, arguments = "assess_route", payload.route.model_dump(mode="json")
    elif payload.action == "status":
        if not payload.request_id:
            raise HTTPException(422, "Select an assistance request first.")
        name, arguments = "get_assistance_status", {"request_id": payload.request_id}
    else:
        name, arguments = "list_route_reports", {"route_geometry": [c.model_dump() for c in payload.route_geometry] if payload.route_geometry else None}
    try:
        async with streamablehttp_client(settings.mcp_internal_url,
            headers={"Authorization": authorization}, timeout=15) as (read, write, _):
            async with ClientSession(read, write) as client:
                await client.initialize()
                available = await client.list_tools()
                if name not in {t.name for t in available.tools}:
                    raise ValueError("Required tool is unavailable")
                result = await client.call_tool(name, arguments)
                if result.isError or result.structuredContent is None:
                    raise ValueError("Tool could not return authorized source data")
                data = result.structuredContent
    except Exception:
        raise HTTPException(503, "Guide could not retrieve source information. Direct map and help controls remain available.") from None
    if payload.action == "status":
        text = f"Request {data['id']} is {data['status'].replace('_', ' ')}."
        if data.get("responder_name"):
            text += f" Recorded responder: {data['responder_name']}."
        sources = [{"id": data["id"], "kind": "assistance", "status": data["status"]}]
    elif payload.action == "route":
        excluded = sum(1 for c in data["candidates"] if c["excluded"])
        text = f"{excluded} of {len(data['candidates'])} route candidates are excluded by reviewed reports. "
        text += "No remaining candidate is available." if data["selected_id"] is None else "A remaining candidate avoids those reported locations; conditions elsewhere remain unknown."
        by_id = {f["report_id"]: f for c in data["candidates"] for f in c["findings"]}
        sources = [{"id": f["report_id"], "kind": "report", "status": f["review_state"]} for f in by_id.values()]
    else:
        reports = data["reports"]
        active = [r for r in reports if r["review_state"] == "reviewed_active"]
        text = f"There are {len(reports)} reports in this view, including {len(active)} reviewed active reports. Missing reports do not establish safe conditions."
        sources = [{"id": r["id"], "kind": "report", "status": r["review_state"]} for r in reports[:10]]
    if settings.waysignal_demo_mode:
        text = "Demo scenario — " + text
    return {"mode": "source_summary", "text": text, "sources": sources,
            "tool_used": name, "notice": "A summary of source records, not a generative AI answer."}
