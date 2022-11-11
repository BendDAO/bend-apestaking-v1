// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

interface IDebtToken is IERC20Upgradeable {
    function approveDelegation(address delegatee, uint256 amount) external;
}
