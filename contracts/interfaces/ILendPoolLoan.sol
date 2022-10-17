// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

interface ILendPoolLoan {
    function addTokenBurnInterceptor(address bNftAddress, uint256 tokenId) external;

    function deleteTokenBurnInterceptor(address bNftAddress, uint256 tokenId) external;

    function getCollateralLoanId(address nftAsset, uint256 nftTokenId) external view returns (uint256);
}
