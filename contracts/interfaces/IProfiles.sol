// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IProfiles
/// @notice Minimal surface of a route-profile registry used by a downstream
///         splitter. Admin-only writes, public reads.
interface IProfiles {
    struct RouteProfile {
        uint16 treasuryBps;
        uint16 ipCreatorBps;
        bool enabled;
        uint64 configuredAt;
        address routeTreasury;
    }

    /// @notice Configure a route profile. Creates a new route if it does not exist.
    function configureRoute(bytes32 _routeId, uint16 _treasuryBps, uint16 _ipCreatorBps, address _routeTreasury)
        external;

    /// @notice Disable an existing route.
    function disableRoute(bytes32 _routeId) external;

    /// @notice Re-enable an existing route.
    function enableRoute(bytes32 _routeId) external;

    /// @notice Read a route profile. Reverts if the route was never configured.
    function getProfile(bytes32 _routeId) external view returns (RouteProfile memory);

    /// @notice Returns true if the route exists and is enabled.
    function isEnabled(bytes32 _routeId) external view returns (bool);

    /// @notice Enumerable list of configured route IDs.
    function routeIds() external view returns (bytes32[] memory);

    /// @notice Helper: `keccak256(bytes(_name))` — canonical routeId for a route name.
    function routeId(string calldata _name) external pure returns (bytes32);
}
