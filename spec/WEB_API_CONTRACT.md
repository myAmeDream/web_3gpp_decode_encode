# 3GPP Web API Contract

## 1. Scope

This document defines the first implementation version of the web API contract for the 3GPP decoder/encoder system.

Current delivery assumption:

1. The first release is for internal enterprise pilot use only.
2. Initial users are a small group of internal employees.
3. External public deployment is not part of phase 1.
4. Architecture should prioritize implementation speed, maintainability, and controlled internal deployment over internet-scale concerns.

Goals:

1. Preserve the current VS Code extension capabilities.
2. Add structure-level editing for protocol IE operations.
3. Support re-encoding after:
   - updating an existing IE value
   - adding a previously absent IE
   - deleting an existing IE

This contract is intended for a browser frontend and a Python backend built around the existing pycrate-based decoding and encoding logic.

## 1.1 Pilot Deployment Implications

Because the first stage is an internal pilot rather than a public internet product, the implementation should follow these principles:

1. Prefer a single deployable application over early microservice splitting.
2. Prefer internal SSO, reverse proxy auth, or network-layer access control over building a custom account system in phase 1.
3. Prefer simple audit logging and operational observability over full multi-tenant governance.
4. Prefer containerized private deployment on the company intranet, VPN, or bastion-protected environment.
5. Defer public-facing concerns such as self-service registration, internet DDoS hardening, and fine-grained tenant isolation unless external rollout is approved.

Recommended phase 1 deployment shape:

1. Frontend static assets served by the same FastAPI service or an internal reverse proxy.
2. Python backend deployed as a single application process group.
3. Optional Redis is not required in phase 1.
4. Optional database is not required in phase 1 unless usage history must be persisted.

## 2. Architecture Boundary

Frontend responsibilities:

1. Render decoded protocol tree.
2. Maintain user editing state.
3. Request schema metadata for add/delete/edit operations.
4. Submit canonical model to backend for validation and encoding.
5. Render encode results, warnings, and validation errors.

Backend responsibilities:

1. Decode hex payload into:
   - display tree
   - canonical model
   - schema hints
2. Validate edited canonical model.
3. Encode canonical model back into hex.
4. Provide schema metadata used by the UI for legal add/delete operations.
5. Provide NAS security encrypt/decrypt APIs.

## 3. API Versioning

Base path:

```text
/api/v1
```

Versioning rules:

1. Backward-compatible field additions are allowed within `v1`.
2. Breaking payload changes require `v2`.
3. Every response should include `apiVersion`.

## 4. Message Types

The backend should support at least the following message types:

```text
BCCH-BCH-Message
BCCH-DL-SCH-Message
DL-CCCH-Message
DL-DCCH-Message
PCCH-Message
UL-CCCH-Message
UL-CCCH1-Message
UL-DCCH-Message
MCCH-Message-r17
NAS-5G-Message
```

## 5. Core Data Models

The API uses three distinct structures.

### 5.1 Display Tree

Used only for rendering.

```json
{
  "id": "node_001",
  "name": "rrcReconfiguration",
  "displayValue": "",
  "path": ["message", "criticalExtensions", "c1", "rrcReconfiguration"],
  "nodeKind": "container",
  "valueType": "sequence",
  "editable": false,
  "deletable": false,
  "addable": true,
  "defaultCollapsed": false,
  "children": []
}
```

Field meanings:

1. `id`: frontend-only stable node identifier for rendering and selection.
2. `name`: ASN.1 or NAS element name.
3. `displayValue`: formatted value for display.
4. `path`: canonical path to locate the node in the canonical model.
5. `nodeKind`: one of `container`, `leaf`, `choice`, `list-item`, `derived`.
6. `valueType`: one of `sequence`, `choice`, `list`, `int`, `str`, `bytes`, `bool`, `null`, `enum`, `nas-field`.
7. `editable`: whether the value itself is directly editable.
8. `deletable`: whether the node can be removed.
9. `addable`: whether children can be appended under this node.
10. `defaultCollapsed`: UI hint only.

### 5.2 Canonical Model

Used for validation and encode. This is the protocol-editable source of truth.

```json
{
  "modelType": "dict",
  "schemaRef": "DL-DCCH-Message",
  "items": {
    "message": {
      "modelType": "choice",
      "choiceName": "c1",
      "value": {
        "modelType": "choice",
        "choiceName": "rrcReconfiguration",
        "value": {
          "modelType": "dict",
          "items": {
            "rrc-TransactionIdentifier": {
              "modelType": "int",
              "value": 1
            }
          }
        }
      }
    }
  },
  "metadata": {
    "messageType": "DL-DCCH-Message",
    "source": "decoded",
    "decodeSessionId": "dec_20260425_001"
  }
}
```

Rules:

1. Frontend may update this model locally after add/delete/edit operations.
2. Backend must treat this model as the input for `/validate` and `/encode`.
3. `metadata` may include backend-only hints, but encode must not depend on UI tree state.

### 5.3 Schema Metadata

Used to drive legal operations in the UI.

```json
{
  "schemaRef": "DL-DCCH-Message",
  "nodePath": ["message", "c1", "rrcReconfiguration"],
  "nodeType": "sequence",
  "mandatory": true,
  "deletable": false,
  "addableChildren": [
    {
      "name": "measConfig",
      "valueType": "sequence",
      "mandatory": false,
      "repeatable": false,
      "defaultTemplateRef": "tpl_measConfig"
    }
  ],
  "editableFields": [
    {
      "name": "rrc-TransactionIdentifier",
      "valueType": "int",
      "constraints": {
        "min": 0,
        "max": 3
      }
    }
  ]
}
```

## 6. Standard Response Envelope

All successful responses should follow this envelope:

```json
{
  "apiVersion": "v1",
  "requestId": "req_123456",
  "success": true,
  "data": {},
  "warnings": []
}
```

All failed responses should follow this envelope:

```json
{
  "apiVersion": "v1",
  "requestId": "req_123456",
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Mandatory IE is missing",
    "details": []
  }
}
```

## 7. Error Codes

Recommended error codes:

```text
INVALID_REQUEST
UNSUPPORTED_MESSAGE_TYPE
INVALID_HEX
DECODE_FAILED
SCHEMA_NOT_FOUND
NODE_NOT_FOUND
ILLEGAL_ADD_OPERATION
ILLEGAL_DELETE_OPERATION
INVALID_MODEL
VALIDATION_ERROR
ENCODE_FAILED
NAS_SECURITY_ERROR
INTERNAL_ERROR
```

## 8. Endpoints

### 8.1 List Supported Message Types

Method:

```text
GET /api/v1/message-types
```

Response `data`:

```json
{
  "messageTypes": [
    "DL-DCCH-Message",
    "UL-DCCH-Message",
    "NAS-5G-Message"
  ]
}
```

### 8.2 Decode Message

Method:

```text
POST /api/v1/protocol/decode
```

Request body:

```json
{
  "messageType": "DL-DCCH-Message",
  "hexData": "08002B",
  "options": {
    "includeSchemaHints": true,
    "includeTextView": true,
    "normalizeHex": true
  }
}
```

Response `data`:

```json
{
  "messageType": "DL-DCCH-Message",
  "normalizedHex": "08002B",
  "decodeSessionId": "dec_20260425_001",
  "displayTree": {
    "id": "node_root",
    "name": "DL-DCCH-Message",
    "displayValue": "",
    "path": [],
    "nodeKind": "container",
    "valueType": "sequence",
    "editable": false,
    "deletable": false,
    "addable": false,
    "defaultCollapsed": false,
    "children": []
  },
  "canonicalModel": {
    "modelType": "dict",
    "schemaRef": "DL-DCCH-Message",
    "items": {},
    "metadata": {
      "messageType": "DL-DCCH-Message",
      "source": "decoded",
      "decodeSessionId": "dec_20260425_001"
    }
  },
  "textView": "ASN.1 text or NAS show() output",
  "schemaHints": {
    "editableNodeCount": 10,
    "addableNodeCount": 3,
    "deletableNodeCount": 2
  }
}
```

Purpose:

1. Decode raw hex.
2. Produce initial UI tree.
3. Produce canonical model for editing.
4. Return hints so the frontend can render action affordances immediately.

### 8.3 Get Node Schema Metadata

Method:

```text
POST /api/v1/protocol/schema/node
```

Request body:

```json
{
  "messageType": "DL-DCCH-Message",
  "nodePath": ["message", "c1", "rrcReconfiguration"]
}
```

Response `data`:

```json
{
  "schemaRef": "DL-DCCH-Message",
  "nodePath": ["message", "c1", "rrcReconfiguration"],
  "nodeType": "sequence",
  "mandatory": true,
  "deletable": false,
  "repeatable": false,
  "addableChildren": [
    {
      "name": "measConfig",
      "label": "measConfig",
      "valueType": "sequence",
      "mandatory": false,
      "repeatable": false,
      "templateMode": "backend-template"
    },
    {
      "name": "lateNonCriticalExtension",
      "label": "lateNonCriticalExtension",
      "valueType": "bytes",
      "mandatory": false,
      "repeatable": false,
      "templateMode": "frontend-scalar"
    }
  ],
  "editableFields": [
    {
      "name": "rrc-TransactionIdentifier",
      "path": ["message", "c1", "rrcReconfiguration", "rrc-TransactionIdentifier"],
      "valueType": "int",
      "nullable": false,
      "constraints": {
        "min": 0,
        "max": 3
      }
    }
  ]
}
```

Purpose:

1. Drive right-side property panel.
2. Drive add/delete action availability.
3. Avoid frontend hardcoding ASN.1 structure rules.

### 8.4 Get Addable IE Template

Method:

```text
POST /api/v1/protocol/schema/template
```

Request body:

```json
{
  "messageType": "DL-DCCH-Message",
  "parentPath": ["message", "c1", "rrcReconfiguration"],
  "ieName": "measConfig"
}
```

Response `data`:

```json
{
  "parentPath": ["message", "c1", "rrcReconfiguration"],
  "ieName": "measConfig",
  "template": {
    "modelType": "dict",
    "items": {}
  },
  "displayNode": {
    "id": "tmp_measConfig",
    "name": "measConfig",
    "displayValue": "",
    "path": ["message", "c1", "rrcReconfiguration", "measConfig"],
    "nodeKind": "container",
    "valueType": "sequence",
    "editable": false,
    "deletable": true,
    "addable": true,
    "defaultCollapsed": false,
    "children": []
  }
}
```

Purpose:

1. Let backend generate a legal default structure.
2. Avoid frontend guessing complex default values.

### 8.5 Validate Canonical Model

Method:

```text
POST /api/v1/protocol/validate
```

Request body:

```json
{
  "messageType": "DL-DCCH-Message",
  "canonicalModel": {
    "modelType": "dict",
    "schemaRef": "DL-DCCH-Message",
    "items": {},
    "metadata": {
      "messageType": "DL-DCCH-Message",
      "source": "edited"
    }
  },
  "changeSet": [
    {
      "op": "add",
      "path": ["message", "c1", "rrcReconfiguration", "measConfig"]
    },
    {
      "op": "remove",
      "path": ["message", "c1", "rrcReconfiguration", "lateNonCriticalExtension"]
    }
  ]
}
```

Response `data`:

```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    {
      "code": "OPTIONAL_IE_MISSING",
      "message": "lateNonCriticalExtension is absent"
    }
  ]
}
```

Validation categories:

1. Structural validity.
2. Mandatory IE completeness.
3. Type validity.
4. Choice consistency.
5. Sequence/list cardinality.
6. NAS-specific semantic constraints where applicable.

Phase 2 implementation note:

1. The backend validates edited existing IE values by attempting a pycrate-backed encode of the submitted raw value model.
2. This makes `/api/v1/protocol/validate` a practical authority check for edited existing fields.
3. Full schema-driven strong validation with field-level constraints remains a later phase.

### 8.6 Encode Canonical Model

Method:

```text
POST /api/v1/protocol/encode
```

Request body:

```json
{
  "messageType": "DL-DCCH-Message",
  "canonicalModel": {
    "modelType": "dict",
    "schemaRef": "DL-DCCH-Message",
    "items": {},
    "metadata": {
      "messageType": "DL-DCCH-Message",
      "source": "edited"
    }
  },
  "options": {
    "returnCArray": true,
    "validateBeforeEncode": true
  }
}
```

Response `data`:

```json
{
  "messageType": "DL-DCCH-Message",
  "hex": "08002B",
  "cArray": "{0x08, 0x00, 0x2B}",
  "length": 3,
  "validation": {
    "performed": true,
    "valid": true,
    "errors": []
  }
}
```

Rules:

1. Encode must operate on canonical model, not on display tree.
2. If `validateBeforeEncode=true`, backend must reject invalid models before encoding.
3. For NAS in phase 1, backend may reject unsupported structure-level operations explicitly.

### 8.7 NAS Encrypt

Method:

```text
POST /api/v1/nas/encrypt
```

Request body:

```json
{
  "hexData": "7E005E01",
  "knasenc": "00112233445566778899AABBCCDDEEFF",
  "knasint": "FFEEDDCCBBAA99887766554433221100",
  "count": 5,
  "bearer": 1,
  "direction": 1,
  "neaAlgorithm": "NEA2",
  "niaAlgorithm": "NIA2",
  "keyByteOrder": "big",
  "newSecurityContext": false
}
```

Response `data`:

```json
{
  "assembled": "7E02A1B2C3D40501020304",
  "ciphertext": "01020304",
  "mac": "A1B2C3D4",
  "sqn": "5 (0x05)",
  "length": 11,
  "cArray": "{0x7E, 0x02, 0xA1, 0xB2, 0xC3, 0xD4, 0x05, 0x01, 0x02, 0x03, 0x04}"
}
```

### 8.8 NAS Decrypt

Method:

```text
POST /api/v1/nas/decrypt
```

Request body:

```json
{
  "hexData": "7E02A1B2C3D40501020304",
  "knasenc": "00112233445566778899AABBCCDDEEFF",
  "knasint": "FFEEDDCCBBAA99887766554433221100",
  "count": 5,
  "bearer": 1,
  "direction": 1,
  "neaAlgorithm": "NEA2",
  "niaAlgorithm": "NIA2",
  "keyByteOrder": "big"
}
```

Response `data`:

```json
{
  "plaintext": "7E005E01",
  "macReceived": "A1B2C3D4",
  "macComputed": "A1B2C3D4",
  "macOk": true,
  "secHdrType": 2,
  "sqn": "5 (0x05)",
  "decodedTree": {
    "id": "node_root",
    "name": "NAS-5G-Message",
    "displayValue": "",
    "path": [],
    "nodeKind": "container",
    "valueType": "sequence",
    "editable": false,
    "deletable": false,
    "addable": false,
    "defaultCollapsed": false,
    "children": []
  },
  "textView": "Decoded plaintext NAS output",
  "canonicalModel": {
    "modelType": "dict",
    "schemaRef": "NAS-5G-Message",
    "items": {},
    "metadata": {
      "messageType": "NAS-5G-Message",
      "source": "decoded"
    }
  }
}
```

## 9. ChangeSet Model

The frontend should keep a change log separate from the canonical model.

Recommended format:

```json
[
  {
    "op": "replace",
    "path": ["message", "c1", "rrcReconfiguration", "rrc-TransactionIdentifier"],
    "oldValue": 0,
    "newValue": 1
  },
  {
    "op": "add",
    "path": ["message", "c1", "rrcReconfiguration", "measConfig"],
    "value": {
      "modelType": "dict",
      "items": {}
    }
  },
  {
    "op": "remove",
    "path": ["message", "c1", "rrcReconfiguration", "lateNonCriticalExtension"]
  }
]
```

Purpose:

1. UI diff display.
2. Audit trail.
3. Easier backend diagnostics.
4. Future undo/redo support.

## 10. RRC and NAS Phase Boundary

Implementation recommendation:

### Phase 1

Supported:

1. Existing capability parity with VS Code extension.
2. Decode and encode round-trip.
3. NAS decode/encode parity.
4. NAS security encrypt/decrypt.

### Phase 2

Supported:

1. Existing decoded IE leaf value edit for already-present fields.
2. Frontend basic type validation for int, bool, bytes, and string values.
3. Backend authority validation through `/api/v1/protocol/validate`.
4. Encode rejection when validation fails.

Limited:

1. Add previously absent IE is not implemented.
2. Delete currently present IE is not implemented.
3. Validation is not yet schema-driven; it relies on pycrate encode acceptance.

### Phase 3

Target:

1. Add previously absent optional IE.
2. Delete existing optional IE.
3. Schema-driven strong field validation.
4. Choice switching helpers.
5. Rich schema-driven form generation.

## 11. Backend Mapping Strategy

Recommended internal layers:

1. `decode_service`
   - wraps current pycrate decode flow
   - returns display tree + canonical model

2. `schema_service`
   - inspects ASN.1 / NAS structure metadata
   - exposes addable/deletable/editable rules

3. `model_service`
   - converts between pycrate native values and canonical model
   - applies add/remove/replace operations safely

4. `validate_service`
   - performs pre-encode structure validation

5. `encode_service`
   - converts canonical model back to pycrate-compatible native value
   - performs final encode

6. `nas_security_service`
   - wraps existing `nas_security.py`

## 12. Frontend State Model

Recommended client-side store shape:

```json
{
  "messageType": "DL-DCCH-Message",
  "sourceHex": "08002B",
  "decodeSessionId": "dec_20260425_001",
  "displayTree": {},
  "canonicalModel": {},
  "selectedPath": ["message", "c1", "rrcReconfiguration"],
  "nodeSchema": {},
  "changeSet": [],
  "validation": {
    "valid": true,
    "errors": [],
    "warnings": []
  },
  "encodeResult": null
}
```

## 13. Non-Functional Requirements

1. Decode and encode responses should be deterministic for the same input.
2. Hex normalization must be consistent across endpoints.
3. Request IDs should be logged server-side.
4. Validation errors must point to a concrete `path` when possible.
5. Large protocol trees should support partial schema fetch by `nodePath`.

### 13.1 Internal Pilot Requirements

For the internal pilot stage, the following non-functional requirements are sufficient:

1. Support tens of concurrent internal users, not internet-scale traffic.
2. Deployment should work in an internal Docker environment or a single Linux VM.
3. Access control may rely on corporate VPN, internal reverse proxy, or SSO gateway.
4. Logs should avoid storing full sensitive message payloads by default; request IDs, message type, and error summaries are preferred.
5. Basic health checks, startup validation, and dependency checks are required.
6. Disaster recovery can initially rely on image versioning and configuration backup rather than full HA design.
7. TLS termination may be handled by the enterprise ingress or reverse proxy instead of the application itself.

### 13.2 Public Rollout Delta

If the system is later exposed outside the initial internal pilot scope, the following areas must be revisited:

1. Authentication and authorization model.
2. Abuse protection and request rate limiting.
3. Stronger audit, retention, and compliance controls.
4. Horizontal scaling and worker isolation.
5. Secret management and environment segregation.
6. Payload redaction and external-facing security review.

## 14. Open Technical Risks

1. NAS currently uses a re-parse-and-overwrite approach, which is suitable for editing existing values but not sufficient for arbitrary structure insertion or deletion.
2. Some ASN.1 defaults and optional fields may require backend-generated templates instead of frontend-generated empty nodes.
3. Choice handling should not be modeled as simple delete/add in all cases; some cases need dedicated switch semantics.

## 15. First Implementation Recommendation

Implement the following sequence:

1. `/message-types`
2. `/protocol/decode`
3. `/protocol/validate`
4. `/protocol/encode`
5. `/nas/encrypt`
6. `/nas/decrypt`
7. `/protocol/schema/node`
8. `/protocol/schema/template`

Reason:

1. This preserves current working value first.
2. Schema-driven add/delete can then be layered in without destabilizing base decode/encode.

For the internal pilot, the implementation should additionally prefer:

1. One backend service plus one frontend application bundle.
2. One deployment environment first, such as `test-internal`.
3. Manual rollout to a controlled user group before any broader release.
