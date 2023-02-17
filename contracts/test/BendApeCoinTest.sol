// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

import {BendApeCoin} from "../BendApeCoin.sol";

contract BendApeCoinTest is BendApeCoin {
    function depositTest(uint256 assets, address receiver) public returns (uint256) {
        require(assets <= maxDeposit(receiver), "ERC4626: deposit more than max");

        uint256 shares = previewDeposit(assets);
        _deposit(_msgSender(), receiver, assets, shares);

        return shares;
    }

    function mintTest(uint256 shares, address receiver) public returns (uint256) {
        require(shares <= maxMint(receiver), "ERC4626: mint more than max");

        uint256 assets = previewMint(shares);
        _deposit(_msgSender(), receiver, assets, shares);

        return assets;
    }
}
