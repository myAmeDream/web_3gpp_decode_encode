from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .models import ApiError, ApiResponse, DecodeRequest, EncodeRequest, NasSecurityRequest, SchemaNodeRequest, SchemaTemplateRequest, ValidateRequest
from .services.protocol_runner import (
    ALL_MESSAGE_TYPES,
    NAS_MESSAGE_TYPE,
    ProtocolRunnerError,
    build_decode_response,
    build_encode_response,
    build_schema_node_response,
    build_schema_template_response,
    build_validation_response,
    extract_raw_value,
    make_request_id,
    normalize_hex,
    run_protocol_command,
)


ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIST_DIR = ROOT_DIR / "frontend" / "dist"


app = FastAPI(title="3GPP Encoder Web", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def success_response(request_id: str, data: dict, warnings: list[dict] | None = None) -> ApiResponse:
    return ApiResponse(requestId=request_id, success=True, data=data, warnings=warnings or [])


def error_response(request_id: str, code: str, message: str, details: list[dict] | None = None) -> ApiResponse:
    return ApiResponse(
        requestId=request_id,
        success=False,
        error=ApiError(code=code, message=message, details=details or []),
    )


@app.get("/api/v1/health")
def health() -> ApiResponse:
    request_id = make_request_id()
    return success_response(request_id, {"status": "ok"})


@app.get("/api/v1/message-types")
def message_types() -> ApiResponse:
    request_id = make_request_id()
    return success_response(request_id, {"messageTypes": ALL_MESSAGE_TYPES})


@app.post("/api/v1/protocol/decode")
def decode_protocol(payload: DecodeRequest) -> ApiResponse:
    request_id = make_request_id()
    try:
        result = run_protocol_command(
            {
                "command": "decode",
                "msgType": payload.messageType,
                "hexData": normalize_hex(payload.hexData) if payload.options.normalizeHex else payload.hexData,
            }
        )
    except ProtocolRunnerError as exc:
        return error_response(request_id, "DECODE_FAILED", str(exc))

    if result.get("error"):
        return error_response(request_id, "DECODE_FAILED", str(result["error"]))

    return success_response(request_id, build_decode_response(payload.messageType, payload.hexData, result))


@app.post("/api/v1/protocol/validate")
def validate_protocol(payload: ValidateRequest) -> ApiResponse:
    request_id = make_request_id()
    return success_response(
        request_id,
        build_validation_response(
            payload.messageType,
            payload.canonicalModel,
            [item.model_dump() for item in payload.changeSet],
        ),
    )


@app.post("/api/v1/protocol/encode")
def encode_protocol(payload: EncodeRequest) -> ApiResponse:
    request_id = make_request_id()
    validation = None
    if payload.options.validateBeforeEncode:
        validation = {
            "performed": True,
            **build_validation_response(payload.messageType, payload.canonicalModel),
        }
        if not validation["valid"]:
            first_error = validation["errors"][0]
            return error_response(
                request_id,
                "VALIDATION_ERROR",
                str(first_error.get("message", "Validation failed")),
                validation["errors"],
            )

    try:
        result = run_protocol_command(
            {
                "command": "encode",
                "msgType": payload.messageType,
                "rawVal": extract_raw_value(payload.canonicalModel),
            }
        )
    except ProtocolRunnerError as exc:
        return error_response(request_id, "ENCODE_FAILED", str(exc))

    if result.get("error"):
        return error_response(request_id, "ENCODE_FAILED", str(result["error"]))

    return success_response(request_id, build_encode_response(payload.messageType, result, validation))


@app.post("/api/v1/protocol/schema/node")
def schema_node(payload: SchemaNodeRequest) -> ApiResponse:
    request_id = make_request_id()
    return success_response(request_id, build_schema_node_response(payload.messageType, payload.nodePath))


@app.post("/api/v1/protocol/schema/template")
def schema_template(payload: SchemaTemplateRequest) -> ApiResponse:
    request_id = make_request_id()
    return success_response(
        request_id,
        build_schema_template_response(payload.messageType, payload.parentPath, payload.ieName),
    )


@app.post("/api/v1/nas/encrypt")
def nas_encrypt(payload: NasSecurityRequest) -> ApiResponse:
    request_id = make_request_id()
    try:
        result = run_protocol_command({"command": "nas_encrypt", **payload.model_dump()})
    except ProtocolRunnerError as exc:
        return error_response(request_id, "NAS_SECURITY_ERROR", str(exc))

    if result.get("error"):
        return error_response(request_id, "NAS_SECURITY_ERROR", str(result["error"]))

    return success_response(request_id, result)


@app.post("/api/v1/nas/decrypt")
def nas_decrypt(payload: NasSecurityRequest) -> ApiResponse:
    request_id = make_request_id()
    try:
        result = run_protocol_command({"command": "nas_decrypt", **payload.model_dump()})
    except ProtocolRunnerError as exc:
        return error_response(request_id, "NAS_SECURITY_ERROR", str(exc))

    if result.get("error"):
        return error_response(request_id, "NAS_SECURITY_ERROR", str(result["error"]))

    if "decodedText" in result and "textView" not in result:
        result["textView"] = result["decodedText"]
    if "rawVal" in result and "canonicalModel" not in result:
        result["canonicalModel"] = {
            "modelType": "legacy-raw",
            "schemaRef": NAS_MESSAGE_TYPE,
            "rawVal": result["rawVal"],
            "metadata": {"messageType": NAS_MESSAGE_TYPE, "source": "decoded"},
        }

    return success_response(request_id, result)


if FRONTEND_DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST_DIR / "assets"), name="assets")


@app.get("/{full_path:path}", response_model=None)
def serve_frontend(full_path: str):
    if FRONTEND_DIST_DIR.exists():
        index_file = FRONTEND_DIST_DIR / "index.html"
        if index_file.exists():
            return FileResponse(index_file)

    request_id = make_request_id()
    return success_response(
        request_id,
        {
            "message": "Frontend build not found. Run the frontend dev server or build the frontend bundle first.",
            "frontendDist": str(FRONTEND_DIST_DIR),
        },
    )
