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
import {EnumerableSetUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import {IWETH} from "./interfaces/IWETH.sol";
import {ILoanRepaidInterceptor} from "./interfaces/ILoanRepaidInterceptor.sol";
import {IApeCoinStaking} from "./interfaces/IApeCoinStaking.sol";
import {IStakerProxy} from "./interfaces/IStakerProxy.sol";
import {IStakeManager, DataTypes} from "./interfaces/IStakeManager.sol";
import {ILendPoolAddressesProvider, ILendPool, ILendPoolLoan} from "./interfaces/ILendPoolAddressesProvider.sol";
import {PercentageMath} from "./libraries/PercentageMath.sol";
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

    enum FlashCall {
        UNKNOWN,
        STAKE,
        UNSTAKE,
        CLAIM
    }

    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    mapping(address => mapping(uint256 => EnumerableSetUpgradeable.AddressSet)) private _stakedProxies;
    mapping(address => bool) public proxies;

    address public override feeRecipient;
    uint256 public override fee;

    address public boundBayc;
    address public boundMayc;

    address public bayc;
    address public mayc;
    address public bakc;

    address public apeCoin;
    IWETH public WETH;

    IApeCoinStaking public apeCoinStaking;

    address public proxyImplementation;

    address public matcher;

    ILendPoolAddressesProvider public lendPoolAddressedProvider;

    modifier onlyCaller(address caller) {
        require(_msgSender() == caller, "Manager: not a valid caller");
        _;
    }

    modifier onlyStaker(IStakerProxy proxy) {
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

    modifier onlyProxy(IStakerProxy proxy) {
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
        boundBayc = boundBayc_;
        boundMayc = boundMayc_;
        bayc = bayc_;
        mayc = mayc_;
        bakc = bakc_;
        apeCoin = apeCoin_;
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
        require(matcher_ != address(0), "Manager: matcher can't be zero address");
        matcher = matcher_;
    }

    function updateFeeRecipient(address feeRecipient_) external override onlyOwner {
        require(feeRecipient_ != address(0), "Manager: fee recipient can't be zero address");
        feeRecipient = feeRecipient_;
    }

    function updateFee(uint256 fee_) external override onlyOwner {
        require(fee_ <= PercentageMath.PERCENTAGE_FACTOR, "Manager: fee overflow");
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
            _msgSender() == operator && (operator == boundBayc || operator == boundMayc),
            "Flashloan: operator is not bound ape"
        );
        require(asset == bayc || asset == mayc, "Flashloan: not ape asset");
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
            _unStake(IStakerProxy(proxy), staker);
        } else if (FlashCall.CLAIM == callType) {
            (address proxy, address staker) = abi.decode(param, (address, address));
            _claim(IStakerProxy(proxy), staker);
        }
        if (asset == bayc) {
            IERC721Upgradeable(bayc).approve(boundBayc, tokenIds[0]);
        } else {
            IERC721Upgradeable(mayc).approve(boundMayc, tokenIds[0]);
        }
        return true;
    }

    function beforeLoanRepaid(address nftAsset, uint256 nftTokenId) external override returns (bool) {
        require(_msgSender() == boundBayc || _msgSender() == boundMayc, "LoanRepaid: sender invalid");
        EnumerableSetUpgradeable.AddressSet storage proxySet = _stakedProxies[nftAsset][nftTokenId];
        uint256 length = proxySet.length();
        address[] memory proxiesCopy = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            proxiesCopy[i] = proxySet.at(i);
        }
        for (uint256 i = 0; i < length; i++) {
            IStakerProxy proxy = IStakerProxy(proxiesCopy[i]);
            if (!proxy.unStaked()) {
                // burn bound ape, so here staker is ape holder
                bytes memory param = abi.encode(proxy, proxy.apeStaked().staker);
                _flashCall(FlashCall.UNSTAKE, proxy.apeStaked().collection, proxy.apeStaked().tokenId, param);
            }
        }
        return true;
    }

    function afterLoanRepaid(address, uint256) external view override returns (bool) {
        require(_msgSender() == boundBayc || _msgSender() == boundMayc, "LoanRepaid: sender invalid");
        return true;
    }

    function flashStake(
        DataTypes.ApeStaked memory apeStaked,
        DataTypes.BakcStaked memory bakcStaked,
        DataTypes.CoinStaked memory coinStaked
    ) external override onlyCaller(matcher) nonReentrant whenNotPaused {
        bytes memory param = abi.encode(apeStaked, bakcStaked, coinStaked);
        _flashCall(FlashCall.STAKE, apeStaked.collection, apeStaked.tokenId, param);
    }

    function mintBoundApe(
        address ape,
        uint256 tokenId,
        address to
    ) external override onlyCaller(matcher) whenNotPaused {
        require(ape == boundBayc || ape == boundMayc, "BNFT: not a valid bound ape");
        IBNFT boundApe = IBNFT(ape);
        boundApe.mint(to, tokenId);
    }

    function flashUnstake(IStakerProxy proxy) external override onlyStaker(proxy) {
        bytes memory param = abi.encode(proxy, _msgSender());
        _flashCall(FlashCall.UNSTAKE, proxy.apeStaked().collection, proxy.apeStaked().tokenId, param);
    }

    function flashClaim(IStakerProxy proxy) external override onlyStaker(proxy) {
        bytes memory param = abi.encode(proxy, _msgSender());
        _flashCall(FlashCall.CLAIM, proxy.apeStaked().collection, proxy.apeStaked().tokenId, param);
    }

    function _flashCall(
        FlashCall callType,
        address boundApeCollection,
        uint256 tokenId,
        bytes memory param
    ) internal nonReentrant whenNotPaused {
        uint256[] memory ids = new uint256[](1);
        ids[0] = tokenId;
        IBNFT boundApe = IBNFT(boundApeCollection);
        bytes memory data = abi.encode(callType, param);
        boundApe.flashLoan(address(this), ids, data);
    }

    function _stake(
        DataTypes.ApeStaked memory apeStaked,
        DataTypes.BakcStaked memory bakcStaked,
        DataTypes.CoinStaked memory coinStaked
    ) internal {
        require(_isBoundApe(apeStaked.collection), "Manager: only bound ape allowed");
        IStakerProxy proxy = IStakerProxy(proxyImplementation.clone());

        address ape = IBNFT(apeStaked.collection).underlyingAsset();
        IERC20Upgradeable(ape).safeTransferFrom(address(this), address(proxy), apeStaked.tokenId);

        uint256 coinAmount = apeStaked.coinAmount;

        if (!bakcStaked.isNull()) {
            coinAmount += bakcStaked.coinAmount;
            IERC20Upgradeable(bakc).safeTransferFrom(address(this), address(proxy), bakcStaked.tokenId);
        }

        if (!coinStaked.isNull()) {
            coinAmount += coinStaked.coinAmount;
        }

        IERC20Upgradeable(apeCoin).safeTransfer(address(proxy), coinAmount);
        proxy.initialize(address(this), bayc, mayc, bakc, boundBayc, boundMayc, apeCoin, address(apeCoinStaking));
        proxy.stake(apeStaked, bakcStaked, coinStaked);
        proxies[address(proxy)] = true;
        // add staked proxy
        uint256 tokenId = proxy.apeStaked().tokenId;
        _stakedProxies[ape][tokenId].add(address(proxy));
        emit Staked(address(proxy), apeStaked.offerHash, bakcStaked.offerHash, coinStaked.offerHash);
    }

    function unStakeBeforeBNFTBurn(address bNftAddress, uint256 tokenId) external onlyCaller(matcher) whenNotPaused {
        lendPoolAddressedProvider.getLendPoolLoan().addLoanRepaidInterceptor(bNftAddress, tokenId);
    }

    function _unStake(IStakerProxy proxy, address staker) internal {
        proxy.unStake();
        // remove staked proxy
        address ape = IBNFT(proxy.apeStaked().collection).underlyingAsset();
        uint256 tokenId = proxy.apeStaked().tokenId;
        _stakedProxies[ape][tokenId].remove(address(proxy));
        emit UnStaked(address(proxy));
        uint256 amount = proxy.withdraw(staker);
        if (amount > 0) {
            emit Withdrawn(staker, amount);
        }
        _claim(proxy, staker);
    }

    function _claim(IStakerProxy proxy, address staker) internal {
        IStakerProxy stakerProxy = IStakerProxy(proxy);
        (uint256 toStaker, uint256 toFee) = stakerProxy.claim(staker, fee, feeRecipient);
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
        require(nftAsset == bayc || nftAsset == mayc, "Borrow: not ape collection");
        IBNFT boundApe = IBNFT(boundBayc);
        if (nftAsset == mayc) {
            boundApe = IBNFT(boundMayc);
        }
        require(boundApe.ownerOf(nftTokenId) == _msgSender(), "Borrow: no bnft ownership");
        require(boundApe.minterOf(nftTokenId) == address(this), "Borrow: not bnft minter");
        boundApe.burn(nftTokenId);
        ILendPool pool = lendPoolAddressedProvider.getLendPool();
        ILendPoolLoan poolLoan = lendPoolAddressedProvider.getLendPoolLoan();

        uint256 loanId = poolLoan.getCollateralLoanId(nftAsset, nftTokenId);
        if (loanId == 0) {
            IERC721Upgradeable(nftAsset).safeTransferFrom(_msgSender(), address(this), nftTokenId);
        }

        pool.borrow(address(WETH), amount, nftAsset, nftTokenId, _msgSender(), 0);
        WETH.withdraw(amount);
        AddressUpgradeable.sendValue(payable(_msgSender()), amount);
    }

    function claimable(IStakerProxy proxy, address staker) external view onlyProxy(proxy) returns (uint256) {
        IStakerProxy stakerProxy = IStakerProxy(proxy);
        return stakerProxy.claimable(staker);
    }

    function withdrawable(IStakerProxy proxy, address staker) external view onlyProxy(proxy) returns (uint256) {
        IStakerProxy stakerProxy = IStakerProxy(proxy);
        return stakerProxy.withdrawable(staker);
    }

    function _isBoundApe(address apeCollection) internal view returns (bool) {
        return apeCollection == boundBayc || apeCollection == boundMayc;
    }
}
