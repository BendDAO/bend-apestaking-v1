// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

interface IApeCoinStaking {
    struct SingleNft {
        uint256 tokenId;
        uint256 amount;
    }
    struct PairNftWithAmount {
        uint256 mainTokenId;
        uint256 bakcTokenId;
        uint256 amount;
    }
    struct PairNft {
        uint256 mainTokenId;
        uint256 bakcTokenId;
    }

    struct Position {
        uint256 stakedAmount;
        int256 rewardsDebt;
    }

    struct TimeRange {
        uint256 startTimestampHour;
        uint256 endTimestampHour;
        uint256 rewardsPerHour;
        uint256 capPerPosition;
    }

    struct Pool {
        uint256 lastRewardedTimestampHour;
        uint256 lastRewardsRangeIndex;
        uint256 stakedAmount;
        uint256 accumulatedRewardsPerShare;
        TimeRange[] timeRanges;
    }

    function pools(uint256 poolId) external view returns (Pool memory);

    function nftPosition(uint256 poolId, uint256 tokenId) external view returns (Position memory);

    function depositBAYC(SingleNft[] calldata _nfts) external;

    function depositMAYC(SingleNft[] calldata _nfts) external;

    function depositBAKC(PairNftWithAmount[] calldata _baycPairs, PairNftWithAmount[] calldata _maycPairs) external;

    function claimBAYC(uint256[] calldata _nfts, address _recipient) external;

    function claimMAYC(uint256[] calldata _nfts, address _recipient) external;

    function claimBAKC(
        PairNft[] calldata _baycPairs,
        PairNft[] calldata _maycPairs,
        address _recipient
    ) external;

    function withdrawBAYC(SingleNft[] calldata _nfts, address _recipient) external;

    function withdrawMAYC(SingleNft[] calldata _nfts, address _recipient) external;

    function withdrawBAKC(PairNftWithAmount[] calldata _baycPairs, PairNftWithAmount[] calldata _maycPairs) external;
}
