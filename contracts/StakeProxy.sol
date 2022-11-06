// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
//fix issue "@openzeppelin/contracts/utils/Address.sol:191: Use of delegatecall is not allowed"
// refer: https://forum.openzeppelin.com/t/spurious-issue-from-non-upgradeable-initializable-sol/30570/6
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

import {IStakeProxy, DataTypes, IApeCoinStaking} from "./interfaces/IStakeProxy.sol";
import {IBNFT} from "./interfaces/IBNFT.sol";
import {PercentageMath} from "./libraries/PercentageMath.sol";

import "hardhat/console.sol";

contract StakeProxy is IStakeProxy, Initializable, Ownable, ReentrancyGuard, ERC721Holder {
    using DataTypes for DataTypes.BakcStaked;
    using DataTypes for DataTypes.CoinStaked;
    using SafeERC20 for IERC20;
    using PercentageMath for uint256;
    using SafeCast for uint256;
    using SafeCast for int256;

    uint256 public override version = 1;

    uint8 private constant PRECISION = 10;

    mapping(address => uint256) public pendingRewards;
    mapping(address => uint256) public pendingWithdraw;

    DataTypes.ApeStaked private _apeStaked;
    DataTypes.BakcStaked private _bakcStaked;
    DataTypes.CoinStaked private _coinStaked;

    bool public override unStaked;
    PoolType public override poolType;

    IERC721 public override bayc;
    IERC721 public override mayc;
    IERC721 public override bakc;
    IERC20 public override apeCoin;

    IApeCoinStaking public override apeStaking;

    modifier onlyStaker(address staker) {
        require(
            staker == _apeStaked.staker || staker == _bakcStaked.staker || staker == _coinStaked.staker,
            "StakeProxy: not valid staker"
        );
        _;
    }

    function initialize(
        address owner_,
        address bayc_,
        address mayc_,
        address bakc_,
        address apeCoin_,
        address apeCoinStaking_
    ) external override initializer {
        _transferOwnership(owner_);
        bayc = IERC721(bayc_);
        mayc = IERC721(mayc_);
        bakc = IERC721(bakc_);
        apeCoin = IERC20(apeCoin_);

        apeStaking = IApeCoinStaking(apeCoinStaking_);
    }

    function apeStaked() external view returns (DataTypes.ApeStaked memory) {
        return _apeStaked;
    }

    function bakcStaked() external view returns (DataTypes.BakcStaked memory) {
        return _bakcStaked;
    }

    function coinStaked() external view returns (DataTypes.CoinStaked memory) {
        return _coinStaked;
    }

    function claimable(address staker, uint256 fee) external view override returns (uint256) {
        uint256 poolId = _getPoolId();
        if (poolId == 0) {
            return 0;
        }

        uint256 tokenId;
        if (poolId == DataTypes.BAKC_POOL_ID) {
            tokenId = _bakcStaked.tokenId;
        } else {
            tokenId = _apeStaked.tokenId;
        }

        uint256 rewardsToBeClaimed = apeStaking.pendingRewards(poolId, address(this), tokenId);

        (uint256 apeRewards, uint256 bakcRewards, uint256 coinRewards) = _computeRawards(rewardsToBeClaimed);

        uint256 stakerRewards = pendingRewards[staker];
        if (staker == _apeStaked.staker) {
            stakerRewards += apeRewards;
        }

        if (staker == _bakcStaked.staker) {
            stakerRewards += bakcRewards;
        }
        if (staker == _coinStaked.staker) {
            stakerRewards += coinRewards;
        }
        return stakerRewards - stakerRewards.percentMul(fee);
    }

    function withdrawable(address staker) external view override returns (uint256) {
        return pendingWithdraw[staker];
    }

    function unStake() external override onlyOwner nonReentrant {
        require(poolType != PoolType.UNKNOWN, "StakeProxy: no staking at all");
        require(!unStaked, "StakeProxy: already unstaked");
        require(
            IERC721(_apeStaked.collection).ownerOf(_apeStaked.tokenId) == address(this),
            "StakeProxy: not ape owner"
        );
        uint256 coinAmount = _totalStakedCoinAmount();
        uint256 preBalance = apeCoin.balanceOf(address(this));

        if (poolType == PoolType.SINGLE_BAYC || poolType == PoolType.SINGLE_MAYC) {
            IApeCoinStaking.SingleNft[] memory nfts = new IApeCoinStaking.SingleNft[](1);
            nfts[0] = IApeCoinStaking.SingleNft({tokenId: _apeStaked.tokenId, amount: coinAmount});
            if (poolType == PoolType.SINGLE_BAYC) {
                apeStaking.withdrawBAYC(nfts, address(this));
            } else {
                apeStaking.withdrawMAYC(nfts, address(this));
            }
        }

        if (poolType == PoolType.PAIRED_BAYC || poolType == PoolType.PAIRED_MAYC) {
            IApeCoinStaking.PairNftWithAmount[] memory nfts = new IApeCoinStaking.PairNftWithAmount[](1);
            nfts[0] = IApeCoinStaking.PairNftWithAmount({
                mainTokenId: _apeStaked.tokenId,
                bakcTokenId: _bakcStaked.tokenId,
                amount: coinAmount
            });
            IApeCoinStaking.PairNftWithAmount[] memory emptyNfts;
            if (poolType == PoolType.PAIRED_BAYC) {
                apeStaking.withdrawBAKC(nfts, emptyNfts);
            } else {
                apeStaking.withdrawBAKC(emptyNfts, nfts);
            }
        }

        pendingWithdraw[_apeStaked.staker] += _apeStaked.coinAmount;
        if (!_bakcStaked.isNull()) {
            pendingWithdraw[_bakcStaked.staker] += _bakcStaked.coinAmount;
        }
        if (!_coinStaked.isNull()) {
            pendingWithdraw[_coinStaked.staker] += _coinStaked.coinAmount;
        }
        // withdraw from ape staking will receive staked principal and rewards
        uint256 rewardsAmount = apeCoin.balanceOf(address(this)) - preBalance - coinAmount;
        _allocateRawards(rewardsAmount);
        unStaked = true;

        // transfer nft back to owner
        IERC721(_apeStaked.collection).safeTransferFrom(address(this), owner(), _apeStaked.tokenId);
    }

    function stake(
        DataTypes.ApeStaked memory apeStaked_,
        DataTypes.BakcStaked memory bakcStaked_,
        DataTypes.CoinStaked memory coinStaked_
    ) external override onlyOwner nonReentrant {
        require(
            IERC721(apeStaked_.collection).ownerOf(apeStaked_.tokenId) == address(this),
            "StakeProxy: not ape owner"
        );

        _setPoolType(apeStaked_, bakcStaked_);

        // check nft staking state
        uint256 poolId = _getPoolId();

        // save storage
        _apeStaked = apeStaked_;
        _bakcStaked = bakcStaked_;
        _coinStaked = coinStaked_;

        uint256 coinAmount = _totalStakedCoinAmount();

        // do the ape staking
        apeCoin.safeApprove(address(apeStaking), coinAmount);
        if (poolType == PoolType.PAIRED_BAYC || poolType == PoolType.PAIRED_MAYC) {
            // check bakc staking state
            require(
                apeStaking.nftPosition(poolId, bakcStaked_.tokenId).stakedAmount == 0,
                "StakeProxy: bakc already staked"
            );

            require(bakc.ownerOf(bakcStaked_.tokenId) == address(this), "StakeProxy: not bakc owner");
            IApeCoinStaking.PairNftWithAmount[] memory nfts = new IApeCoinStaking.PairNftWithAmount[](1);
            nfts[0] = IApeCoinStaking.PairNftWithAmount({
                mainTokenId: apeStaked_.tokenId,
                bakcTokenId: bakcStaked_.tokenId,
                amount: coinAmount
            });
            IApeCoinStaking.PairNftWithAmount[] memory emptyNfts;
            if (poolType == PoolType.PAIRED_BAYC) {
                apeStaking.depositBAKC(nfts, emptyNfts);
            } else if (_apeStaked.collection == address(mayc)) {
                apeStaking.depositBAKC(emptyNfts, nfts);
            }
        } else {
            // check ape staking state
            require(
                apeStaking.nftPosition(poolId, apeStaked_.tokenId).stakedAmount == 0,
                "StakeProxy: ape already staked"
            );

            IApeCoinStaking.SingleNft[] memory nfts = new IApeCoinStaking.SingleNft[](1);
            nfts[0] = IApeCoinStaking.SingleNft({tokenId: apeStaked_.tokenId, amount: coinAmount});
            if (poolType == PoolType.SINGLE_BAYC) {
                apeStaking.depositBAYC(nfts);
            } else if (poolType == PoolType.SINGLE_MAYC) {
                apeStaking.depositMAYC(nfts);
            }
        }
        apeCoin.safeApprove(address(apeStaking), 0);

        // transfer nft back to owner
        IERC721(apeStaked_.collection).safeTransferFrom(address(this), owner(), apeStaked_.tokenId);
    }

    function _setPoolType(DataTypes.ApeStaked memory apeStaked_, DataTypes.BakcStaked memory bakcStaked_) internal {
        require(
            apeStaked_.collection == address(bayc) || apeStaked_.collection == address(mayc),
            "StakeProxy: invalid ape collection"
        );
        if (!bakcStaked_.isNull()) {
            require(bakc.ownerOf(bakcStaked_.tokenId) == address(this), "StakeProxy: not bakc owner");

            if (apeStaked_.collection == address(bayc)) {
                poolType = PoolType.PAIRED_BAYC;
            } else if (apeStaked_.collection == address(mayc)) {
                poolType = PoolType.PAIRED_MAYC;
            }
        } else {
            if (apeStaked_.collection == address(bayc)) {
                poolType = PoolType.SINGLE_BAYC;
            } else if (apeStaked_.collection == address(mayc)) {
                poolType = PoolType.SINGLE_MAYC;
            }
        }
    }

    function claim(
        address staker,
        uint256 fee,
        address feeRecipient
    ) external override onlyOwner onlyStaker(staker) nonReentrant returns (uint256 toStaker, uint256 toFee) {
        _claim();
        toStaker = pendingRewards[staker];
        toFee = toStaker.percentMul(fee);
        if (toFee > 0 && feeRecipient != address(0)) {
            apeCoin.safeTransfer(feeRecipient, toFee);
            toStaker -= toFee;
        }
        apeCoin.safeTransfer(staker, toStaker);
        pendingRewards[staker] = 0;
    }

    function withdraw(address staker)
        external
        override
        onlyOwner
        onlyStaker(staker)
        nonReentrant
        returns (uint256 amount)
    {
        if (unStaked) {
            amount = pendingWithdraw[staker];
            if (amount > 0) {
                apeCoin.safeTransfer(staker, amount);
            }
            pendingWithdraw[staker] = 0;
        }
        if (poolType == PoolType.PAIRED_BAYC || poolType == PoolType.PAIRED_MAYC) {
            if ((!_bakcStaked.isNull()) && staker == _bakcStaked.staker) {
                bakc.safeTransferFrom(address(this), _bakcStaked.staker, _bakcStaked.tokenId);
            }
        }
    }

    function withdrawERC20Emergency(
        address token,
        address to,
        uint256 amount
    ) external override onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    function withdrawERC721Emergency(
        address token,
        address to,
        uint256 tokenId
    ) external override onlyOwner {
        IERC721(token).safeTransferFrom(address(this), to, tokenId);
    }

    function _allocateRawards(uint256 rewardsAmount) internal {
        (uint256 apeRewards, uint256 bakcRewards, uint256 coinRewards) = _computeRawards(rewardsAmount);
        pendingRewards[_apeStaked.staker] += apeRewards;
        pendingRewards[_bakcStaked.staker] += bakcRewards;
        pendingRewards[_coinStaked.staker] += coinRewards;
    }

    function _computeRawards(uint256 rewardsAmount)
        internal
        view
        returns (
            uint256 apeRewards,
            uint256 bakcRewards,
            uint256 coinRewards
        )
    {
        if (rewardsAmount > 0) {
            uint256 maxCap = _totalStakedCoinAmount();
            apeRewards = rewardsAmount.percentMul(_apeStaked.apeShare);
            bakcRewards = rewardsAmount.percentMul(_bakcStaked.bakcShare);
            coinRewards = rewardsAmount - apeRewards - bakcRewards;

            if (_apeStaked.coinAmount > 0) {
                uint256 coinSharedRewards = (coinRewards * (_apeStaked.coinAmount * 10**10)) / maxCap / 10**10;

                apeRewards += coinSharedRewards;
                coinRewards -= coinSharedRewards;
            }
            if (_bakcStaked.coinAmount > 0) {
                uint256 coinSharedRewards = (coinRewards * (_bakcStaked.coinAmount * 10**10)) / maxCap / 10**10;
                bakcRewards += coinSharedRewards;
                coinRewards -= coinSharedRewards;
            }
        }
    }

    function _claim() internal {
        if (!unStaked) {
            require(
                IERC721(_apeStaked.collection).ownerOf(_apeStaked.tokenId) == address(this),
                "StakeProxy: not ape owner"
            );
            if (!_bakcStaked.isNull()) {
                require(bakc.ownerOf(_bakcStaked.tokenId) == address(this), "StakeProxy: not bakc owner");
            }
            uint256 preBalance = apeCoin.balanceOf(address(this));
            if (poolType == PoolType.SINGLE_BAYC || poolType == PoolType.SINGLE_MAYC) {
                uint256[] memory nfts = new uint256[](1);
                nfts[0] = _apeStaked.tokenId;
                if (poolType == PoolType.SINGLE_BAYC) {
                    apeStaking.claimBAYC(nfts, address(this));
                } else {
                    apeStaking.claimMAYC(nfts, address(this));
                }
            }

            if (poolType == PoolType.PAIRED_BAYC || poolType == PoolType.PAIRED_MAYC) {
                IApeCoinStaking.PairNft[] memory nfts = new IApeCoinStaking.PairNft[](1);
                nfts[0] = IApeCoinStaking.PairNft({mainTokenId: _apeStaked.tokenId, bakcTokenId: _bakcStaked.tokenId});
                IApeCoinStaking.PairNft[] memory emptyNfts;
                if (poolType == PoolType.PAIRED_BAYC) {
                    apeStaking.claimBAKC(nfts, emptyNfts, address(this));
                } else {
                    apeStaking.claimBAKC(emptyNfts, nfts, address(this));
                }
            }
            uint256 rewardsAmount = apeCoin.balanceOf(address(this)) - preBalance;
            _allocateRawards(rewardsAmount);

            // transfer nft back to owner
            IERC721(_apeStaked.collection).safeTransferFrom(address(this), owner(), _apeStaked.tokenId);
        }
    }

    function _totalStakedCoinAmount() internal view returns (uint256 coinAmount) {
        coinAmount = _apeStaked.coinAmount;
        if (!_bakcStaked.isNull()) {
            coinAmount += _bakcStaked.coinAmount;
        }
        if (!_coinStaked.isNull()) {
            coinAmount += _coinStaked.coinAmount;
        }
    }

    function _getPoolId() internal view returns (uint256) {
        if (poolType == PoolType.SINGLE_BAYC) {
            return DataTypes.BAYC_POOL_ID;
        } else if (poolType == PoolType.SINGLE_MAYC) {
            return DataTypes.MAYC_POOL_ID;
        } else if (poolType == PoolType.PAIRED_BAYC || poolType == PoolType.PAIRED_MAYC) {
            return DataTypes.BAKC_POOL_ID;
        }
        return 0;
    }

    receive() external payable {
        revert("Receive ETH not allowed");
    }
}
