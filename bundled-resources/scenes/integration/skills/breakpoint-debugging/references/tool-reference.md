# BreakHub MCP tool reference

Wireless ATE Agent addresses each proxied tool as `<server-name>_<tool-name>`. The examples assume the bundled server name is `microbreakpoint`; pass that full name to the `mcp` proxy when making a call.

## Equipment and control

| Tool suffix | Arguments | Use |
| --- | --- | --- |
| `list_equipment` | none | List authorized equipment and safe live status. |
| `connect_equipment` | `equipment_id` | Bind the current trusted MCP identity to one equipment. Reconnecting the same ID is idempotent. |
| `start_debugging` | none | Acquire or renew MCP control and start the implicit current debugging session. |
| `disconnect_equipment` | none | Remove the binding and release debugging only when the caller owns control. |

## BreakHub connections

| Tool suffix | Arguments | Use |
| --- | --- | --- |
| `list_connections` | none | List safe connection IDs, live equipment identity, and availability without returning URLs or tokens. |
| `upsert_connection` | `url`, `access_token` | Validate a BreakHub host, IP, or HTTP(S) URL and atomically add or update its connection; use port `18621` when omitted. |
| `remove_connection` | `connection_id` | Idempotently remove one exact connection after explicit user confirmation. |

Use these tools inside the conversation; do not send the user to `breakpoint-debugging-manager.exe` for runtime configuration. When the user omits a port, proceed with `18621` instead of asking for one. `upsert_connection` first reads `/api/v1/equipment`, so an invalid URL or token is not persisted. Its result never repeats the URL or token. After a successful write, call `list_equipment` to use the freshly resolved equipment ID.

`EQUIPMENT_ALREADY_CONNECTED` means the current MCP identity is bound to another equipment. Disconnect deliberately before switching. `EQUIPMENT_UNREACHABLE` does not create a new binding. `CONTROLLED_BY_WEB` and `CONTROLLED_BY_MCP` block writes; do not retry in a loop.

## Interfaces and breakpoints

| Tool suffix | Arguments | Use |
| --- | --- | --- |
| `find_interfaces` | `query=""`, `cursor=""` | Search object, command, and field paths; returns at most 50 results. |
| `get_interface` | `object`, `command` | Read the exact schema, statistics, and sample reference. |
| `find_breakpoints` | `query=""`, `cursor=""`, `enabled=null` | Search by exact ID or keyword and optionally filter enabled state. |
| `get_breakpoint` | `breakpoint_id` | Read one exact rule and hit summary. |
| `create_breakpoint` | `object`, `command`, `pause_point`, `name=""`, `conditions=null` | Idempotently create one complete rule. |
| `enable_breakpoint` | `breakpoint_id` | Idempotently enable one rule. |
| `disable_breakpoint` | `breakpoint_id` | Idempotently disable one rule. |
| `delete_breakpoint` | `breakpoint_id` | Idempotently delete one exact rule. |
| `delete_breakpoints` | none | Delete every breakpoint in the current session; bulk destructive operation. |

Set `pause_point` to `before` to inspect or change input parameters, or `after` to inspect or change the result.

An unconditional interface breakpoint uses `conditions: []` or `null`. Conditional rules use an AND-combined array. Each condition contains exactly `source`, `field_path`, `operator`, and `value`:

```json
[
  {"source":"params","field_path":"mode","operator":"eq","value":"AUTO"},
  {"source":"result","field_path":"tags","operator":"contains_any","value":["smoke","urgent"]}
]
```

`source` is required on every condition: use `params` for the original input, or `result` for the original successful output of an `after` breakpoint. One after rule may mix both sources; all conditions are AND-combined against the original values captured before any injection. `eq` accepts one JSON scalar (`number`, `string`, `boolean`, or `null`) with strict JSON types and precision-preserving numeric equality. `contains_any` requires a non-empty array of those scalar values and matches only an array field. A missing field does not equal `null`. Field paths are dot-separated object paths; root values, array indexes, JSON Pointer slashes, wildcards, `$`, `@`, and backslashes are invalid.

Choose one exact Interaction as the 参考调用 when checking condition evidence. Read params and result from that same call; never join input from one call to output from another. 运行中的参考调用没有 result 证据. When its selected source does not contain the field path, describe the rule as a 未验证条件. This warning is non-blocking（不阻止创建）: `create_breakpoint` may still create the rule, and the Agent must disclose which path was not verified from the inspected sample.

`create_breakpoint` returns `discarded_conditions` beside `breakpoint`; it is write metadata and never part of the persisted definition. A before write removes every `source: "result"` condition. Report every removal to the user, and when the returned breakpoint has no remaining conditions, warn that it is unconditional and pauses every target call.

Before `delete_breakpoints`, call unfiltered `find_breakpoints(query="", cursor="", enabled=null)` immediately beforehand. Read `confirmation_preview.breakpoint_count`, explain that every rule will stop producing new pauses, obtain explicit confirmation, then make `delete_breakpoints` the only tool call.

## Interactions and injection

| Tool suffix | Arguments | Use |
| --- | --- | --- |
| `find_interactions` | `query=""`, `cursor=""`, `status=null` | Search exact ID or object/command; status is `in_progress`, `paused`, or `completed`. |
| `get_interaction` | `interaction_id` | Read the bounded complete evidence record, current pause, content, and timeline. |
| `inject_interaction` | `interaction_id`, `pause_point`, `changes` | Stage nested JSON changes on one exact active pause without continuing it. |
| `continue_interaction` | `interaction_id`, `pause_point` | Idempotently continue one exact pause. |
| `continue_interactions` | none | Atomically continue all current pauses and commit their pending injections; bulk destructive operation. |

Use `changes` as a narrow nested patch that mirrors the payload shape. For example, at a `before` pause:

```json
{
  "interaction_id": "<returned-id>",
  "pause_point": "before",
  "changes": {
    "mode": "MANUAL",
    "request": {"count": 2}
  }
}
```

For an `after` pause, the same `changes` field patches the result content. Keep existing field types and re-read the record after injection. A successful injection remains pending until that exact pause is continued.

Each `breakpoint_snapshots[].condition_evidence[]` returned by `get_interaction` explains one matched condition with `source`, `field_path`, `operator`, `expected_value`, and `actual_value`. For `contains_any`, `actual_value` contains only the stable, deduplicated intersection rather than the full source array. These entries are immutable hit-time audit evidence, not the current Breakpoint definition or a full params/result copy. Oversized condition or evidence values use the same preview plus `*_metadata.truncated` boundary as other Agent payloads; retain the source, path, and operator when explaining the pause.

Before `continue_interactions`, call `find_interactions(query="", cursor="", status="paused")` immediately beforehand. Read `confirmation_preview.pause_count` and `pending_injection_count`, explain that all listed business calls will resume and all pending injections will be committed, obtain explicit confirmation, then make `continue_interactions` the only tool call.

## Paging and verification

- `find_*` calls return no more than 50 records per page.
- Pass the returned cursor unchanged to the next call with the same query and filters.
- After creating or changing a breakpoint, verify with `get_breakpoint`.
- After injection or continuation, verify with `get_interaction`.
- Report capture only when `find_interactions` or `get_interaction` returns the corresponding record.
