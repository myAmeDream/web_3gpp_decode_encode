from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ApiError(BaseModel):
    code: str
    message: str
    details: list[dict[str, Any]] = Field(default_factory=list)


class ApiResponse(BaseModel):
    apiVersion: str = "v1"
    requestId: str
    success: bool
    data: dict[str, Any] | None = None
    warnings: list[dict[str, Any]] = Field(default_factory=list)
    error: ApiError | None = None


class DecodeOptions(BaseModel):
    includeSchemaHints: bool = True
    includeTextView: bool = True
    normalizeHex: bool = True


class DecodeRequest(BaseModel):
    messageType: str
    hexData: str
    options: DecodeOptions = Field(default_factory=DecodeOptions)


class EncodeOptions(BaseModel):
    returnCArray: bool = True
    validateBeforeEncode: bool = False


class EncodeRequest(BaseModel):
    messageType: str
    canonicalModel: dict[str, Any]
    options: EncodeOptions = Field(default_factory=EncodeOptions)


class ChangeSetItem(BaseModel):
    op: Literal["add", "remove", "replace"]
    path: list[str] = Field(default_factory=list)
    oldValue: Any | None = None
    newValue: Any | None = None
    value: Any | None = None


class ValidateRequest(BaseModel):
    messageType: str
    canonicalModel: dict[str, Any]
    changeSet: list[ChangeSetItem] = Field(default_factory=list)


class SchemaNodeRequest(BaseModel):
    messageType: str
    nodePath: list[str] = Field(default_factory=list)


class SchemaTemplateRequest(BaseModel):
    messageType: str
    parentPath: list[str] = Field(default_factory=list)
    ieName: str


class NasSecurityRequest(BaseModel):
    hexData: str
    knasenc: str = ""
    knasint: str = ""
    count: int | str = 0
    bearer: int = 1
    direction: int = 1
    neaAlgorithm: str = "NEA2"
    niaAlgorithm: str = "NIA2"
    keyByteOrder: str = "big"
    newSecurityContext: bool = False
