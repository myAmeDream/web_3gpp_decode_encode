from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[3]
REFERENCE_TOOLS_DIR = ROOT_DIR / "reference" / "tools"
DECODE_SCRIPT = REFERENCE_TOOLS_DIR / "decode.py"

RRC_MESSAGE_TYPES = [
    "BCCH-BCH-Message",
    "BCCH-DL-SCH-Message",
    "DL-CCCH-Message",
    "DL-DCCH-Message",
    "PCCH-Message",
    "UL-CCCH-Message",
    "UL-CCCH1-Message",
    "UL-DCCH-Message",
    "MCCH-Message-r17",
]
NAS_MESSAGE_TYPE = "NAS-5G-Message"
ALL_MESSAGE_TYPES = [*RRC_MESSAGE_TYPES, NAS_MESSAGE_TYPE]


class ProtocolRunnerError(RuntimeError):
    pass


def normalize_hex(hex_data: str) -> str:
    return hex_data.replace(" ", "").replace("0x", "").replace("0X", "").upper()


def make_request_id() -> str:
    return f"req_{uuid.uuid4().hex[:12]}"


def resolve_python_command() -> list[str]:
    env_python = os.getenv("PYTHON")
    if env_python:
        return [env_python]
    return [sys.executable or "python3"]


def run_protocol_command(payload: dict[str, Any]) -> dict[str, Any]:
    if not DECODE_SCRIPT.exists():
        raise ProtocolRunnerError(f"Missing decoder script: {DECODE_SCRIPT}")

    command = [*resolve_python_command(), str(DECODE_SCRIPT)]
    env = os.environ.copy()
    existing_path = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(REFERENCE_TOOLS_DIR) if not existing_path else f"{REFERENCE_TOOLS_DIR}:{existing_path}"

    completed = subprocess.run(
        command,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        cwd=str(REFERENCE_TOOLS_DIR),
        env=env,
        check=False,
    )

    if completed.returncode != 0:
        stderr = completed.stderr.strip() or "Unknown Python subprocess error"
        raise ProtocolRunnerError(stderr)

    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise ProtocolRunnerError(f"Invalid JSON returned by decode.py: {exc}") from exc


def build_decode_response(message_type: str, hex_data: str, result: dict[str, Any]) -> dict[str, Any]:
    normalized_hex = normalize_hex(hex_data)
    decode_session_id = f"dec_{uuid.uuid4().hex[:12]}"
    raw_val = result.get("rawVal")
    tree = result.get("tree") or {"name": message_type, "value": "", "children": []}

    return {
        "messageType": message_type,
        "normalizedHex": normalized_hex,
        "decodeSessionId": decode_session_id,
        "displayTree": tree,
        "canonicalModel": {
            "modelType": "legacy-raw",
            "schemaRef": message_type,
            "rawVal": raw_val,
            "metadata": {
                "messageType": message_type,
                "source": "decoded",
                "decodeSessionId": decode_session_id,
            },
        },
        "rawVal": raw_val,
        "textView": result.get("asn1Text", ""),
        "schemaHints": {
            "editableNodeCount": 0,
            "addableNodeCount": 0,
            "deletableNodeCount": 0,
            "phase": "legacy",
        },
    }


def extract_raw_value(canonical_model: dict[str, Any]) -> Any:
    if "rawVal" in canonical_model:
        return canonical_model["rawVal"]
    return canonical_model


def _build_validation_issue(message: str, path: list[str] | None = None) -> dict[str, Any]:
    issue: dict[str, Any] = {"code": "VALIDATION_ERROR", "message": message}
    if path:
        issue["path"] = path
    return issue


def build_encode_response(message_type: str, result: dict[str, Any], validation: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "messageType": message_type,
        "hex": result.get("hex", ""),
        "cArray": result.get("cArray", ""),
        "length": result.get("length", 0),
        "validation": validation or {"performed": False, "valid": True, "errors": []},
    }


def build_schema_node_response(message_type: str, node_path: list[str]) -> dict[str, Any]:
    return {
        "schemaRef": message_type,
        "nodePath": node_path,
        "nodeType": "unknown",
        "mandatory": False,
        "deletable": False,
        "repeatable": False,
        "addableChildren": [],
        "editableFields": [],
        "note": "Schema-driven add/delete is not implemented in the initial monolith build yet.",
    }


def build_schema_template_response(message_type: str, parent_path: list[str], ie_name: str) -> dict[str, Any]:
    return {
        "messageType": message_type,
        "parentPath": parent_path,
        "ieName": ie_name,
        "template": None,
        "note": "Template generation is not implemented in the initial monolith build yet.",
    }


def build_validation_response(
    message_type: str,
    canonical_model: dict[str, Any],
    change_set: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    change_path: list[str] | None = None
    if change_set:
        raw_path = change_set[-1].get("path")
        if isinstance(raw_path, list):
            change_path = [str(item) for item in raw_path]

    try:
        result = run_protocol_command(
            {
                "command": "encode",
                "msgType": message_type,
                "rawVal": extract_raw_value(canonical_model),
            }
        )
    except ProtocolRunnerError as exc:
        return {
            "valid": False,
            "errors": [_build_validation_issue(str(exc), change_path)],
            "warnings": [],
        }

    if result.get("error"):
        return {
            "valid": False,
            "errors": [_build_validation_issue(str(result["error"]), change_path)],
            "warnings": [],
        }

    return {
        "valid": True,
        "errors": [],
        "warnings": [],
    }
