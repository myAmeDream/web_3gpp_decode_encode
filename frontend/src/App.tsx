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
          </div>
          <div className="status-strip">
            <span>IE add/delete UI is reserved for the next phase.</span>
            <span>Current build keeps decode, encode, and NAS security functional.</span>
          </div>
        </section>

        <section className="panel tree-panel">
          <div className="panel-heading">
            <h2>Decoded Tree</h2>
            <span>{decodeResult ? decodeResult.messageType : "No message loaded"}</span>
          </div>
          <div className="tree-surface">
            {decodeResult ? <TreeView node={decodeResult.displayTree} /> : <div className="empty-state">Decode a message to inspect the protocol tree.</div>}
          </div>
        </section>

        <section className="panel text-panel">
          <div className="panel-heading">
            <h2>Protocol Text View</h2>
            <span>ASN.1 or NAS dump</span>
          </div>
          <pre className="text-surface">{decodeResult?.textView || "No decoded text yet."}</pre>
        </section>

        <section className="panel result-panel">
          <div className="panel-heading">
            <h2>Encode Result</h2>
            <span>{encodeResult ? `${encodeResult.length} bytes` : "Waiting"}</span>
          </div>
          <div className="result-surface">
            {encodeResult ? (
              <>
                <div className="result-item">
                  <label>Hex</label>
                  <code>{encodeResult.hex}</code>
                </div>
                <div className="result-item">
                  <label>C Array</label>
                  <code>{encodeResult.cArray}</code>
                </div>
              </>
            ) : (
              <div className="empty-state">Encode output will appear here after a successful round-trip.</div>
            )}
          </div>
        </section>

        <section className="panel nas-panel">
          <div className="panel-heading">
            <h2>NAS Security</h2>
            <span>Encrypt and decrypt helpers</span>
          </div>
          <div className="control-grid nas-grid">
            <label className="wide-field">
              <span>NAS Hex Data</span>
              <textarea
                rows={3}
                value={nasForm.hexData}
                onChange={(event) => updateNasField("hexData", event.target.value)}
                placeholder="Plaintext for encrypt, ciphertext for decrypt"
              />
            </label>
            <label>
              <span>KNASenc</span>
              <input value={nasForm.knasenc} onChange={(event) => updateNasField("knasenc", event.target.value)} />
            </label>
            <label>
              <span>KNASint</span>
              <input value={nasForm.knasint} onChange={(event) => updateNasField("knasint", event.target.value)} />
            </label>
            <label>
              <span>COUNT</span>
              <input value={String(nasForm.count)} onChange={(event) => updateNasField("count", event.target.value)} />
            </label>
            <label>
              <span>Direction</span>
              <select value={nasForm.direction} onChange={(event) => updateNasField("direction", Number(event.target.value))}>
                <option value={0}>0 - Uplink</option>
                <option value={1}>1 - Downlink</option>
              </select>
            </label>
            <label>
              <span>NEA</span>
              <select value={nasForm.neaAlgorithm} onChange={(event) => updateNasField("neaAlgorithm", event.target.value)}>
                <option value="NEA0">NEA0</option>
                <option value="NEA1">NEA1</option>
                <option value="NEA2">NEA2</option>
                <option value="NEA3">NEA3</option>
              </select>
            </label>
            <label>
              <span>NIA</span>
              <select value={nasForm.niaAlgorithm} onChange={(event) => updateNasField("niaAlgorithm", event.target.value)}>
                <option value="NIA0">NIA0</option>
                <option value="NIA1">NIA1</option>
                <option value="NIA2">NIA2</option>
                <option value="NIA3">NIA3</option>
              </select>
            </label>
          </div>
          <div className="button-row">
            <button onClick={() => handleNas("encrypt")} disabled={busy !== null || !nasForm.hexData.trim()}>
              {busy === "encrypt" ? "Encrypting..." : "Encrypt"}
            </button>
            <button onClick={() => handleNas("decrypt")} disabled={busy !== null || !nasForm.hexData.trim()}>
              {busy === "decrypt" ? "Decrypting..." : "Decrypt"}
            </button>
          </div>
          <div className="result-surface">
            {nasResult ? (
              <>
                {nasResult.assembled ? (
                  <div className="result-item">
                    <label>Assembled</label>
                    <code>{nasResult.assembled}</code>
                  </div>
                ) : null}
                {nasResult.plaintext ? (
                  <div className="result-item">
                    <label>Plaintext</label>
                    <code>{nasResult.plaintext}</code>
                  </div>
                ) : null}
                {nasResult.mac ? (
                  <div className="result-item">
                    <label>MAC</label>
                    <code>{nasResult.mac}</code>
                  </div>
                ) : null}
                {typeof nasResult.macOk === "boolean" ? (
                  <div className="result-item">
                    <label>MAC Check</label>
                    <code>{nasResult.macOk ? "PASS" : "FAIL"}</code>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-state">NAS encrypt and decrypt results will appear here.</div>
            )}
          </div>
        </section>
      </main>

      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}
