// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
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
    IStakeManager,
    IFlashLoanReceiver,
    ILoanRepaidInterceptor,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC721HolderUpgradeable
{
    using ClonesUpgradeable for address;
    using AddressUpgradeable for address;
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using DataTypes for DataTypes.ApeStaked;
    using DataTypes for DataTypes.BakcStaked;
    using DataTypes for DataTypes.CoinStaked;
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

    modifier onlyStaker(address proxy) {
        IStakerProxy stakerProxy = IStakerProxy(proxy);
        address _sender = _msgSender();
        require(
            _sender == stakerProxy.apeStaked().staker ||
                _sender == stakerProxy.bakcStaked().staker ||
                _sender == stakerProxy.coinStaked().staker,
            "Manager: not valid staker"
        );
        _;
    }

    modifier onlyCaller(address caller) {
        require(_msgSender() == caller, "Manager: not a valid caller");
        _;
    }

    modifier onlySelf() {
        require(_msgSender() == address(this), "Manager: not a valid caller");
        _;
    }

    modifier onlyValidProxy(address proxy) {
        require(proxies[proxy], "Manager: not a valid proxy");
        _;
    }

    function initialize(
        address bayc_,
        address mayc_,
        address bakcStaked,
        address boundBayc_,
        address boundMayc_,
        address apeCoin_,
        address apeCoinStaking_,
        address WETH_,
        address proxyImplementation_,
        address matcher_,
        address lendPoolAddressedProvider_
    ) external initializer {
        __Ownable_init();
        __ReentrancyGuard_init();
        boundBayc = boundBayc_;
        boundMayc = boundMayc_;
        bayc = bayc_;
        mayc = mayc_;
        bakc = bakcStaked;
        apeCoin = apeCoin_;
        WETH = IWETH(WETH_);
        apeCoinStaking = IApeCoinStaking(apeCoinStaking_);
        proxyImplementation = proxyImplementation_;
        matcher = matcher_;
        lendPoolAddressedProvider = ILendPoolAddressesProvider(lendPoolAddressedProvider_);
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
    ) external returns (bool) {
        require(address(this) == initiator, "Flashloan: invalid initiator");
        require(
            _msgSender() == operator && (operator == boundBayc || operator == boundMayc),
            "Flashloan: operator is not bound ape"
        );
        require(asset == bayc || asset == mayc, "Flashloan: not ape asset");
        require(tokenIds.length == 1, "Flashloan: multiple apes not supported");

        address(this).functionCall(params);
        return true;
    }

    function beforeLoanRepaid(address nftAsset, uint256 nftTokenId) external override returns (bool) {
        require(_msgSender() == boundBayc || _msgSender() == boundMayc, "Matcher: burn sender invalid");
        EnumerableSetUpgradeable.AddressSet storage proxySet = _stakedProxies[nftAsset][nftTokenId];
        uint256 length = proxySet.length();
        address[] memory proxiesCopy = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            proxiesCopy[i] = proxySet.at(i);
        }
        for (uint256 i = 0; i < length; i++) {
            IStakerProxy proxy = IStakerProxy(proxiesCopy[i]);
            if (!proxy.unStaked()) {
                _flashCall(address(proxy), this.unStake.selector);
            }
        }
        return true;
    }

    function afterLoanRepaid(address, uint256) external view override returns (bool) {
        require(_msgSender() == boundBayc || _msgSender() == boundMayc, "Matcher: burn sender invalid");
        return true;
    }

    function flashStake(
        DataTypes.ApeStaked memory apeStaked,
        DataTypes.BakcStaked memory bakcStaked,
        DataTypes.CoinStaked memory coinStaked
    ) external override onlyCaller(matcher) nonReentrant {
        IBNFT boundApe = IBNFT(apeStaked.collection);
        uint256[] memory ids = new uint256[](1);
        ids[0] = apeStaked.tokenId;
        bytes memory dataStaked = abi.encodeWithSelector(this.stake.selector, apeStaked, bakcStaked, coinStaked);
        boundApe.flashLoan(address(this), ids, dataStaked);
    }

    function mintBoundApe(
        address ape,
        uint256 tokenId,
        address to
    ) external override onlyCaller(matcher) {
        require(ape == boundBayc || ape == boundMayc, "BNFT: not a valid bound ape");
        IBNFT boundApe = IBNFT(ape);
        boundApe.mint(to, tokenId);
    }

    function flashUnstake(address proxy) external override {
        _flashCall(proxy, this.unStake.selector);
    }

    function flashClaim(address proxy) external override {
        _flashCall(proxy, this.claim.selector);
    }

    function flashWithdraw(address proxy) external override {
        _flashCall(proxy, this.withdraw.selector);
    }

    function _flashCall(address proxy, bytes4 selector) internal onlyStaker(proxy) onlyValidProxy(proxy) nonReentrant {
        IStakerProxy stakerProxy = IStakerProxy(proxy);
        uint256[] memory ids = new uint256[](1);
        ids[0] = stakerProxy.apeStaked().tokenId;
        IBNFT boundApe = IBNFT(stakerProxy.apeStaked().collection);
        bytes memory data = abi.encodeWithSelector(selector, proxy, _msgSender());
        boundApe.flashLoan(address(this), ids, data);
    }

    function stake(
        DataTypes.ApeStaked memory apeStaked,
        DataTypes.BakcStaked memory bakcStaked,
        DataTypes.CoinStaked memory coinStaked
    ) external override onlySelf {
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

    function unStakeBeforeBNFTBurn(address bNftAddress, uint256 tokenId) external onlyCaller(matcher) {
        lendPoolAddressedProvider.getLendPoolLoan().addLoanRepaidInterceptor(bNftAddress, tokenId);
    }

    function unStake(address proxy) external override onlySelf onlyValidProxy(proxy) {
        _unStake(IStakerProxy(proxy));
    }

    function _unStake(IStakerProxy proxy) internal {
        proxy.unStake();
        // remove staked proxy
        address ape = IBNFT(proxy.apeStaked().collection).underlyingAsset();
        uint256 tokenId = proxy.apeStaked().tokenId;
        _stakedProxies[ape][tokenId].remove(address(proxy));
        emit UnStaked(address(proxy));
    }

    function claim(address proxy, address staker) external override onlySelf onlyValidProxy(proxy) {
        IStakerProxy stakerProxy = IStakerProxy(proxy);
        (uint256 toStaker, uint256 toFee) = stakerProxy.claim(staker, fee, feeRecipient);
        emit Claimed(staker, toStaker);
        emit FeePaid(staker, feeRecipient, toFee);
    }

    function withdraw(address proxy, address staker) external override onlySelf onlyValidProxy(proxy) {
        IStakerProxy stakerProxy = IStakerProxy(proxy);
        if (!stakerProxy.unStaked()) {
            _unStake(stakerProxy);
        }
        uint256 amount = stakerProxy.withdraw(staker);
        if (amount > 0) {
            emit Withdrawn(staker, amount);
        }
    }

    function borrowETH(
        uint256 amount,
        address nftAsset,
        uint256 nftTokenId
    ) external {
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

    function claimable(address proxy, address staker) external view onlyValidProxy(proxy) returns (uint256) {
        IStakerProxy stakerProxy = IStakerProxy(proxy);
        return stakerProxy.claimable(staker);
    }

    function withdrawable(address proxy, address staker) external view onlyValidProxy(proxy) returns (uint256) {
        IStakerProxy stakerProxy = IStakerProxy(proxy);
        return stakerProxy.withdrawable(staker);
    }

    function _isBoundApe(address apeCollection) internal view returns (bool) {
        return apeCollection == boundBayc || apeCollection == boundMayc;
    }
}
