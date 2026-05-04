import { useEffect, useState } from "react";

import { decodeMessage, decryptNas, encodeMessage, encryptNas, fetchMessageTypes, validateMessage } from "./api";
import type {
  CanonicalModel,
  ChangeSetItem,
  DecodeResponse,
  EncodeResponse,
  NasRequest,
  NasResult,
  TreeNode,
} from "./types";

const INITIAL_NAS_FORM: NasRequest = {
  hexData: "",
  knasenc: "",
  knasint: "",
  count: 0,
  bearer: 1,
  direction: 1,
  neaAlgorithm: "NEA2",
  niaAlgorithm: "NIA2",
  keyByteOrder: "big",
  newSecurityContext: false,
};

type RawValueNode = {
  _type: string;
  _items?: Record<string, RawValueNode> | RawValueNode[];
  _name?: string;
  _value?: RawValueNode;
  _hex?: string;
  _val?: boolean | number | string | null;
  _uint?: number;
  _bits?: number;
  _original_hex?: string;
};

type TreeViewProps = {
  node: TreeNode;
  path: string[];
  rawValue: RawValueNode | null;
  modifiedPaths: Set<string>;
  isBusy: boolean;
  isDerived?: boolean;
  onCommitEdit: (path: string[], nextInput: string, originalInput: string) => Promise<boolean>;
};

type BasicValidationResult =
  | {
      valid: true;
      updatedNode: RawValueNode;
      displayValue: string;
      submittedValue: boolean | number | string;
    }
  | {
      valid: false;
      message: string;
    };

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRawValueNode(value: unknown): value is RawValueNode {
  return typeof value === "object" && value !== null && "_type" in value;
}

function parseListIndex(segment: string): number {
  return Number.parseInt(segment.replace(/[[\]]/g, ""), 10);
}

function pathKey(path: string[]): string {
  return path.join("/");
}

function extractEditableText(value?: string): string {
  if (!value) {
    return "";
  }

  const intMatch = value.match(/^(-?(?:0x[0-9a-fA-F]+|\d+))\s*\(0x/i);
  if (intMatch) {
    return intMatch[1];
  }

  return value;
}

function isEditableRawType(node: RawValueNode | null): boolean {
  return Boolean(node && ["int", "str", "bytes", "bool", "bitstring"].includes(node._type));
}

function getDictItems(node: RawValueNode): Record<string, RawValueNode> | null {
  if (node._type !== "dict") {
    return null;
  }

  const items = node._items;
  if (!items || Array.isArray(items)) {
    return null;
  }

  return items as Record<string, RawValueNode>;
}

function getListItems(node: RawValueNode): RawValueNode[] | null {
  if (node._type !== "list") {
    return null;
  }

  const items = node._items;
  if (!items || !Array.isArray(items)) {
    return null;
  }

  return items as RawValueNode[];
}

function getRawNodeAtPath(rawValue: RawValueNode, path: string[]): RawValueNode | null {
  let node: RawValueNode | undefined = rawValue;

  for (const segment of path) {
    if (!node) {
      return null;
    }

    if (node._type === "dict") {
      const items = getDictItems(node);
      if (!items) {
        return null;
      }
      node = items[segment];
      continue;
    }

    if (node._type === "choice") {
      node = node._value;
      continue;
    }

    if (node._type === "list") {
      const items = getListItems(node);
      if (!items) {
        return null;
      }
      node = items[parseListIndex(segment)];
      continue;
    }

    return null;
  }

  return node ?? null;
}

function setRawNodeAtPath(rawValue: RawValueNode, path: string[], nextNode: RawValueNode): boolean {
  if (path.length === 0) {
    return false;
  }

  let node: RawValueNode | undefined = rawValue;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (!node) {
      return false;
    }

    if (node._type === "dict") {
      const items = getDictItems(node);
      if (!items) {
        return false;
      }
      node = items[segment];
      continue;
    }

    if (node._type === "choice") {
      node = node._value;
      continue;
    }

    if (node._type === "list") {
      const items = getListItems(node);
      if (!items) {
        return false;
      }
      node = items[parseListIndex(segment)];
      continue;
    }

    return false;
  }

  if (!node) {
    return false;
  }

  const lastSegment = path[path.length - 1];
  if (node._type === "dict") {
    const items = getDictItems(node);
    if (!items) {
      return false;
    }
    items[lastSegment] = nextNode;
    return true;
  }

  if (node._type === "choice") {
    node._value = nextNode;
    return true;
  }

  if (node._type === "list") {
    const items = getListItems(node);
    if (!items) {
      return false;
    }
    items[parseListIndex(lastSegment)] = nextNode;
    return true;
  }

  return false;
}

function formatBitstringDisplay(uint: number, bits: number): string {
  if (bits <= 0) {
    return "''H";
  }
  if (bits % 4 === 0) {
    const hexDigits = bits / 4;
    return `'${uint.toString(16).toUpperCase().padStart(hexDigits, "0")}'H`;
  }
  return `'${uint.toString(2).padStart(bits, "0")}'B`;
}

function readRawNodeValue(node: RawValueNode): unknown {
  if (node._type === "int" || node._type === "str" || node._type === "bool") {
    return node._val;
  }
  if (node._type === "bytes") {
    return node._hex;
  }
  if (node._type === "bitstring") {
    const bits = typeof node._bits === "number" ? node._bits : 0;
    const uint = typeof node._uint === "number" ? node._uint : 0;
    return formatBitstringDisplay(uint, bits);
  }
  return undefined;
}

function buildUpdatedRawNode(node: RawValueNode, inputValue: string): BasicValidationResult {
  const trimmed = inputValue.trim();

  if (node._type === "int") {
    if (!/^[-+]?(?:0x[0-9a-fA-F]+|\d+)$/.test(trimmed)) {
      return { valid: false, message: "This IE expects an integer value." };
    }

    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) {
      return { valid: false, message: "This IE expects an integer value." };
    }

    return {
      valid: true,
      updatedNode: { ...node, _val: parsed },
      displayValue: `${parsed} (0x${parsed.toString(16).toUpperCase()})`,
      submittedValue: parsed,
    };
  }

  if (node._type === "bytes") {
    if (trimmed.length === 0) {
      return { valid: false, message: "This IE expects hexadecimal bytes." };
    }

    if (!/^[0-9a-fA-F\s]+$/.test(trimmed)) {
      return { valid: false, message: "This IE expects hexadecimal bytes only." };
    }

    const normalized = trimmed.replace(/\s+/g, "").toUpperCase();
    if (normalized.length % 2 !== 0) {
      return { valid: false, message: "Hex byte strings must contain an even number of hex digits." };
    }

    return {
      valid: true,
      updatedNode: { ...node, _hex: normalized },
      displayValue: normalized,
      submittedValue: normalized,
    };
  }

  if (node._type === "bool") {
    const normalized = trimmed.toLowerCase();
    if (normalized !== "true" && normalized !== "false") {
      return { valid: false, message: "This IE expects true or false." };
    }

    const parsed = normalized === "true";
    return {
      valid: true,
      updatedNode: { ...node, _val: parsed },
      displayValue: String(parsed),
      submittedValue: parsed,
    };
  }

  if (node._type === "str") {
    return {
      valid: true,
      updatedNode: { ...node, _val: inputValue },
      displayValue: inputValue,
      submittedValue: inputValue,
    };
  }

  if (node._type === "bitstring") {
    const bits = typeof node._bits === "number" ? node._bits : 0;
    if (bits <= 0) {
      return { valid: false, message: "BIT STRING bit length is unknown; cannot edit." };
    }

    let inner = trimmed;
    let isBinaryForm = bits % 4 !== 0;

    const fullMatch = trimmed.match(/^'([0-9a-fA-F]*)'([HB])$/);
    if (fullMatch) {
      inner = fullMatch[1];
      isBinaryForm = fullMatch[2] === "B";
    }

    if (isBinaryForm) {
      if (!/^[01]*$/.test(inner)) {
        return { valid: false, message: "Binary BIT STRING expects only 0/1 digits." };
      }
      if (inner.length !== bits) {
        return { valid: false, message: `BIT STRING expects ${bits} bits.` };
      }
      const parsed = inner.length ? Number.parseInt(inner, 2) : 0;
      const display = `'${inner}'B`;
      return {
        valid: true,
        updatedNode: { ...node, _uint: parsed, _bits: bits },
        displayValue: display,
        submittedValue: display,
      };
    }

    if (!/^[0-9a-fA-F]*$/.test(inner)) {
      return { valid: false, message: "Hex BIT STRING expects only hex digits." };
    }
    const expectedHexDigits = bits / 4;
    if (inner.length !== expectedHexDigits) {
      return { valid: false, message: `BIT STRING expects ${expectedHexDigits} hex digits (${bits} bits).` };
    }
    const parsed = inner.length ? Number.parseInt(inner, 16) : 0;
    const upper = inner.toUpperCase();
    const display = `'${upper}'H`;
    return {
      valid: true,
      updatedNode: { ...node, _uint: parsed, _bits: bits },
      displayValue: display,
      submittedValue: display,
    };
  }

  return {
    valid: false,
    message: `Editing raw value type '${node._type}' is not supported in phase 2.`,
  };
}

function updateTreeValue(node: TreeNode, path: string[], nextValue: string): TreeNode {
  if (path.length === 0) {
    return { ...node, value: nextValue };
  }

  const [head, ...rest] = path;
  return {
    ...node,
    children: (node.children ?? []).map((child) => (child.name === head ? updateTreeValue(child, rest, nextValue) : child)),
  };
}

function TreeView({ node, path, rawValue, modifiedPaths, isBusy, isDerived = false, onCommitEdit }: TreeViewProps) {
  const children = node.children ?? [];
  const derivedChildren = node.derivedChildren ?? [];
  const combinedChildren = [...children, ...derivedChildren];
  const [collapsed, setCollapsed] = useState(Boolean(node.defaultCollapsed));
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draftValue, setDraftValue] = useState(extractEditableText(node.value));

  const rawNode = rawValue ? getRawNodeAtPath(rawValue, path) : null;
  const isEditable = !isDerived && children.length === 0 && isEditableRawType(rawNode);
  const isModified = modifiedPaths.has(pathKey(path));

  useEffect(() => {
    if (!editing) {
      setDraftValue(extractEditableText(node.value));
    }
  }, [editing, node.value]);

  async function commitEdit() {
    if (!isEditable || !node.value) {
      setEditing(false);
      return;
    }

    const originalInput = extractEditableText(node.value);
    if (draftValue === originalInput) {
      setEditing(false);
      return;
    }

    setSubmitting(true);
    const success = await onCommitEdit(path, draftValue, originalInput);
    setSubmitting(false);
    setEditing(false);
    if (!success) {
      setDraftValue(originalInput);
    }
  }

  return (
    <div className="tree-node">
      <div className="tree-label" onClick={() => combinedChildren.length && setCollapsed((value) => !value)}>
        <span className="tree-toggle">{combinedChildren.length ? (collapsed ? ">" : "v") : "-"}</span>
        <span className="tree-name">{node.name}</span>
        {node.value ? (
          editing ? (
            <input
              autoFocus
              className="tree-value-input"
              disabled={submitting}
              onBlur={() => {
                void commitEdit();
              }}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setDraftValue(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  void commitEdit();
                }
                if (event.key === "Escape") {
                  setDraftValue(extractEditableText(node.value));
                  setEditing(false);
                }
              }}
              value={draftValue}
            />
          ) : (
            <span
              className={`tree-value${isEditable ? " tree-value-editable" : ""}${isModified ? " tree-value-modified" : ""}`}
              onClick={(event) => {
                if (isEditable) {
                  event.stopPropagation();
                }
              }}
              onDoubleClick={(event) => {
                if (!isEditable || isBusy) {
                  return;
                }
                event.stopPropagation();
                setDraftValue(extractEditableText(node.value));
                setEditing(true);
              }}
            >
              {node.value}
            </span>
          )
        ) : null}
      </div>
      {!collapsed && combinedChildren.length ? (
        <div className="tree-children">
          {children.map((child, index) => {
            const childPath = [...path, child.name];
            return (
              <TreeView
                key={`${pathKey(childPath)}-${index}`}
                isBusy={isBusy}
                modifiedPaths={modifiedPaths}
                node={child}
                onCommitEdit={onCommitEdit}
                path={childPath}
                rawValue={rawValue}
              />
            );
          })}
          {derivedChildren.map((child, index) => (
            <TreeView
              key={`derived-${child.name}-${index}`}
              isBusy={isBusy}
              isDerived
              modifiedPaths={modifiedPaths}
              node={child}
              onCommitEdit={onCommitEdit}
              path={[]}
              rawValue={rawValue}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [messageTypes, setMessageTypes] = useState<string[]>([]);
  const [messageType, setMessageType] = useState("DL-DCCH-Message");
  const [hexData, setHexData] = useState("");
  const [showTextView, setShowTextView] = useState(false);
  const [nasExpanded, setNasExpanded] = useState(false);
  const [decodeResult, setDecodeResult] = useState<DecodeResponse | null>(null);
  const [encodeResult, setEncodeResult] = useState<EncodeResponse | null>(null);
  const [nasResult, setNasResult] = useState<NasResult | null>(null);
  const [nasForm, setNasForm] = useState<NasRequest>(INITIAL_NAS_FORM);
  const [modifiedPaths, setModifiedPaths] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"decode" | "encode" | "encrypt" | "decrypt" | "validate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentRawValue = decodeResult && isRawValueNode(decodeResult.canonicalModel.rawVal) ? decodeResult.canonicalModel.rawVal : null;
  const isNasDecryptResult = typeof nasResult?.macOk === "boolean" || Boolean(nasResult?.plaintext && nasResult?.macReceived);

  useEffect(() => {
    void fetchMessageTypes()
      .then((result) => setMessageTypes(result.messageTypes))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  async function handleDecode() {
    setBusy("decode");
    setError(null);
    setEncodeResult(null);
    setNasResult(null);
    setModifiedPaths(new Set());

    try {
      const result = await decodeMessage(messageType, hexData);
      setDecodeResult(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Decode failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleEncode() {
    if (!decodeResult?.canonicalModel) {
      return;
    }

    setBusy("encode");
    setError(null);

    try {
      const result = await encodeMessage(messageType, decodeResult.canonicalModel);
      setEncodeResult(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Encode failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleTreeEdit(path: string[], nextInput: string, originalInput: string): Promise<boolean> {
    if (!decodeResult || !currentRawValue) {
      return false;
    }

    const currentNode = getRawNodeAtPath(currentRawValue, path);
    if (!currentNode) {
      setError("The selected IE could not be resolved in the current raw model.");
      return false;
    }

    const basicValidation = buildUpdatedRawNode(currentNode, nextInput);
    if (!basicValidation.valid) {
      setError(basicValidation.message);
      return false;
    }

    if (nextInput === originalInput) {
      return true;
    }

    const nextRawValue = cloneJson(currentRawValue);
    if (!setRawNodeAtPath(nextRawValue, path, basicValidation.updatedNode)) {
      setError("Failed to apply the edited IE value to the current raw model.");
      return false;
    }

    const nextCanonicalModel: CanonicalModel = {
      ...decodeResult.canonicalModel,
      rawVal: nextRawValue,
    };

    const changeSet: ChangeSetItem[] = [
      {
        op: "replace",
        path,
        oldValue: readRawNodeValue(currentNode),
        newValue: basicValidation.submittedValue,
      },
    ];

    setBusy("validate");
    setError(null);
    try {
      const validation = await validateMessage(decodeResult.messageType, nextCanonicalModel, changeSet);
      if (!validation.valid) {
        setError(validation.errors[0]?.message ?? "Validation failed.");
        return false;
      }

      setDecodeResult({
        ...decodeResult,
        canonicalModel: nextCanonicalModel,
        rawVal: nextRawValue,
        displayTree: updateTreeValue(decodeResult.displayTree, path, basicValidation.displayValue),
      });
      setEncodeResult(null);
      setModifiedPaths((current) => {
        const next = new Set(current);
        next.add(pathKey(path));
        return next;
      });
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Validation failed.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function handleNas(mode: "encrypt" | "decrypt") {
    setBusy(mode);
    setError(null);
    setNasResult(null);

    try {
      const result = mode === "encrypt" ? await encryptNas(nasForm) : await decryptNas(nasForm);
      setNasResult(result);
      const decodedTree = result.decodedTree;
      const canonicalModel = result.canonicalModel;
      if (decodedTree && canonicalModel) {
        const nextType = "NAS-5G-Message";
        setMessageType(nextType);
        setModifiedPaths(new Set());
        setDecodeResult((current) => ({
          messageType: nextType,
          normalizedHex: result.plaintext ?? "",
          decodeSessionId: current?.decodeSessionId ?? "nas-session",
          displayTree: decodedTree,
          canonicalModel,
          rawVal: canonicalModel.rawVal,
          textView: result.textView ?? "",
          schemaHints: {
            editableNodeCount: 0,
            addableNodeCount: 0,
            deletableNodeCount: 0,
            phase: "legacy",
          },
        }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${mode} failed`);
    } finally {
      setBusy(null);
    }
  }

  function updateNasField<K extends keyof NasRequest>(key: K, value: NasRequest[K]) {
    setNasForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="page-shell">
      <header className="hero-panel">
        <div>
          <div className="eyebrow">Internal Pilot</div>
          <h1>3GPP Decoder and Encoder Web Console</h1>
          <p>
            Single-machine React and FastAPI monolith. Phase 2 keeps the existing Python runtime and now supports editing
            existing IE leaf values with client-side type validation and backend pycrate validation.
          </p>
        </div>
        <div className="hero-card">
          <span>Backend</span>
          <strong>FastAPI + existing pycrate scripts</strong>
          <span>Frontend</span>
          <strong>React + Vite</strong>
        </div>
      </header>

      <main className="workspace-grid">
        <section className="panel input-panel">
          <div className="panel-heading">
            <h2>Protocol Workspace</h2>
            <span>{decodeResult?.schemaHints.phase === "legacy" ? "Legacy-compatible mode" : "Schema mode"}</span>
          </div>
          <div className="control-grid">
            <label>
              <span>Message Type</span>
              <select value={messageType} onChange={(event) => setMessageType(event.target.value)}>
                {messageTypes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide-field">
              <span>Hex Byte Stream</span>
              <textarea
                rows={4}
                value={hexData}
                onChange={(event) => setHexData(event.target.value)}
                placeholder="Paste hex bytes here"
              />
            </label>
          </div>
          <div className="button-row">
            <button onClick={handleDecode} disabled={busy !== null || !hexData.trim()}>
              {busy === "decode" ? "Decoding..." : "Decode"}
            </button>
            {decodeResult ? (
              <label className="inline-checkbox checkbox-chip">
                <input type="checkbox" checked={showTextView} onChange={(event) => setShowTextView(event.target.checked)} />
                <span>Show ASN.1 Text</span>
              </label>
            ) : null}
          </div>
          <div className="status-strip">
            <span>Double-click an existing leaf IE to edit it in phase 2.</span>
            <span>Add and delete IE operations are reserved for the next phase.</span>
          </div>
        </section>

        {decodeResult ? (
          <section className={`panel tree-panel${showTextView ? "" : " tree-panel-full"}`}>
            <div className="panel-heading">
              <h2>Decoded Tree</h2>
              <span>{decodeResult.messageType}</span>
            </div>
            <div className="tree-surface">
              <TreeView
                isBusy={busy !== null}
                modifiedPaths={modifiedPaths}
                node={decodeResult.displayTree}
                onCommitEdit={handleTreeEdit}
                path={[]}
                rawValue={currentRawValue}
              />
            </div>
            <div className="button-row tree-actions">
              <button className="accent-button" onClick={handleEncode} disabled={busy !== null || !decodeResult}>
                {busy === "encode" ? "Encoding..." : "Encode"}
              </button>
            </div>
            {encodeResult ? (
              <div className="inline-result">
                <div className="panel-heading">
                  <h2>Encode Result</h2>
                  <span>{`${encodeResult.length} bytes`}</span>
                </div>
                <div className="result-surface">
                  <div className="result-item">
                    <label>Hex</label>
                    <code>{encodeResult.hex}</code>
                  </div>
                  <div className="result-item">
                    <label>C Array</label>
                    <code>{encodeResult.cArray}</code>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {showTextView ? (
          <section className="panel text-panel">
            <div className="panel-heading">
              <h2>Protocol Text View</h2>
              <span>ASN.1 or NAS dump</span>
            </div>
            <pre className="text-surface">{decodeResult?.textView || "No decoded text yet."}</pre>
          </section>
        ) : null}

        <section className="panel nas-panel">
          <button className="security-header" type="button" onClick={() => setNasExpanded((value) => !value)}>
            <span className="security-toggle">{nasExpanded ? "v" : ">"}</span>
            <span className="security-title">NAS Security (Encrypt / Decrypt)</span>
          </button>
          {nasExpanded ? (
            <div className="security-body">
              <div className="security-grid">
                <label className="wide-field security-field">
                  <span>NAS Hex Data (Big-Endian byte order only)</span>
                  <input
                    value={nasForm.hexData}
                    onChange={(event) => updateNasField("hexData", event.target.value)}
                    placeholder="Plaintext (encrypt) or ciphertext (decrypt)"
                  />
                </label>
                <label className="wide-field security-field">
                  <span>Key Byte Order</span>
                  <select value={nasForm.keyByteOrder} onChange={(event) => updateNasField("keyByteOrder", event.target.value)}>
                    <option value="big">Big-Endian (standard)</option>
                    <option value="little">Little-Endian (x86 uint32_t*)</option>
                  </select>
                </label>
                <label className="security-field">
                  <span>Encryption Algorithm</span>
                  <select value={nasForm.neaAlgorithm} onChange={(event) => updateNasField("neaAlgorithm", event.target.value)}>
                    <option value="NEA0">NEA0 (Null)</option>
                    <option value="NEA1">NEA1 (Snow 3G)</option>
                    <option value="NEA2">NEA2 (AES)</option>
                    <option value="NEA3">NEA3 (ZUC)</option>
                  </select>
                </label>
                <label className="security-field">
                  <span>KNASenc (32 hex chars)</span>
                  <input
                    value={nasForm.knasenc}
                    onChange={(event) => updateNasField("knasenc", event.target.value)}
                    placeholder="e.g. 00112233445566778899AABBCCDDEEFF"
                  />
                </label>
                <label className="security-field">
                  <span>Integrity Algorithm</span>
                  <select value={nasForm.niaAlgorithm} onChange={(event) => updateNasField("niaAlgorithm", event.target.value)}>
                    <option value="NIA0">NIA0 (Null)</option>
                    <option value="NIA1">NIA1 (Snow 3G)</option>
                    <option value="NIA2">NIA2 (AES)</option>
                    <option value="NIA3">NIA3 (ZUC)</option>
                  </select>
                </label>
                <label className="security-field">
                  <span>KNASint (32 hex chars)</span>
                  <input
                    value={nasForm.knasint}
                    onChange={(event) => updateNasField("knasint", event.target.value)}
                    placeholder="e.g. FFEEDDCCBBAA99887766554433221100"
                  />
                </label>
                <label className="wide-field security-field">
                  <span>COUNT (decimal or 0x hex)</span>
                  <input
                    value={String(nasForm.count)}
                    onChange={(event) => updateNasField("count", event.target.value)}
                    placeholder="e.g. 5 or 0x05"
                  />
                </label>
                <label className="wide-field security-field">
                  <span>BEARER</span>
                  <input value={String(nasForm.bearer)} readOnly />
                </label>
                <label className="wide-field security-field">
                  <span>DIRECTION</span>
                  <select value={nasForm.direction} onChange={(event) => updateNasField("direction", Number(event.target.value))}>
                    <option value={0}>0 - Uplink</option>
                    <option value={1}>1 - Downlink</option>
                  </select>
                </label>
                <label
                  className="wide-field inline-checkbox security-checkbox"
                  title="Use security header types 0x03/0x04 (e.g. for Security Mode Complete with a newly established NAS security context)."
                >
                  <input
                    type="checkbox"
                    checked={nasForm.newSecurityContext}
                    onChange={(event) => updateNasField("newSecurityContext", event.target.checked)}
                  />
                  <span>New 5G NAS security context (sec hdr 0x03 / 0x04)</span>
                </label>
              </div>
              <div className="security-actions">
                <button className="security-action security-action-encrypt" onClick={() => handleNas("encrypt")} disabled={busy !== null || !nasForm.hexData.trim()}>
                  {busy === "encrypt" ? "Encrypting..." : "Encrypt"}
                </button>
                <button className="security-action security-action-decrypt" onClick={() => handleNas("decrypt")} disabled={busy !== null || !nasForm.hexData.trim()}>
                  {busy === "decrypt" ? "Decrypting..." : "Decrypt"}
                </button>
              </div>
              <div className="security-result">
                {nasResult ? (
                  <>
                    <div className="security-result-title">{isNasDecryptResult ? "Decrypt Result" : "Encrypt Result"}</div>
                    {isNasDecryptResult ? (
                      <>
                        <div className="result-item">
                          <label>MAC Check</label>
                          <code className={nasResult.macOk ? "mac-ok" : "mac-fail"}>{nasResult.macOk ? "PASS" : "FAIL"}</code>
                        </div>
                        {nasResult.macReceived ? (
                          <div className="result-item">
                            <label>MAC Recv</label>
                            <code>{nasResult.macReceived}</code>
                          </div>
                        ) : null}
                        {nasResult.macComputed ? (
                          <div className="result-item">
                            <label>MAC Calc</label>
                            <code>{nasResult.macComputed}</code>
                          </div>
                        ) : null}
                        {nasResult.sqn ? (
                          <div className="result-item">
                            <label>SQN</label>
                            <code>{nasResult.sqn}</code>
                          </div>
                        ) : null}
                        {nasResult.plaintext ? (
                          <div className="result-item">
                            <label>Plaintext</label>
                            <code>{nasResult.plaintext}</code>
                          </div>
                        ) : null}
                        {nasResult.decodedTree ? <div className="security-note">Decoded plaintext shown in tree above</div> : null}
                      </>
                    ) : (
                      <>
                        {nasResult.mac ? (
                          <div className="result-item">
                            <label>MAC</label>
                            <code>{nasResult.mac}</code>
                          </div>
                        ) : null}
                        {nasResult.sqn ? (
                          <div className="result-item">
                            <label>SQN</label>
                            <code>{nasResult.sqn}</code>
                          </div>
                        ) : null}
                        {nasResult.ciphertext ? (
                          <div className="result-item">
                            <label>Ciphertext</label>
                            <code>{nasResult.ciphertext}</code>
                          </div>
                        ) : null}
                        {typeof nasResult.length === "number" ? (
                          <div className="result-item">
                            <label>Length</label>
                            <code>{nasResult.length} bytes</code>
                          </div>
                        ) : null}
                        {nasResult.assembled ? (
                          <div className="result-item">
                            <label>Assembled</label>
                            <code>{nasResult.assembled}</code>
                          </div>
                        ) : null}
                        {nasResult.cArray ? (
                          <div className="result-item">
                            <label>C Array</label>
                            <code>{nasResult.cArray}</code>
                          </div>
                        ) : null}
                      </>
                    )}
                  </>
                ) : (
                  <div className="empty-state">NAS encrypt and decrypt results will appear here.</div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </main>

      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}
