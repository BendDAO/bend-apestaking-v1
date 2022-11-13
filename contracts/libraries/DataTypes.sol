// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

library DataTypes {
    uint256 internal constant BAYC_POOL_ID = 1;
    uint256 internal constant MAYC_POOL_ID = 2;
    uint256 internal constant BAKC_POOL_ID = 3;
    enum PoolType {
        UNKNOWN,
        SINGLE,
        PAIRED
    }

    bytes32 internal constant APE_OFFER_HASH =
        keccak256(
            "ApeOffer(uint8 poolType,address staker,address collection,uint256 tokenId,uint256 coinAmount,uint256 apeShare,uint256 coinShare,uint256 endTime,uint256 nonce)"
        );

    bytes32 internal constant APE_OFFER_KEY =
        keccak256("ApeOffer(uint8 poolType,address staker,address collection,uint256 tokenId)");

    bytes32 internal constant BAKC_OFFER_HASH =
        keccak256(
            "BakcOffer(bytes32 key,address staker,uint256 tokenId,uint256 coinAmount,uint256 bakcShare,uint256 coinShare,uint256 endTime,uint256 nonce)"
        );

    bytes32 internal constant COIN_OFFER_HASH =
        keccak256(
            "CoinOffer(bytes32 key,address staker,uint256 coinAmount,uint256 coinShare,uint256 endTime,uint256 nonce)"
        );

    struct ApeOffer {
        PoolType poolType;
        address staker;
        address collection;
        uint256 tokenId;
        uint256 coinAmount;
        uint256 apeShare;
        uint256 coinShare;
        uint256 endTime;
        uint256 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function hash(ApeOffer memory apeOffer) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    APE_OFFER_HASH,
                    apeOffer.poolType,
                    apeOffer.staker,
                    apeOffer.collection,
                    apeOffer.tokenId,
                    apeOffer.coinAmount,
                    apeOffer.apeShare,
                    apeOffer.coinShare,
                    apeOffer.endTime,
                    apeOffer.nonce
                )
            );
    }

    function key(ApeOffer memory apeOffer) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(APE_OFFER_KEY, apeOffer.poolType, apeOffer.staker, apeOffer.collection, apeOffer.tokenId)
            );
    }

    function toStaked(ApeOffer memory apeOffer) internal pure returns (ApeStaked memory apeStaked) {
        apeStaked.offerHash = hash(apeOffer);
        apeStaked.staker = apeOffer.staker;
        apeStaked.collection = apeOffer.collection;
        apeStaked.tokenId = apeOffer.tokenId;
        apeStaked.coinAmount = apeOffer.coinAmount;
        apeStaked.apeShare = apeStaked.apeShare;
        apeStaked.coinShare = apeStaked.coinShare;
    }

    struct BakcOffer {
        bytes32 key;
        address staker;
        uint256 tokenId;
        uint256 coinAmount;
        uint256 bakcShare;
        uint256 coinShare;
        uint256 endTime;
        uint256 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function isNull(BakcOffer memory bakcOffer) internal pure returns (bool) {
        return (bakcOffer.key == 0 &&
            bakcOffer.staker == address(0) &&
            bakcOffer.tokenId == 0 &&
            bakcOffer.coinAmount == 0 &&
            bakcOffer.bakcShare == 0 &&
            bakcOffer.coinShare == 0 &&
            bakcOffer.nonce == 0 &&
            bakcOffer.v == 0 &&
            bakcOffer.r == 0 &&
            bakcOffer.s == 0);
    }

    function toStaked(BakcOffer memory bakcOffer) internal pure returns (BakcStaked memory bakcStaked) {
        bakcStaked.offerHash = hash(bakcOffer);
        bakcStaked.staker = bakcOffer.staker;
        bakcStaked.tokenId = bakcOffer.tokenId;
        bakcStaked.coinAmount = bakcOffer.coinAmount;
        bakcStaked.bakcShare = bakcOffer.bakcShare;
        bakcStaked.coinShare = bakcOffer.coinShare;
    }

    function hash(BakcOffer memory bakcOffer) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    BAKC_OFFER_HASH,
                    bakcOffer.key,
                    bakcOffer.staker,
                    bakcOffer.tokenId,
                    bakcOffer.coinAmount,
                    bakcOffer.bakcShare,
                    bakcOffer.coinShare,
                    bakcOffer.endTime,
                    bakcOffer.nonce
                )
            );
    }

    struct CoinOffer {
        bytes32 key;
        address staker;
        uint256 coinAmount;
        uint256 coinShare;
        uint256 endTime;
        uint256 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function isNull(CoinOffer memory coinOffer) internal pure returns (bool) {
        return (coinOffer.key == 0 &&
            coinOffer.staker == address(0) &&
            coinOffer.coinAmount == 0 &&
            coinOffer.coinShare == 0 &&
            coinOffer.nonce == 0 &&
            coinOffer.v == 0 &&
            coinOffer.r == 0 &&
            coinOffer.s == 0);
    }

    function toStaked(CoinOffer memory coinOffer) internal pure returns (CoinStaked memory coinStaked) {
        coinStaked.offerHash = hash(coinOffer);
        coinStaked.staker = coinOffer.staker;
        coinStaked.coinAmount = coinOffer.coinAmount;
        coinStaked.coinShare = coinOffer.coinShare;
    }

    function hash(CoinOffer memory coinOffer) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    COIN_OFFER_HASH,
                    coinOffer.key,
                    coinOffer.staker,
                    coinOffer.coinAmount,
                    coinOffer.coinShare,
                    coinOffer.endTime,
                    coinOffer.nonce
                )
            );
    }

    struct ApeStaked {
        bytes32 offerHash;
        address staker;
        address collection;
        uint256 tokenId;
        uint256 coinAmount;
        uint256 apeShare;
        uint256 coinShare;
    }

    function isNull(ApeStaked memory apeStaked) internal pure returns (bool) {
        return (apeStaked.staker == address(0) &&
            apeStaked.collection == address(0) &&
            apeStaked.tokenId == 0 &&
            apeStaked.coinAmount == 0 &&
            apeStaked.apeShare == 0 &&
            apeStaked.coinShare == 0);
    }

    struct BakcStaked {
        bytes32 offerHash;
        address staker;
        uint256 tokenId;
        uint256 coinAmount;
        uint256 bakcShare;
        uint256 coinShare;
    }

    function isNull(BakcStaked memory bakcStaked) internal pure returns (bool) {
        return (bakcStaked.staker == address(0) &&
            bakcStaked.tokenId == 0 &&
            bakcStaked.coinAmount == 0 &&
            bakcStaked.bakcShare == 0 &&
            bakcStaked.coinShare == 0);
    }

    struct CoinStaked {
        bytes32 offerHash;
        address staker;
        uint256 coinAmount;
        uint256 coinShare;
    }

    function isNull(CoinStaked memory coinStaked) internal pure returns (bool) {
        return (coinStaked.staker == address(0) && coinStaked.coinAmount == 0 && coinStaked.coinShare == 0);
    }
}
