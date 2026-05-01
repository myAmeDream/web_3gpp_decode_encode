#!/usr/bin/env python3
"""
3GPP NR RRC / NAS 5G Decoder & Encoder using pycrate.
Called by VS Code extension via subprocess.
Input: JSON on stdin with { "command": "decode"|"encode", "msgType": "...", ... }
Output: JSON on stdout.
"""

import sys
import os
import json
import struct

# Suppress pycrate warnings (e.g. "CryptoMobile not found") from polluting stdout.
# pycrate uses print() for warnings, so we must redirect stdout during import.
_real_stdout = sys.stdout
sys.stdout = open(os.devnull, "w")

from pycrate_asn1dir.RRCNR import NR_RRC_Definitions
from pycrate_mobile.NAS5G import parse_NAS5G

sys.stdout = _real_stdout

from nas_security import nas_encrypt, nas_decrypt

# RRC message types (ASN.1 UPER)
RRC_MESSAGE_TYPES = {
    "BCCH-BCH-Message": NR_RRC_Definitions.BCCH_BCH_Message,
    "BCCH-DL-SCH-Message": NR_RRC_Definitions.BCCH_DL_SCH_Message,
    "DL-CCCH-Message": NR_RRC_Definitions.DL_CCCH_Message,
    "DL-DCCH-Message": NR_RRC_Definitions.DL_DCCH_Message,
    "PCCH-Message": NR_RRC_Definitions.PCCH_Message,
    "UL-CCCH-Message": NR_RRC_Definitions.UL_CCCH_Message,
    "UL-CCCH1-Message": NR_RRC_Definitions.UL_CCCH1_Message,
    "UL-DCCH-Message": NR_RRC_Definitions.UL_DCCH_Message,
    "MCCH-Message-r17": NR_RRC_Definitions.MCCH_Message_r17,
}

# NAS 5G is auto-detected, no need for sub-types
NAS_MSG_TYPE = "NAS-5G-Message"
PIGGYBACK_NAS_FIELD_NAMES = {"dedicatedNAS-Message", "dedicatedNAS-MessageList"}


# ============================================================
# Tree conversion (decode output)
# ============================================================

def asn1_to_tree(obj, name="root"):
    """Convert pycrate ASN.1 decoded value to a JSON-serializable tree structure."""
    val = obj.get_val()
    return _convert(val, name)


def _is_bitstring_value(val):
    return isinstance(val, tuple) and len(val) == 2 and isinstance(val[0], int) and isinstance(val[1], int)


def _format_bitstring_value(value, bit_length):
    if bit_length <= 0:
        return "''H"

    if bit_length % 4 == 0:
        hex_digits = (bit_length + 3) // 4
        return f"'{value:0{hex_digits}X}'H"

    return f"'{value:0{bit_length}b}'B"


def _convert(val, name):
    """Recursively convert a pycrate value to a tree node."""
    if isinstance(val, dict):
        children = []
        for k, v in val.items():
            children.append(_convert(v, k))
        return {"name": name, "value": "", "children": children}
    elif isinstance(val, tuple) and len(val) == 2 and isinstance(val[0], str):
        # ASN.1 CHOICE type: (choice_name, choice_value)
        child = _convert(val[1], val[0])
        return {"name": name, "value": "", "children": [child]}
    elif _is_bitstring_value(val):
        return {"name": name, "value": _format_bitstring_value(val[0], val[1]), "children": []}
    elif isinstance(val, (list, tuple)):
        children = []
        for i, v in enumerate(val):
            children.append(_convert(v, f"[{i}]"))
        return {"name": name, "value": "", "children": children}
    elif isinstance(val, bytes):
        hex_str = val.hex().upper()
        return {"name": name, "value": hex_str, "children": []}
    elif isinstance(val, bool):
        return {"name": name, "value": str(val), "children": []}
    elif isinstance(val, int):
        return {"name": name, "value": f"{val} (0x{val:X})", "children": []}
    elif isinstance(val, float):
        return {"name": name, "value": str(val), "children": []}
    elif isinstance(val, str):
        return {"name": name, "value": val, "children": []}
    elif val is None:
        return {"name": name, "value": "NULL", "children": []}
    else:
        return {"name": name, "value": str(val), "children": []}


def _nas_iter_children(elem):
    """Yield immediate child elements from a pycrate NAS element.

    Handles three pycrate container shapes that look different at the
    Python level:
      - Envelope: ``_content`` is a list of static children
      - Alt: ``_content`` is a dict ``{selector: element}``; iterating
        the dict yields integer keys, not children, so we pick the
        selected alternative via ``get_sel()``
      - Array: no ``_content`` attribute, but iterable with a ``_tmpl``
    """
    content = getattr(elem, '_content', None)
    if isinstance(content, dict):
        sel = elem.get_sel() if hasattr(elem, 'get_sel') else None
        if sel in content:
            yield content[sel]
        return
    if isinstance(content, (list, tuple)):
        for e in content:
            yield e
        return
    if hasattr(elem, '_tmpl') and hasattr(elem, '__iter__'):
        for e in elem:
            yield e


def _is_nas_container(e):
    content = getattr(e, '_content', None)
    if isinstance(content, dict) and content:
        return True
    if isinstance(content, (list, tuple)) and content:
        return True
    if hasattr(e, '_tmpl') and hasattr(e, '__iter__'):
        return True
    return False


def _nas_elem_to_tree(elem, name="root"):
    """Convert a pycrate NAS element (Envelope / Alt / Array) to a tree node."""
    children = []
    for e in _nas_iter_children(elem):
        child_name = getattr(e, '_name', '?')
        if _is_nas_container(e):
            children.append(_nas_elem_to_tree(e, child_name))
        elif hasattr(e, 'get_val'):
            val = e.get_val()
            if isinstance(val, dict):
                sub_children = [_convert(v, k) for k, v in val.items()]
                children.append({"name": child_name, "value": "", "children": sub_children})
            elif isinstance(val, bytes):
                children.append({"name": child_name, "value": val.hex().upper(), "children": []})
            elif isinstance(val, int):
                children.append({"name": child_name, "value": f"{val} (0x{val:X})", "children": []})
            elif val is not None:
                children.append({"name": child_name, "value": str(val), "children": []})
            else:
                children.append({"name": child_name, "value": "", "children": []})
        elif hasattr(e, '_name'):
            children.append({"name": e._name, "value": "", "children": []})
    return {"name": name, "value": "", "children": children}


def _leaf(name, value):
    """Build a leaf tree node."""
    return {"name": name, "value": value, "children": []}


def _find_first_node(node, target_name):
    """Find the first node with the specified name using DFS."""
    if node.get("name") == target_name:
        return node
    for child in node.get("children", []):
        found = _find_first_node(child, target_name)
        if found is not None:
            return found
    return None


def _find_first_value(node, target_name):
    """Find the first non-empty value for the specified node name."""
    found = _find_first_node(node, target_name)
    if found is None:
        return None
    return found.get("value") or None


def _parse_displayed_int(value_text):
    """Parse display text like '2 (0x2)' and return the integer value."""
    if not value_text:
        return None
    try:
        return int(str(value_text).split(" ", 1)[0], 10)
    except (TypeError, ValueError):
        return None


def _build_plain_nas_decode_node(plain_tree):
    """Build the nested plain NAS display subtree."""
    return {
        "name": "Decoded Plain 5GS NAS",
        "value": "",
        "children": [plain_tree],
        "defaultCollapsed": True,
    }


def _extract_integrity_only_plain_tree(outer_tree):
    """Extract the inner plain NAS tree from a sec hdr 1/3 decoded tree."""
    for child in outer_tree.get("children", []):
        if child.get("name") not in {"5GMMHeaderSec", "MAC", "Seqn"}:
            return child
    return None


def _build_piggyback_nas_analysis(hex_str):
    """Decode a piggyback NAS hex string into a protocol-aware analysis node."""
    try:
        raw = bytes.fromhex(hex_str)
    except ValueError:
        return None

    outer = decode_nas(raw)
    if "error" in outer:
        return None

    outer_tree = outer["tree"]
    epd = _find_first_value(outer_tree, "EPD")
    sec_hdr_text = _find_first_value(outer_tree, "SecHdr")
    sec_hdr = _parse_displayed_int(sec_hdr_text)
    if sec_hdr is None:
        return None

    children = []
    if epd is not None:
        children.append(_leaf("Extended Protocol Discriminator", epd))
    children.append(_leaf("Security Header Type", sec_hdr_text))

    if sec_hdr == 0:
        pti = _find_first_value(outer_tree, "PTI") or "Not present"
        msg_type = _find_first_value(outer_tree, "Type") or "Not present"
        children.append(_leaf("procedure transaction identity", pti))
        children.append(_leaf("message type", msg_type))
        children.append(_leaf("Inner Plain NAS Availability", "Available / Decoded"))
        children.append(_build_plain_nas_decode_node(outer_tree))
    else:
        mac = _find_first_value(outer_tree, "MAC")
        seqn = _find_first_value(outer_tree, "Seqn")
        if mac is not None:
            children.append(_leaf("Message Authentication Code", mac))
        if seqn is not None:
            children.append(_leaf("Sequence Number", seqn))

        if sec_hdr in (1, 3):
            inner_plain_tree = _extract_integrity_only_plain_tree(outer_tree)
            if inner_plain_tree is not None:
                children.append(_leaf("Inner Plain NAS Availability", "Available / Decoded"))
                children.append(_build_plain_nas_decode_node(inner_plain_tree))
            else:
                children.append(_leaf("Inner Plain NAS Availability", "Decode failed"))
        elif sec_hdr in (2, 4):
            children.append(_leaf("Inner Plain NAS Availability", "Ciphered / Not decoded"))
        else:
            children.append(_leaf("Inner Plain NAS Availability", "Unknown security header type"))

    return {
        "name": "Piggyback NAS Analysis",
        "value": "",
        "children": children,
    }


def _attach_nested_nas_trees(node, path=None):
    """Attach inline NAS decode results under known piggyback NAS byte fields."""
    if path is None:
        path = []

    children = node.get("children", [])
    parent_name = path[-1] if path else None
    if node.get("value") and (node.get("name") in PIGGYBACK_NAS_FIELD_NAMES or parent_name in PIGGYBACK_NAS_FIELD_NAMES):
        derived = _build_piggyback_nas_analysis(node["value"])
        if derived is not None:
            node["derivedChildren"] = [derived]

    for child in children:
        _attach_nested_nas_trees(child, path + [node.get("name", "")])

    return node


# ============================================================
# Decode
# ============================================================

def decode_rrc(msg_type, raw):
    """Decode an RRC message."""
    asn1_obj = RRC_MESSAGE_TYPES[msg_type]
    asn1_obj.from_uper(raw)
    tree = asn1_to_tree(asn1_obj, msg_type)
    _attach_nested_nas_trees(tree)
    asn1_text = asn1_obj.to_asn1()
    # Also return the raw pycrate value for encode round-trip
    raw_val = asn1_obj.get_val()
    return {"tree": tree, "asn1Text": asn1_text, "rawVal": _val_to_json(raw_val)}


def decode_nas(raw):
    """Decode a NAS 5G message."""
    msg, err = parse_NAS5G(raw)
    if err:
        return {"error": f"NAS decode failed: {err}"}

    tree = _nas_elem_to_tree(msg, msg._name if hasattr(msg, '_name') else "NAS-5G-Message")
    text = msg.show()

    # Build rawVal for encode round-trip
    raw_val = _nas_elem_to_rawval(msg)
    raw_val["_original_hex"] = raw.hex().upper()

    return {"tree": tree, "asn1Text": text, "rawVal": raw_val}


def decode(msg_type, hex_data):
    """Decode a hex string using the specified message type."""
    try:
        raw = bytes.fromhex(hex_data.replace(" ", "").replace("0x", ""))
    except ValueError as e:
        return {"error": f"Invalid hex data: {e}"}

    try:
        if msg_type == NAS_MSG_TYPE:
            return decode_nas(raw)
        elif msg_type in RRC_MESSAGE_TYPES:
            return decode_rrc(msg_type, raw)
        else:
            return {
                "error": f"Unknown message type: {msg_type}",
                "available": list(RRC_MESSAGE_TYPES.keys()) + [NAS_MSG_TYPE],
            }
    except Exception as e:
        return {"error": f"Decode failed: {e}"}


# ============================================================
# Encode (V1: modify existing field values and re-encode)
# ============================================================

def _val_to_json(val):
    """Convert pycrate value to JSON-serializable format, preserving structure."""
    if isinstance(val, dict):
        return {"_type": "dict", "_items": {k: _val_to_json(v) for k, v in val.items()}}
    elif isinstance(val, tuple) and len(val) == 2 and isinstance(val[0], str):
        return {"_type": "choice", "_name": val[0], "_value": _val_to_json(val[1])}
    elif _is_bitstring_value(val):
        return {"_type": "bitstring", "_uint": val[0], "_bits": val[1]}
    elif isinstance(val, (list, tuple)):
        return {"_type": "list", "_items": [_val_to_json(v) for v in val]}
    elif isinstance(val, bytes):
        return {"_type": "bytes", "_hex": val.hex().upper()}
    elif isinstance(val, bool):
        return {"_type": "bool", "_val": val}
    elif isinstance(val, int):
        return {"_type": "int", "_val": val}
    elif isinstance(val, str):
        return {"_type": "str", "_val": val}
    elif val is None:
        return {"_type": "null"}
    else:
        return {"_type": "str", "_val": str(val)}


def _json_to_val(j):
    """Convert JSON-serialized value back to pycrate-compatible Python value."""
    if not isinstance(j, dict) or "_type" not in j:
        return j
    t = j["_type"]
    if t == "dict":
        return {k: _json_to_val(v) for k, v in j["_items"].items()}
    elif t == "choice":
        return (j["_name"], _json_to_val(j["_value"]))
    elif t == "bitstring":
        return (j["_uint"], j["_bits"])
    elif t == "list":
        return [_json_to_val(v) for v in j["_items"]]
    elif t == "bytes":
        return bytes.fromhex(j["_hex"])
    elif t == "bool":
        return j["_val"]
    elif t == "int":
        return j["_val"]
    elif t == "str":
        return j["_val"]
    elif t == "null":
        return None
    else:
        return j.get("_val")


def _to_c_array(raw):
    """Convert bytes to C array string like {0x7E, 0x00, 0x5B, 0x01}."""
    return "{" + ", ".join(f"0x{b:02X}" for b in raw) + "}"


def _nas_elem_to_rawval(elem):
    """Serialize NAS element tree to JSON-compatible rawVal for encode round-trip.

    Uses the same dict/leaf format as RRC rawVal so the existing updateRawVal
    navigation in the webview works without modification.
    """
    items = {}
    for e in elem._content:
        if hasattr(e, '_content') and e._content:
            items[e._name] = _nas_elem_to_rawval(e)
        elif hasattr(e, 'get_val'):
            val = e.get_val()
            if val is not None:
                items[e._name] = _val_to_json(val)
    return {"_type": "dict", "_items": items}


def _apply_nas_rawval(elem, rawval_json):
    """Apply modified values from rawVal JSON back to a parsed NAS element tree."""
    if rawval_json.get("_type") != "dict":
        return
    items = rawval_json.get("_items", {})
    for e in elem._content:
        name = getattr(e, '_name', None)
        if name and name in items:
            child_json = items[name]
            if child_json.get("_type") == "dict" and hasattr(e, '_content') and e._content:
                _apply_nas_rawval(e, child_json)
            elif hasattr(e, 'set_val'):
                val = _json_to_val(child_json)
                try:
                    e.set_val(val)
                except Exception:
                    pass  # Skip values that can't be set directly


def encode_nas(raw_val_json):
    """Encode a NAS message from modified value structure.

    Re-parses the original hex, applies modifications, and re-encodes.
    """
    original_hex = raw_val_json.get("_original_hex", "")
    if not original_hex:
        return {"error": "No original NAS data for re-encoding"}

    raw = bytes.fromhex(original_hex)
    msg, err = parse_NAS5G(raw)
    if err:
        return {"error": f"Failed to re-parse original NAS message: {err}"}

    _apply_nas_rawval(msg, raw_val_json)

    encoded = msg.to_bytes()
    hex_str = encoded.hex().upper()

    return {
        "hex": hex_str,
        "cArray": _to_c_array(encoded),
        "length": len(encoded),
    }


def encode_rrc(msg_type, raw_val_json):
    """Encode an RRC message from modified value structure."""
    if msg_type not in RRC_MESSAGE_TYPES:
        return {"error": f"Unknown RRC message type: {msg_type}"}

    asn1_obj = RRC_MESSAGE_TYPES[msg_type]
    val = _json_to_val(raw_val_json)
    asn1_obj.set_val(val)
    raw = asn1_obj.to_uper()
    hex_str = raw.hex().upper()

    return {
        "hex": hex_str,
        "cArray": _to_c_array(raw),
        "length": len(raw),
    }


def encode(msg_type, raw_val_json):
    """Encode a message from modified value structure."""
    try:
        if msg_type in RRC_MESSAGE_TYPES:
            return encode_rrc(msg_type, raw_val_json)
        elif msg_type == NAS_MSG_TYPE:
            return encode_nas(raw_val_json)
        else:
            return {"error": f"Encode not supported for: {msg_type}"}
    except Exception as e:
        return {"error": f"Encode failed: {e}"}


# ============================================================
# NAS Security (encrypt / decrypt)
# ============================================================

def _swap_key_endian(key_bytes):
    """Swap byte order within each 4-byte word of a 16-byte key.

    On little-endian systems (x86), a key stored as uint32_t[4] has bytes
    reversed within each word compared to the big-endian byte string that
    standard crypto libraries expect. This function performs that conversion.
    """
    words = struct.unpack('<4I', key_bytes)
    return struct.pack('>4I', *words)


def _parse_security_params(input_data):
    """Parse and validate security parameters from input JSON."""
    nea_algorithm = input_data.get("neaAlgorithm", "NEA2")
    nia_algorithm = input_data.get("niaAlgorithm", "NIA2")
    key_byte_order = input_data.get("keyByteOrder", "big")

    # Parse KNASenc (not required for NEA0)
    knasenc = None
    if nea_algorithm != "NEA0":
        try:
            knasenc = bytes.fromhex(input_data.get("knasenc", "").replace(" ", ""))
        except ValueError as e:
            return None, {"error": f"Invalid KNASenc hex: {e}"}
        if len(knasenc) != 16:
            return None, {"error": f"KNASenc must be 16 bytes, got {len(knasenc)}"}
        if key_byte_order == "little":
            knasenc = _swap_key_endian(knasenc)

    # Parse KNASint (not required for NIA0)
    knasint = None
    if nia_algorithm != "NIA0":
        try:
            knasint = bytes.fromhex(input_data.get("knasint", "").replace(" ", ""))
        except ValueError as e:
            return None, {"error": f"Invalid KNASint hex: {e}"}
        if len(knasint) != 16:
            return None, {"error": f"KNASint must be 16 bytes, got {len(knasint)}"}
        if key_byte_order == "little":
            knasint = _swap_key_endian(knasint)

    count = input_data.get("count", 0)
    if isinstance(count, str):
        count = int(count, 0)  # supports 0x prefix
    bearer = input_data.get("bearer", 1)
    direction = input_data.get("direction", 0)
    new_security_context = bool(input_data.get("newSecurityContext", False))

    return {
        "knasenc": knasenc,
        "knasint": knasint,
        "count": count,
        "bearer": bearer,
        "direction": direction,
        "neaAlgorithm": nea_algorithm,
        "niaAlgorithm": nia_algorithm,
        "newSecurityContext": new_security_context,
    }, None


def handle_nas_encrypt(input_data):
    """Handle NAS encryption request."""
    params, err = _parse_security_params(input_data)
    if err:
        return err

    hex_data = input_data.get("hexData", "").replace(" ", "").replace("0x", "")
    if not hex_data:
        return {"error": "No plaintext NAS hex data provided"}

    try:
        plaintext = bytes.fromhex(hex_data)
    except ValueError as e:
        return {"error": f"Invalid hex data: {e}"}

    result = nas_encrypt(
        params["knasenc"], params["knasint"],
        params["count"], params["bearer"], params["direction"],
        params["neaAlgorithm"], params["niaAlgorithm"], plaintext,
        new_security_context=params["newSecurityContext"],
    )

    if "error" not in result:
        result["cArray"] = _to_c_array(bytes.fromhex(result["assembled"]))

    return result


def handle_nas_decrypt(input_data):
    """Handle NAS decryption request."""
    params, err = _parse_security_params(input_data)
    if err:
        return err

    hex_data = input_data.get("hexData", "").replace(" ", "").replace("0x", "")
    if not hex_data:
        return {"error": "No encrypted NAS hex data provided"}

    try:
        protected_msg = bytes.fromhex(hex_data)
    except ValueError as e:
        return {"error": f"Invalid hex data: {e}"}

    result = nas_decrypt(
        params["knasenc"], params["knasint"],
        params["count"], params["bearer"], params["direction"],
        params["neaAlgorithm"], params["niaAlgorithm"], protected_msg
    )

    if "error" not in result:
        # Also decode the decrypted plaintext
        try:
            plaintext_bytes = bytes.fromhex(result["plaintext"])
            decode_result = decode_nas(plaintext_bytes)
            if "error" not in decode_result:
                result["decodedTree"] = decode_result.get("tree")
                result["decodedText"] = decode_result.get("asn1Text")
                result["rawVal"] = decode_result.get("rawVal")
        except Exception:
            pass  # Decoding failure is non-fatal

    return result


# ============================================================
# Main entry point
# ============================================================

def main():
    try:
        input_data = json.loads(sys.stdin.read())
        command = input_data.get("command", "decode")
        msg_type = input_data.get("msgType", "")

        if command == "decode":
            hex_data = input_data.get("hexData", "")
            if not msg_type:
                result = {
                    "error": "No message type specified",
                    "available": list(RRC_MESSAGE_TYPES.keys()) + [NAS_MSG_TYPE],
                }
            elif not hex_data:
                result = {"error": "No hex data provided"}
            else:
                result = decode(msg_type, hex_data)

        elif command == "encode":
            raw_val = input_data.get("rawVal")
            if not msg_type:
                result = {"error": "No message type specified"}
            elif raw_val is None:
                result = {"error": "No value data provided"}
            else:
                result = encode(msg_type, raw_val)

        elif command == "nas_encrypt":
            result = handle_nas_encrypt(input_data)

        elif command == "nas_decrypt":
            result = handle_nas_decrypt(input_data)

        else:
            result = {"error": f"Unknown command: {command}"}

        print(json.dumps(result, ensure_ascii=False))
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON input"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
