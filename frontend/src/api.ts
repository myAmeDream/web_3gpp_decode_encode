import type { ApiEnvelope, ChangeSetItem, DecodeResponse, EncodeResponse, NasRequest, NasResult, ValidateResponse } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const payload = (await response.json()) as ApiEnvelope<T>;
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
