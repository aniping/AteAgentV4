---
name: breakpoint-debugging
description: Use the BreakHub local stdio MCP to discover equipment interfaces, capture call records, manage before/after breakpoints, inspect paused interactions, inject parameter or result changes, and continue calls safely. Use for 断点调试、调用记录捕捉、参数注入、返回值修改、设备连接、接口发现和暂停调用排查。
---

# Breakpoint Debugging

Use the BreakHub MCP tools as the source of truth for breakpoint state. Do not call the product HTTP API or edit its state files when the MCP tools are available.

Wireless ATE Agent exposes this bundled server through its `mcp` proxy. Connect lazily with `mcp({ connect: "microbreakpoint" })`, then call a tool with `mcp({ tool: "microbreakpoint_<suffix>", args: {...} })`, for example `microbreakpoint_list_equipment`. Throughout this skill, the unprefixed suffix is the authoritative tool name. Do not assume the server tools are registered directly.

## Run the workflow

1. Call `list_equipment` and select a returned `equipment_id`. Never guess an ID.
2. Call `connect_equipment` with that ID. A conversation can bind to only one equipment; disconnect before switching.
3. Call `start_debugging`. Treat `ok: true` as success even when the result says the requested state already exists.
4. Discover the exact interface with `find_interfaces`, then confirm its schema with `get_interface`. When validating condition fields, explicitly select one Interaction as the 参考调用 and inspect it with `get_interaction`; read both params and result evidence from 同一条参考调用 instead of combining different calls. A running reference has no result evidence.
5. Create an idempotent breakpoint with the exact `object`, `command`, and `pause_point` (`before` or `after`). Use `conditions: []` for an unconditional interface breakpoint. Every condition must explicitly use `source: "params"` or `source: "result"`; `result` is available only at `after`. Prefer paths supported by the same inspected 参考调用. If no inspected sample contains a manually supplied path, label it 未验证条件, explain that fact to the user, and continue: missing evidence does not block creation（不阻止创建）. Inspect `discarded_conditions` in every create result and disclose any non-empty list; if a before write discarded every condition, warn that the persisted breakpoint is unconditional and will pause every target call.
6. Ask the user to trigger the business call when the call must happen outside the Agent. Verify capture with `find_interactions`; do not infer capture from the business HTTP status.
7. For a paused record, call `get_interaction` immediately before any write. Use its current `interaction_id`, `current_pause.pause_point`, original/effective content, and injection state. Explain the pause from each snapshot's `condition_evidence`: source, field path, operator, expected value, and actual matched value. Treat it as immutable hit-time audit evidence, not as the current Breakpoint or a copy of the full payload.
8. At `before`, inject nested parameter changes. At `after`, inject nested result changes. Call `inject_interaction`, then read the interaction again and report the effective content while it remains paused.
9. Continue only the reviewed pause with `continue_interaction(interaction_id, pause_point)`. Re-read the record if the stage may have changed.
10. Call `disconnect_equipment` when the task is complete. It releases debugging only when this MCP identity owns control.

Read [references/tool-reference.md](references/tool-reference.md) when exact arguments, condition syntax, paging, or error handling are needed. If the server is absent, report that the bundled integration is unavailable and ask the user to restart or update Wireless ATE Agent; do not ask them to install a separate archive.

## Manage BreakHub connections

Manage runtime connections entirely through MCP; never direct the user to an external configuration command and never edit `breakhub_targets.json` freehand.

- Call `list_connections` to inspect configured connections and their live status. It intentionally returns neither URLs nor access tokens.
- When the user supplies a host, IP, or HTTP(S) URL and an access token, call `upsert_connection`. If the input has no explicit port, use the BreakHub default `18621`; do not ask for a port unless the user needs a different one. Never repeat the token in your response or any follow-up tool arguments. The tool validates `/api/v1/equipment` before saving and returns the authoritative equipment identity.
- After a successful upsert, call `list_equipment` and continue with `connect_equipment` when requested.
- Before `remove_connection`, state the returned `connection_id` and impact, then obtain explicit confirmation. Make the removal its own tool call.
- If an unreachable connection needs repair, ask the user for that connection's URL and current access token, then call `upsert_connection`; do not ask them to run the manager EXE.

## Apply safety rules

- Treat every tool result as structured state. If `ok` is false, report its stable error code and correct the cause before retrying.
- If the error is `CONTROLLED_BY_WEB`, stop write attempts. The Web controller must release control; reads remain useful.
- If the error is `CONTROLLED_BY_MCP`, do not compete with the other MCP instance.
- Never expose target URLs, access tokens, control identities, or binding-store contents. A token supplied by the user may appear only in the single `upsert_connection` call that consumes it.
- Use returned stable IDs. Reuse a cursor only with the same query and filters; treat cursors as opaque.
- Preserve JSON shape and types during injection. Change only fields shown by the latest interaction detail; do not add speculative fields or replace a whole object when a narrow nested patch is enough.
- Injection does not continue a call. Always show the injected effective content before continuing unless the user explicitly requested a pre-approved end-to-end operation.
- Never call `delete_breakpoints` or `continue_interactions` as part of a multi-tool batch. These affect the whole current session. First obtain the fresh, unfiltered preview described in the tool reference, state its counts and impact, obtain explicit user confirmation, then call the bulk tool alone.
- Prefer `delete_breakpoint` and `continue_interaction` for precise changes.
