// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IProfiles} from "./interfaces/IProfiles.sol";
import {
    TreasuryFeeTooHigh,
    IPCreatorFeeTooHigh,
    RouteAlreadyExists,
    RouteNotFound,
    UnknownRoute,
    ArrayLengthMismatch
} from "./errors/Errors.sol";

/// @title Profiles
/// @notice Standalone route-profile registry. Stores per-route economics and
///         enabled flag. Admin-only updates. The downstream splitter resolves
///         a route by ID before settlement.
contract Profiles is AccessControl, IProfiles {
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;

    uint16 public constant MAX_TREASURY_BPS = 500;
    uint16 public constant MAX_IP_CREATOR_BPS = 100;

    mapping(bytes32 => RouteProfile) private _profiles;
    bytes32[] private _routeIds;

    event RouteConfigured(
        bytes32 indexed routeId,
        uint16 treasuryBps,
        uint16 ipCreatorBps,
        address indexed routeTreasury
    );
    event RouteStatusChanged(bytes32 indexed routeId, bool indexed enabled);

    /// @param _admin Address that will hold `ADMIN_ROLE`.
    /// @param _initialRouteIds Ordered list of route identifiers.
    /// @param _treasuryBps Aligned treasury fee basis points.
    /// @param _ipCreatorBps Aligned IP creator fee basis points.
    constructor(
        address _admin,
        bytes32[] memory _initialRouteIds,
        uint16[] memory _treasuryBps,
        uint16[] memory _ipCreatorBps
    ) {
        _grantRole(ADMIN_ROLE, _admin);

        uint256 routeCount = _initialRouteIds.length;
        if (routeCount == 0) revert RouteNotFound(0);
        if (routeCount != _treasuryBps.length || routeCount != _ipCreatorBps.length) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < routeCount; i++) {
            bytes32 id = _initialRouteIds[i];
            uint16 tBps = _treasuryBps[i];
            uint16 iBps = _ipCreatorBps[i];
            if (_profiles[id].configuredAt != 0) revert RouteAlreadyExists(id);
            _validateBps(tBps, iBps);

            _profiles[id] = RouteProfile({
                treasuryBps: tBps,
                ipCreatorBps: iBps,
                enabled: true,
                configuredAt: uint64(block.timestamp),
                routeTreasury: address(0)
            });
            _routeIds.push(id);
            emit RouteConfigured(id, tBps, iBps, address(0));
        }
    }

    /// @notice Configure a route profile. Creates a new route if it does not exist.
    function configureRoute(
        bytes32 _routeId,
        uint16 _treasuryBps,
        uint16 _ipCreatorBps,
        address _routeTreasury
    ) external onlyRole(ADMIN_ROLE) {
        _validateBps(_treasuryBps, _ipCreatorBps);
        RouteProfile storage profile = _profiles[_routeId];
        if (profile.configuredAt == 0) {
            profile.enabled = true;
            profile.configuredAt = uint64(block.timestamp);
            _routeIds.push(_routeId);
        }
        profile.treasuryBps = _treasuryBps;
        profile.ipCreatorBps = _ipCreatorBps;
        profile.routeTreasury = _routeTreasury;
        emit RouteConfigured(_routeId, _treasuryBps, _ipCreatorBps, _routeTreasury);
    }

    /// @notice Disable an existing route.
    function disableRoute(bytes32 _routeId) external onlyRole(ADMIN_ROLE) {
        RouteProfile storage profile = _profiles[_routeId];
        if (profile.configuredAt == 0) revert UnknownRoute(_routeId);
        profile.enabled = false;
        emit RouteStatusChanged(_routeId, false);
    }

    /// @notice Re-enable an existing route.
    function enableRoute(bytes32 _routeId) external onlyRole(ADMIN_ROLE) {
        RouteProfile storage profile = _profiles[_routeId];
        if (profile.configuredAt == 0) revert UnknownRoute(_routeId);
        profile.enabled = true;
        emit RouteStatusChanged(_routeId, true);
    }

    /// @notice Read a route profile. Reverts if the route was never configured.
    function getProfile(bytes32 _routeId) external view returns (RouteProfile memory) {
        RouteProfile memory profile = _profiles[_routeId];
        if (profile.configuredAt == 0) revert UnknownRoute(_routeId);
        return profile;
    }

    /// @notice Returns true if the route exists and is enabled.
    function isEnabled(bytes32 _routeId) external view returns (bool) {
        RouteProfile memory profile = _profiles[_routeId];
        return profile.configuredAt != 0 && profile.enabled;
    }

    /// @notice Enumerable list of configured route IDs.
    function routeIds() external view returns (bytes32[] memory) {
        return _routeIds;
    }

    /// @notice Helper to compute a canonical routeId from a UTF-8 route name.
    ///         Matches the off-chain convention `keccak256(bytes(_name))`.
    function routeId(string calldata _name) external pure returns (bytes32) {
        return keccak256(bytes(_name));
    }

    function _validateBps(uint16 _treasuryBps, uint16 _ipCreatorBps) private pure {
        if (_treasuryBps > MAX_TREASURY_BPS) revert TreasuryFeeTooHigh();
        if (_ipCreatorBps > MAX_IP_CREATOR_BPS) revert IPCreatorFeeTooHigh();
    }
}
