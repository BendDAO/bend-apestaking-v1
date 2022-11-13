// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ClonesUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ERC721HolderUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/utils/ERC721HolderUpgradeable.sol";
import {IBNFT, IERC721Upgradeable} from "./interfaces/IBNFT.sol";
import {AddressUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";

import {IWETH} from "./interfaces/IWETH.sol";
import {ILoanRepaidInterceptor} from "./interfaces/ILoanRepaidInterceptor.sol";
import {IApeCoinStaking} from "./interfaces/IApeCoinStaking.sol";
import {IStakeProxy} from "./interfaces/IStakeProxy.sol";
import {IStakeManager, DataTypes} from "./interfaces/IStakeManager.sol";
import {ILendPoolAddressesProvider, ILendPool, ILendPoolLoan} from "./interfaces/ILendPoolAddressesProvider.sol";
import {PercentageMath} from "./libraries/PercentageMath.sol";
import {NFTProxy} from "./libraries/NFTProxy.sol";
import {IFlashLoanReceiver} from "./interfaces/IFlashLoanReceiver.sol";

contract StakeManager is
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    ERC721HolderUpgradeable,
    IStakeManager,
    IFlashLoanReceiver,
    ILoanRepaidInterceptor
{
    using ClonesUpgradeable for address;
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using DataTypes for DataTypes.ApeStaked;
    using DataTypes for DataTypes.BakcStaked;
    using DataTypes for DataTypes.CoinStaked;
    using NFTProxy for NFTProxy.Proxies;

    enum FlashCall {
        UNKNOWN,
        STAKE,
        UNSTAKE,
        CLAIM
    }
    NFTProxy.Proxies private _stakedProxies;
    mapping(IStakeProxy => bool) public proxies;
    mapping(IStakeProxy => mapping(address => bool)) public override unStaked;

    address public override feeRecipient;
    uint256 public override fee;

    IBNFT public boundBayc;
    IBNFT public boundMayc;

    IERC721Upgradeable public bayc;
    IERC721Upgradeable public mayc;
    IERC721Upgradeable public bakc;

    IERC20Upgradeable public apeCoin;
    IWETH public WETH;

    IApeCoinStaking public apeStaking;

    address public proxyImplementation;

    address public matcher;

    ILendPoolAddressesProvider public lendPoolAddressedProvider;

    modifier onlyMatcher() {
        require(_msgSender() == matcher, "StakeManager: caller must be matcher");
        _;
    }

    modifier onlyStaker(IStakeProxy proxy) {
        require(proxies[proxy], "StakeManager: invalid proxy");
        address _sender = _msgSender();
        require(
            _sender == proxy.apeStaked().staker ||
                _sender == proxy.bakcStaked().staker ||
                _sender == proxy.coinStaked().staker,
            "StakeManager: invalid caller"
        );
        _;
    }

    modifier onlyLendPool() {
        require(
            _msgSender() == address(lendPoolAddressedProvider.getLendPoolLoan()),
            "StakeManager: caller must be lend pool"
        );
        _;
    }

    modifier onlyProxy(IStakeProxy proxy) {
        require(proxies[proxy], "StakeManager: invalid proxy");
        _;
    }

    function initialize(
        address bayc_,
        address mayc_,
        address bakc_,
        address boundBayc_,
        address boundMayc_,
        address apeCoin_,
        address WETH_,
        address apeStaking_,
        address proxyImplementation_,
        address lendPoolAddressedProvider_
    ) external initializer {
        __Ownable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        boundBayc = IBNFT(boundBayc_);
        boundMayc = IBNFT(boundMayc_);
        bayc = IERC721Upgradeable(bayc_);
        mayc = IERC721Upgradeable(mayc_);
        bakc = IERC721Upgradeable(bakc_);
        apeCoin = IERC20Upgradeable(apeCoin_);
        WETH = IWETH(WETH_);
        apeStaking = IApeCoinStaking(apeStaking_);
        proxyImplementation = proxyImplementation_;
        lendPoolAddressedProvider = ILendPoolAddressesProvider(lendPoolAddressedProvider_);
    }

    function pause() external onlyOwner whenNotPaused {
        _pause();
    }

    function unpause() external onlyOwner whenPaused {
        _unpause();
    }

    function setMatcher(address matcher_) external override onlyOwner {
        require(matcher_ != address(0), "StakeManager: matcher can't be zero address");
        matcher = matcher_;
    }

    function updateFeeRecipient(address feeRecipient_) external override onlyOwner {
        require(feeRecipient_ != address(0), "StakeManager: fee recipient can't be zero address");
        feeRecipient = feeRecipient_;
    }

    function updateFee(uint256 fee_) external override onlyOwner {
        require(fee_ <= PercentageMath.PERCENTAGE_FACTOR, "StakeManager: fee overflow");
        fee = fee_;
    }

    function executeOperation(
        address asset,
        uint256[] calldata tokenIds,
        address initiator,
        address operator,
        bytes calldata params
    ) external whenNotPaused returns (bool) {
        require(address(this) == initiator, "Flashloan: invalid initiator");
        require(
            _msgSender() == operator && (operator == address(boundBayc) || operator == address(boundMayc)),
            "Flashloan: operator is not bound ape"
        );
        require(asset == address(bayc) || asset == address(mayc), "Flashloan: not ape asset");
        require(tokenIds.length == 1, "Flashloan: multiple apes not supported");

        (FlashCall callType, bytes memory param) = abi.decode(params, (FlashCall, bytes));

        if (FlashCall.STAKE == callType) {
            (
                DataTypes.ApeStaked memory apeStaked,
                DataTypes.BakcStaked memory bakcStaked,
                DataTypes.CoinStaked memory coinStaked
            ) = abi.decode(param, (DataTypes.ApeStaked, DataTypes.BakcStaked, DataTypes.CoinStaked));
            _stake(apeStaked, bakcStaked, coinStaked);
        } else if (FlashCall.UNSTAKE == callType) {
            (address proxy, address staker) = abi.decode(param, (address, address));
            _unStake(IStakeProxy(proxy), staker);
        } else if (FlashCall.CLAIM == callType) {
            (address proxy, address staker) = abi.decode(param, (address, address));
            _claim(IStakeProxy(proxy), staker);
        }
        if (asset == address(bayc)) {
            bayc.approve(address(boundBayc), tokenIds[0]);
        } else {
            mayc.approve(address(boundMayc), tokenIds[0]);
        }
        return true;
    }

    function beforeLoanRepaid(address nftAsset, uint256 nftTokenId)
        external
        override
        nonReentrant
        onlyLendPool
        returns (bool)
    {
        address[] memory _proxies = _stakedProxies.values(nftAsset, nftTokenId);

        for (uint256 i = 0; i < _proxies.length; i++) {
            IStakeProxy proxy = IStakeProxy(_proxies[i]);
            // burn bound ape, so here unStaker is ape holder
            _flashUnStake(proxy, proxy.apeStaked().staker);
        }
        return true;
    }

    function afterLoanRepaid(address, uint256) external view override onlyLendPool returns (bool) {
        return true;
    }

    function stake(
        DataTypes.ApeStaked memory apeStaked,
        DataTypes.BakcStaked memory bakcStaked,
        DataTypes.CoinStaked memory coinStaked
    ) external override onlyMatcher nonReentrant whenNotPaused {
        // lock ape in BNFT and lock flashLoan
        _lock(apeStaked.collection, apeStaked.tokenId, apeStaked.staker);
        bytes memory param = abi.encode(apeStaked, bakcStaked, coinStaked);
        _flashCall(FlashCall.STAKE, apeStaked.collection, apeStaked.tokenId, param);
    }

    function _flashUnStake(IStakeProxy proxy, address unStaker) internal {
        if (!proxy.unStaked()) {
            DataTypes.ApeStaked memory apeStaked = proxy.apeStaked();
            bytes memory param = abi.encode(proxy, unStaker);
            _flashCall(FlashCall.UNSTAKE, apeStaked.collection, apeStaked.tokenId, param);
            _unlock(apeStaked.collection, apeStaked.tokenId, apeStaked.staker);
        }
    }

    function unStake(IStakeProxy proxy) external override onlyStaker(proxy) nonReentrant {
        address unStaker = _msgSender();
        DataTypes.ApeStaked memory apeStaked = proxy.apeStaked();
        if (!proxy.unStaked()) {
            bytes memory param = abi.encode(proxy, unStaker);
            _flashCall(FlashCall.UNSTAKE, apeStaked.collection, apeStaked.tokenId, param);
        } else {
            _unStake(proxy, unStaker);
        }

        // unlock flashloan and withdraw ape for ape staker
        if (_msgSender() == apeStaked.staker) {
            _unlock(apeStaked.collection, apeStaked.tokenId, apeStaked.staker);
        }
    }

    function claim(IStakeProxy proxy) external override onlyStaker(proxy) nonReentrant {
        if (!proxy.unStaked()) {
            bytes memory param = abi.encode(proxy, _msgSender());
            _flashCall(FlashCall.CLAIM, proxy.apeStaked().collection, proxy.apeStaked().tokenId, param);
        } else {
            _claim(proxy, _msgSender());
        }
    }

    function _flashCall(
        FlashCall callType,
        address apeNft,
        uint256 apeTokenId,
        bytes memory param
    ) internal whenNotPaused {
        IBNFT boundApe = _getBNFT(apeNft);
        uint256[] memory ids = new uint256[](1);
        ids[0] = apeTokenId;
        bytes memory data = abi.encode(callType, param);
        boundApe.flashLoan(address(this), ids, data);
    }

    function _stake(
        DataTypes.ApeStaked memory apeStaked,
        DataTypes.BakcStaked memory bakcStaked,
        DataTypes.CoinStaked memory coinStaked
    ) internal {
        IERC721Upgradeable ape = IERC721Upgradeable(apeStaked.collection);

        // clone proxy
        IStakeProxy proxy = IStakeProxy(proxyImplementation.clone());
        proxy.initialize(
            address(this),
            address(bayc),
            address(mayc),
            address(bakc),
            address(apeCoin),
            address(apeStaking)
        );

        // transfer nft and ape coin to proxy
        ape.safeTransferFrom(address(this), address(proxy), apeStaked.tokenId);
        uint256 coinAmount = apeStaked.coinAmount;
        if (!bakcStaked.isNull()) {
            require(bakc.ownerOf(bakcStaked.tokenId) == address(this), "StakeManager: not bakc owner");
            coinAmount += bakcStaked.coinAmount;
            bakc.safeTransferFrom(address(this), address(proxy), bakcStaked.tokenId);
        }

        if (!coinStaked.isNull()) {
            coinAmount += coinStaked.coinAmount;
        }
        apeCoin.safeTransfer(address(proxy), coinAmount);

        // do proxy stake
        proxy.stake(apeStaked, bakcStaked, coinStaked);

        // emit event
        emit Staked(address(proxy), apeStaked, bakcStaked, coinStaked);

        // save storage
        proxies[proxy] = true;
        _stakedProxies.add(apeStaked.collection, apeStaked.tokenId, address(proxy));
        if (!bakcStaked.isNull()) {
            _stakedProxies.add(address(bakc), bakcStaked.tokenId, address(proxy));
        }
    }

    function _lock(
        address apeAsset,
        uint256 apeTokenId,
        address lockFor
    ) internal {
        IBNFT boundApe = _getBNFT(apeAsset);
        IERC721Upgradeable apeNft = IERC721Upgradeable(apeAsset);
        ILendPoolLoan poolLoan = lendPoolAddressedProvider.getLendPoolLoan();
        address apeActualOwner = apeNft.ownerOf(apeTokenId);

        // if ape already locked in BNFT
        if (apeActualOwner == address(boundApe)) {
            address boundApeOwner = boundApe.ownerOf(apeTokenId);
            address boundApeMinter = boundApe.minterOf(apeTokenId);

            // BNFT owner must be ape staker
            require(boundApeOwner == lockFor, "StakeManager: not bound ape owner");

            // if BNFT minter is lend poll, lock flashloan and add interceptor
            if (boundApeMinter == address(poolLoan)) {
                poolLoan.setFlashLoanLocking(apeAsset, apeTokenId, true);
                poolLoan.addLoanRepaidInterceptor(apeAsset, apeTokenId);
            } else {
                // else BNFT minter must be self
                require(boundApeMinter == address(this), "StakeManager: invalid bound ape");
            }
        } else {
            // else mint own BNFT and lock flashloan
            require(apeActualOwner == address(this), "StakeManager: not ape owner");
            apeNft.approve(address(boundApe), apeTokenId);
            boundApe.mint(lockFor, apeTokenId);
            boundApe.setFlashLoanLocking(apeTokenId, address(this), true);
        }
    }

    function _unStake(IStakeProxy proxy, address staker) internal {
        require(!unStaked[proxy][staker], "StakeManager: already unStaked");
        // unstake from proxy
        if (!proxy.unStaked()) {
            _unStakeProxy(proxy, staker);
        }

        // withdraw ape coin for staker
        uint256 amount = proxy.withdraw(staker);
        if (amount > 0) {
            emit Withdrawn(staker, amount);
        }

        // claim rewards for staker
        (uint256 toStaker, uint256 toFee) = proxy.claim(staker, fee, feeRecipient);
        if (toStaker > 0) {
            emit Claimed(staker, toStaker);
        }
        if (toFee > 0) {
            emit FeePaid(staker, feeRecipient, toFee);
        }

        unStaked[proxy][staker] = true;
    }

    function _unStakeProxy(IStakeProxy proxy, address staker) internal {
        DataTypes.ApeStaked memory apeStaked = proxy.apeStaked();
        DataTypes.BakcStaked memory bakcStaked = proxy.bakcStaked();

        IERC721Upgradeable ape = IERC721Upgradeable(apeStaked.collection);

        // should transfer nft to proxy when unstake
        ape.safeTransferFrom(address(this), address(proxy), apeStaked.tokenId);

        // do proxy unstake
        proxy.unStake();

        // check nft ownership
        require(ape.ownerOf(apeStaked.tokenId) == address(this), "StakeManager: not ape owner");

        if (!bakcStaked.isNull()) {
            // remove staked proxy for bakc
            _stakedProxies.remove(address(bakc), bakcStaked.tokenId, address(proxy));
        }

        // remove staked proxy for ape
        _stakedProxies.remove(apeStaked.collection, apeStaked.tokenId, address(proxy));
        emit UnStaked(address(proxy), staker);
    }

    function _unlock(
        address apeNft,
        uint256 apeTokenId,
        address unLockFor
    ) internal {
        // must no proxy staked
        if (!_stakedProxies.isEmpty(apeNft, apeTokenId)) {
            return;
        }
        IBNFT boundApe = _getBNFT(apeNft);

        if (boundApe.minterOf(apeTokenId) == address(this) && boundApe.ownerOf(apeTokenId) == unLockFor) {
            boundApe.burn(apeTokenId);
            boundApe.setFlashLoanLocking(apeTokenId, address(this), false);
            IERC721Upgradeable(apeNft).safeTransferFrom(address(this), unLockFor, apeTokenId);
        } else {
            ILendPoolLoan poolLoan = lendPoolAddressedProvider.getLendPoolLoan();
            poolLoan.setFlashLoanLocking(apeNft, apeTokenId, false);
            poolLoan.deleteLoanRepaidInterceptor(apeNft, apeTokenId);
        }
    }

    function _claim(IStakeProxy proxy, address staker) internal {
        DataTypes.ApeStaked memory apeStaked = proxy.apeStaked();

        address apeNft = apeStaked.collection;
        uint256 apeTokenId = apeStaked.tokenId;

        IERC721Upgradeable ape = IERC721Upgradeable(apeNft);

        // should transfer ape to proxy if not unstaked
        if (!proxy.unStaked()) {
            ape.safeTransferFrom(address(this), address(proxy), apeTokenId);
        }

        // claim rewards for staker
        (uint256 toStaker, uint256 toFee) = proxy.claim(staker, fee, feeRecipient);

        if (toStaker > 0) {
            emit Claimed(staker, toStaker);
        }
        if (toFee > 0) {
            emit FeePaid(staker, feeRecipient, toFee);
        }
    }

    function borrowETH(
        uint256 amount,
        address apeAsset,
        uint256 apeTokenId
    ) external whenNotPaused nonReentrant {
        IBNFT boundApe = _getBNFT(apeAsset);
        require(boundApe.ownerOf(apeTokenId) == _msgSender(), "StakeManager: not BNFT owner");
        require(boundApe.minterOf(apeTokenId) == address(this), "StakeManager: invalid BNFT minter");

        // burn bnft and unlock flashloan
        boundApe.setFlashLoanLocking(apeTokenId, address(this), false);
        boundApe.burn(apeTokenId);

        ILendPool pool = lendPoolAddressedProvider.getLendPool();
        ILendPoolLoan poolLoan = lendPoolAddressedProvider.getLendPoolLoan();
        IERC721Upgradeable(apeAsset).approve(address(pool), apeTokenId);

        // borrow ETH and mint bnft, add interceptor and lock flashloan
        pool.borrow(address(WETH), amount, apeAsset, apeTokenId, _msgSender(), 0);
        poolLoan.setFlashLoanLocking(apeAsset, apeTokenId, true);
        poolLoan.addLoanRepaidInterceptor(apeAsset, apeTokenId);

        // withdraw eth to sender
        WETH.withdraw(amount);
        AddressUpgradeable.sendValue(payable(_msgSender()), amount);
    }

    function _getBNFT(address apeNft) internal view returns (IBNFT) {
        require(apeNft == address(bayc) || apeNft == address(mayc), "StakeManager: not ape collection");
        if (apeNft == address(mayc)) {
            return IBNFT(boundMayc);
        }
        return IBNFT(boundBayc);
    }

    function getCurrentApeCoinCap(uint256 poolId) external view returns (uint256) {
        return _getCurrentTimeRange(poolId).capPerPosition;
    }

    function _getCurrentTimeRange(uint256 poolId) internal view returns (IApeCoinStaking.TimeRange memory) {
        (
            ,
            IApeCoinStaking.PoolUI memory baycPoolUI,
            IApeCoinStaking.PoolUI memory maycPoolUI,
            IApeCoinStaking.PoolUI memory bakcPoolUI
        ) = apeStaking.getPoolsUI();

        if (poolId == DataTypes.BAYC_POOL_ID && poolId == baycPoolUI.poolId) {
            return baycPoolUI.currentTimeRange;
        }

        if (poolId == DataTypes.MAYC_POOL_ID && poolId == maycPoolUI.poolId) {
            return maycPoolUI.currentTimeRange;
        }
        if (poolId == DataTypes.BAKC_POOL_ID && poolId == bakcPoolUI.poolId) {
            return bakcPoolUI.currentTimeRange;
        }

        revert("StakeManager: invalid pool id");
    }

    function claimable(IStakeProxy proxy, address staker) external view onlyProxy(proxy) returns (uint256) {
        return proxy.claimable(staker, fee);
    }

    function totalStaked(IStakeProxy proxy, address staker) external view onlyProxy(proxy) returns (uint256 amount) {
        if (proxy.unStaked()) {
            amount = proxy.withdrawable(staker);
        } else {
            DataTypes.ApeStaked memory apeStaked = proxy.apeStaked();
            DataTypes.BakcStaked memory bakcStaked = proxy.bakcStaked();
            DataTypes.CoinStaked memory coinStaked = proxy.coinStaked();
            if (staker == apeStaked.staker) {
                amount += apeStaked.coinAmount;
            }
            if (staker == bakcStaked.staker) {
                amount += bakcStaked.coinAmount;
            }
            if (staker == coinStaked.staker) {
                amount += coinStaked.coinAmount;
            }
        }
    }

    function getStakedProxies(address nftAsset, uint256 tokenId) external view returns (address[] memory) {
        return _stakedProxies.values(nftAsset, tokenId);
    }

    receive() external payable {
        require(_msgSender() == address(WETH), "only allowed receive ETH from WETH");
    }
}
