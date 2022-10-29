// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

import {DataTypes} from "../libraries/DataTypes.sol";
import {IStakerProxy} from "./IStakerProxy.sol";

interface IStakeManager {
    event Staked(address indexed proxy, bytes32 apeOfferHash, bytes32 bakcOfferHash, bytes32 coinOfferHash);
    event UnStaked(address indexed proxy);

    event FeePaid(address indexed payer, address indexed feeRecipient, uint256 apeCoinAmount);
    event Claimed(address indexed staker, uint256 apeCoinAmount);
    event Withdrawn(address indexed staker, uint256 apeCoinAmount);

    function claimable(IStakerProxy proxy, address staker) external view returns (uint256);

    function withdrawable(IStakerProxy proxy, address staker) external view returns (uint256);

    function feeRecipient() external view returns (address);

    function fee() external view returns (uint256);

    function updateFeeRecipient(address recipient) external;

    function updateFee(uint256 fee) external;

    function setMatcher(address matcher) external;

    function mintBoundApe(
        address ape,
        uint256 tokenId,
        address to
    ) external;

    function flashStake(
        DataTypes.ApeStaked memory apeStaked,
        DataTypes.BakcStaked memory bakcStaked,
        DataTypes.CoinStaked memory coinStaked
    ) external;

    function flashUnstake(IStakerProxy proxy) external;

    function flashClaim(IStakerProxy proxy) external;

    function unStakeBeforeBNFTBurn(address bNftAddress, uint256 tokenId) external;

    function borrowETH(
        uint256 amount,
        address nftAsset,
        uint256 nftTokenId
    ) external;
}
