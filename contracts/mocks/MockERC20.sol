// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only ERC-20 with a configurable decimals value.
/// @dev Decimals are a constructor argument because the splitter's stablecoin
///      path must behave identically on 6-decimal USDC and the 18-decimal USDC
///      deployed on BNB Chain. A mock fixed at 18 would hide that.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
