// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LemoTitle
/// @notice Compact title record for the EVM face: the accepted native revision, the backing that
///         caps the representation, and whether the representation may move. Revisions only rise.
///         Sized deliberately small because Portaldot charges a storage deposit per code byte.
contract LemoTitle {
    struct Title {
        bytes32 asset;
        uint128 backing;
        uint64 revision;
        bytes32 digest;
        bool eligible;
    }

    address public immutable governor;
    mapping(bytes32 => Title) public titles;

    event Settled(bytes32 indexed id, uint64 revision, bytes32 digest, bool eligible);

    error NotGovernor();

    constructor() {
        governor = msg.sender;
    }

    /// Registers a title, or moves an existing one to a newer revision. Never backwards.
    function set(bytes32 id, bytes32 asset, uint128 backing, uint64 revision, bytes32 digest, bool eligible) external {
        if (msg.sender != governor) revert NotGovernor();

        Title storage record = titles[id];
        require(revision >= record.revision, "stale");

        if (record.asset == bytes32(0)) {
            titles[id] = Title(asset, backing, revision, digest, eligible);
        } else {
            if (backing != record.backing) titles[id].backing = backing;
            if (revision > record.revision) {
                titles[id].revision = revision;
                titles[id].digest = digest;
            }
            titles[id].eligible = eligible;
        }

        emit Settled(id, revision, digest, eligible);
    }

    /// The gate the representation token asks before every transfer.
    function eligible(bytes32 id) external view returns (bool) {
        return titles[id].eligible;
    }
}
