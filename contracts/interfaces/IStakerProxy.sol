// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;
import {DataTypes} from "../libraries/DataTypes.sol";

interface IStakerProxy {
    function initialize(
        address owner_,
        address bayc_,
        address mayc_,
        address bakc_,
        address boundBayc_,
        address boundMayc_,
        address apeCoin_,
        address apeCoinStaking_
    ) external;

    function version() external view returns (uint256);

    function apeStaked() external view returns (DataTypes.ApeStaked memory);

    function bakcStaked() external view returns (DataTypes.BakcStaked memory);

    function coinStaked() external view returns (DataTypes.CoinStaked memory);

    function unStaked() external view returns (bool);

    function claimable(address staker) external view returns (uint256);

    function withdrawable(address staker) external view returns (uint256);

    function unStake() external;

    function stake(
        DataTypes.ApeStaked memory ape,
        DataTypes.BakcStaked memory bakc,
        DataTypes.CoinStaked memory coin
    ) external;

    function claim(
        address staker,
        uint256 fee,
        address feeRecipient
    ) external returns (uint256, uint256);

    function withdraw(address staker) external returns (uint256);

    function withdrawERC20Emergency(
        address token,
        address to,
        uint256 amount
    ) external;

    function withdrawERC721Emergency(
        address token,
        address to,
        uint256 tokenId
    ) external;
}
