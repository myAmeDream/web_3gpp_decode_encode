from backend.app.services.protocol_runner import run_protocol_command

from conftest import find_first_node

SIB1_SAMPLE_HEX = "6CC0101A3800806003005800C012003003240153A81204758A3800C012003005800C012003003240153A81204758A3800C012003005800C012003003240153A81204758A3800C012003005800C012003003240153A8120475880481005608435494004264269491827A2500815F9801E99644C3B8A54D95A5A03A71803C0C3618A5AD0E403058E0580C7D5861DC6001B808CFEECB37AF19D425C91AF874EC4415C136A4000003021000906020924924924924924924924924924924924924924924924CE08043064445108"

def test_decode_keeps_tracking_area_code_and_cell_identity_as_scalar_bitstrings() -> None:
    result = run_protocol_command(
        {
            "command": "decode",
            "msgType": "BCCH-DL-SCH-Message",
            "hexData": SIB1_SAMPLE_HEX,
        }
    )

    assert "error" not in result

    tracking_area_code = find_first_node(result["tree"], "trackingAreaCode")
    cell_identity = find_first_node(result["tree"], "cellIdentity")

    assert tracking_area_code == {"name": "trackingAreaCode", "value": "'240153'H", "children": []}
    assert cell_identity == {"name": "cellIdentity", "value": "'A81204758'H", "children": []}

    first_plmn_identity = result["rawVal"]["_items"]["message"]["_value"]["_value"]["_items"]["cellAccessRelatedInfo"]["_items"]["plmn-IdentityInfoList"]["_items"][0]["_items"]

    assert first_plmn_identity["trackingAreaCode"] == {"_type": "bitstring", "_uint": 2359635, "_bits": 24}
    assert first_plmn_identity["cellIdentity"] == {"_type": "bitstring", "_uint": 45116049240, "_bits": 36}


def test_decode_then_encode_round_trip_preserves_original_hex() -> None:
    decode_result = run_protocol_command(
        {
            "command": "decode",
            "msgType": "BCCH-DL-SCH-Message",
            "hexData": SIB1_SAMPLE_HEX,
        }
    )

    assert "error" not in decode_result

    encode_result = run_protocol_command(
        {
            "command": "encode",
            "msgType": "BCCH-DL-SCH-Message",
            "rawVal": decode_result["rawVal"],
        }
    )

    assert "error" not in encode_result
    assert encode_result["hex"] == SIB1_SAMPLE_HEX