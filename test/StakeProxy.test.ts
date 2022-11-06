import { expect } from "chai";
import fc from "fast-check";
import { formatBytes32String } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { Contracts, Env, makeSuite, Snapshots } from "./_setup";
import { BigNumber, constants, Contract } from "ethers";

import { MintableERC721, Ownable } from "../typechain-types";

import { DataTypes } from "../typechain-types/contracts/interfaces/IStakeProxy";
import { advanceBlock, increaseTo, latest } from "./helpers/block-traveller";
import { PromiseOrValue } from "../typechain-types/common";
import { impersonateAccount, setBalance } from "@nomicfoundation/hardhat-network-helpers";

export function makeBN18(num: string | number): BigNumber {
  return ethers.utils.parseUnits(num.toString(), 18);
}

export const getContract = async <ContractType extends Contract>(
  contractName: string,
  address: string
): Promise<ContractType> => (await ethers.getContractAt(contractName, address)) as ContractType;

const emptyBytes32 = formatBytes32String("");

/* eslint-disable no-unused-expressions */
makeSuite("StakeProxy", (contracts: Contracts, env: Env, snapshots: Snapshots) => {
  let apeStaked: DataTypes.ApeStakedStruct;
  let bakcStaked: DataTypes.BakcStakedStruct;
  let coinStaked: DataTypes.CoinStakedStruct;
  let apeContract: MintableERC721;
  let poolId: number;
  let revertTag: string;

  const generateStakeParam = (maxCap: number) => {
    const shares = fc
      .array(fc.integer({ min: 100, max: 10000 }), { minLength: 3, maxLength: 3 })
      .filter((t) => t[0] + t[1] + t[2] === 10000);
    const stakers = fc.uniqueArray(fc.integer({ min: 1, max: 5 }), {
      minLength: 3,
      maxLength: 3,
    });
    const coins = fc
      .array(fc.integer({ min: 0, max: maxCap }), { minLength: 3, maxLength: 3 })
      .filter((t) => t[0] + t[1] + t[2] === maxCap);

    const ape = fc.constantFrom(contracts.bayc.address, contracts.mayc.address);

    return fc.tuple(shares, stakers, coins, ape).map((t) => {
      const [_shares, _stakers, _coins, _ape] = t;
      return {
        apeStaked: {
          offerHash: emptyBytes32,
          staker: env.accounts[_stakers[0]].address,
          collection: _ape,
          tokenId: 100,
          coinAmount: makeBN18(_coins[0]),
          apeShare: _shares[0],
          coinShare: _shares[2],
        },
        bakcStaked: {
          offerHash: emptyBytes32,
          staker: env.accounts[_stakers[1]].address,
          tokenId: 100,
          coinAmount: makeBN18(_coins[1]),
          bakcShare: _shares[1],
          coinShare: _shares[2],
        },
        coinStaked: {
          offerHash: emptyBytes32,
          staker: env.accounts[_stakers[2]].address,
          coinAmount: makeBN18(_coins[2]),
          coinShare: _shares[2],
        },
      };
    });
  };

  before(async () => {
    await contracts.stakeProxy
      .connect(env.admin)
      .initialize(
        env.admin.address,
        contracts.bayc.address,
        contracts.mayc.address,
        contracts.bakc.address,
        contracts.apeCoin.address,
        contracts.apeStaking.address
      );

    expect(await contracts.stakeProxy.bayc()).to.eq(contracts.bayc.address);
    expect(await contracts.stakeProxy.mayc()).to.eq(contracts.mayc.address);
    expect(await contracts.stakeProxy.bakc()).to.eq(contracts.bakc.address);
    expect(await contracts.stakeProxy.apeCoin()).to.eq(contracts.apeCoin.address);
    expect(await contracts.stakeProxy.apeStaking()).to.eq(contracts.apeStaking.address);
    expect(await (await getContract<Ownable>("Ownable", contracts.stakeProxy.address)).owner()).to.eq(
      env.admin.address
    );

    fc.check(
      fc.property(generateStakeParam(856), (data) => {
        // console.log(data);
        apeStaked = data.apeStaked;
        bakcStaked = data.bakcStaked;
        coinStaked = data.coinStaked;
        // bakc pool
        poolId = 3;
      }),
      { numRuns: 1 }
    );
    apeContract = await getContract("MintableERC721", await apeStaked.collection);
    await apeContract.connect(await ethers.getSigner(await apeStaked.staker)).mint(await apeStaked.tokenId);
    await contracts.bakc.connect(await ethers.getSigner(await bakcStaked.staker)).mint(await bakcStaked.tokenId);
    await snapshots.capture("init");
    revertTag = "init";
  });

  afterEach(async () => {
    await snapshots.revert(revertTag);
  });

  it("stake: revert - caller is not the owner", async () => {
    await expect(
      contracts.stakeProxy.connect(env.accounts[1]).stake(apeStaked, bakcStaked, coinStaked)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("stake: revert - not ape owner", async () => {
    await expect(contracts.stakeProxy.stake(apeStaked, bakcStaked, coinStaked)).to.be.revertedWith(
      "StakeProxy: not ape owner"
    );
  });

  it("stake: revert - not bakc owner", async () => {
    await apeContract
      .connect(await ethers.getSigner(await apeStaked.staker))
      .transferFrom(apeStaked.staker, contracts.stakeProxy.address, apeStaked.tokenId);
    await expect(contracts.stakeProxy.stake(apeStaked, bakcStaked, coinStaked)).to.be.revertedWith(
      "StakeProxy: not bakc owner"
    );
  });

  it("stake: revert - ERC20: transfer amount exceeds balance", async () => {
    await apeContract
      .connect(await ethers.getSigner(await apeStaked.staker))
      .transferFrom(apeStaked.staker, contracts.stakeProxy.address, apeStaked.tokenId);

    await contracts.bakc
      .connect(await ethers.getSigner(await bakcStaked.staker))
      .transferFrom(bakcStaked.staker, contracts.stakeProxy.address, bakcStaked.tokenId);

    await expect(contracts.stakeProxy.stake(apeStaked, bakcStaked, coinStaked)).to.be.revertedWith(
      "ERC20: transfer amount exceeds balance"
    );
  });

  it("unStake: unStake if not staked", async () => {
    await expect(contracts.stakeProxy.unStake()).to.be.rejectedWith("StakeProxy: no staking at all");
    expect(await contracts.stakeProxy.withdrawable(constants.AddressZero)).to.eq(constants.Zero);
    expect(await contracts.stakeProxy.claimable(constants.AddressZero, constants.Zero)).to.eq(constants.Zero);
  });

  it("stake: check state if stake success", async () => {
    await apeContract
      .connect(await ethers.getSigner(await apeStaked.staker))
      .transferFrom(apeStaked.staker, contracts.stakeProxy.address, apeStaked.tokenId);

    await contracts.bakc
      .connect(await ethers.getSigner(await bakcStaked.staker))
      .transferFrom(bakcStaked.staker, contracts.stakeProxy.address, bakcStaked.tokenId);

    await contracts.apeCoin
      .connect(await ethers.getSigner(await apeStaked.staker))
      .transfer(contracts.stakeProxy.address, apeStaked.coinAmount);

    await contracts.apeCoin
      .connect(await ethers.getSigner(await bakcStaked.staker))
      .transfer(contracts.stakeProxy.address, bakcStaked.coinAmount);

    let apeStakedStorage = await contracts.stakeProxy.apeStaked();
    let bakcStakedStorage = await contracts.stakeProxy.bakcStaked();
    let coinStakedStorage = await contracts.stakeProxy.coinStaked();

    expect(apeStakedStorage.offerHash).to.eq(emptyBytes32);
    expect(apeStakedStorage.staker).to.eq(constants.AddressZero);
    expect(apeStakedStorage.collection).to.eq(constants.AddressZero);
    expect(apeStakedStorage.tokenId).to.eq(constants.Zero);
    expect(apeStakedStorage.apeShare).to.eq(constants.Zero);
    expect(apeStakedStorage.coinShare).to.eq(constants.Zero);
    expect(apeStakedStorage.coinAmount).to.eq(constants.Zero);

    expect(bakcStakedStorage.offerHash).to.eq(emptyBytes32);
    expect(bakcStakedStorage.staker).to.eq(constants.AddressZero);
    expect(bakcStakedStorage.tokenId).to.eq(constants.Zero);
    expect(bakcStakedStorage.bakcShare).to.eq(constants.Zero);
    expect(bakcStakedStorage.coinShare).to.eq(constants.Zero);
    expect(bakcStakedStorage.coinAmount).to.eq(constants.Zero);

    expect(coinStakedStorage.offerHash).to.eq(emptyBytes32);
    expect(coinStakedStorage.staker).to.eq(constants.AddressZero);
    expect(coinStakedStorage.coinShare).to.eq(constants.Zero);
    expect(coinStakedStorage.coinAmount).to.eq(constants.Zero);

    await contracts.apeCoin
      .connect(await ethers.getSigner(await coinStaked.staker))
      .transfer(contracts.stakeProxy.address, coinStaked.coinAmount);
    await expect(contracts.stakeProxy.stake(apeStaked, bakcStaked, coinStaked)).not.to.reverted;

    revertTag = "stake";
    await snapshots.capture(revertTag);

    // check nft ownership
    expect(await apeContract.ownerOf(apeStaked.tokenId)).to.be.eq(env.admin.address);
    expect(await contracts.bakc.ownerOf(bakcStaked.tokenId)).to.be.eq(contracts.stakeProxy.address);

    // check storage
    apeStakedStorage = await contracts.stakeProxy.apeStaked();
    bakcStakedStorage = await contracts.stakeProxy.bakcStaked();
    coinStakedStorage = await contracts.stakeProxy.coinStaked();
    if (apeContract.address === contracts.bayc.address) {
      expect(await contracts.stakeProxy.poolType()).to.eq(3);
    } else {
      expect(await contracts.stakeProxy.poolType()).to.eq(4);
    }
    expect(await apeStaked.offerHash).to.eq(apeStakedStorage.offerHash);
    expect(await apeStaked.staker).to.eq(apeStakedStorage.staker);
    expect(await apeStaked.collection).to.eq(apeStakedStorage.collection);
    expect(await apeStaked.tokenId).to.eq(apeStakedStorage.tokenId);
    expect(await apeStaked.apeShare).to.eq(apeStakedStorage.apeShare);
    expect(await apeStaked.coinShare).to.eq(apeStakedStorage.coinShare);
    expect(await apeStaked.coinAmount).to.eq(apeStakedStorage.coinAmount);

    expect(await bakcStaked.offerHash).to.eq(bakcStakedStorage.offerHash);
    expect(await bakcStaked.staker).to.eq(bakcStakedStorage.staker);
    expect(await bakcStaked.tokenId).to.eq(bakcStakedStorage.tokenId);
    expect(await bakcStaked.bakcShare).to.eq(bakcStakedStorage.bakcShare);
    expect(await bakcStaked.coinShare).to.eq(bakcStakedStorage.coinShare);
    expect(await bakcStaked.coinAmount).to.eq(bakcStakedStorage.coinAmount);

    expect(await coinStaked.offerHash).to.eq(coinStakedStorage.offerHash);
    expect(await coinStaked.staker).to.eq(coinStakedStorage.staker);
    expect(await coinStaked.coinShare).to.eq(coinStakedStorage.coinShare);
    expect(await coinStaked.coinAmount).to.eq(coinStakedStorage.coinAmount);

    expect(await contracts.apeCoin.balanceOf(contracts.stakeProxy.address)).to.be.eq(constants.Zero);

    await contracts.apeCoin
      .connect(await ethers.getSigner(await bakcStaked.staker))
      .transfer(contracts.stakeProxy.address, bakcStaked.coinAmount);

    const totalStaked = BigNumber.from(await apeStaked.coinAmount)
      .add(await bakcStaked.coinAmount)
      .add(await coinStaked.coinAmount);

    expect(await contracts.apeStaking.stakedTotal(env.admin.address)).to.eq(totalStaked);
    expect((await contracts.apeStaking.nftPosition(poolId, bakcStaked.tokenId)).stakedAmount).to.eq(totalStaked);

    expect(await contracts.stakeProxy.withdrawable(apeStaked.staker)).to.eq(constants.Zero);
    expect(await contracts.stakeProxy.withdrawable(bakcStaked.staker)).to.eq(constants.Zero);
    expect(await contracts.stakeProxy.withdrawable(coinStaked.staker)).to.eq(constants.Zero);

    expect(await contracts.stakeProxy.claimable(apeStaked.staker, constants.Zero)).to.eq(constants.Zero);
    expect(await contracts.stakeProxy.claimable(bakcStaked.staker, constants.Zero)).to.eq(constants.Zero);
    expect(await contracts.stakeProxy.claimable(coinStaked.staker, constants.Zero)).to.eq(constants.Zero);

    expect(await contracts.stakeProxy.unStaked()).to.eq(false);
  });

  const computeRewards = async (totalRewards: BigNumber) => {
    const maxCap = BigNumber.from(await apeStaked.coinAmount)
      .add(await bakcStaked.coinAmount)
      .add(await coinStaked.coinAmount);
    let apeRewards = totalRewards
      .mul(await apeStaked.apeShare)
      .add(5000)
      .div(10000);
    let bakcRewards = totalRewards
      .mul(await bakcStaked.bakcShare)
      .add(5000)
      .div(10000);
    let coinRewards = totalRewards.sub(apeRewards).sub(bakcRewards);
    let coinRewardsShared = coinRewards
      .mul(await apeStaked.coinAmount)
      .mul(10 ** 10)
      .div(maxCap)
      .div(10 ** 10);
    apeRewards = apeRewards.add(coinRewardsShared);
    coinRewards = coinRewards.sub(coinRewardsShared);
    coinRewardsShared = coinRewards
      .mul(await bakcStaked.coinAmount)
      .mul(10 ** 10)
      .div(maxCap)
      .div(10 ** 10);
    bakcRewards = bakcRewards.add(coinRewardsShared);
    coinRewards = coinRewards.sub(coinRewardsShared);
    return { apeRewards, bakcRewards, coinRewards };
  };

  it("claimable: amount will grow up before unStake", async () => {
    const now = await latest();
    const pools = await contracts.apeStaking.getPoolsUI();

    const endTimestamp = pools[poolId].currentTimeRange.endTimestampHour.toNumber();
    const startTimestamp = pools[poolId].currentTimeRange.startTimestampHour.toNumber();
    const rewardsPerHour = pools[poolId].currentTimeRange.rewardsPerHour;
    const time = Math.max(now + 1, startTimestamp);
    const randomTime = fc.integer({ min: time, max: endTimestamp - 3600 });
    await fc.assert(
      fc
        .asyncProperty(randomTime, async (t) => {
          await increaseTo(BigNumber.from(t));
          await advanceBlock();
          const totalRewards = await contracts.apeStaking.pendingRewards(
            poolId,
            contracts.stakeProxy.address,
            bakcStaked.tokenId
          );
          const apeRewards = await contracts.stakeProxy.claimable(apeStaked.staker, constants.Zero);
          const bakcRewards = await contracts.stakeProxy.claimable(bakcStaked.staker, constants.Zero);
          const coinRewards = await contracts.stakeProxy.claimable(coinStaked.staker, constants.Zero);

          expect(totalRewards).to.eq(apeRewards.add(bakcRewards).add(coinRewards));

          const computed = await computeRewards(totalRewards);
          expect(apeRewards).to.eq(computed.apeRewards);
          expect(bakcRewards).to.eq(computed.bakcRewards);
          expect(coinRewards).to.eq(computed.coinRewards);

          await increaseTo(BigNumber.from(t + 3600));
          await advanceBlock();

          const totalRewards2 = await contracts.apeStaking.pendingRewards(
            poolId,
            contracts.stakeProxy.address,
            bakcStaked.tokenId
          );
          const apeRewards2 = await contracts.stakeProxy.claimable(apeStaked.staker, constants.Zero);
          const bakcRewards2 = await contracts.stakeProxy.claimable(bakcStaked.staker, constants.Zero);
          const coinRewards2 = await contracts.stakeProxy.claimable(coinStaked.staker, constants.Zero);
          expect(totalRewards2).to.eq(apeRewards2.add(bakcRewards2).add(coinRewards2));
          expect(totalRewards2.sub(totalRewards)).to.closeTo(rewardsPerHour, rewardsPerHour.div(10000));
        })
        .beforeEach(async () => {
          await snapshots.revert(revertTag);
        }),
      { numRuns: 5 }
    );
  });

  it("claimable: amount will not grow up after unStake", async () => {
    const pools = await contracts.apeStaking.getPoolsUI();

    const endTimestamp = pools[poolId].currentTimeRange.endTimestampHour.toNumber();
    const startTimestamp = pools[poolId].currentTimeRange.startTimestampHour.toNumber();
    const now = await latest();
    const time = Math.max(now + 3, startTimestamp);
    const randomTime = fc.integer({ min: time, max: endTimestamp });
    await fc.assert(
      fc
        .asyncProperty(randomTime, async (t) => {
          await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);
          await contracts.stakeProxy.unStake();
          const totalRewards = await contracts.apeStaking.pendingRewards(
            poolId,
            contracts.stakeProxy.address,
            bakcStaked.tokenId
          );

          const apeRewards = await contracts.stakeProxy.claimable(apeStaked.staker, constants.Zero);
          const bakcRewards = await contracts.stakeProxy.claimable(bakcStaked.staker, constants.Zero);
          const coinRewards = await contracts.stakeProxy.claimable(coinStaked.staker, constants.Zero);
          await increaseTo(BigNumber.from(t));
          await advanceBlock();

          const afterTotalRewards = await contracts.apeStaking.pendingRewards(
            poolId,
            contracts.stakeProxy.address,
            bakcStaked.tokenId
          );
          const afterApeRewards = await contracts.stakeProxy.claimable(apeStaked.staker, constants.Zero);
          const afterBakcRewards = await contracts.stakeProxy.claimable(bakcStaked.staker, constants.Zero);
          const afterCoinRewards = await contracts.stakeProxy.claimable(coinStaked.staker, constants.Zero);

          expect(afterTotalRewards).to.eq(totalRewards);

          expect(afterApeRewards).to.eq(apeRewards);
          expect(afterBakcRewards).to.eq(bakcRewards);
          expect(afterCoinRewards).to.eq(coinRewards);
        })
        .beforeEach(async () => {
          await snapshots.revert(revertTag);
        }),
      { numRuns: 5 }
    );
  });

  it("withdrawable: amount will always be zero before unStake", async () => {
    const now = await latest();
    const pools = await contracts.apeStaking.getPoolsUI();

    const endTimestamp = pools[poolId].currentTimeRange.endTimestampHour.toNumber();
    const startTimestamp = pools[poolId].currentTimeRange.startTimestampHour.toNumber();
    const time = Math.max(now + 1, startTimestamp);
    const randomTime = fc.integer({ min: time, max: endTimestamp });
    await fc.assert(
      fc
        .asyncProperty(randomTime, async (t) => {
          await increaseTo(BigNumber.from(t));
          await advanceBlock();

          const apeRewards = await contracts.stakeProxy.withdrawable(apeStaked.staker);
          const bakcRewards = await contracts.stakeProxy.withdrawable(bakcStaked.staker);
          const coinRewards = await contracts.stakeProxy.withdrawable(coinStaked.staker);

          expect(apeRewards).to.eq(0);
          expect(bakcRewards).to.eq(0);
          expect(coinRewards).to.eq(0);
        })
        .beforeEach(async () => {
          await snapshots.revert(revertTag);
        }),
      { numRuns: 5 }
    );
  });

  it("withdrawable: amount will always be const after unStake", async () => {
    const now = await latest();
    const pools = await contracts.apeStaking.getPoolsUI();

    const endTimestamp = pools[poolId].currentTimeRange.endTimestampHour.toNumber();
    const startTimestamp = pools[poolId].currentTimeRange.startTimestampHour.toNumber();
    const time = Math.max(now + 3, startTimestamp);
    const randomTime = fc.integer({ min: time, max: endTimestamp });
    await fc.assert(
      fc
        .asyncProperty(randomTime, async (t) => {
          await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);
          await contracts.stakeProxy.unStake();

          expect(await contracts.stakeProxy.withdrawable(apeStaked.staker)).to.eq(apeStaked.coinAmount);
          expect(await contracts.stakeProxy.withdrawable(bakcStaked.staker)).to.eq(bakcStaked.coinAmount);
          expect(await contracts.stakeProxy.withdrawable(coinStaked.staker)).to.eq(coinStaked.coinAmount);

          await increaseTo(BigNumber.from(t));
          await advanceBlock();

          expect(await contracts.stakeProxy.withdrawable(apeStaked.staker)).to.eq(apeStaked.coinAmount);
          expect(await contracts.stakeProxy.withdrawable(bakcStaked.staker)).to.eq(bakcStaked.coinAmount);
          expect(await contracts.stakeProxy.withdrawable(coinStaked.staker)).to.eq(coinStaked.coinAmount);
        })
        .beforeEach(async () => {
          await snapshots.revert(revertTag);
        }),
      { numRuns: 5 }
    );
  });

  const skipHourBlocks = async () => {
    const currentTime = await latest();
    // skip hour blocks
    if (currentTime % 3600 === 3599 || currentTime % 3600 === 0) {
      await advanceBlock();
      await advanceBlock();
    }
  };

  it("claim: revert - not ape owner", async () => {
    await expect(contracts.stakeProxy.claim(apeStaked.staker, 0, constants.AddressZero)).to.rejectedWith(
      "StakeProxy: not ape owner"
    );
  });

  it("claim: revert - not bakc owner", async () => {
    await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);

    // mock transfer bakc away
    await impersonateAccount(contracts.stakeProxy.address);
    await setBalance(contracts.stakeProxy.address, makeBN18(1));
    await contracts.bakc
      .connect(await ethers.getSigner(contracts.stakeProxy.address))
      .transferFrom(contracts.stakeProxy.address, env.admin.address, bakcStaked.tokenId);

    await expect(contracts.stakeProxy.claim(apeStaked.staker, 0, constants.AddressZero)).to.rejectedWith(
      "StakeProxy: not bakc owner"
    );
  });

  it("claim: claim one by one before unStake", async () => {
    const now = await latest();
    const pools = await contracts.apeStaking.getPoolsUI();

    const endTimestamp = pools[poolId].currentTimeRange.endTimestampHour.toNumber();
    const startTimestamp = pools[poolId].currentTimeRange.startTimestampHour.toNumber();
    const time = Math.max(now + 1, startTimestamp);

    const randomStakers = fc.shuffledSubarray([apeStaked.staker, bakcStaked.staker, coinStaked.staker], {
      maxLength: 3,
      minLength: 1,
    });
    const randomTime = fc.integer({ min: time, max: endTimestamp });

    await fc.assert(
      fc
        .asyncProperty(randomTime, randomStakers, async (t, stakers) => {
          await increaseTo(BigNumber.from(t));
          await advanceBlock();
          const fee = 200;

          const testClaim = async (staker: PromiseOrValue<string>) => {
            await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);
            await skipHourBlocks();
            const proxyRewardsClaimed = await contracts.apeStaking.pendingRewards(
              poolId,
              contracts.stakeProxy.address,
              bakcStaked.tokenId
            );
            let rewards = await contracts.stakeProxy.claimable(staker, constants.Zero);
            let toFee = constants.Zero;
            if (rewards.gt(constants.Zero)) {
              toFee = rewards.mul(fee).add(5000).div(10000);
              rewards = rewards.sub(toFee);
            }
            const proxyRewardsDiff = proxyRewardsClaimed.sub(rewards).sub(toFee);

            // check ape coin balances
            await expect(contracts.stakeProxy.claim(staker, fee, env.admin.address)).to.changeTokenBalances(
              contracts.apeCoin,
              [staker, env.admin.address, contracts.stakeProxy.address],
              [rewards, toFee, proxyRewardsDiff]
            );

            // check nft owner
            expect(await apeContract.ownerOf(apeStaked.tokenId)).to.eq(env.admin.address);
            expect(await contracts.bakc.ownerOf(bakcStaked.tokenId)).to.eq(contracts.stakeProxy.address);
          };
          for (let i = 0; i < stakers.length; i++) {
            await testClaim(stakers[i]);
          }
        })
        .beforeEach(async () => {
          await snapshots.revert(revertTag);
        }),
      { numRuns: 5 }
    );
  });
});
