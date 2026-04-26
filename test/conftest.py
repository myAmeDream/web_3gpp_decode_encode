import pytest


def find_first_node(node: dict, name: str) -> dict | None:
    if node.get("name") == name:
        return node

    for child in node.get("children", []):
        found = find_first_node(child, name)
        if found is not None:
            return found

    return None