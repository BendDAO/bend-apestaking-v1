// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

library DataTypes {
    uint256 internal constant BAYC_POOL_ID = 1;
    uint256 internal constant MAYC_POOL_ID = 2;
    uint256 internal constant BAKC_POOL_ID = 3;

    bytes32 internal constant APE_OFFER_HASH =
        keccak256(
            "ApeOffer(uint8 poolId,address staker,address bakcOfferor,address coinOfferor,address collection,uint256 tokenId,uint256 coinAmount,uint256 apeShare,uint256 coinShare,uint256 startTime,uint256 endTime,uint256 nonce)"
        );

    bytes32 internal constant BAKC_OFFER_HASH =
        keccak256(
            "BakcOffer(address staker,address apeOfferor,address coinOfferor,uint256 tokenId,uint256 coinAmount,uint256 bakcShare,uint256 coinShare,uint256 startTime,uint256 endTime,uint256 nonce)"
        );

    bytes32 internal constant COIN_OFFER_HASH =
        keccak256(
            "CoinOffer(address staker,address apeOfferor,address bakcOfferor,uint256 coinAmount,uint256 coinShare,uint256 startTime,uint256 endTime,uint256 nonce)"
        );

    struct ApeOffer {
        uint8 poolId;
        address staker;
        address bakcOfferor;
        address coinOfferor;
        address collection;
        uint256 tokenId;
        uint256 coinAmount;
        uint256 apeShare;
        uint256 coinShare;
        uint256 startTime;
        uint256 endTime;
        uint256 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
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

    struct BakcOffer {
        address staker;
        address apeOfferor;
        address coinOfferor;
        uint256 tokenId;
        uint256 coinAmount;
        uint256 bakcShare;
        uint256 coinShare;
        uint256 startTime;
        uint256 endTime;
        uint256 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct BakcStaked {
        bytes32 offerHash;
        address staker;
        uint256 tokenId;
        uint256 coinAmount;
        uint256 bakcShare;
        uint256 coinShare;
    }

    struct CoinOffer {
        uint8 poolId;
        address staker;
        address apeOfferor;
        address bakcOfferor;
        uint256 coinAmount;
        uint256 coinShare;
        uint256 startTime;
        uint256 endTime;
        uint256 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct CoinStaked {
        bytes32 offerHash;
        address staker;
        uint256 coinAmount;
        uint256 coinShare;
    }

    function hash(ApeOffer memory apeOffer) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    APE_OFFER_HASH,
                    apeOffer.poolId,
                    apeOffer.staker,
                    apeOffer.bakcOfferor,
                    apeOffer.coinOfferor,
                    apeOffer.collection,
                    apeOffer.tokenId,
                    apeOffer.coinAmount,
                    apeOffer.apeShare,
                    apeOffer.coinShare,
                    apeOffer.startTime,
                    apeOffer.endTime,
                    apeOffer.nonce
                )
            );
    }

    function hash(BakcOffer memory bakcOffer) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    BAKC_OFFER_HASH,
                    bakcOffer.staker,
                    bakcOffer.apeOfferor,
                    bakcOffer.coinOfferor,
                    bakcOffer.tokenId,
                    bakcOffer.coinAmount,
                    bakcOffer.bakcShare,
                    bakcOffer.coinShare,
                    bakcOffer.startTime,
                    bakcOffer.endTime,
                    bakcOffer.nonce
                )
            );
    }

    function hash(CoinOffer memory coinOffer) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    COIN_OFFER_HASH,
                    coinOffer.poolId,
                    coinOffer.staker,
                    coinOffer.apeOfferor,
                    coinOffer.bakcOfferor,
                    coinOffer.coinAmount,
                    coinOffer.coinShare,
                    coinOffer.startTime,
                    coinOffer.endTime,
                    coinOffer.nonce
                )
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

    function toStaked(BakcOffer memory bakcOffer) internal pure returns (BakcStaked memory bakcStaked) {
        bakcStaked.offerHash = hash(bakcOffer);
        bakcStaked.staker = bakcOffer.staker;
        bakcStaked.tokenId = bakcOffer.tokenId;
        bakcStaked.coinAmount = bakcOffer.coinAmount;
        bakcStaked.bakcShare = bakcOffer.bakcShare;
        bakcStaked.coinShare = bakcOffer.coinShare;
    }

    function toStaked(CoinOffer memory coinOffer) internal pure returns (CoinStaked memory coinStaked) {
        coinStaked.offerHash = hash(coinOffer);
        coinStaked.staker = coinOffer.staker;
        coinStaked.coinAmount = coinOffer.coinAmount;
        coinStaked.coinShare = coinOffer.coinShare;
    }
}
