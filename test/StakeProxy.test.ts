import { expect } from "chai";
import fc from "fast-check";
import { ethers } from "hardhat";
import { Contracts, Env, makeSuite, Snapshots } from "./_setup";
import { BigNumber, constants } from "ethers";

import { Ownable } from "../typechain-types";

import { advanceBlock, increaseTo, latest } from "./helpers/block-traveller";
import { impersonateAccount, setBalance } from "@nomicfoundation/hardhat-network-helpers";
import {
  emptyBytes32,
  getContract,
  makeBN18,
  randomPairedStake,
  randomSingleStake,
  randomStake,
  skipHourBlocks,
} from "./utils";

fc.configureGlobal({
  numRuns: 10,
  asyncReporter: async (r) => {
    if (r.failed) {
      throw r.errorInstance;
    }
  },
  endOnFailure: true,
});

/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-explicit-any */
makeSuite("StakeProxy", (contracts: Contracts, env: Env, snapshots: Snapshots) => {
  let lastRevert: string;
  let pools: any;

  const prepareStake = async (param: any) => {
    param.poolTokenId = param.apeStaked.tokenId;
    if (param.poolId === 3) {
      param.poolTokenId = param.bakcStaked.tokenId;
      await contracts.bakc
        .connect(await ethers.getSigner(await param.bakcStaked.staker))
        .mint(await param.bakcStaked.tokenId);
    }
    param.apeContract = await getContract("MintableERC721", await param.apeStaked.collection);
    await param.apeContract
      .connect(await ethers.getSigner(await param.apeStaked.staker))
      .mint(await param.apeStaked.tokenId);
    return param;
  };

  const stake = async (param: any) => {
    await param.apeContract
      .connect(await ethers.getSigner(await param.apeStaked.staker))
      .transferFrom(param.apeStaked.staker, contracts.stakeProxy.address, param.apeStaked.tokenId);

    await contracts.apeCoin
      .connect(await ethers.getSigner(await param.apeStaked.staker))
      .transfer(contracts.stakeProxy.address, param.apeStaked.coinAmount);

    if (param.poolId === 3) {
      await contracts.bakc
        .connect(await ethers.getSigner(await param.bakcStaked.staker))
        .transferFrom(param.bakcStaked.staker, contracts.stakeProxy.address, param.bakcStaked.tokenId);
      await contracts.apeCoin
        .connect(await ethers.getSigner(await param.bakcStaked.staker))
        .transfer(contracts.stakeProxy.address, param.bakcStaked.coinAmount);
    }
    if (param.coinStaked.coinAmount > 0) {
      await contracts.apeCoin
        .connect(await ethers.getSigner(await param.coinStaked.staker))
        .transfer(contracts.stakeProxy.address, param.coinStaked.coinAmount);
    }
    await expect(contracts.stakeProxy.stake(param.apeStaked, param.bakcStaked, param.coinStaked)).not.to.reverted;
  };

  const computeRewards = async (totalRewards: BigNumber, param: any) => {
    const apeRewards = totalRewards
      .mul(await param.apeStaked.share)
      .add(5000)
      .div(10000);
    const bakcRewards = totalRewards
      .mul(await param.bakcStaked.share)
      .add(5000)
      .div(10000);
    const coinRewards = totalRewards.sub(apeRewards).sub(bakcRewards);

    const stakerRewards = new Map<string, BigNumber>();

    const appendRewards = (staker: string, rewards: BigNumber) => {
      const value = stakerRewards.get(staker);
      if (value) {
        stakerRewards.set(staker, value.add(rewards));
      } else {
        stakerRewards.set(staker, rewards);
      }
    };

    appendRewards(await param.apeStaked.staker, apeRewards);
    appendRewards(await param.bakcStaked.staker, bakcRewards);
    appendRewards(await param.coinStaked.staker, coinRewards);

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
    ).to.revertedWith("Initializable: contract is already initialized");
    pools = await contracts.apeStaking.getPoolsUI();
    lastRevert = "init";
    await snapshots.capture("init");
  });

  afterEach(async () => {
    await snapshots.revert(lastRevert);
  });

  it("onlyOwner: revertions work as expected", async () => {
    const param = fc.sample(randomStake(env, contracts), 1)[0];
    await expect(
      contracts.stakeProxy.connect(env.accounts[1]).stake(param.apeStaked, param.bakcStaked, param.coinStaked)
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
        .migrateERC20(constants.AddressZero, constants.AddressZero, constants.Zero)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(
      contracts.stakeProxy
        .connect(env.accounts[1])
        .migrateERC721(constants.AddressZero, constants.AddressZero, constants.Zero)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("onlyStaker: revertions work as expected", async () => {
    const param = fc.sample(randomStake(env, contracts), 1)[0];
    await prepareStake(param);
    await stake(param);
    await expect(
      contracts.stakeProxy.claim(env.admin.address, constants.Zero, constants.AddressZero)
    ).to.be.revertedWith("StakeProxy: not valid staker");
    await expect(contracts.stakeProxy.withdraw(env.admin.address)).to.be.revertedWith("StakeProxy: not valid staker");
  });

  it("migrateERC20", async () => {
    await contracts.apeCoin.transfer(contracts.stakeProxy.address, makeBN18(100));
    await expect(
      contracts.stakeProxy.migrateERC20(contracts.apeCoin.address, env.admin.address, makeBN18(100))
    ).to.changeTokenBalances(
      contracts.apeCoin,
      [env.admin.address, contracts.stakeProxy.address],
      [makeBN18(100), constants.Zero.sub(makeBN18(100))]
    );
  });

  it("migrateERC721", async () => {
    await contracts.bayc.mint(200);
    await contracts.bayc.transferFrom(env.admin.address, contracts.stakeProxy.address, 200);
    await expect(contracts.stakeProxy.migrateERC721(contracts.bayc.address, env.admin.address, 200)).to.not.reverted;
    expect(await contracts.bayc.ownerOf(200)).to.eq(env.admin.address);
  });

  it("stake: revert - caller is not the owner", async () => {
    const param = fc.sample(randomStake(env, contracts), 1)[0];
    await expect(
      contracts.stakeProxy.connect(env.accounts[1]).stake(param.apeStaked, param.bakcStaked, param.coinStaked)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("stake: revert - not ape owner", async () => {
    const param = fc.sample(randomStake(env, contracts), 1)[0];
    await prepareStake(param);
    await expect(contracts.stakeProxy.stake(param.apeStaked, param.bakcStaked, param.coinStaked)).to.be.revertedWith(
      "StakeProxy: not ape owner"
    );
  });

  it("stake: revert - invalid ape collection", async () => {
    const param = fc.sample(randomStake(env, contracts), 1)[0];
    const invalidApeStaked = { ...param.apeStaked };
    invalidApeStaked.collection = constants.AddressZero;
    await expect(contracts.stakeProxy.stake(invalidApeStaked, param.bakcStaked, param.coinStaked)).to.be.revertedWith(
      "StakeProxy: invalid ape collection"
    );
  });

  it("stake: revert - ape already staked", async () => {
    const param = fc.sample(randomSingleStake(env, contracts), 1)[0];
    await prepareStake(param);
    await (param as any).apeContract
      .connect(await ethers.getSigner(param.apeStaked.staker))
      .transferFrom(param.apeStaked.staker, env.admin.address, param.apeStaked.tokenId);

    // mock stake in offical apeStaking
    const nfts = [{ tokenId: param.apeStaked.tokenId, amount: makeBN18(200) }];
    await contracts.apeCoin.approve(contracts.apeStaking.address, constants.MaxUint256);
    if (param.apeStaked.collection === contracts.bayc.address) {
      await expect(contracts.apeStaking.depositBAYC(nfts)).to.not.reverted;
    } else {
      await expect(contracts.apeStaking.depositMAYC(nfts)).to.not.reverted;
    }

    await (param as any).apeContract.transferFrom(
      env.admin.address,
      contracts.stakeProxy.address,
      param.apeStaked.tokenId
    );

    await expect(contracts.stakeProxy.stake(param.apeStaked, param.bakcStaked, param.coinStaked)).to.be.revertedWith(
      "StakeProxy: ape already staked"
    );
  });

  it("stake: revert - not bakc owner", async () => {
    const param = fc.sample(randomPairedStake(env, contracts), 1)[0];
    await prepareStake(param);
    await (param as any).apeContract
      .connect(await ethers.getSigner(param.apeStaked.staker))
      .transferFrom(param.apeStaked.staker, contracts.stakeProxy.address, param.apeStaked.tokenId);

    await expect(contracts.stakeProxy.stake(param.apeStaked, param.bakcStaked, param.coinStaked)).to.be.revertedWith(
      "StakeProxy: not bakc owner"
    );
  });

  it("stake: revert - bakc already staked", async () => {
    const param = fc.sample(randomPairedStake(env, contracts), 1)[0];
    await prepareStake(param);
    await (param as any).apeContract
      .connect(await ethers.getSigner(param.apeStaked.staker))
      .transferFrom(param.apeStaked.staker, env.admin.address, param.apeStaked.tokenId);

    await contracts.bakc
      .connect(await ethers.getSigner(param.bakcStaked.staker))
      .transferFrom(param.bakcStaked.staker, env.admin.address, param.bakcStaked.tokenId);

    // mock stake in offical apeStaking
    await contracts.apeCoin.approve(contracts.apeStaking.address, constants.MaxUint256);
    const nfts = [
      { mainTokenId: param.apeStaked.tokenId, bakcTokenId: param.bakcStaked.tokenId, amount: makeBN18(200) },
    ];
    if (param.apeStaked.collection === contracts.bayc.address) {
      await expect(contracts.apeStaking.depositBAKC(nfts, [])).to.not.reverted;
    } else {
      await expect(contracts.apeStaking.depositBAKC([], nfts)).to.not.reverted;
    }

    await (param as any).apeContract.transferFrom(
      env.admin.address,
      contracts.stakeProxy.address,
      param.apeStaked.tokenId
    );

    await contracts.bakc.transferFrom(env.admin.address, contracts.stakeProxy.address, param.bakcStaked.tokenId);

    await expect(contracts.stakeProxy.stake(param.apeStaked, param.bakcStaked, param.coinStaked)).to.be.revertedWith(
      "StakeProxy: bakc already staked"
    );
  });

  it("stake: revert - ERC20: transfer amount exceeds balance", async () => {
    const param = fc.sample(randomStake(env, contracts), 1)[0];
    await prepareStake(param);
    const apeContract = (param as any).apeContract;
    const apeStaked = param.apeStaked;
    const bakcStaked = param.bakcStaked;
    const coinStaked = param.coinStaked;
    const poolId = param.poolId;
    await apeContract
      .connect(await ethers.getSigner(apeStaked.staker))
      .transferFrom(apeStaked.staker, contracts.stakeProxy.address, apeStaked.tokenId);

    if (poolId === 3) {
      await contracts.bakc
        .connect(await ethers.getSigner(bakcStaked.staker))
        .transferFrom(bakcStaked.staker, contracts.stakeProxy.address, bakcStaked.tokenId);
    }
    await expect(contracts.stakeProxy.stake(apeStaked, bakcStaked, coinStaked)).to.be.revertedWith(
      "ERC20: transfer amount exceeds balance"
    );
  });

  it("unStake: unStake if not staked", async () => {
    await expect(contracts.stakeProxy.unStake()).to.be.revertedWith("StakeProxy: no staking at all");
    expect(await contracts.stakeProxy.withdrawable(constants.AddressZero)).to.eq(constants.Zero);
    expect(await contracts.stakeProxy.claimable(constants.AddressZero, constants.Zero)).to.eq(constants.Zero);
  });

  it("stake: check state if stake success", async () => {
    await fc.assert(
      fc
        .asyncProperty(randomStake(env, contracts), async (param) => {
          await prepareStake(param);

          let apeStakedStorage = await contracts.stakeProxy.apeStaked();
          let bakcStakedStorage = await contracts.stakeProxy.bakcStaked();
          let coinStakedStorage = await contracts.stakeProxy.coinStaked();

          expect(apeStakedStorage.offerHash).to.eq(emptyBytes32);
          expect(apeStakedStorage.staker).to.eq(constants.AddressZero);
          expect(apeStakedStorage.collection).to.eq(constants.AddressZero);
          expect(apeStakedStorage.tokenId).to.eq(constants.Zero);
          expect(apeStakedStorage.share).to.eq(constants.Zero);
          expect(apeStakedStorage.coinAmount).to.eq(constants.Zero);

          expect(bakcStakedStorage.offerHash).to.eq(emptyBytes32);
          expect(bakcStakedStorage.staker).to.eq(constants.AddressZero);
          expect(bakcStakedStorage.tokenId).to.eq(constants.Zero);
          expect(bakcStakedStorage.share).to.eq(constants.Zero);
          expect(bakcStakedStorage.coinAmount).to.eq(constants.Zero);

          expect(coinStakedStorage.offerHash).to.eq(emptyBytes32);
          expect(coinStakedStorage.staker).to.eq(constants.AddressZero);
          expect(coinStakedStorage.share).to.eq(constants.Zero);
          expect(coinStakedStorage.coinAmount).to.eq(constants.Zero);

          await stake(param);

          const apeContract = (param as any).apeContract;
          const apeStaked = param.apeStaked;
          const bakcStaked = param.bakcStaked;
          const coinStaked = param.coinStaked;
          const poolId = param.poolId;

          // check nft ownership
          expect(await apeContract.ownerOf(apeStaked.tokenId)).to.be.eq(env.admin.address);
          if (poolId === 3) {
            expect(await contracts.bakc.ownerOf(bakcStaked.tokenId)).to.be.eq(contracts.stakeProxy.address);
          }

          // check storage
          apeStakedStorage = await contracts.stakeProxy.apeStaked();
          bakcStakedStorage = await contracts.stakeProxy.bakcStaked();
          coinStakedStorage = await contracts.stakeProxy.coinStaked();

          expect(await contracts.stakeProxy.poolId()).to.eq(poolId);
          expect(apeStaked.offerHash).to.eq(apeStakedStorage.offerHash);
          expect(apeStaked.staker).to.eq(apeStakedStorage.staker);
          expect(apeStaked.collection).to.eq(apeStakedStorage.collection);
          expect(apeStaked.tokenId).to.eq(apeStakedStorage.tokenId);
          expect(apeStaked.share).to.eq(apeStakedStorage.share);
          expect(apeStaked.coinAmount).to.eq(apeStakedStorage.coinAmount);

          expect(bakcStaked.offerHash).to.eq(bakcStakedStorage.offerHash);
          expect(bakcStaked.staker).to.eq(bakcStakedStorage.staker);
          expect(bakcStaked.tokenId).to.eq(bakcStakedStorage.tokenId);
          expect(bakcStaked.share).to.eq(bakcStakedStorage.share);
          expect(bakcStaked.coinAmount).to.eq(bakcStakedStorage.coinAmount);

          expect(coinStaked.offerHash).to.eq(coinStakedStorage.offerHash);
          expect(coinStaked.staker).to.eq(coinStakedStorage.staker);
          expect(coinStaked.share).to.eq(coinStakedStorage.share);
          expect(coinStaked.coinAmount).to.eq(coinStakedStorage.coinAmount);

          expect(await contracts.apeCoin.balanceOf(contracts.stakeProxy.address)).to.be.eq(constants.Zero);

          const totalStaked = BigNumber.from(apeStaked.coinAmount)
            .add(bakcStaked.coinAmount)
            .add(coinStaked.coinAmount);

          expect(await contracts.apeStaking.stakedTotal(env.admin.address)).to.eq(totalStaked);
          expect((await contracts.apeStaking.nftPosition(poolId, (param as any).poolTokenId)).stakedAmount).to.eq(
            totalStaked
          );

          expect(await contracts.stakeProxy.withdrawable(apeStaked.staker)).to.eq(constants.Zero);
          expect(await contracts.stakeProxy.withdrawable(bakcStaked.staker)).to.eq(constants.Zero);
          expect(await contracts.stakeProxy.withdrawable(coinStaked.staker)).to.eq(constants.Zero);

          expect(await contracts.stakeProxy.claimable(apeStaked.staker, constants.Zero)).to.eq(constants.Zero);
          expect(await contracts.stakeProxy.claimable(bakcStaked.staker, constants.Zero)).to.eq(constants.Zero);
          expect(await contracts.stakeProxy.claimable(coinStaked.staker, constants.Zero)).to.eq(constants.Zero);

          expect(await contracts.stakeProxy.totalStaked()).eq(totalStaked);

          expect(await contracts.stakeProxy.unStaked()).to.eq(false);
        })
        .beforeEach(async () => {
          await snapshots.revert("init");
        }),
      { numRuns: 10 }
    );
  });

  it("unStake: revert - not ape owner", async () => {
    const param = fc.sample(randomStake(env, contracts), 1)[0];
    await prepareStake(param);
    await stake(param);
    await expect(contracts.stakeProxy.unStake()).to.revertedWith("StakeProxy: not ape owner");
  });

  it("unStake: revert - already unStaked", async () => {
    const param = fc.sample(randomStake(env, contracts), 1)[0];
    await prepareStake(param);
    await stake(param);

    const apeContract = (param as any).apeContract;
    const apeStaked = param.apeStaked;

    await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);

    expect(await contracts.stakeProxy.unStake()).to.not.be.reverted;

    await expect(contracts.stakeProxy.unStake()).to.revertedWith("StakeProxy: already unStaked");
  });

  it("unStake: check state after unStake", async () => {
    const now = await latest();

    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
        const endTimestamp = pools[v.poolId].currentTimeRange.endTimestampHour.toNumber();
        const startTimestamp = pools[v.poolId].currentTimeRange.startTimestampHour.toNumber();
        const time = Math.max(now + 100, startTimestamp);
        const randomTime = fc.integer({ min: time, max: endTimestamp });
        return fc.tuple(fc.constant(v), randomTime);
      });
    };

    await fc.assert(
      fc
        .asyncProperty(randomParams(), async (v) => {
          const [param, time] = v;

          await prepareStake(param);
          await stake(param);

          const apeContract = (param as any).apeContract;
          const apeStaked = param.apeStaked;
          const bakcStaked = param.bakcStaked;
          const coinStaked = param.coinStaked;
          const poolId = param.poolId;
          const poolTokenId = (param as any).poolTokenId;

          const totalStaked = BigNumber.from(apeStaked.coinAmount)
            .add(bakcStaked.coinAmount)
            .add(coinStaked.coinAmount);

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

          expect(await apeContract.ownerOf(apeStaked.tokenId)).to.eq(env.admin.address);
        })
        .beforeEach(async () => {
          lastRevert = "init";
          await snapshots.revert(lastRevert);
        }),
      { numRuns: 10 }
    );
  });

  it("claimable: amount will grow up before unStake", async () => {
    const now = await latest();

    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
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
      fc
        .asyncProperty(randomParams(), async (v) => {
          const [param, times] = v;
          await prepareStake(param);
          await stake(param);

          const apeStaked = param.apeStaked;
          const bakcStaked = param.bakcStaked;
          const coinStaked = param.coinStaked;
          const poolId = param.poolId;
          const poolTokenId = (param as any).poolTokenId;

          const uniqueStakers = new Set<string>([apeStaked.staker, bakcStaked.staker, coinStaked.staker]);

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
          let computed = await computeRewards(totalRewards, param);

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
          computed = await computeRewards(totalRewards2, param);

          expect(totalRewards2).to.eq(totalClaimable);

          uniqueStakers.forEach((v) => {
            expect(stakerRewards.get(v)).to.eq(computed.get(v));
          });

          expect(totalRewards2).gte(totalRewards);
        })
        .beforeEach(async () => {
          lastRevert = "init";
          await snapshots.revert(lastRevert);
        }),
      { numRuns: 10 }
    );
  });

  it("claimable: amount will not grow up after unStake", async () => {
    const now = await latest();

    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
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
      fc
        .asyncProperty(randomParams(), async (v) => {
          const [param, times] = v;

          await prepareStake(param);
          await stake(param);

          const apeContract = (param as any).apeContract;
          const apeStaked = param.apeStaked;
          const bakcStaked = param.bakcStaked;
          const coinStaked = param.coinStaked;
          const poolId = param.poolId;

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
        })
        .beforeEach(async () => {
          lastRevert = "init";
          await snapshots.revert(lastRevert);
        }),
      { numRuns: 10 }
    );
  });

  it("withdrawable: amount will always be zero before unStake", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
        const endTimestamp = pools[v.poolId].currentTimeRange.endTimestampHour.toNumber();
        const startTimestamp = pools[v.poolId].currentTimeRange.startTimestampHour.toNumber();
        const time = Math.max(now + 100, startTimestamp);
        const randomTime = fc.integer({ min: time, max: endTimestamp });
        return fc.tuple(fc.constant(v), randomTime);
      });
    };

    await fc.assert(
      fc
        .asyncProperty(randomParams(), async (v) => {
          const [param, time] = v;

          await prepareStake(param);
          await stake(param);

          const apeStaked = param.apeStaked;
          const bakcStaked = param.bakcStaked;
          const coinStaked = param.coinStaked;

          await increaseTo(BigNumber.from(time));
          await advanceBlock();

          const apeRewards = await contracts.stakeProxy.withdrawable(apeStaked.staker);
          const bakcRewards = await contracts.stakeProxy.withdrawable(bakcStaked.staker);
          const coinRewards = await contracts.stakeProxy.withdrawable(coinStaked.staker);

          expect(apeRewards).to.eq(0);
          expect(bakcRewards).to.eq(0);
          expect(coinRewards).to.eq(0);
        })
        .beforeEach(async () => {
          lastRevert = "init";
          await snapshots.revert(lastRevert);
        }),
      { numRuns: 10 }
    );
  });

  it("withdrawable: amount will always be const after unStake", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
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
      fc
        .asyncProperty(randomParams(), async (v) => {
          const [param, times] = v;

          await prepareStake(param);
          await stake(param);

          const apeContract = (param as any).apeContract;
          const apeStaked = param.apeStaked;
          const bakcStaked = param.bakcStaked;
          const coinStaked = param.coinStaked;

          await increaseTo(BigNumber.from(times[0]));
          await advanceBlock();
          await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);
          await contracts.stakeProxy.unStake();
          const uniqueStakers = new Set<string>([apeStaked.staker, bakcStaked.staker, coinStaked.staker]);

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
        })
        .beforeEach(async () => {
          lastRevert = "init";
          await snapshots.revert(lastRevert);
        }),
      { numRuns: 10 }
    );
  });

  it("claim: revert - not ape owner", async () => {
    const param = fc.sample(randomStake(env, contracts), 1)[0];
    await prepareStake(param);
    await stake(param);

    const apeStaked = param.apeStaked;

    await expect(contracts.stakeProxy.claim(apeStaked.staker, 0, constants.AddressZero)).to.revertedWith(
      "StakeProxy: not ape owner"
    );
  });

  it("claim: revert - not bakc owner", async () => {
    const param = fc.sample(randomPairedStake(env, contracts), 1)[0];
    await prepareStake(param);
    await stake(param);

    const apeContract = (param as any).apeContract;
    const apeStaked = param.apeStaked;
    const bakcStaked = param.bakcStaked;

    await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);

    // mock transfer bakc away
    await impersonateAccount(contracts.stakeProxy.address);
    await setBalance(contracts.stakeProxy.address, makeBN18(1));
    await contracts.bakc
      .connect(await ethers.getSigner(contracts.stakeProxy.address))
      .transferFrom(contracts.stakeProxy.address, env.admin.address, bakcStaked.tokenId);

    await expect(contracts.stakeProxy.claim(apeStaked.staker, 0, constants.AddressZero)).to.revertedWith(
      "StakeProxy: not bakc owner"
    );
  });

  it("claim: claims before unStake", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
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
      fc
        .asyncProperty(randomParams(), async (v) => {
          const [param, times] = v;
          await prepareStake(param);
          await stake(param);

          const apeContract = (param as any).apeContract;
          const apeStaked = param.apeStaked;
          const bakcStaked = param.bakcStaked;
          const poolId = param.poolId;
          const poolTokenId = (param as any).poolTokenId;

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
        })
        .beforeEach(async () => {
          lastRevert = "init";
          await snapshots.revert(lastRevert);
        }),
      { numRuns: 10 }
    );
  });

  it("claim: claims over unStake", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
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
      fc
        .asyncProperty(randomParams(), async (v) => {
          const [param, times] = v;
          await prepareStake(param);
          await stake(param);

          const apeContract = (param as any).apeContract;
          const apeStaked = param.apeStaked;
          const bakcStaked = param.bakcStaked;
          const poolId = param.poolId;
          const poolTokenId = (param as any).poolTokenId;

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
        })
        .beforeEach(async () => {
          lastRevert = "init";
          await snapshots.revert(lastRevert);
        }),
      { numRuns: 10 }
    );
  });

  it("withdraw: revert - can't withdraw before unStake", async () => {
    const param = fc.sample(randomStake(env, contracts), 1)[0];
    await prepareStake(param);
    await stake(param);
    const apeStaked = param.apeStaked;
    await expect(contracts.stakeProxy.withdraw(apeStaked.staker)).to.revertedWith("StakeProxy: can't withdraw");
  });

  it("withdraw: after unStake", async () => {
    await fc.assert(
      fc
        .asyncProperty(randomStake(env, contracts), async (param) => {
          await prepareStake(param);
          await stake(param);

          const apeContract = (param as any).apeContract;
          const apeStaked = param.apeStaked;
          const bakcStaked = param.bakcStaked;
          const coinStaked = param.coinStaked;
          const poolId = param.poolId;

          await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);
          await contracts.stakeProxy.unStake();
          const apeWithdrawable = await contracts.stakeProxy.withdrawable(apeStaked.staker);
          const bakcWithdrawable = await contracts.stakeProxy.withdrawable(bakcStaked.staker);
          const coinWithdrawable = await contracts.stakeProxy.withdrawable(coinStaked.staker);
          await expect(contracts.stakeProxy.withdraw(apeStaked.staker)).to.changeTokenBalances(
            contracts.apeCoin,
            [apeStaked.staker, contracts.stakeProxy.address],
            [apeWithdrawable, constants.Zero.sub(apeWithdrawable)]
          );
          if (apeStaked.staker !== bakcStaked.staker && bakcStaked.staker !== constants.AddressZero) {
            await expect(contracts.stakeProxy.withdraw(bakcStaked.staker)).to.changeTokenBalances(
              contracts.apeCoin,
              [bakcStaked.staker, contracts.stakeProxy.address],
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
              [coinStaked.staker, contracts.stakeProxy.address],
              [coinWithdrawable, constants.Zero.sub(coinWithdrawable)]
            );
          }
          if (poolId === 3) {
            expect(await contracts.bakc.ownerOf(bakcStaked.tokenId)).to.eq(bakcStaked.staker);
          }
        })
        .beforeEach(async () => {
          lastRevert = "init";
          await snapshots.revert(lastRevert);
        }),
      { numRuns: 10 }
    );
  });
});
