// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

interface IBNFTBurnInterceptor {
    function beforeTokenBurn(address nftAsset, uint256 nftTokenId) external returns (bool);

    function afterTokenBurn(address nftAsset, uint256 nftTokenId) external returns (bool);
}
