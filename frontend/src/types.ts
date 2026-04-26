export type ApiEnvelope<T> = {
  apiVersion: string;
  requestId: string;
  success: boolean;
  data?: T;
  warnings?: Array<{ code?: string; message?: string }>;
  error?: {
    code: string;
    message: string;
    details?: Array<Record<string, unknown>>;
  };
};

export type CanonicalModel = Record<string, unknown> & {
  rawVal?: unknown;
};

export type ChangeSetItem = {
  op: "add" | "remove" | "replace";
  path: string[];
  oldValue?: unknown;
  newValue?: unknown;
  value?: unknown;
};

export type ValidationIssue = {
  code: string;
  message: string;
  path?: string[];
};

export type ValidateResponse = {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type DecodeResponse = {
  messageType: string;
  normalizedHex: string;
  decodeSessionId: string;
  displayTree: TreeNode;
  canonicalModel: CanonicalModel;
  rawVal?: unknown;
  textView: string;
  schemaHints: {
    editableNodeCount: number;
    addableNodeCount: number;
    deletableNodeCount: number;
    phase?: string;
  };
};

export type TreeNode = {
  name: string;
  value?: string;
  children?: TreeNode[];
  derivedChildren?: TreeNode[];
  defaultCollapsed?: boolean;
};

export type EncodeResponse = {
  messageType: string;
  hex: string;
  cArray: string;
  length: number;
  validation?: {
    performed: boolean;
    valid: boolean;
    errors?: Array<Record<string, unknown>>;
  };
};

export type NasResult = {
  assembled?: string;
  ciphertext?: string;
  mac?: string;
  sqn?: string;
  length?: number;
  cArray?: string;
  plaintext?: string;
  macReceived?: string;
  macComputed?: string;
  macOk?: boolean;
  secHdrType?: number;
  decodedTree?: TreeNode;
  textView?: string;
  canonicalModel?: CanonicalModel;
};

export type NasRequest = {
  hexData: string;
  knasenc: string;
  knasint: string;
  count: number | string;
  bearer: number;
  direction: number;
  neaAlgorithm: string;
  niaAlgorithm: string;
  keyByteOrder: string;
  newSecurityContext: boolean;
};
