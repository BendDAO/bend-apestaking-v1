import { expect } from "chai";
import fc from "fast-check";
import { ethers } from "hardhat";
import { Contracts, Env, makeSuite, Snapshots } from "./_setup";
import { BigNumber, constants } from "ethers";

import { MintableERC721, Ownable } from "../typechain-types";

import { DataTypes } from "../typechain-types/contracts/interfaces/IStakeProxy";
import { advanceBlock, increaseTo, latest } from "./helpers/block-traveller";
import { impersonateAccount, setBalance } from "@nomicfoundation/hardhat-network-helpers";
import {
  emptyBytes32,
  getContract,
  makeBN18,
  randomPairedStakeParam,
  randomSingleStakeParam,
  randomStakeParam,
  skipHourBlocks,
} from "./utils";

/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-explicit-any */
makeSuite("StakeProxy", (contracts: Contracts, env: Env, snapshots: Snapshots) => {
  let lastRevert: string;
  let apeStaked: DataTypes.ApeStakedStruct;
  let bakcStaked: DataTypes.BakcStakedStruct;
  let coinStaked: DataTypes.CoinStakedStruct;
  let apeContract: MintableERC721;
  let poolId: number;
  let poolTokenId: number;
  let pools: any;

  const prepareForStake = async (param: any) => {
    await snapshots.revert("init");
    poolTokenId = param.apeStaked.tokenId;
    poolId = param.poolId;
    if (poolId === 3) {
      poolTokenId = param.bakcStaked.tokenId;
      await contracts.bakc
        .connect(await ethers.getSigner(await param.bakcStaked.staker))
        .mint(await param.bakcStaked.tokenId);
    }
    apeContract = await getContract("MintableERC721", await param.apeStaked.collection);

    await apeContract.connect(await ethers.getSigner(await param.apeStaked.staker)).mint(await param.apeStaked.tokenId);

    apeStaked = param.apeStaked;
    bakcStaked = param.bakcStaked;
    coinStaked = param.coinStaked;
    lastRevert = "setStakeParam";
    await snapshots.capture("setStakeParam");
  };

  const prepareData = async (t: fc.Arbitrary<any>) => {
    await fc.check(
      fc.asyncProperty(t, async (data) => {
        await prepareForStake(data);
      }),
      { numRuns: 1 }
    );
  };

  const stake = async () => {
    await apeContract
      .connect(await ethers.getSigner(await apeStaked.staker))
      .transferFrom(apeStaked.staker, contracts.stakeProxy.address, apeStaked.tokenId);

    await contracts.apeCoin
      .connect(await ethers.getSigner(await apeStaked.staker))
      .transfer(contracts.stakeProxy.address, apeStaked.coinAmount);

    if (poolId === 3) {
      await contracts.bakc
        .connect(await ethers.getSigner(await bakcStaked.staker))
        .transferFrom(bakcStaked.staker, contracts.stakeProxy.address, bakcStaked.tokenId);
      await contracts.apeCoin
        .connect(await ethers.getSigner(await bakcStaked.staker))
        .transfer(contracts.stakeProxy.address, bakcStaked.coinAmount);
    }
    if (coinStaked.coinAmount > 0) {
      await contracts.apeCoin
        .connect(await ethers.getSigner(await coinStaked.staker))
        .transfer(contracts.stakeProxy.address, coinStaked.coinAmount);
    }
    await expect(contracts.stakeProxy.stake(apeStaked, bakcStaked, coinStaked)).not.to.reverted;

    lastRevert = "stake";
    await snapshots.capture(lastRevert);
  };

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

    const stakerRewards = new Map<string, BigNumber>();

    const appendRewards = (staker: string, rewards: BigNumber) => {
      const value = stakerRewards.get(staker);
      if (value) {
        stakerRewards.set(staker, value.add(rewards));
      } else {
        stakerRewards.set(staker, rewards);
      }
    };

    appendRewards(await apeStaked.staker, apeRewards);
    appendRewards(await bakcStaked.staker, bakcRewards);
    appendRewards(await coinStaked.staker, coinRewards);

    return stakerRewards;
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
    await expect(
      contracts.stakeProxy.initialize(
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero
      )
    ).to.rejectedWith("Initializable: contract is already initialized");
    pools = await contracts.apeStaking.getPoolsUI();
    lastRevert = "init";
    await snapshots.capture("init");
  });

  afterEach(async () => {
    await snapshots.revert(lastRevert);
  });

  it("Revert - Receive ETH not allowed", async () => {
    await expect(env.admin.sendTransaction({ to: contracts.stakeProxy.address, value: makeBN18(1) })).to.rejectedWith(
      "Receive ETH not allowed"
    );
  });

  it("onlyOwner: revertions work as expected", async () => {
    await prepareData(randomStakeParam(env, contracts));
    await expect(
      contracts.stakeProxy.connect(env.accounts[1]).stake(apeStaked, bakcStaked, coinStaked)
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(contracts.stakeProxy.connect(env.accounts[1]).unStake()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await expect(
      contracts.stakeProxy.connect(env.accounts[1]).claim(constants.AddressZero, constants.Zero, constants.AddressZero)
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(contracts.stakeProxy.connect(env.accounts[1]).withdraw(constants.AddressZero)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await expect(
      contracts.stakeProxy
        .connect(env.accounts[1])
        .withdrawERC20Emergency(constants.AddressZero, constants.AddressZero, constants.Zero)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(
      contracts.stakeProxy
        .connect(env.accounts[1])
        .withdrawERC721Emergency(constants.AddressZero, constants.AddressZero, constants.Zero)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("onlyStaker: revertions work as expected", async () => {
    await stake();

    await expect(
      contracts.stakeProxy.claim(env.admin.address, constants.Zero, constants.AddressZero)
    ).to.be.revertedWith("StakeProxy: not valid staker");
    await expect(contracts.stakeProxy.withdraw(env.admin.address)).to.be.revertedWith("StakeProxy: not valid staker");
  });

  it("withdrawERC20Emergency", async () => {
    await contracts.apeCoin.transfer(contracts.stakeProxy.address, makeBN18(100));
    await expect(
      contracts.stakeProxy.withdrawERC20Emergency(contracts.apeCoin.address, env.admin.address, makeBN18(100))
    ).to.changeTokenBalances(
      contracts.apeCoin,
      [env.admin.address, contracts.stakeProxy.address],
      [makeBN18(100), constants.Zero.sub(makeBN18(100))]
    );
  });

  it("withdrawERC721Emergency", async () => {
    await contracts.bayc.mint(200);
    await contracts.bayc.transferFrom(env.admin.address, contracts.stakeProxy.address, 200);
    await expect(contracts.stakeProxy.withdrawERC721Emergency(contracts.bayc.address, env.admin.address, 200)).to.not
      .reverted;
    expect(await contracts.bayc.ownerOf(200)).to.eq(env.admin.address);
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

  it("stake: revert - invalid ape collection", async () => {
    const invalidApeStaked = { ...apeStaked };
    invalidApeStaked.collection = constants.AddressZero;
    await expect(contracts.stakeProxy.stake(invalidApeStaked, bakcStaked, coinStaked)).to.be.revertedWith(
      "StakeProxy: invalid ape collection"
    );
  });

  it("stake: revert - ape already staked", async () => {
    await prepareData(randomSingleStakeParam(env, contracts));
    await apeContract
      .connect(await ethers.getSigner(await apeStaked.staker))
      .transferFrom(apeStaked.staker, env.admin.address, apeStaked.tokenId);

    // mock stake in offical apeStaking
    const nfts = [{ tokenId: apeStaked.tokenId, amount: makeBN18(200) }];
    await contracts.apeCoin.approve(contracts.apeStaking.address, constants.MaxUint256);
    if (apeStaked.collection === contracts.bayc.address) {
      await expect(contracts.apeStaking.depositBAYC(nfts)).to.not.reverted;
    } else {
      await expect(contracts.apeStaking.depositMAYC(nfts)).to.not.reverted;
    }

    await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);

    await expect(contracts.stakeProxy.stake(apeStaked, bakcStaked, coinStaked)).to.be.revertedWith(
      "StakeProxy: ape already staked"
    );
  });

  it("stake: revert - not bakc owner", async () => {
    await prepareData(randomPairedStakeParam(env, contracts));
    await apeContract
      .connect(await ethers.getSigner(await apeStaked.staker))
      .transferFrom(apeStaked.staker, contracts.stakeProxy.address, apeStaked.tokenId);

    await expect(contracts.stakeProxy.stake(apeStaked, bakcStaked, coinStaked)).to.be.revertedWith(
      "StakeProxy: not bakc owner"
    );
  });

  it("stake: revert - bakc already staked", async () => {
    await apeContract
      .connect(await ethers.getSigner(await apeStaked.staker))
      .transferFrom(apeStaked.staker, env.admin.address, apeStaked.tokenId);

    await contracts.bakc
      .connect(await ethers.getSigner(await bakcStaked.staker))
      .transferFrom(bakcStaked.staker, env.admin.address, bakcStaked.tokenId);

    // mock stake in offical apeStaking
    await contracts.apeCoin.approve(contracts.apeStaking.address, constants.MaxUint256);
    const nfts = [{ mainTokenId: apeStaked.tokenId, bakcTokenId: bakcStaked.tokenId, amount: makeBN18(200) }];
    if (apeStaked.collection === contracts.bayc.address) {
      await expect(contracts.apeStaking.depositBAKC(nfts, [])).to.not.reverted;
    } else {
      await expect(contracts.apeStaking.depositBAKC([], nfts)).to.not.reverted;
    }

    await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);

    await contracts.bakc.transferFrom(env.admin.address, contracts.stakeProxy.address, bakcStaked.tokenId);

    await expect(contracts.stakeProxy.stake(apeStaked, bakcStaked, coinStaked)).to.be.revertedWith(
      "StakeProxy: bakc already staked"
    );
  });

  it("stake: revert - ERC20: transfer amount exceeds balance", async () => {
    await prepareData(randomStakeParam(env, contracts));
    await apeContract
      .connect(await ethers.getSigner(await apeStaked.staker))
      .transferFrom(apeStaked.staker, contracts.stakeProxy.address, apeStaked.tokenId);

    if (poolId === 3) {
      await contracts.bakc
        .connect(await ethers.getSigner(await bakcStaked.staker))
        .transferFrom(bakcStaked.staker, contracts.stakeProxy.address, bakcStaked.tokenId);
    }
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
    await fc.assert(
      fc.asyncProperty(randomStakeParam(env, contracts), async (v) => {
        await prepareForStake(v);

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

        await stake();

        // check nft ownership
        expect(await apeContract.ownerOf(apeStaked.tokenId)).to.be.eq(env.admin.address);
        if (poolId === 3) {
          expect(await contracts.bakc.ownerOf(bakcStaked.tokenId)).to.be.eq(contracts.stakeProxy.address);
        }

        // check storage
        apeStakedStorage = await contracts.stakeProxy.apeStaked();
        bakcStakedStorage = await contracts.stakeProxy.bakcStaked();
        coinStakedStorage = await contracts.stakeProxy.coinStaked();
        if (poolId === 1) {
          expect(await contracts.stakeProxy.poolType()).to.eq(1);
        } else if (poolId === 2) {
          expect(await contracts.stakeProxy.poolType()).to.eq(2);
        } else if (poolId === 3) {
          if (apeContract.address === contracts.bayc.address) {
            expect(await contracts.stakeProxy.poolType()).to.eq(3);
          } else {
            expect(await contracts.stakeProxy.poolType()).to.eq(4);
          }
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

        const totalStaked = BigNumber.from(await apeStaked.coinAmount)
          .add(await bakcStaked.coinAmount)
          .add(await coinStaked.coinAmount);

        expect(await contracts.apeStaking.stakedTotal(env.admin.address)).to.eq(totalStaked);
        expect((await contracts.apeStaking.nftPosition(poolId, poolTokenId)).stakedAmount).to.eq(totalStaked);

        expect(await contracts.stakeProxy.withdrawable(apeStaked.staker)).to.eq(constants.Zero);
        expect(await contracts.stakeProxy.withdrawable(bakcStaked.staker)).to.eq(constants.Zero);
        expect(await contracts.stakeProxy.withdrawable(coinStaked.staker)).to.eq(constants.Zero);

        expect(await contracts.stakeProxy.claimable(apeStaked.staker, constants.Zero)).to.eq(constants.Zero);
        expect(await contracts.stakeProxy.claimable(bakcStaked.staker, constants.Zero)).to.eq(constants.Zero);
        expect(await contracts.stakeProxy.claimable(coinStaked.staker, constants.Zero)).to.eq(constants.Zero);

        expect(await contracts.stakeProxy.totalStaked()).eq(totalStaked);

        expect(await contracts.stakeProxy.unStaked()).to.eq(false);
      }),
      { numRuns: 10 }
    );
  });

  it("unStake: revert - not ape owner", async () => {
    await expect(contracts.stakeProxy.unStake()).to.revertedWith("StakeProxy: not ape owner");
  });

  it("unStake: revert - already unStaked", async () => {
    await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);

    expect(await contracts.stakeProxy.unStake()).to.not.be.reverted;

    await expect(contracts.stakeProxy.unStake()).to.rejectedWith("StakeProxy: already unStaked");
  });

  it("unStake: check state after unStake", async () => {
    const now = await latest();

    const randomParams = () => {
      return randomStakeParam(env, contracts).chain((v) => {
        const endTimestamp = pools[v.poolId].currentTimeRange.endTimestampHour.toNumber();
        const startTimestamp = pools[v.poolId].currentTimeRange.startTimestampHour.toNumber();
        const time = Math.max(now + 100, startTimestamp);
        const randomTime = fc.integer({ min: time, max: endTimestamp });
        return fc.tuple(fc.constant(v), randomTime);
      });
    };

    await fc.assert(
      fc.asyncProperty(randomParams(), async (v) => {
        const [param, time] = v;

        await prepareForStake(param);
        await stake();

        const totalStaked = BigNumber.from(await apeStaked.coinAmount)
          .add(await bakcStaked.coinAmount)
          .add(await coinStaked.coinAmount);

        await increaseTo(BigNumber.from(time));
        await advanceBlock();
        await skipHourBlocks();

        expect(await contracts.stakeProxy.unStaked()).to.be.false;
        await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);

        const totalRewards = await contracts.apeStaking.pendingRewards(
          poolId,
          contracts.stakeProxy.address,
          poolTokenId
        );
        const preBalance = await contracts.apeCoin.balanceOf(contracts.stakeProxy.address);
        await expect(contracts.stakeProxy.unStake()).to.not.reverted;
        const balanceChanged = (await contracts.apeCoin.balanceOf(contracts.stakeProxy.address)).sub(preBalance);
        expect(totalStaked.add(totalRewards)).to.closeTo(balanceChanged, balanceChanged.div(1000));
        expect(await contracts.stakeProxy.unStaked()).to.be.true;

        expect(await apeContract.ownerOf(await apeStaked.tokenId)).to.eq(env.admin.address);
      }),
      { numRuns: 10 }
    );
  });

  it("claimable: amount will grow up before unStake", async () => {
    const now = await latest();

    const randomParams = () => {
      return randomStakeParam(env, contracts).chain((v) => {
        const endTimestamp = pools[v.poolId].currentTimeRange.endTimestampHour.toNumber();
        const startTimestamp = pools[v.poolId].currentTimeRange.startTimestampHour.toNumber();
        const time = Math.max(now + 100, startTimestamp);
        const randomTime = fc.integer({ min: time, max: endTimestamp });
        const randomTimes = fc.tuple(randomTime, randomTime).filter((t) => {
          return t[0] < t[1];
        });
        return fc.tuple(fc.constant(v), randomTimes);
      });
    };
    await fc.assert(
      fc.asyncProperty(randomParams(), async (v) => {
        const [param, times] = v;
        await prepareForStake(param);
        await stake();
        const uniqueStakers = new Set<string>([
          await apeStaked.staker,
          await bakcStaked.staker,
          await coinStaked.staker,
        ]);

        await increaseTo(BigNumber.from(times[0]));
        await advanceBlock();
        await skipHourBlocks();
        const totalRewards = await contracts.apeStaking.pendingRewards(
          poolId,
          contracts.stakeProxy.address,
          poolTokenId
        );

        let stakerRewards = new Map<string, BigNumber>();
        let totalClaimable = BigNumber.from(0);

        for (const staker of uniqueStakers) {
          const amount = await contracts.stakeProxy.claimable(staker, constants.Zero);
          totalClaimable = totalClaimable.add(amount);
          const value = stakerRewards.get(staker);
          if (value) {
            value.add(amount);
            stakerRewards.set(staker, value);
          } else {
            stakerRewards.set(staker, amount);
          }
        }
        let computed = await computeRewards(totalRewards);

        expect(totalRewards).to.eq(totalClaimable);

        uniqueStakers.forEach((v) => {
          expect(stakerRewards.get(v)).to.eq(computed.get(v));
        });

        await increaseTo(BigNumber.from(times[1]));
        await advanceBlock();
        await skipHourBlocks();

        const totalRewards2 = await contracts.apeStaking.pendingRewards(
          poolId,
          contracts.stakeProxy.address,
          poolTokenId
        );
        stakerRewards = new Map<string, BigNumber>();
        totalClaimable = BigNumber.from(0);

        for (const staker of uniqueStakers) {
          const amount = await contracts.stakeProxy.claimable(staker, constants.Zero);
          totalClaimable = totalClaimable.add(amount);
          const value = stakerRewards.get(staker);
          if (value) {
            value.add(amount);
            stakerRewards.set(staker, value);
          } else {
            stakerRewards.set(staker, amount);
          }
        }
        computed = await computeRewards(totalRewards2);

        expect(totalRewards2).to.eq(totalClaimable);

        uniqueStakers.forEach((v) => {
          expect(stakerRewards.get(v)).to.eq(computed.get(v));
        });

        expect(totalRewards2).gte(totalRewards);
      }),
      { numRuns: 10 }
    );
  });

  it("claimable: amount will not grow up after unStake", async () => {
    const now = await latest();

    const randomParams = () => {
      return randomStakeParam(env, contracts).chain((v) => {
        const endTimestamp = pools[v.poolId].currentTimeRange.endTimestampHour.toNumber();
        const startTimestamp = pools[v.poolId].currentTimeRange.startTimestampHour.toNumber();
        const time = Math.max(now + 100, startTimestamp);
        const randomTime = fc.integer({ min: time, max: endTimestamp });
        const randomTimes = fc.tuple(randomTime, randomTime).filter((t) => {
          return t[0] < t[1] && Math.abs(t[0] - t[1]) > 100;
        });
        return fc.tuple(fc.constant(v), randomTimes);
      });
    };

    await fc.assert(
      fc.asyncProperty(randomParams(), async (v) => {
        const [param, times] = v;

        await prepareForStake(param);
        await stake();

        await increaseTo(BigNumber.from(times[0]));
        await advanceBlock();
        await skipHourBlocks();

        await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);
        await contracts.stakeProxy.unStake();

        const apeRewards = await contracts.stakeProxy.claimable(apeStaked.staker, constants.Zero);
        const bakcRewards = await contracts.stakeProxy.claimable(bakcStaked.staker, constants.Zero);
        const coinRewards = await contracts.stakeProxy.claimable(coinStaked.staker, constants.Zero);

        await increaseTo(BigNumber.from(times[1]));
        await advanceBlock();

        const afterTotalRewards = await contracts.apeStaking.pendingRewards(
          poolId,
          contracts.stakeProxy.address,
          bakcStaked.tokenId
        );
        const afterApeRewards = await contracts.stakeProxy.claimable(apeStaked.staker, constants.Zero);
        const afterBakcRewards = await contracts.stakeProxy.claimable(bakcStaked.staker, constants.Zero);
        const afterCoinRewards = await contracts.stakeProxy.claimable(coinStaked.staker, constants.Zero);

        expect(afterTotalRewards).to.eq(0);

        expect(afterApeRewards).to.eq(apeRewards);
        expect(afterBakcRewards).to.eq(bakcRewards);
        expect(afterCoinRewards).to.eq(coinRewards);
      }),
      { numRuns: 10 }
    );
  });

  it("withdrawable: amount will always be zero before unStake", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStakeParam(env, contracts).chain((v) => {
        const endTimestamp = pools[v.poolId].currentTimeRange.endTimestampHour.toNumber();
        const startTimestamp = pools[v.poolId].currentTimeRange.startTimestampHour.toNumber();
        const time = Math.max(now + 100, startTimestamp);
        const randomTime = fc.integer({ min: time, max: endTimestamp });
        return fc.tuple(fc.constant(v), randomTime);
      });
    };

    await fc.assert(
      fc.asyncProperty(randomParams(), async (v) => {
        const [param, time] = v;

        await prepareForStake(param);
        await stake();

        await increaseTo(BigNumber.from(time));
        await advanceBlock();

        const apeRewards = await contracts.stakeProxy.withdrawable(apeStaked.staker);
        const bakcRewards = await contracts.stakeProxy.withdrawable(bakcStaked.staker);
        const coinRewards = await contracts.stakeProxy.withdrawable(coinStaked.staker);

        expect(apeRewards).to.eq(0);
        expect(bakcRewards).to.eq(0);
        expect(coinRewards).to.eq(0);
      }),
      { numRuns: 10 }
    );
  });

  it("withdrawable: amount will always be const after unStake", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStakeParam(env, contracts).chain((v) => {
        const endTimestamp = pools[v.poolId].currentTimeRange.endTimestampHour.toNumber();
        const startTimestamp = pools[v.poolId].currentTimeRange.startTimestampHour.toNumber();
        const time = Math.max(now + 100, startTimestamp);
        const randomTime = fc.integer({ min: time, max: endTimestamp });
        const randomTimes = fc.tuple(randomTime, randomTime).filter((t) => {
          return t[0] < t[1] && Math.abs(t[0] - t[1]) > 100;
        });
        return fc.tuple(fc.constant(v), randomTimes);
      });
    };
    await fc.assert(
      fc.asyncProperty(randomParams(), async (v) => {
        const [param, times] = v;

        await prepareForStake(param);
        await stake();

        await increaseTo(BigNumber.from(times[0]));
        await advanceBlock();
        await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);
        await contracts.stakeProxy.unStake();
        const uniqueStakers = new Set<string>([
          await apeStaked.staker,
          await bakcStaked.staker,
          await coinStaked.staker,
        ]);

        let stakerWithdrawable = new Map<string, BigNumber>();

        for (const staker of uniqueStakers) {
          let amount = await contracts.stakeProxy.withdrawable(staker);
          const value = stakerWithdrawable.get(staker);
          if (value) {
            amount = value.add(amount);
          }
          stakerWithdrawable.set(staker, amount);
        }

        for (const staker of uniqueStakers) {
          expect(await contracts.stakeProxy.withdrawable(staker)).to.eq(stakerWithdrawable.get(staker));
        }

        await increaseTo(BigNumber.from(times[1]));
        await advanceBlock();

        stakerWithdrawable = new Map<string, BigNumber>();

        for (const staker of uniqueStakers) {
          let amount = await contracts.stakeProxy.withdrawable(staker);
          const value = stakerWithdrawable.get(staker);
          if (value) {
            amount = value.add(amount);
          }
          stakerWithdrawable.set(staker, amount);
        }

        for (const staker of uniqueStakers) {
          expect(await contracts.stakeProxy.withdrawable(staker)).to.eq(stakerWithdrawable.get(staker));
        }
      }),
      { numRuns: 10 }
    );
  });

  it("claim: revert - not ape owner", async () => {
    await expect(contracts.stakeProxy.claim(apeStaked.staker, 0, constants.AddressZero)).to.rejectedWith(
      "StakeProxy: not ape owner"
    );
  });

  it("claim: revert - not bakc owner", async () => {
    await prepareData(randomPairedStakeParam(env, contracts));
    await stake();

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

  it("claim: claims before unStake", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStakeParam(env, contracts).chain((v) => {
        const endTimestamp = pools[v.poolId].currentTimeRange.endTimestampHour.toNumber();
        const startTimestamp = pools[v.poolId].currentTimeRange.startTimestampHour.toNumber();
        const time = Math.max(now + 100, startTimestamp);
        const randomTime = fc.integer({ min: time, max: endTimestamp });
        const randomTimes = fc.tuple(randomTime, randomTime, randomTime).filter((t) => {
          return t[0] < t[1] && Math.abs(t[0] - t[1]) > 100 && t[1] < t[2] && Math.abs(t[1] - t[2]) > 100;
        });
        return fc.tuple(fc.constant(v), randomTimes);
      });
    };
    await fc.assert(
      fc.asyncProperty(randomParams(), async (v) => {
        const [param, times] = v;
        await prepareForStake(param);
        await stake();

        const claim = async (time: number, staker: string, fee: number) => {
          await increaseTo(BigNumber.from(time));
          await advanceBlock();

          await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);
          await skipHourBlocks();
          const proxyRewardsClaimed = await contracts.apeStaking.pendingRewards(
            poolId,
            contracts.stakeProxy.address,
            poolTokenId
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
          if (poolId === 3) {
            expect(await contracts.bakc.ownerOf(bakcStaked.tokenId)).to.eq(contracts.stakeProxy.address);
          }
        };

        let index = 0;
        for (const staker of param.stakers) {
          await claim(times[index], staker, 200);
          index += 1;
        }
      }),
      { numRuns: 10 }
    );
  });

  it("claim: claims over unStake", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStakeParam(env, contracts).chain((v) => {
        const endTimestamp = pools[v.poolId].currentTimeRange.endTimestampHour.toNumber();
        const startTimestamp = pools[v.poolId].currentTimeRange.startTimestampHour.toNumber();
        const time = Math.max(now + 100, startTimestamp);
        const randomTime = fc.integer({ min: time, max: endTimestamp });
        const randomTimes = fc.tuple(randomTime, randomTime, randomTime).filter((t) => {
          return t[0] < t[1] && Math.abs(t[0] - t[1]) > 100 && t[1] < t[2] && Math.abs(t[1] - t[2]) > 100;
        });
        return fc.tuple(fc.constant(v), randomTimes);
      });
    };
    await fc.assert(
      fc.asyncProperty(randomParams(), async (v) => {
        const [param, times] = v;
        await prepareForStake(param);
        await stake();

        const claim = async (time: number, staker: string, fee: number) => {
          await increaseTo(BigNumber.from(time));
          await advanceBlock();

          if (!unStake) {
            await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);
          }
          await skipHourBlocks();
          const proxyRewardsClaimed = await contracts.apeStaking.pendingRewards(
            poolId,
            contracts.stakeProxy.address,
            poolTokenId
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
          if (poolId === 3) {
            expect(await contracts.bakc.ownerOf(bakcStaked.tokenId)).to.eq(contracts.stakeProxy.address);
          }
        };

        let index = 0;
        let unStake = false;
        for (const staker of param.stakers) {
          await claim(times[index], staker, 200);
          index += 1;
          if (!unStake) {
            await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);
            await contracts.stakeProxy.unStake();
            unStake = true;
          }
        }
      }),
      { numRuns: 10 }
    );
  });

  it("withdraw: revert - can't withdraw before unStake", async () => {
    await expect(contracts.stakeProxy.withdraw(apeStaked.staker)).to.rejectedWith("StakeProxy: can't withdraw");
  });

  it("withdraw: after unStake", async () => {
    await fc.assert(
      fc.asyncProperty(randomStakeParam(env, contracts), async (v) => {
        await prepareForStake(v);
        await stake();

        await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);
        await contracts.stakeProxy.unStake();
        const apeWithdrawable = await contracts.stakeProxy.withdrawable(apeStaked.staker);
        const bakcWithdrawable = await contracts.stakeProxy.withdrawable(bakcStaked.staker);
        const coinWithdrawable = await contracts.stakeProxy.withdrawable(coinStaked.staker);
        await expect(contracts.stakeProxy.withdraw(apeStaked.staker)).to.changeTokenBalances(
          contracts.apeCoin,
          [await apeStaked.staker, contracts.stakeProxy.address],
          [apeWithdrawable, constants.Zero.sub(apeWithdrawable)]
        );
        if (apeStaked.staker !== bakcStaked.staker && bakcStaked.staker !== constants.AddressZero) {
          await expect(contracts.stakeProxy.withdraw(bakcStaked.staker)).to.changeTokenBalances(
            contracts.apeCoin,
            [await bakcStaked.staker, contracts.stakeProxy.address],
            [bakcWithdrawable, constants.Zero.sub(bakcWithdrawable)]
          );
        }
        if (
          apeStaked.staker !== coinStaked.staker &&
          bakcStaked.staker !== coinStaked.staker &&
          coinStaked.staker !== constants.AddressZero
        ) {
          await expect(contracts.stakeProxy.withdraw(coinStaked.staker)).to.changeTokenBalances(
            contracts.apeCoin,
            [await coinStaked.staker, contracts.stakeProxy.address],
            [coinWithdrawable, constants.Zero.sub(coinWithdrawable)]
          );
        }
        if (poolId === 3) {
          expect(await contracts.bakc.ownerOf(bakcStaked.tokenId)).to.eq(bakcStaked.staker);
        }
      }),
      { numRuns: 10 }
    );
  });
});
