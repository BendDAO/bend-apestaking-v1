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
    mapping(address => bool) public proxies;
    mapping(uint256 => address) public override bakcOwnerOf;

    address public override feeRecipient;
    uint256 public override fee;

    IBNFT public boundBayc;
    IBNFT public boundMayc;

    IERC721Upgradeable public bayc;
    IERC721Upgradeable public mayc;
    IERC721Upgradeable public bakc;

    IERC20Upgradeable public apeCoin;
    IWETH public WETH;

    IApeCoinStaking public apeCoinStaking;

    address public proxyImplementation;

    address public matcher;

    ILendPoolAddressesProvider public lendPoolAddressedProvider;

    modifier onlyCaller(address caller) {
        require(_msgSender() == caller, "Manager: not a valid caller");
        _;
    }

    modifier onlyStaker(IStakeProxy proxy) {
        require(proxies[address(proxy)], "Manager: not a valid proxy");
        address _sender = _msgSender();
        require(
            _sender == proxy.apeStaked().staker ||
                _sender == proxy.bakcStaked().staker ||
                _sender == proxy.coinStaked().staker,
            "Manager: not valid staker"
        );
        _;
    }

    modifier onlyLendPool() {
        require(
            _msgSender() == address(lendPoolAddressedProvider.getLendPoolLoan()),
            "Manager: sender must be lend pool"
        );
        _;
    }

    modifier onlyProxy(IStakeProxy proxy) {
        require(proxies[address(proxy)], "Manager: not a valid proxy");
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
        address apeCoinStaking_,
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
        apeCoinStaking = IApeCoinStaking(apeCoinStaking_);
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

    function beforeLoanRepaid(address nftAsset, uint256 nftTokenId) external override onlyLendPool returns (bool) {
        address[] memory _proxies = _stakedProxies.values(nftAsset, nftTokenId);

        for (uint256 i = 0; i < _proxies.length; i++) {
            IStakeProxy proxy = IStakeProxy(_proxies[i]);
            if (!proxy.unStaked()) {
                // burn bound ape, so here staker is ape holder
                bytes memory param = abi.encode(proxy, proxy.apeStaked().staker);
                _flashCall(FlashCall.UNSTAKE, proxy.apeStaked().collection, proxy.apeStaked().tokenId, param);
            }
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
    ) external override onlyCaller(matcher) nonReentrant whenNotPaused {
        bytes memory param = abi.encode(apeStaked, bakcStaked, coinStaked);
        _flashCall(FlashCall.STAKE, apeStaked.collection, apeStaked.tokenId, param);
    }

    function mintBoundApe(
        address apeCollection,
        uint256 tokenId,
        address to
    ) external override onlyCaller(matcher) whenNotPaused {
        IBNFT boundApe = _getBNFT(apeCollection);
        IERC721Upgradeable(apeCollection).approve(address(boundApe), tokenId);
        boundApe.mint(to, tokenId);
        boundApe.setFlashLoanLocking(tokenId, true);
    }

    function unstake(IStakeProxy proxy) external override onlyStaker(proxy) {
        if (!proxy.unStaked()) {
            bytes memory param = abi.encode(proxy, _msgSender());
            _flashCall(FlashCall.UNSTAKE, proxy.apeStaked().collection, proxy.apeStaked().tokenId, param);
        } else {
            _unStake(proxy, _msgSender());
        }
    }

    function claim(IStakeProxy proxy) external override onlyStaker(proxy) {
        if (!proxy.unStaked()) {
            bytes memory param = abi.encode(proxy, _msgSender());
            _flashCall(FlashCall.CLAIM, proxy.apeStaked().collection, proxy.apeStaked().tokenId, param);
        } else {
            _claim(proxy, _msgSender());
        }
    }

    function _flashCall(
        FlashCall callType,
        address apeCollection,
        uint256 tokenId,
        bytes memory param
    ) internal nonReentrant whenNotPaused {
        IBNFT boundApe = _getBNFT(apeCollection);
        uint256[] memory ids = new uint256[](1);
        ids[0] = tokenId;
        bytes memory data = abi.encode(callType, param);
        boundApe.flashLoan(address(this), ids, data);
    }

    function _stake(
        DataTypes.ApeStaked memory apeStaked,
        DataTypes.BakcStaked memory bakcStaked,
        DataTypes.CoinStaked memory coinStaked
    ) internal {
        require(
            apeStaked.collection == address(bayc) || apeStaked.collection == address(mayc),
            "StakeManager: not ape collection"
        );

        if (!bakcStaked.isNull() && bakcOwnerOf[bakcStaked.tokenId] != address(0)) {
            require(bakcOwnerOf[bakcStaked.tokenId] == bakcStaked.staker, "StakeManager: not bakc owner");
        }

        IERC721Upgradeable iApe = IERC721Upgradeable(apeStaked.collection);

        // clone proxy
        IStakeProxy proxy = IStakeProxy(proxyImplementation.clone());
        proxy.initialize(
            address(this),
            address(bayc),
            address(mayc),
            address(bakc),
            address(apeCoin),
            address(apeCoinStaking)
        );

        // transfer nft and ape coin to proxy
        iApe.safeTransferFrom(address(this), address(proxy), apeStaked.tokenId);
        uint256 coinAmount = apeStaked.coinAmount;
        if (!bakcStaked.isNull()) {
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
        emit Staked(address(proxy), apeStaked.offerHash, bakcStaked.offerHash, coinStaked.offerHash);

        // save storage
        proxies[address(proxy)] = true;
        _stakedProxies.add(apeStaked.collection, apeStaked.tokenId, address(proxy));
        if (!bakcStaked.isNull()) {
            _stakedProxies.add(address(bakc), bakcStaked.tokenId, address(proxy));
            bakcOwnerOf[bakcStaked.tokenId] = bakcStaked.staker;
        }
    }

    function lockFlashloan(address nftAsset, uint256 tokenId) external onlyCaller(matcher) whenNotPaused {
        require(nftAsset == address(bayc) || nftAsset == address(mayc), "StakeManager: not ape collection");
        ILendPoolLoan poolLoan = lendPoolAddressedProvider.getLendPoolLoan();
        address[] memory interceptors = poolLoan.getLoanRepaidInterceptors(nftAsset, tokenId);
        for (uint256 i = 0; i < interceptors.length; i++) {
            if (interceptors[i] == address(this)) {
                return;
            }
        }
        poolLoan.setFlashLoanLocking(nftAsset, tokenId, true);
        poolLoan.addLoanRepaidInterceptor(nftAsset, tokenId);
    }

    function _unStake(IStakeProxy proxy, address staker) internal {
        // unstake from proxy
        _unStakeProxy(proxy, staker);
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
        // withdraw nft
        _withdrawNFTIfNecessary(proxy, staker);
    }

    function _unStakeProxy(IStakeProxy proxy, address staker) internal {
        if (proxy.unStaked()) {
            return;
        }
        DataTypes.ApeStaked memory apeStaked = proxy.apeStaked();
        DataTypes.BakcStaked memory bakcStaked = proxy.bakcStaked();

        IERC721Upgradeable iApe = IERC721Upgradeable(apeStaked.collection);

        // should transfer nft to proxy when unstake
        iApe.safeTransferFrom(address(this), address(proxy), apeStaked.tokenId);
        if (!bakcStaked.isNull()) {
            bakc.safeTransferFrom(address(this), address(proxy), bakcStaked.tokenId);
        }

        // do proxy unstake
        proxy.unStake();

        // check nft ownership
        require(iApe.ownerOf(apeStaked.tokenId) == address(this), "StakeManager: not ape owner");
        if (!bakcStaked.isNull()) {
            require(bakc.ownerOf(bakcStaked.tokenId) == address(this), "StakeManager: not bakc owner");
            // remove staked proxy for bakc
            _stakedProxies.remove(address(bakc), bakcStaked.tokenId, address(proxy));
        }

        // remove staked proxy for ape
        _stakedProxies.remove(apeStaked.collection, apeStaked.tokenId, address(proxy));
        emit UnStaked(address(proxy), staker);
    }

    function _withdrawNFTIfNecessary(IStakeProxy proxy, address staker) internal {
        if (!proxy.unStaked()) {
            return;
        }
        DataTypes.ApeStaked memory apeStaked = proxy.apeStaked();
        DataTypes.BakcStaked memory bakcStaked = proxy.bakcStaked();

        address apeCollection = apeStaked.collection;
        uint256 apeTokenId = apeStaked.tokenId;
        address apeStaker = apeStaked.staker;

        address bakcStaker = bakcStaked.staker;
        uint256 bakcTokenId = bakcStaked.tokenId;

        if (_stakedProxies.isEmpty(apeCollection, apeTokenId) && staker == apeStaker) {
            // burn bound ape if all prox unstaked and no debt in lending pool
            IBNFT boundApe = _getBNFT(apeCollection);
            if (boundApe.minterOf(apeTokenId) == address(this) && boundApe.ownerOf(apeTokenId) == apeStaker) {
                boundApe.setFlashLoanLocking(apeTokenId, false);
                boundApe.burn(apeTokenId);
                IERC721Upgradeable(apeCollection).safeTransferFrom(address(this), apeStaker, apeTokenId);
            }
        }
        if (
            _stakedProxies.isEmpty(address(bakc), bakcTokenId) &&
            bakcStaker == staker &&
            bakcOwnerOf[bakcTokenId] == staker
        ) {
            bakc.safeTransferFrom(address(this), bakcStaker, bakcTokenId);
            bakcOwnerOf[bakcTokenId] = address(0);
        }
    }

    function _claim(IStakeProxy proxy, address staker) internal {
        bool nftTransfered = false;

        DataTypes.ApeStaked memory apeStaked = proxy.apeStaked();
        DataTypes.BakcStaked memory bakcStaked = proxy.bakcStaked();

        address apeCollection = apeStaked.collection;
        uint256 apeTokenId = apeStaked.tokenId;
        uint256 bakcTokenId = bakcStaked.tokenId;

        IERC721Upgradeable iApe = IERC721Upgradeable(apeCollection);

        // should transfer ape to proxy if not unstaked
        if (!proxy.unStaked()) {
            iApe.safeTransferFrom(address(this), address(proxy), apeTokenId);
            if (!bakcStaked.isNull()) {
                bakc.safeTransferFrom(address(this), address(proxy), bakcTokenId);
            }
            nftTransfered = true;
        }

        // claim rewards for staker
        (uint256 toStaker, uint256 toFee) = proxy.claim(staker, fee, feeRecipient);

        // check nft ownership
        if (nftTransfered) {
            require(iApe.ownerOf(apeTokenId) == address(this), "StakeManager: not ape owner");
            if (!bakcStaked.isNull()) {
                require(bakc.ownerOf(bakcTokenId) == address(this), "StakeManager: not bakc owner");
            }
        }

        if (toStaker > 0) {
            emit Claimed(staker, toStaker);
        }
        if (toFee > 0) {
            emit FeePaid(staker, feeRecipient, toFee);
        }
    }

    function borrowETH(
        uint256 amount,
        address nftAsset,
        uint256 nftTokenId
    ) external whenNotPaused {
        IBNFT boundApe = _getBNFT(nftAsset);
        require(boundApe.ownerOf(nftTokenId) == _msgSender(), "StakeManager: not bnft owner");
        require(boundApe.minterOf(nftTokenId) == address(this), "StakeManager: not bnft minter");
        boundApe.burn(nftTokenId);

        ILendPool pool = lendPoolAddressedProvider.getLendPool();
        ILendPoolLoan poolLoan = lendPoolAddressedProvider.getLendPoolLoan();
        poolLoan.addLoanRepaidInterceptor(nftAsset, nftTokenId);
        pool.borrow(address(WETH), amount, nftAsset, nftTokenId, _msgSender(), 0);
        WETH.withdraw(amount);
        AddressUpgradeable.sendValue(payable(_msgSender()), amount);
    }

    function _getBNFT(address apeCollection) internal view returns (IBNFT) {
        require(apeCollection == address(bayc) || apeCollection == address(mayc), "StakeManager: not ape collection");
        if (apeCollection == address(mayc)) {
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
        ) = apeCoinStaking.getPoolsUI();

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
        return proxy.claimable(staker);
    }

    function withdrawable(IStakeProxy proxy, address staker) external view onlyProxy(proxy) returns (uint256) {
        return proxy.withdrawable(staker);
    }

    function getStakedProxies(address nftAsset, uint256 tokenId) external view returns (address[] memory) {
        return _stakedProxies.values(nftAsset, tokenId);
    }
}
