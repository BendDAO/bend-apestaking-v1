// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

import "./interfaces/IBNFT.sol";
import "./interfaces/IStakeProxy.sol";
import "./StakeManager.sol";
import "./StakeProxy.sol";

/**
 * @title Bend Ape Staking's Voting Contract
 * @notice Provides a comprehensive vote count across BAYC & MAYC & BAKC pools
 */
contract BendApeStakedVoting {
    /// @notice The staking manager contract
    StakeManager public immutable stakeManager;

    /**
     * @notice Construct a new ApeCoinStakedVoting instance
     * @param _stakeManager The ApeCoinStaking contract being delegated to
     */
    constructor(address payable _stakeManager) {
        require(_stakeManager != address(0), "manager address cannot be zero");
        stakeManager = StakeManager(_stakeManager);
    }

    /**
     * @notice Returns a vote count across BAYC & MAYC & BAKC pools for a given address
     * @param _address The address to return votes for
     */
    function getVotes(address _address) external view returns (uint256) {
        address[2] memory ognftAddresses = [address(stakeManager.bayc()), address(stakeManager.mayc())];
        address[2] memory bnftAddresses = [address(stakeManager.boundBayc()), address(stakeManager.boundMayc())];
        uint256 totalStakedAmount = 0;

        for (uint256 nftIdx = 0; nftIdx < ognftAddresses.length; nftIdx++) {
            IERC721Enumerable bnftErc721 = IERC721Enumerable(bnftAddresses[nftIdx]);

            uint256 tokenNum = bnftErc721.balanceOf(_address);
            for (uint256 idIdx = 0; idIdx < tokenNum; idIdx++) {
                uint256 tokenId = bnftErc721.tokenOfOwnerByIndex(_address, idIdx);
                address[] memory proxyAddresses = stakeManager.getStakedProxies(ognftAddresses[nftIdx], tokenId);

                for (uint256 proxyIdx = 0; proxyIdx < proxyAddresses.length; proxyIdx++) {
                    totalStakedAmount =
                        totalStakedAmount +
                        stakeManager.totalStaked(IStakeProxy(proxyAddresses[proxyIdx]), _address);
                }
            }
        }

        return totalStakedAmount;
    }
}
