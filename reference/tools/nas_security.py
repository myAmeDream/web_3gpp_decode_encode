"""
3GPP NAS Security: NEA/NIA implementation.

Supports:
  - NEA0/NIA0 (Null - no encryption/integrity)
  - NEA1/NIA1 (Snow 3G) via CryptoMobile
  - NEA2/NIA2 (AES) via pycryptodome (fallback) or CryptoMobile
  - NEA3/NIA3 (ZUC) via CryptoMobile

References:
  - TS 33.501 Section 6.7 (5G NAS security)
  - TS 33.401 Annex B (EEA/EIA algorithms)
"""

import struct

# Try CryptoMobile first (supports all algorithms)
_has_cryptomobile = False
try:
    from CryptoMobile.CM import EEA1, EIA1, EEA2, EIA2, EEA3, EIA3
    _has_cryptomobile = True
except ImportError:
    pass

# Fallback: pycryptodome for NEA2/NIA2 only
_has_pycryptodome = False
try:
    from Crypto.Cipher import AES
    from Crypto.Hash import CMAC
    _has_pycryptodome = True
except ImportError:
    pass


SUPPORTED_NEA = ["NEA0", "NEA1", "NEA2", "NEA3"]
SUPPORTED_NIA = ["NIA0", "NIA1", "NIA2", "NIA3"]


# ============================================================
# NEA2/NIA2 (AES) - pycryptodome fallback
# ============================================================

def _build_ctr_iv(count, bearer, direction):
    upper = (bearer << 27) | (direction << 26)
    iv = struct.pack('>II', count, upper) + b'\x00' * 8
    return iv


def _nea2_pycryptodome(key, count, bearer, direction, data):
    """NEA2 via pycryptodome AES-CTR."""
    iv = _build_ctr_iv(count, bearer, direction)
    ctr_nonce = iv[:8]
    ctr_initial = int.from_bytes(iv[8:], 'big')
    cipher = AES.new(key, AES.MODE_CTR, nonce=ctr_nonce, initial_value=ctr_initial)
    return cipher.encrypt(data)


def _nia2_pycryptodome(key, count, bearer, direction, message):
    """NIA2 via pycryptodome AES-CMAC."""
    upper = (bearer << 27) | (direction << 26)
    header = struct.pack('>II', count, upper)
    cmac_input = header + message
    mac_obj = CMAC.new(key, ciphermod=AES)
    mac_obj.update(cmac_input)
    return mac_obj.digest()[:4]


# ============================================================
# Unified encrypt/decrypt using best available backend
# ============================================================

def _nea_encrypt(algorithm, key, count, bearer, direction, data):
    """Encrypt data using the specified NEA algorithm."""

    if algorithm == "NEA0":
        return data  # Null encryption - passthrough

    elif algorithm == "NEA1":
        if not _has_cryptomobile:
            raise RuntimeError("NEA1 (Snow3G) requires CryptoMobile. Install: pip install git+https://github.com/P1sec/CryptoMobile.git")
        return EEA1(key, count, bearer, direction, data)

    elif algorithm == "NEA2":
        if _has_cryptomobile:
            return EEA2(key, count, bearer, direction, data)
        elif _has_pycryptodome:
            return _nea2_pycryptodome(key, count, bearer, direction, data)
        else:
            raise RuntimeError("NEA2 requires CryptoMobile or pycryptodome")

    elif algorithm == "NEA3":
        if not _has_cryptomobile:
            raise RuntimeError("NEA3 (ZUC) requires CryptoMobile. Install: pip install git+https://github.com/P1sec/CryptoMobile.git")
        return EEA3(key, count, bearer, direction, data)

    else:
        raise ValueError(f"Unknown NEA algorithm: {algorithm}")


def _nea_decrypt(algorithm, key, count, bearer, direction, data):
    """Decrypt data. For stream ciphers, same as encrypt."""
    return _nea_encrypt(algorithm, key, count, bearer, direction, data)


def _nia_mac(algorithm, key, count, bearer, direction, message):
    """Compute 4-byte MAC using the specified NIA algorithm."""

    if algorithm == "NIA0":
        return b'\x00\x00\x00\x00'  # Null integrity - zero MAC

    elif algorithm == "NIA1":
        if not _has_cryptomobile:
            raise RuntimeError("NIA1 (Snow3G) requires CryptoMobile")
        return EIA1(key, count, bearer, direction, message)

    elif algorithm == "NIA2":
        if _has_cryptomobile:
            return EIA2(key, count, bearer, direction, message)
        elif _has_pycryptodome:
            return _nia2_pycryptodome(key, count, bearer, direction, message)
        else:
            raise RuntimeError("NIA2 requires CryptoMobile or pycryptodome")

    elif algorithm == "NIA3":
        if not _has_cryptomobile:
            raise RuntimeError("NIA3 (ZUC) requires CryptoMobile")
        return EIA3(key, count, bearer, direction, message)

    else:
        raise ValueError(f"Unknown NIA algorithm: {algorithm}")


# ============================================================
# Public API
# ============================================================

def get_available_algorithms():
    """Return dict of available NEA and NIA algorithms based on installed libraries."""
    nea = ["NEA0"]
    nia = ["NIA0"]
    if _has_cryptomobile:
        nea.extend(["NEA1", "NEA2", "NEA3"])
        nia.extend(["NIA1", "NIA2", "NIA3"])
    elif _has_pycryptodome:
        nea.append("NEA2")
        nia.append("NIA2")
    return {"nea": nea, "nia": nia}


def nas_encrypt(knasenc, knasint, count, bearer, direction, nea_algorithm, nia_algorithm, plaintext_nas,
                new_security_context=False):
    """
    Full NAS encryption: encrypt plaintext + compute MAC + assemble message.

    Args:
        knasenc: 16 bytes encryption key (can be None if NEA0)
        knasint: 16 bytes integrity key (can be None if NIA0)
        count: 32-bit NAS COUNT
        bearer: 5-bit bearer
        direction: 0=UL, 1=DL
        nea_algorithm: "NEA0", "NEA1", "NEA2", or "NEA3"
        nia_algorithm: "NIA0", "NIA1", "NIA2", or "NIA3"
        plaintext_nas: full plaintext NAS message bytes
        new_security_context: if True, use security header types 0x03/0x04
            (used for messages establishing a new 5G NAS security context,
            e.g. Security Mode Complete)

    Returns:
        dict with assembled encrypted message, or error
    """
    available = get_available_algorithms()
    if nea_algorithm not in available["nea"]:
        return {"error": f"Algorithm {nea_algorithm} not available. Install CryptoMobile for NEA1/NEA3."}
    if nia_algorithm not in available["nia"]:
        return {"error": f"Algorithm {nia_algorithm} not available. Install CryptoMobile for NIA1/NIA3."}

    sqn = count & 0xFF

    # Step 1: Encrypt
    ciphertext = _nea_encrypt(nea_algorithm, knasenc, count, bearer, direction, plaintext_nas)

    # Step 2: Compute MAC over (SQN + ciphertext)
    mac_input = bytes([sqn]) + ciphertext
    mac = _nia_mac(nia_algorithm, knasint, count, bearer, direction, mac_input)

    # Step 3: Determine security header type (TS 24.501 Table 9.3.1)
    if nea_algorithm == "NEA0" and nia_algorithm == "NIA0":
        sec_hdr = 0x00  # Plain NAS message
    elif nea_algorithm == "NEA0":
        # Integrity protected only (0x01), or with new 5G NAS security context (0x03)
        sec_hdr = 0x03 if new_security_context else 0x01
    else:
        # Integrity protected and ciphered (0x02), or with new 5G NAS security context (0x04)
        sec_hdr = 0x04 if new_security_context else 0x02

    # Step 4: Assemble
    assembled = bytes([0x7E, sec_hdr]) + mac + bytes([sqn]) + ciphertext

    return {
        "assembled": assembled.hex().upper(),
        "ciphertext": ciphertext.hex().upper(),
        "mac": mac.hex().upper(),
        "sqn": f"{sqn} (0x{sqn:02X})",
        "length": len(assembled),
        "neaAlgorithm": nea_algorithm,
        "niaAlgorithm": nia_algorithm,
    }


def nas_decrypt(knasenc, knasint, count, bearer, direction, nea_algorithm, nia_algorithm, protected_msg):
    """
    Full NAS decryption: verify MAC + decrypt ciphertext.

    Args:
        knasenc: 16 bytes encryption key (can be None if NEA0)
        knasint: 16 bytes integrity key (can be None if NIA0)
        count: 32-bit NAS COUNT
        bearer: 5-bit bearer
        direction: 0=UL, 1=DL
        nea_algorithm: "NEA0", "NEA1", "NEA2", or "NEA3"
        nia_algorithm: "NIA0", "NIA1", "NIA2", or "NIA3"
        protected_msg: full Security Protected NAS message bytes

    Returns:
        dict with decrypted plaintext, MAC verification result, or error
    """
    available = get_available_algorithms()
    if nea_algorithm not in available["nea"]:
        return {"error": f"Algorithm {nea_algorithm} not available. Install CryptoMobile for NEA1/NEA3."}
    if nia_algorithm not in available["nia"]:
        return {"error": f"Algorithm {nia_algorithm} not available. Install CryptoMobile for NIA1/NIA3."}

    if len(protected_msg) < 8:
        return {"error": "Message too short for Security Protected NAS Message"}

    # Parse
    epd = protected_msg[0]
    sec_hdr = protected_msg[1]
    mac_received = protected_msg[2:6]
    sqn = protected_msg[6]
    ciphertext = protected_msg[7:]

    if epd != 0x7E:
        return {"error": f"Invalid EPD: 0x{epd:02X}, expected 0x7E (5GMM)"}

    if sec_hdr not in (0x01, 0x02, 0x03, 0x04):
        return {"error": f"Invalid Security Header Type: 0x{sec_hdr:02X}"}

    # Step 1: Verify MAC
    mac_input = bytes([sqn]) + ciphertext
    mac_computed = _nia_mac(nia_algorithm, knasint, count, bearer, direction, mac_input)
    mac_ok = (mac_received == mac_computed)

    # Step 2: Decrypt
    if sec_hdr in (0x02, 0x04):
        plaintext = _nea_decrypt(nea_algorithm, knasenc, count, bearer, direction, ciphertext)
    else:
        plaintext = ciphertext

    return {
        "plaintext": plaintext.hex().upper(),
        "macReceived": mac_received.hex().upper(),
        "macComputed": mac_computed.hex().upper(),
        "macOk": mac_ok,
        "secHdrType": sec_hdr,
        "sqn": f"{sqn} (0x{sqn:02X})",
        "neaAlgorithm": nea_algorithm,
        "niaAlgorithm": nia_algorithm,
    }
