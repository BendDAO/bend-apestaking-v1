// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

interface IBNFTRegistry {
    function getBNFTAddresses(address nftAsset) external view returns (address bNftProxy, address bNftImpl);
}
