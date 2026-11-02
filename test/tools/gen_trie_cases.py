#!/usr/bin/env python3
"""Generate test/fixtures/trie-cases.json.

Each case is a small, hand-assembled sp-trie: the nodes are encoded exactly the
way parity-scale-codec's NodeHeader writes them (header, partial, optional value,
bitmap, children in ascending nibble order), the root is blake2b-256 of the root
node, and the proof set is what a node would return.

The point is coverage of the node kinds that a live Portaldot proof does not
exercise today: inline children, a branch that carries a value, an odd partial
count with its front padding nibble, the continuation form of a 6 bit count, a
hashed leaf whose value is a separate node, and the empty trie.

Run from the repository root:  python3 test/tools/gen_trie_cases.py
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "fixtures" / "trie-cases.json"


def blake2b256(data: bytes) -> bytes:
    return hashlib.blake2b(data, digest_size=32).digest()


def compact(value: int) -> bytes:
    if value < 0x40:
        return bytes([value << 2])
    if value < 0x4000:
        return ((value << 2) | 0b01).to_bytes(2, "little")
    return ((value << 2) | 0b10).to_bytes(4, "little")


def partial_bytes(nibbles: str) -> bytes:
    """Pack partial key nibbles, front padded with a zero nibble when odd."""
    if len(nibbles) % 2 == 1:
        nibbles = "0" + nibbles
    return bytes.fromhex(nibbles)


def nibble_count(count: int, width: int) -> tuple[int, bytes]:
    """Return (low bits of the header, continuation bytes).

    The decoder reads max - 1, adds 255 per 0xff byte, then adds the final byte
    plus one, so the encoder is its exact inverse.
    """
    max_value = 0xFF >> (8 - width)
    if count < max_value:
        return count, b""
    r = max_value - 1
    extra = b""
    while count - (r + 1) > 255:
        r += 255
        extra += b"\xff"
    return max_value, extra + bytes([count - (r + 1)])


def leaf(partial: str, value: bytes, hashed: bool) -> bytes:
    """Leaf node. `hashed` writes the value's own node instead of the value."""
    count = len(partial)
    if hashed:
        width = 5
        low, extra = nibble_count(count, width)
        header = bytes([0x20 | low])
        return header + extra + partial_bytes(partial) + blake2b256(value)
    width = 6
    low, extra = nibble_count(count, width)
    header = bytes([0x40 | low])
    return header + extra + partial_bytes(partial) + compact(len(value)) + value


def branch(partial: str, value: bytes | None, children: list[tuple[int, bytes, bool]]) -> bytes:
    """Branch node: header, partial, bitmap, value, children ascending.

    `children` is (nibble, node bytes, is_hash_ref) in ascending nibble order.
    """
    count = len(partial)
    width = 6
    low, extra = nibble_count(count, width)
    header = bytes([(0xC0 if value is not None else 0x80) | low])
    bitmap = 0
    for nibble, _, _ in children:
        bitmap |= 1 << nibble
    out = header + extra + partial_bytes(partial) + bitmap.to_bytes(2, "little")
    if value is not None:
        out += compact(len(value)) + value
    for _, node, as_hash in children:
        ref = blake2b256(node) if as_hash else node
        out += compact(len(ref)) + ref
    return out


def case(name: str, key: bytes, root: bytes, nodes: list[bytes], expect: str, note: str) -> dict:
    return {
        "name": name,
        "note": note,
        "key": "0x" + key.hex(),
        "root": "0x" + root.hex(),
        "nodes": ["0x" + n.hex() for n in nodes],
        "expect": expect,
    }


def main() -> None:
    cases = []

    # A. Root branch, partial "12", two children: an inline leaf under nibble 3
    #    and a hash referenced leaf under nibble 5. Exercises inline vs hash refs
    #    and the ascending order (nibble 3 comes before nibble 5).
    leaf3 = leaf("4", bytes.fromhex("beefbeef"), hashed=False)
    long_value = bytes(range(40))
    leaf5 = leaf("6", long_value, hashed=False)
    assert len(leaf3) < 32, len(leaf3)
    assert len(leaf5) >= 32, len(leaf5)
    root = branch("12", None, [(3, leaf3, False), (5, leaf5, True)])
    cases.append(
        case(
            "inline-and-hashed-children",
            bytes.fromhex("bedfaced"),
            blake2b256(root),
            [root, leaf5],
            "ABSENT",
            "the key 0xbedfaced is not in this trie; the walk diverges on the committed root partial",
        )
    )
    cases.append(
        case(
            "inline-leaf-present",
            bytes.fromhex("1234"),
            blake2b256(root),
            [root],
            "0xbeefbeef",
            "root branch, inline leaf child under nibble 3, value inline in that leaf",
        )
    )
    cases.append(
        case(
            "hashed-leaf-present",
            bytes.fromhex("1256"),
            blake2b256(root),
            [root, leaf5],
            "0x" + long_value.hex(),
            "root branch, 32 byte hash reference, leaf value inline in its own node",
        )
    )
    cases.append(
        case(
            "hash-child-missing",
            bytes.fromhex("1256"),
            blake2b256(root),
            [root],
            "INCOMPLETE",
            "the leaf node the hash reference names is not in the proof set",
        )
    )

    # B. A branch that carries a value, for keys where one is a prefix of the
    #    other. The value must be read before the children, so a decoder that
    #    reads children first returns the wrong bytes for key 0x12.
    leaf_34 = leaf("4", bytes.fromhex("bb"), hashed=False)
    b2 = branch("", bytes.fromhex("aa"), [(3, leaf_34, False)])
    b1 = branch("", None, [(2, b2, False)])
    root_b = branch("", None, [(1, b1, False)])
    cases.append(
        case(
            "branch-with-value",
            bytes.fromhex("12"),
            blake2b256(root_b),
            [root_b, b1, b2],
            "0xaa",
            "key ends exactly at the branch, which carries the value before its children",
        )
    )
    cases.append(
        case(
            "branch-with-value-descend",
            bytes.fromhex("1234"),
            blake2b256(root_b),
            [root_b, b1, b2],
            "0xbb",
            "same branch, key continues past the carried value",
        )
    )

    # C. Odd partial counts: front padding nibble, and a count of 3.
    leaf_ab1 = leaf("", bytes.fromhex("01"), hashed=False)
    leaf_ab2 = leaf("", bytes.fromhex("02"), hashed=False)
    root_c = branch("0ab", None, [(1, leaf_ab1, False), (2, leaf_ab2, False)])
    cases.append(
        case(
            "odd-partial-three",
            bytes.fromhex("0ab1"),
            blake2b256(root_c),
            [root_c],
            "0x01",
            "root partial count 3 packed as [pad|0][a][b]; both children are zero length partial leaves",
        )
    )

    # D. Continuation form of the 6 bit count: a 32 byte key is 64 nibbles,
    #    which does not fit in 6 bits, so the header is 0x7f and one byte follows.
    big_value = bytes(range(48))
    key_d = bytes.fromhex("00112233445566778899aabbccddeeff" * 2)
    assert len(key_d) == 32
    # A single leaf holding the whole 32 byte key: 64 partial nibbles, which is
    # more than the six bit field can hold.
    leaf_d = leaf(key_d.hex(), big_value, hashed=False)
    cases.append(
        case(
            "six-bit-count-continuation",
            key_d,
            blake2b256(leaf_d),
            [leaf_d],
            "0x" + big_value.hex(),
            "partial count 64 needs the continuation byte: header 0x7f then 0x01",
        )
    )

    # E. Hashed leaf: the value is its own node, referenced by hash.
    record = bytes(range(96))
    leaf_e = leaf("a1b2", record, hashed=True)
    cases.append(
        case(
            "hashed-leaf-value-node",
            bytes.fromhex("a1b2"),
            blake2b256(leaf_e),
            [leaf_e, record],
            "0x" + record.hex(),
            "leaf carries only the blake2b-256 of the separate value node",
        )
    )
    cases.append(
        case(
            "hashed-leaf-value-node-missing",
            bytes.fromhex("a1b2"),
            blake2b256(leaf_e),
            [leaf_e],
            "INCOMPLETE",
            "the value node is not in the proof set, which is not an absence",
        )
    )

    # F. Empty trie.
    cases.append(
        case(
            "empty-trie",
            bytes.fromhex("00ff"),
            blake2b256(bytes.fromhex("00")),
            [bytes.fromhex("00")],
            "ABSENT",
            "the empty node is a proof that the trie holds nothing",
        )
    )

    # Parallel arrays rather than an array of objects: forge's JSON reader is
    # reliable on flat arrays and a struct array of dynamic strings is not worth
    # the fragility in a test that must not silently skip a case.
    flat_nodes: list[str] = []
    counts: list[int] = []
    for c in cases:
        counts.append(len(c["nodes"]))
        flat_nodes.extend(c["nodes"])

    OUT.write_text(
        json.dumps(
            {
                "generator": "test/tools/gen_trie_cases.py",
                "note": "Synthetic sp-trie cases, encoded by hand in the generator. "
                "Roots are blake2b-256 of the root node. Cases are stored as parallel "
                "arrays; nodes is flattened and nodeCounts gives each case's slice.",
                "names": [c["name"] for c in cases],
                "notes": [c["note"] for c in cases],
                "keys": [c["key"] for c in cases],
                "roots": [c["root"] for c in cases],
                "expects": [c["expect"] for c in cases],
                "nodeCounts": counts,
                "nodes": flat_nodes,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"wrote {OUT} with {len(cases)} cases")


if __name__ == "__main__":
    main()
