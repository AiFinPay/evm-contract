// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only stablecoin with configurable decimals, so the payStable
///         path can be exercised against both 6-decimal (USDC/USDT-like) and
///         18-decimal tokens. Never deployed.
contract MockStable is ERC20 {
    uint8 private immutable DECIMALS;

    constructor(string memory _name, uint8 _decimals) ERC20(_name, _name) {
        DECIMALS = _decimals;
    }

    function decimals() public view override returns (uint8) {
        return DECIMALS;
    }

    function mint(address _to, uint256 _amount) external {
        _mint(_to, _amount);
    }
}
