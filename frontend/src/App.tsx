import { useEffect, useState } from "react";

import { decodeMessage, decryptNas, encodeMessage, encryptNas, fetchMessageTypes } from "./api";
import type { DecodeResponse, EncodeResponse, NasRequest, NasResult, TreeNode } from "./types";


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


function TreeView({ node }: { node: TreeNode }) {
  const children = [...(node.children ?? []), ...(node.derivedChildren ?? [])];
  const [collapsed, setCollapsed] = useState(Boolean(node.defaultCollapsed));

  return (
    <div className="tree-node">
      <div className="tree-label" onClick={() => setCollapsed((value) => !value)}>
        <span className="tree-toggle">{children.length ? (collapsed ? ">" : "v") : "-"}</span>
        <span className="tree-name">{node.name}</span>
        {node.value ? <span className="tree-value">{node.value}</span> : null}
      </div>
      {!collapsed && children.length ? (
        <div className="tree-children">
          {children.map((child, index) => (
            <TreeView key={`${child.name}-${index}`} node={child} />
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
  const [busy, setBusy] = useState<"decode" | "encode" | "encrypt" | "decrypt" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        setDecodeResult((current) => {
          return {
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
          };
        });
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

  const isNasDecryptResult = typeof nasResult?.macOk === "boolean" || Boolean(nasResult?.plaintext && nasResult?.macReceived);

  return (
    <div className="page-shell">
      <header className="hero-panel">
        <div>
          <div className="eyebrow">Internal Pilot</div>
          <h1>3GPP Decoder and Encoder Web Console</h1>
          <p>
            Single-machine React and FastAPI monolith. The first build keeps the existing Python decode and encode runtime,
            and prepares the UI shell for future IE add and delete workflows.
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
            <button className="accent-button" onClick={handleEncode} disabled={busy !== null || !decodeResult}>
              {busy === "encode" ? "Encoding..." : "Encode"}
            </button>
            {decodeResult ? (
              <label className="inline-checkbox checkbox-chip">
                <input type="checkbox" checked={showTextView} onChange={(event) => setShowTextView(event.target.checked)} />
                <span>Show ASN.1 Text</span>
              </label>
            ) : null}
          </div>
          <div className="status-strip">
            <span>IE add/delete UI is reserved for the next phase.</span>
            <span>Current build keeps decode, encode, and NAS security functional.</span>
          </div>
        </section>

        {decodeResult ? (
          <section className={`panel tree-panel${showTextView ? "" : " tree-panel-full"}`}>
            <div className="panel-heading">
              <h2>Decoded Tree</h2>
              <span>{decodeResult.messageType}</span>
            </div>
            <div className="tree-surface">
              <TreeView node={decodeResult.displayTree} />
            </div>
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

        {encodeResult ? (
          <section className="panel result-panel">
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
