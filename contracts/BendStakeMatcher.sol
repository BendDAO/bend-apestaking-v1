// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {SignatureCheckerUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";
import {ECDSAUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import {IBNFT, IERC721Upgradeable} from "./interfaces/IBNFT.sol";
import {IStakingMatcher, DataTypes} from "./interfaces/IStakingMatcher.sol";
import {IStakeManager} from "./interfaces/IStakeManager.sol";
import {ILendPoolAddressesProvider, ILendPool, ILendPoolLoan} from "./interfaces/ILendPoolAddressesProvider.sol";
import {PercentageMath} from "./libraries/PercentageMath.sol";

contract BendStakeMatcher is IStakingMatcher, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using DataTypes for DataTypes.ApeOffer;
    using DataTypes for DataTypes.BakcOffer;
    using DataTypes for DataTypes.CoinOffer;

    using DataTypes for DataTypes.BakcStaked;
    using DataTypes for DataTypes.CoinStaked;

    string public constant NAME = "BendStakeMatcher";
    string public constant VERSION = "1";

    uint256 public constant BAYC_POOL_MAX_COIN_CAP = 10094 * 1e18;
    uint256 public constant MAYC_POOL_MAX_COIN_CAP = 2042 * 1e18;
    uint256 public constant BAKC_POOL_MAX_COIN_CAP = 856 * 1e18;

    bytes32 public immutable DOMAIN_SEPARATOR;
    uint256 private immutable _CACHED_CHAIN_ID;
    address private immutable _CACHED_THIS;

    bytes32 private immutable _HASHED_NAME;
    bytes32 private immutable _HASHED_VERSION;
    bytes32 private immutable _TYPE_HASH;

    IStakeManager public stakeManager;
    ILendPoolAddressesProvider public lendPoolAddressedProvider;
    address public boundBayc;
    address public boundMayc;
    address public bayc;
    address public mayc;
    address public bakc;
    address public apeCoin;

    mapping(address => mapping(uint256 => bool)) private _isOfferNonceExecutedOrCancelled;

    constructor() {
        // keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
        _TYPE_HASH = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;
        // keccak256("BendStakeMatcher")
        _HASHED_NAME = 0xbcb698091c9b825f82b6d0957999ec0c6842230972755478948ae344e510f89c;
        // keccak256(bytes("1"))
        _HASHED_VERSION = 0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6;

        _CACHED_CHAIN_ID = block.chainid;
        _CACHED_THIS = address(this);

        DOMAIN_SEPARATOR = _buildDomainSeparator(_TYPE_HASH, _HASHED_NAME, _HASHED_VERSION);
    }

    function initialize(
        address lendPoolAddressedProvider_,
        address stakeManager_,
        address bayc_,
        address mayc_,
        address bakc_,
        address boundBayc_,
        address boundMayc_,
        address apeCoin_
    ) external initializer {
        __Ownable_init();
        __ReentrancyGuard_init();
        lendPoolAddressedProvider = ILendPoolAddressesProvider(lendPoolAddressedProvider_);
        stakeManager = IStakeManager(stakeManager_);
        boundBayc = boundBayc_;
        boundMayc = boundMayc_;
        bayc = bayc_;
        mayc = mayc_;
        bakc = bakc_;
        apeCoin = apeCoin_;
    }

    function cancelOffers(uint256[] calldata offerNonces) external override {
        require(offerNonces.length > 0, "Cancel: can not be empty");

        for (uint256 i = 0; i < offerNonces.length; i++) {
            _isOfferNonceExecutedOrCancelled[msg.sender][offerNonces[i]] = true;
        }

        emit OffersCanceled(msg.sender, offerNonces);
    }

    function isOfferNonceExecutedOrCancelled(address user, uint256 offerNonce) external view returns (bool) {
        return _isOfferNonceExecutedOrCancelled[user][offerNonce];
    }

    function matchWithBakcAndCoin(
        DataTypes.ApeOffer calldata apeOffer,
        DataTypes.BakcOffer calldata bakcOffer,
        DataTypes.CoinOffer calldata coinOffer
    ) external override nonReentrant {
        _validateApeOffer(apeOffer, DataTypes.PoolType.PAIRED);
        _validateBakcOffer(bakcOffer);
        _validateCoinOffer(coinOffer);

        bytes32 key = apeOffer.key();
        require(key == bakcOffer.key && apeOffer.coinShare == bakcOffer.coinShare, "Offer: invalid bakc offer");
        require(key == coinOffer.key && apeOffer.coinShare == coinOffer.coinShare, "Offer: invalid coin offer");
        require(
            apeOffer.apeShare + bakcOffer.bakcShare + coinOffer.coinShare == PercentageMath.PERCENTAGE_FACTOR,
            "Offer: share total amount invalid"
        );
        require(
            apeOffer.coinAmount + bakcOffer.coinAmount + coinOffer.coinAmount == BAKC_POOL_MAX_COIN_CAP * 1e18,
            "Offer: ape coin total amount invalid"
        );

        _flashStake(apeOffer.toStaked(), bakcOffer.toStaked(), coinOffer.toStaked());
    }

    function matchWithBakc(DataTypes.ApeOffer calldata apeOffer, DataTypes.BakcOffer calldata bakcOffer)
        external
        override
        nonReentrant
    {
        _validateApeOffer(apeOffer, DataTypes.PoolType.PAIRED);
        _validateBakcOffer(bakcOffer);
        bytes32 key = apeOffer.key();

        require(key == bakcOffer.key && apeOffer.coinShare == bakcOffer.coinShare, "Offer: invalid bakc offer");

        require(
            apeOffer.apeShare + bakcOffer.bakcShare + apeOffer.coinShare == PercentageMath.PERCENTAGE_FACTOR,
            "Offer: share total amount invalid"
        );

        require(
            apeOffer.coinAmount + bakcOffer.coinAmount == BAKC_POOL_MAX_COIN_CAP,
            "Offer: ape coin total amount invalid"
        );
        DataTypes.CoinStaked memory emptyCoinStaked;
        _flashStake(apeOffer.toStaked(), bakcOffer.toStaked(), emptyCoinStaked);
    }

    function matchWithCoin(DataTypes.ApeOffer calldata apeOffer, DataTypes.CoinOffer calldata coinOffer)
        external
        override
        nonReentrant
    {
        _validateApeOffer(apeOffer, DataTypes.PoolType.SINGLE);
        _validateCoinOffer(coinOffer);
        bytes32 key = apeOffer.key();

        require(key == coinOffer.key && apeOffer.coinShare == coinOffer.coinShare, "Offer: invalid coin offer");

        require(
            apeOffer.apeShare + coinOffer.coinShare == PercentageMath.PERCENTAGE_FACTOR,
            "Offer: share total amount invalid"
        );

        uint256 maxCap = BAYC_POOL_MAX_COIN_CAP;
        if (apeOffer.collection == mayc || apeOffer.collection == boundMayc) {
            maxCap = MAYC_POOL_MAX_COIN_CAP;
        }

        require(apeOffer.coinAmount + coinOffer.coinAmount == maxCap, "Offer: ape coin total amount invalid");

        DataTypes.BakcStaked memory emptyBakcStaked;
        _flashStake(apeOffer.toStaked(), emptyBakcStaked, coinOffer.toStaked());
    }

    function _flashStake(
        DataTypes.ApeStaked memory apeStaked,
        DataTypes.BakcStaked memory bakcStaked,
        DataTypes.CoinStaked memory coinStaked
    ) internal {
        IERC20Upgradeable _apeCoin = IERC20Upgradeable(apeCoin);

        if (apeStaked.coinAmount > 0) {
            _apeCoin.safeTransferFrom(apeStaked.staker, address(stakeManager), apeStaked.coinAmount);
        }

        if (!bakcStaked.isNull()) {
            IERC721Upgradeable(bakc).safeTransferFrom(bakcStaked.staker, address(stakeManager), bakcStaked.tokenId);
            if (bakcStaked.coinAmount > 0) {
                _apeCoin.safeTransferFrom(bakcStaked.staker, address(stakeManager), bakcStaked.coinAmount);
            }
        }

        if ((!coinStaked.isNull()) && coinStaked.coinAmount > 0) {
            _apeCoin.safeTransferFrom(coinStaked.staker, address(stakeManager), coinStaked.coinAmount);
        }

        if (_isApe(apeStaked.collection)) {
            IBNFT boundApe = IBNFT(boundBayc);
            if (apeStaked.collection == mayc) {
                boundApe = IBNFT(boundMayc);
            }
            IERC721Upgradeable(apeStaked.collection).safeTransferFrom(
                apeStaked.staker,
                address(this),
                apeStaked.tokenId
            );
            stakeManager.mintBoundApe(address(boundApe), apeStaked.tokenId, apeStaked.staker);
            apeStaked.collection = address(boundApe);
        } else {
            stakeManager.unStakeBeforeBNFTBurn(apeStaked.collection, apeStaked.tokenId);
        }

        stakeManager.flashStake(apeStaked, bakcStaked, coinStaked);
    }

    function _isBoundApe(address apeCollection) internal view returns (bool) {
        return apeCollection == boundBayc || apeCollection == boundMayc;
    }

    function _isApe(address apeCollection) internal view returns (bool) {
        return apeCollection == bayc || apeCollection == mayc;
    }

    function _validateApeOffer(DataTypes.ApeOffer memory apeOffer, DataTypes.PoolType poolType) internal view {
        require(_validateOfferNonce(apeOffer.staker, apeOffer.nonce), "Offer: ape offer expired");
        if (_isBoundApe(apeOffer.collection)) {
            require(
                apeOffer.poolType == poolType &&
                    IBNFT(apeOffer.collection).ownerOf(apeOffer.tokenId) == apeOffer.staker,
                "Offer: invalid ape offer"
            );
        } else {
            require(apeOffer.poolType == poolType && _isApe(apeOffer.collection), "Offer: invalid ape offer");
        }

        require(
            _validateOfferSignature(apeOffer.staker, apeOffer.hash(), apeOffer.r, apeOffer.s, apeOffer.v),
            "Offer: invalid ape offer signature"
        );
    }

    function _validateBakcOffer(DataTypes.BakcOffer memory bakcOffer) internal view {
        require(_validateOfferNonce(bakcOffer.staker, bakcOffer.nonce), "Offer: bakc offer expired");
        require(
            _validateOfferSignature(bakcOffer.staker, bakcOffer.hash(), bakcOffer.r, bakcOffer.s, bakcOffer.v),
            "Offer: invalid bakc offer signature"
        );
    }

    function _validateCoinOffer(DataTypes.CoinOffer memory coinOffer) internal view {
        require(_validateOfferNonce(coinOffer.staker, coinOffer.nonce), "Offer: coin offer expired");
        require(
            _validateOfferSignature(coinOffer.staker, coinOffer.hash(), coinOffer.r, coinOffer.s, coinOffer.v),
            "Offer: invalid coin offer signature"
        );
    }

    function _domainSeparatorV4() internal view returns (bytes32) {
        if (address(this) == _CACHED_THIS && block.chainid == _CACHED_CHAIN_ID) {
            return DOMAIN_SEPARATOR;
        } else {
            return _buildDomainSeparator(_TYPE_HASH, _HASHED_NAME, _HASHED_VERSION);
        }
    }

    function _buildDomainSeparator(
        bytes32 typeHash,
        bytes32 nameHash,
        bytes32 versionHash
    ) private view returns (bytes32) {
        return keccak256(abi.encode(typeHash, nameHash, versionHash, block.chainid, address(this)));
    }

    function _validateOfferNonce(address offeror, uint256 nonce) internal view returns (bool) {
        if (_msgSender() == offeror) {
            return nonce == 0;
        }
        return !_isOfferNonceExecutedOrCancelled[offeror][nonce];
    }

    function _validateOfferSignature(
        address signer,
        bytes32 offerHash,
        bytes32 r,
        bytes32 s,
        uint8 v
    ) internal view returns (bool) {
        if (_msgSender() == signer) {
            return true;
        }
        return
            SignatureCheckerUpgradeable.isValidSignatureNow(
                signer,
                ECDSAUpgradeable.toTypedDataHash(_domainSeparatorV4(), offerHash),
                abi.encodePacked(r, s, v)
            );
    }
}
