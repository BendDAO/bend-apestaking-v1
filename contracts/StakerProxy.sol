// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

import {IStakerProxy, DataTypes} from "./interfaces/IStakerProxy.sol";
import {IBNFT} from "./interfaces/IBNFT.sol";
import {IApeCoinStaking} from "./interfaces/IApeCoinStaking.sol";
import {PercentageMath} from "./libraries/PercentageMath.sol";

contract StakerProxy is IStakerProxy, Initializable, Ownable, ReentrancyGuard, ERC721Holder {
    using DataTypes for DataTypes.BakcStaked;
    using DataTypes for DataTypes.CoinStaked;
    using SafeERC20 for IERC20;
    using PercentageMath for uint256;
    using SafeCast for uint256;
    using SafeCast for int256;

    uint8 private constant PRECISION = 10;
    uint256 private constant BAYC_POOL_ID = 1;
    uint256 private constant MAYC_POOL_ID = 2;
    uint256 private constant BAKC_POOL_ID = 3;

    enum PoolType {
        UNKNOWN,
        SINGLE_BAYC,
        SINGLE_MAYC,
        PAIRED_BAYC,
        PAIRED_MAYC
    }

    mapping(address => uint256) public pendingRewards;
    mapping(address => uint256) public pendingWithdraw;
    DataTypes.ApeStaked private _apeStaked;
    DataTypes.BakcStaked private _bakcStaked;
    DataTypes.CoinStaked private _coinStaked;

    bool public override unStaked;
    PoolType public poolType;

    address public bayc;
    address public mayc;
    address public bakc;
    address public apeCoin;

    address public boundBayc;
    address public boundMayc;

    IApeCoinStaking public apeCoinStaking;

    modifier onlyStaker(address staker) {
        require(
            staker == _apeStaked.staker || staker == _bakcStaked.staker || staker == _coinStaked.staker,
            "StakerProxy: not valid staker"
        );
        _;
    }

    function initialize(
        address owner_,
        address bayc_,
        address mayc_,
        address bakc_,
        address boundBayc_,
        address boundMayc_,
        address apeCoin_,
        address apeCoinStaking_
    ) external override initializer {
        _transferOwnership(owner_);
        bayc = bayc_;
        mayc = mayc_;
        bakc = bakc_;
        apeCoin = apeCoin_;

        boundBayc = boundBayc_;
        boundMayc = boundMayc_;

        apeCoinStaking = IApeCoinStaking(apeCoinStaking_);
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

    function claimable(address staker) external view override returns (uint256) {
        uint256 poolId = _getPoolId();
        if (poolId == 0) {
            return 0;
        }
        IApeCoinStaking.Position memory _position;
        if (poolId == BAKC_POOL_ID) {
            _position = apeCoinStaking.nftPosition(poolId, _bakcStaked.tokenId);
        } else {
            _position = apeCoinStaking.nftPosition(poolId, _apeStaked.tokenId);
        }

        IApeCoinStaking.Pool memory pool = apeCoinStaking.pools(poolId);

        int256 accumulatedApeCoins = (_position.stakedAmount * pool.accumulatedRewardsPerShare).toInt256();
        uint256 rewardsToBeClaimed = (accumulatedApeCoins - _position.rewardsDebt).toUint256() / 1e18;
        (uint256 apeRewards, uint256 bakcRewards, uint256 coinRewards) = _computeRawards(rewardsToBeClaimed);
        if (staker == _apeStaked.staker) {
            return pendingRewards[staker] + apeRewards;
        }

        if (staker == _bakcStaked.staker) {
            return pendingRewards[staker] + bakcRewards;
        }
        if (staker == _coinStaked.staker) {
            return pendingRewards[staker] + coinRewards;
        }
        return 0;
    }

    function withdrawable(address staker) external view override returns (uint256) {
        return pendingWithdraw[staker];
    }

    function unStake() external override onlyOwner nonReentrant {
        require(!unStaked, "StakerProxy: already unstaked");
        _withdraw();
        unStaked = true;
    }

    function stake(
        DataTypes.ApeStaked memory apeStaked_,
        DataTypes.BakcStaked memory bakcStaked_,
        DataTypes.CoinStaked memory coinStaked_
    ) external override onlyOwner nonReentrant {
        _apeStaked = apeStaked_;
        _bakcStaked = bakcStaked_;
        _coinStaked = coinStaked_;
        uint256 coinAmount = _totalStakedCoinAmount();

        // do the ape staking
        IERC20(apeCoin).safeApprove(address(apeCoinStaking), coinAmount);
        if (!_bakcStaked.isNull()) {
            IApeCoinStaking.PairNftWithAmount[] memory nfts = new IApeCoinStaking.PairNftWithAmount[](1);
            nfts[0] = IApeCoinStaking.PairNftWithAmount({
                mainTokenId: _apeStaked.tokenId,
                bakcTokenId: _bakcStaked.tokenId,
                amount: coinAmount
            });
            IApeCoinStaking.PairNftWithAmount[] memory emptyNfts;
            if (_apeStaked.collection == boundBayc) {
                apeCoinStaking.depositBAKC(nfts, emptyNfts);
                poolType = PoolType.PAIRED_BAYC;
            } else if (_apeStaked.collection == boundMayc) {
                apeCoinStaking.depositBAKC(emptyNfts, nfts);
                poolType = PoolType.PAIRED_MAYC;
            }
        } else {
            IApeCoinStaking.SingleNft[] memory nfts = new IApeCoinStaking.SingleNft[](1);
            nfts[0] = IApeCoinStaking.SingleNft({tokenId: _apeStaked.tokenId, amount: coinAmount});
            if (_apeStaked.collection == boundBayc) {
                apeCoinStaking.depositBAYC(nfts);
                poolType = PoolType.SINGLE_BAYC;
            } else if (_apeStaked.collection == boundMayc) {
                apeCoinStaking.depositMAYC(nfts);
                poolType = PoolType.SINGLE_MAYC;
            }
        }
        IERC20(apeCoin).safeApprove(address(apeCoinStaking), 0);

        // transfer ape back to owner
        address apeCollection = apeStaked_.collection;
        if (_isBoundApe(apeCollection)) {
            apeCollection = IBNFT(apeCollection).underlyingAsset();
        }
        IERC721(apeCollection).safeTransferFrom(address(this), owner(), apeStaked_.tokenId);
    }

    function claim(
        address staker,
        uint256 fee,
        address feeRecipient
    ) external override onlyOwner onlyStaker(staker) nonReentrant returns (uint256 toStaker, uint256 toFee) {
        _claim();
        toStaker = pendingRewards[staker];
        toFee = toStaker.percentMul(fee);
        toStaker -= toFee;
        IERC20(apeCoin).safeTransfer(feeRecipient, toFee);
        IERC20(apeCoin).safeTransfer(staker, toStaker);
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
        amount = pendingWithdraw[staker];
        if (amount > 0) {
            IERC20(apeCoin).safeTransfer(staker, amount);
        }
        if (staker == _bakcStaked.staker) {
            IERC721(bakc).safeTransferFrom(address(this), staker, _bakcStaked.tokenId);
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
        (
            pendingRewards[_apeStaked.staker],
            pendingRewards[_bakcStaked.staker],
            pendingRewards[_coinStaked.staker]
        ) = _computeRawards(rewardsAmount);
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
                uint256 coinSharedRewards = (_apeStaked.coinAmount * 10**10) / maxCap / 10**10;
                apeRewards += coinSharedRewards;
                coinRewards -= coinSharedRewards;
            }
            if (_bakcStaked.coinAmount > 0) {
                uint256 coinSharedRewards = (_bakcStaked.coinAmount * 10**10) / maxCap / 10**10;
                bakcRewards += coinSharedRewards;
                coinRewards -= coinSharedRewards;
            }
        }
    }

    function _claim() internal {
        if (!unStaked) {
            uint256 preBalance = IERC20(apeCoin).balanceOf(address(this));
            if (poolType == PoolType.SINGLE_BAYC || poolType == PoolType.SINGLE_MAYC) {
                uint256[] memory nfts = new uint256[](1);
                nfts[0] = _apeStaked.tokenId;
                if (poolType == PoolType.SINGLE_BAYC) {
                    apeCoinStaking.claimBAYC(nfts, address(this));
                } else {
                    apeCoinStaking.claimMAYC(nfts, address(this));
                }
            }

            if (poolType == PoolType.PAIRED_BAYC || poolType == PoolType.SINGLE_MAYC) {
                IApeCoinStaking.PairNft[] memory nfts = new IApeCoinStaking.PairNft[](1);
                nfts[0] = IApeCoinStaking.PairNft({mainTokenId: _apeStaked.tokenId, bakcTokenId: _bakcStaked.tokenId});
                IApeCoinStaking.PairNft[] memory emptyNfts;
                if (poolType == PoolType.PAIRED_BAYC) {
                    apeCoinStaking.claimBAKC(nfts, emptyNfts, address(this));
                } else {
                    apeCoinStaking.claimBAKC(emptyNfts, nfts, address(this));
                }
            }
            uint256 rewardsAmount = IERC20(apeCoin).balanceOf(address(this)) - preBalance;
            _allocateRawards(rewardsAmount);
        }
    }

    function _withdraw() internal {
        uint256 coinAmount = _totalStakedCoinAmount();
        uint256 preBalance = IERC20(apeCoin).balanceOf(address(this));
        if (poolType == PoolType.SINGLE_BAYC || poolType == PoolType.SINGLE_MAYC) {
            IApeCoinStaking.SingleNft[] memory nfts = new IApeCoinStaking.SingleNft[](1);
            nfts[0] = IApeCoinStaking.SingleNft({tokenId: _apeStaked.tokenId, amount: coinAmount});
            if (poolType == PoolType.SINGLE_BAYC) {
                apeCoinStaking.withdrawBAYC(nfts, address(this));
            } else {
                apeCoinStaking.withdrawBAYC(nfts, address(this));
            }
        }

        if (poolType == PoolType.PAIRED_BAYC || poolType == PoolType.SINGLE_MAYC) {
            IApeCoinStaking.PairNftWithAmount[] memory nfts = new IApeCoinStaking.PairNftWithAmount[](1);
            nfts[0] = IApeCoinStaking.PairNftWithAmount({
                mainTokenId: _apeStaked.tokenId,
                bakcTokenId: _bakcStaked.tokenId,
                amount: coinAmount
            });
            IApeCoinStaking.PairNftWithAmount[] memory emptyNfts;
            if (poolType == PoolType.PAIRED_BAYC) {
                apeCoinStaking.withdrawBAKC(nfts, emptyNfts);
            } else {
                apeCoinStaking.withdrawBAKC(emptyNfts, nfts);
            }
        }
        pendingWithdraw[_apeStaked.staker] = _apeStaked.coinAmount;
        if (!_bakcStaked.isNull()) {
            pendingWithdraw[_bakcStaked.staker] = _bakcStaked.coinAmount;
        }
        if (!_coinStaked.isNull()) {
            pendingWithdraw[_coinStaked.staker] = _coinStaked.coinAmount;
        }
        // withdraw from ape staking will receive staked principal and rewards
        uint256 rewardsAmount = IERC20(apeCoin).balanceOf(address(this)) - preBalance - coinAmount;
        _allocateRawards(rewardsAmount);
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
            return BAYC_POOL_ID;
        } else if (poolType == PoolType.SINGLE_MAYC) {
            return MAYC_POOL_ID;
        } else if (poolType == PoolType.PAIRED_BAYC || poolType == PoolType.PAIRED_MAYC) {
            return BAKC_POOL_ID;
        }
        return 0;
    }

    function _isBoundApe(address apeCollection) internal view returns (bool) {
        return apeCollection == boundBayc || apeCollection == boundMayc;
    }

    receive() external payable {
        revert("Receive ETH not allowed");
    }
}
