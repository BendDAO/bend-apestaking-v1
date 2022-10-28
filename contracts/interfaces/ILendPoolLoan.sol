// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

interface ILendPoolLoan {
    function addLoanRepaidInterceptor(address nftAsset, uint256 tokenId) external;

    function deleteLoanRepaidInterceptor(address nftAsset, uint256 tokenId) external;

    function getCollateralLoanId(address nftAsset, uint256 nftTokenId) external view returns (uint256);
}
