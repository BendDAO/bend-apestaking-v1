// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

interface ILendPool {
    function borrow(
        address reserveAsset,
        uint256 amount,
        address nftAsset,
        uint256 nftTokenId,
        address onBehalfOf,
        uint16 referralCode
    ) external;
}
