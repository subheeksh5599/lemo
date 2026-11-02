// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LemoTitleRegistry
/// @notice The EVM-side record of which native title revision has been accepted, and whether
///         that title currently permits its representation to move. Revisions only move forward.
///         The contract does not verify Substrate proofs itself: it records the digest of a
///         package that a verifier checked against a finalized state root, so any observer can
///         re-run that check against the digest.
contract LemoTitleRegistry {
    struct Title {
        bytes32 nativeAsset;
        uint256 backing;
        uint64 revision;
        bytes32 proofDigest;
        address attester;
        uint64 updatedBlock;
        bool eligible;
    }

    address public immutable governor;
    mapping(bytes32 => Title) private records;
    mapping(bytes32 => bool) private known;

    event TitleRegistered(bytes32 indexed titleId, bytes32 nativeAsset, uint256 backing, uint64 revision);
    event RevisionAccepted(bytes32 indexed titleId, uint64 revision, bytes32 proofDigest, bool eligible);
    event EligibilitySet(bytes32 indexed titleId, bool eligible, string reason);

    error NotGovernor();
    error TitleExists();
    error UnknownTitle();
    error ZeroBacking();
    error RevisionNotNewer(uint64 current, uint64 offered);
    error EmptyDigest();

    modifier onlyGovernor() {
        if (msg.sender != governor) revert NotGovernor();
        _;
    }

    constructor() {
        governor = msg.sender;
    }

    function registerTitle(
        bytes32 titleId,
        bytes32 nativeAsset,
        uint256 backing,
        uint64 revision,
        bytes32 proofDigest
    ) external onlyGovernor {
        if (known[titleId]) revert TitleExists();
        if (backing == 0) revert ZeroBacking();
        if (proofDigest == bytes32(0)) revert EmptyDigest();

        records[titleId] = Title({
            nativeAsset: nativeAsset,
            backing: backing,
            revision: revision,
            proofDigest: proofDigest,
            attester: msg.sender,
            updatedBlock: uint64(block.number),
            eligible: true
        });
        known[titleId] = true;

        emit TitleRegistered(titleId, nativeAsset, backing, revision);
        emit RevisionAccepted(titleId, revision, proofDigest, true);
    }

    function acceptRevision(bytes32 titleId, uint64 revision, bytes32 proofDigest, bool eligible) external onlyGovernor {
        if (!known[titleId]) revert UnknownTitle();

        Title storage record = records[titleId];
        if (revision <= record.revision) revert RevisionNotNewer(record.revision, revision);
        if (proofDigest == bytes32(0)) revert EmptyDigest();

        record.revision = revision;
        record.proofDigest = proofDigest;
        record.attester = msg.sender;
        record.updatedBlock = uint64(block.number);
        record.eligible = eligible;

        emit RevisionAccepted(titleId, revision, proofDigest, eligible);
    }

    function setEligibility(bytes32 titleId, bool eligible, string calldata reason) external onlyGovernor {
        if (!known[titleId]) revert UnknownTitle();
        records[titleId].eligible = eligible;
        emit EligibilitySet(titleId, eligible, reason);
    }

    function isEligible(bytes32 titleId) external view returns (bool) {
        return known[titleId] && records[titleId].eligible;
    }

    function titleState(bytes32 titleId)
        external
        view
        returns (bytes32 nativeAsset, uint256 backing, uint64 revision, bytes32 proofDigest, address attester, uint64 updatedBlock, bool eligible)
    {
        if (!known[titleId]) revert UnknownTitle();
        Title memory record = records[titleId];
        return (record.nativeAsset, record.backing, record.revision, record.proofDigest, record.attester, record.updatedBlock, record.eligible);
    }
}
