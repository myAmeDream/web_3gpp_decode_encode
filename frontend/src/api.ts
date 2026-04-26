import type { ApiEnvelope, ChangeSetItem, DecodeResponse, EncodeResponse, NasRequest, NasResult, ValidateResponse } from "./types";

const DEV_BACKEND_URL = "http://127.0.0.1:8000";

function buildConnectionError(): Error {
  return new Error(`Cannot reach the backend API. Start the backend service on ${DEV_BACKEND_URL}.`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch {
    throw buildConnectionError();
  }

  const responseText = await response.text();
  let payload: ApiEnvelope<T> | null = null;

  if (responseText.trim().length > 0) {
    try {
      payload = JSON.parse(responseText) as ApiEnvelope<T>;
    } catch {
      if (!response.ok) {
        throw new Error(responseText.trim() || `Request failed with status ${response.status}.`);
      }
      throw new Error("The backend returned an invalid JSON response.");
    }
  }

  if (!response.ok) {
    if (payload?.error?.message) {
      throw new Error(payload.error.message);
    }
    throw response.status >= 500 && responseText.trim().length === 0
      ? buildConnectionError()
      : new Error(responseText.trim() || `Request failed with status ${response.status}.`);
  }

  if (!payload) {
    throw buildConnectionError();
  }

  if (!payload.success || !payload.data) {
    throw new Error(payload.error?.message || "Request failed");
  }

  return payload.data;
}

export function fetchMessageTypes(): Promise<{ messageTypes: string[] }> {
  return request("/api/v1/message-types");
}

export function decodeMessage(messageType: string, hexData: string): Promise<DecodeResponse> {
  return request("/api/v1/protocol/decode", {
    method: "POST",
    body: JSON.stringify({
      messageType,
      hexData,
      options: {
        includeSchemaHints: true,
        includeTextView: true,
        normalizeHex: true,
      },
    }),
  });
}

export function encodeMessage(messageType: string, canonicalModel: Record<string, unknown>): Promise<EncodeResponse> {
  return request("/api/v1/protocol/encode", {
    method: "POST",
    body: JSON.stringify({
      messageType,
      canonicalModel,
      options: {
        returnCArray: true,
        validateBeforeEncode: true,
      },
    }),
  });
}

export function validateMessage(
  messageType: string,
  canonicalModel: Record<string, unknown>,
  changeSet: ChangeSetItem[] = [],
): Promise<ValidateResponse> {
  return request("/api/v1/protocol/validate", {
    method: "POST",
    body: JSON.stringify({
      messageType,
      canonicalModel,
      changeSet,
    }),
  });
}

export function encryptNas(payload: NasRequest): Promise<NasResult> {
  return request("/api/v1/nas/encrypt", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function decryptNas(payload: NasRequest): Promise<NasResult> {
  return request("/api/v1/nas/decrypt", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
