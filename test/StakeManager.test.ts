import { expect } from "chai";
import fc from "fast-check";
import { ethers } from "hardhat";
import { Contracts, Env, makeSuite, Snapshots } from "./_setup";
import { BigNumber, constants, Contract } from "ethers";

import { IStakeProxy } from "../typechain-types/contracts/interfaces/IStakeProxy";
import { getContract, makeBN18, randomPairedStake, randomSingleStake, randomStake, skipHourBlocks } from "./utils";
import { advanceBlock, increaseBy, increaseTo, latest } from "./helpers/block-traveller";
import { impersonateAccount, setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { parseEvents } from "./helpers/transaction-helper";

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
makeSuite("StakeManager", (contracts: Contracts, env: Env, snapshots: Snapshots) => {
  let lastRevert: string;
  let pools: any;

  const getPoolTime = (poolId_: number): number[] => {
    const startTimestamp = pools[poolId_].currentTimeRange.startTimestampHour;
    const endTimestamp = pools[poolId_].currentTimeRange.endTimestampHour;
    return [startTimestamp, endTimestamp];
  };

  const prepareStake = async (param: any, withLoan_: boolean): Promise<any> => {
    param.withLoan = withLoan_;
    param.apeContract = await getContract("MintableERC721", param.apeStaked.collection);
    const bnft = await contracts.bnftRegistry.getBNFTAddresses(param.apeStaked.collection);
    param.boundApeContract = await getContract("IBNFT", bnft[0]);
    const apeStaker = await ethers.getSigner(await param.apeStaked.staker);
    let apeOwner = constants.AddressZero;
    try {
      apeOwner = await param.apeContract.ownerOf(param.apeStaked.tokenId);
    } catch (error) {}
    if (apeOwner === constants.AddressZero) {
      await param.apeContract.connect(apeStaker).mint(await param.apeStaked.tokenId);
      if (param.withLoan) {
        await param.apeContract.connect(apeStaker).approve(contracts.lendPool.address, param.apeStaked.tokenId);
        await contracts.lendPool
          .connect(apeStaker)
          .borrow(
            contracts.weth.address,
            makeBN18("0.001"),
            param.apeStaked.collection,
            param.apeStaked.tokenId,
            param.apeStaked.staker,
            0
          );
      } else {
        await param.apeContract
          .connect(apeStaker)
          .transferFrom(param.apeStaked.staker, contracts.stakeManager.address, param.apeStaked.tokenId);
      }
    }

    if (param.poolId === 3) {
      const bakcStaker = await ethers.getSigner(await param.bakcStaked.staker);
      try {
        await contracts.bakc.connect(bakcStaker).mint(await param.bakcStaked.tokenId);
        await contracts.bakc
          .connect(bakcStaker)
          .transferFrom(param.bakcStaked.staker, contracts.stakeManager.address, param.bakcStaked.tokenId);
      } catch (error) {}
    }

    const totalStaked = BigNumber.from(param.apeStaked.coinAmount)
      .add(await param.bakcStaked.coinAmount)
      .add(await param.coinStaked.coinAmount);

    await contracts.apeCoin.transfer(contracts.stakeManager.address, totalStaked);
    return param;
  };

  const randomWithLoan = fc.boolean();

  const doStake = async (param: any) => {
    const tx = await contracts.stakeManager.stake(param.apeStaked, param.bakcStaked, param.coinStaked);
    const events = parseEvents(await tx.wait(), contracts.stakeManager.interface);
    const stakedEvent = events.Staked;
    if (stakedEvent) {
      param.proxy = await getContract<IStakeProxy>("IStakeProxy", stakedEvent.proxy);
      return param;
    } else {
      throw new Error("match error");
    }
  };

  const assertUnStake = async (unStaker: string, param: any) => {
    await skipHourBlocks();

    const apeStaked = param.apeStaked;
    const bakcStaked = param.bakcStaked;
    const coinStaked = param.coinStaked;

    const apeStakerTotalStaked = await contracts.stakeManager.totalStaked(param.proxy.address, apeStaked.staker);
    const bakcStakerTotalStaked = await contracts.stakeManager.totalStaked(param.proxy.address, bakcStaked.staker);
    const coinStakerTotalStaked = await contracts.stakeManager.totalStaked(param.proxy.address, coinStaked.staker);

    const fee = await contracts.stakeManager.fee();

    const apeStakerRewards = await param.proxy.claimable(apeStaked.staker, fee);
    const apeStakerFee = (await param.proxy.claimable(apeStaked.staker, 0)).sub(apeStakerRewards);

    const bakcStakerRewards = await param.proxy.claimable(bakcStaked.staker, fee);
    const bakcStakerFee = (await param.proxy.claimable(bakcStaked.staker, 0)).sub(bakcStakerRewards);

    const coinStakerRewards = await param.proxy.claimable(coinStaked.staker, fee);
    const coinStakerFee = (await param.proxy.claimable(coinStaked.staker, 0)).sub(coinStakerRewards);

    let toFee = apeStakerFee;

    if (apeStaked.staker !== bakcStaked.staker) {
      toFee = toFee.add(bakcStakerFee);
    }
    if (bakcStaked.staker !== coinStaked.staker && apeStaked.staker !== coinStaked.staker) {
      toFee = toFee.add(coinStakerFee);
    }

    const unStakerSigner = await ethers.getSigner(unStaker);
    let beoundApeMinter = constants.AddressZero;

    try {
      beoundApeMinter = await param.boundApeContract.minterOf(apeStaked.tokenId);
    } catch (error) {}
    const withLoan = beoundApeMinter === contracts.lendPoolLoan.address;

    // assert ape coin balances
    await expect(contracts.stakeManager.connect(unStakerSigner).unStake(param.proxy.address)).changeTokenBalances(
      contracts.apeCoin,
      [apeStaked.staker, bakcStaked.staker, coinStaked.staker, await contracts.stakeManager.feeRecipient()],
      [
        apeStakerTotalStaked.add(apeStakerRewards),
        bakcStakerTotalStaked.add(bakcStakerRewards),
        coinStakerTotalStaked.add(coinStakerRewards),
        toFee,
      ]
    );
    expect(await contracts.stakeManager.totalStaked(param.proxy.address, unStaker)).eq(0);

    // assert staked proxy removed
    const stakedProxies = await contracts.stakeManager.getStakedProxies(apeStaked.collection, apeStaked.tokenId);
    expect(stakedProxies).to.not.contains(param.proxy.address);

    const allProxiesUnStaked = stakedProxies.length === 0;
    if (withLoan) {
      expect(
        await param.boundApeContract.isFlashLoanLocked(
          apeStaked.tokenId,
          contracts.lendPoolLoan.address,
          contracts.stakeManager.address
        )
      ).to.eq(!allProxiesUnStaked);
      if (allProxiesUnStaked) {
        expect(await contracts.lendPoolLoan.getLoanRepaidInterceptors(apeStaked.collection, apeStaked.tokenId)).to.be
          .empty;
      }
      expect(await param.apeContract.ownerOf(apeStaked.tokenId)).to.eq(param.boundApeContract.address);
    } else {
      expect(
        await param.boundApeContract.isFlashLoanLocked(
          apeStaked.tokenId,
          contracts.stakeManager.address,
          contracts.stakeManager.address
        )
      ).to.eq(!allProxiesUnStaked);
      // check ape owner
      if (allProxiesUnStaked) {
        expect(await param.apeContract.ownerOf(apeStaked.tokenId)).to.eq(apeStaked.staker);
      } else {
        expect(await param.apeContract.ownerOf(apeStaked.tokenId)).to.eq(param.boundApeContract.address);
      }
    }

    // check bakc owner
    if (param.poolId === 3) {
      expect(await contracts.bakc.ownerOf(bakcStaked.tokenId)).to.eq(bakcStaked.staker);
    }
    // check ape coin
    expect(await contracts.apeCoin.balanceOf(contracts.stakeManager.address)).to.be.eq(0);
  };

  const assertClaim = async (claimer: string, param: any, claimFor = false) => {
    await skipHourBlocks();

    const rewards = await contracts.stakeManager.claimable(param.proxy.address, claimer);
    const fee = (await param.proxy.claimable(claimer, 0)).sub(rewards);

    // assert ape coin balances
    if (claimFor) {
      await expect(contracts.stakeManager.claimFor(param.proxy.address, claimer)).changeTokenBalances(
        contracts.apeCoin,
        [claimer, await contracts.stakeManager.feeRecipient()],
        [rewards, fee]
      );
    } else {
      const claimerSigner = await ethers.getSigner(claimer);
      await expect(contracts.stakeManager.connect(claimerSigner).claim(param.proxy.address)).changeTokenBalances(
        contracts.apeCoin,
        [claimer, await contracts.stakeManager.feeRecipient()],
        [rewards, fee]
      );
    }

    // check ape coin
    expect(await contracts.apeCoin.balanceOf(contracts.stakeManager.address)).to.be.eq(0);
  };

  const assertStake = async (param: any) => {
    // check proxy state
    const proxies = await contracts.stakeManager.getStakedProxies(param.apeStaked.collection, param.apeStaked.tokenId);

    expect(proxies).contains(param.proxy.address);

    expect(await (contracts.stakeManager as Contract).proxies(param.proxy.address)).to.be.true;

    const apeStakedStorage = await param.proxy.apeStaked();
    const bakcStakedStorage = await param.proxy.bakcStaked();
    const coinStakedStorage = await param.proxy.coinStaked();

    const apeStaked = param.apeStaked;
    const bakcStaked = param.bakcStaked;
    const coinStaked = param.coinStaked;

    expect(await apeStaked.offerHash).to.eq(apeStakedStorage.offerHash);
    expect(await apeStaked.staker).to.eq(apeStakedStorage.staker);
    expect(await apeStaked.collection).to.eq(apeStakedStorage.collection);
    expect(await apeStaked.tokenId).to.eq(apeStakedStorage.tokenId);
    expect(await apeStaked.share).to.eq(apeStakedStorage.share);
    expect(await apeStaked.coinAmount).to.eq(apeStakedStorage.coinAmount);

    expect(await bakcStaked.offerHash).to.eq(bakcStakedStorage.offerHash);
    expect(await bakcStaked.staker).to.eq(bakcStakedStorage.staker);
    expect(await bakcStaked.tokenId).to.eq(bakcStakedStorage.tokenId);
    expect(await bakcStaked.share).to.eq(bakcStakedStorage.share);
    expect(await bakcStaked.coinAmount).to.eq(bakcStakedStorage.coinAmount);

    expect(await coinStaked.offerHash).to.eq(coinStakedStorage.offerHash);
    expect(await coinStaked.staker).to.eq(coinStakedStorage.staker);
    expect(await coinStaked.share).to.eq(coinStakedStorage.share);
    expect(await coinStaked.coinAmount).to.eq(coinStakedStorage.coinAmount);

    // check bnft interceptor and flashloan locking
    if (param.withLoan) {
      expect(
        await param.boundApeContract.isFlashLoanLocked(
          apeStaked.tokenId,
          contracts.lendPoolLoan.address,
          contracts.stakeManager.address
        )
      ).to.be.true;
      expect(await contracts.lendPoolLoan.getLoanRepaidInterceptors(apeStaked.collection, apeStaked.tokenId)).contains(
        contracts.stakeManager.address
      );
    } else {
      expect(
        await param.boundApeContract.isFlashLoanLocked(
          apeStaked.tokenId,
          contracts.stakeManager.address,
          contracts.stakeManager.address
        )
      ).to.be.true;
    }

    // check nft owner
    expect(await param.apeContract.ownerOf(apeStaked.tokenId)).to.eq(param.boundApeContract.address);

    if (param.poolId === 3) {
      expect(await contracts.bakc.ownerOf(bakcStaked.tokenId)).to.eq(param.proxy.address);
    }

    // check ape coin
    expect(await contracts.apeCoin.balanceOf(contracts.stakeManager.address)).to.be.eq(0);
  };

  before(async () => {
    pools = await contracts.apeStaking.getPoolsUI();
  });
  afterEach(async () => {
    if (lastRevert) {
      await snapshots.revert(lastRevert);
    }
  });

  it("setMatcher: revert", async () => {
    expect(await (contracts.stakeManager as any).matcher()).eq(constants.AddressZero);
    await expect(contracts.stakeManager.setMatcher(constants.AddressZero)).revertedWith(
      "StakeManager: matcher can't be zero address"
    );
    await contracts.stakeManager.setMatcher(env.admin.address);
    expect(await (contracts.stakeManager as any).matcher()).eq(env.admin.address);
    lastRevert = "init";
    await snapshots.capture("init");
  });

  it("updateFeeRecipient & updateFee: check state", async () => {
    expect(await contracts.stakeManager.feeRecipient()).eq(constants.AddressZero);
    expect(await contracts.stakeManager.fee()).eq(constants.Zero);

    await expect(contracts.stakeManager.updateFeeRecipient(constants.AddressZero)).revertedWith(
      "StakeManager: fee recipient can't be zero address"
    );
    await expect(contracts.stakeManager.updateFee(10001)).revertedWith("StakeManager: fee overflow");

    await contracts.stakeManager.updateFeeRecipient(env.admin.address);
    await contracts.stakeManager.updateFee(500);

    expect(await contracts.stakeManager.feeRecipient()).eq(env.admin.address);
    expect(await contracts.stakeManager.fee()).eq(500);
    lastRevert = "init";
    await snapshots.capture("init");
  });

  it("Revert - only allowed receive ETH from WETH", async () => {
    await expect(env.admin.sendTransaction({ to: contracts.stakeManager.address, value: makeBN18(1) })).revertedWith(
      "only allowed receive ETH from WETH"
    );
  });

  it("getCurrentApeCoinCap: check state", async () => {
    await expect(contracts.stakeManager.getCurrentApeCoinCap(0)).revertedWith("StakeManager: invalid pool id");
    for (const poolId of [1, 2, 3]) {
      expect(await contracts.stakeManager.getCurrentApeCoinCap(poolId)).eq(
        pools[poolId].currentTimeRange.capPerPosition
      );
    }
  });

  it("claimable & Fee: check state", async () => {
    const fee = await contracts.stakeManager.fee();

    const assertClaimable = async (param: any, withLoan: boolean) => {
      await snapshots.revert("init");
      await prepareStake(param, withLoan);
      await doStake(param);
      await increaseBy(BigNumber.from(3600 * 24));
      await advanceBlock();
      let proxyFee = fee;
      // assert fee should be zero if all staker are one user
      if (param.poolId === 1 || param.poolId === 2) {
        // no coin staker
        if (param.coinStaked.staker === constants.AddressZero) {
          proxyFee = constants.Zero;
        } else {
          if (param.apeStaked.staker === param.coinStaked.staker) {
            proxyFee = constants.Zero;
          }
        }
      }

      if (param.poolId === 3) {
        // no coin staker
        if (param.coinStaked.staker === constants.AddressZero) {
          if (param.apeStaked.staker === param.bakcStaked.staker) {
            proxyFee = constants.Zero;
          }
        } else {
          if (
            param.apeStaked.staker === param.coinStaked.staker &&
            param.apeStaked.staker === param.bakcStaked.staker
          ) {
            proxyFee = constants.Zero;
          }
        }
      }
      const proxy = (param as any).proxy;
      for (const staker of param.stakers) {
        expect(await contracts.stakeManager.claimable(proxy.address, staker)).eq(
          await proxy.claimable(staker, proxyFee)
        );
      }
    };
    const case1 = fc.sample(
      fc.tuple(
        randomPairedStake(env, contracts).filter((v) => {
          return v.apeStaked.staker === v.bakcStaked.staker && v.apeStaked.staker === v.coinStaked.staker;
        }),
        randomWithLoan
      ),
      1
    )[0];
    const case2 = fc.sample(
      fc.tuple(
        randomPairedStake(env, contracts).filter((v) => {
          return v.apeStaked.staker === v.bakcStaked.staker && constants.AddressZero === v.coinStaked.staker;
        }),
        randomWithLoan
      ),
      1
    )[0];
    for (const [param, withLoan] of fc.sample(fc.tuple(randomPairedStake(env, contracts), randomWithLoan), {
      examples: [case1, case2],
      numRuns: 10,
    })) {
      await assertClaimable(param, withLoan);
    }

    const case3 = fc.sample(
      fc.tuple(
        randomSingleStake(env, contracts).filter((v) => {
          return constants.AddressZero !== v.coinStaked.staker && v.apeStaked.staker === v.coinStaked.staker;
        }),
        randomWithLoan
      ),
      1
    )[0];
    for (const [param, withLoan] of fc.sample(fc.tuple(randomSingleStake(env, contracts), randomWithLoan), {
      examples: [case3],
      numRuns: 10,
    })) {
      await assertClaimable(param, withLoan);
    }
  });

  it("initialized: check init state and revert if reInit", async () => {
    expect(await (contracts.stakeManager as Contract).bayc()).to.eq(contracts.bayc.address);
    expect(await (contracts.stakeManager as Contract).mayc()).to.eq(contracts.mayc.address);
    expect(await (contracts.stakeManager as Contract).bakc()).to.eq(contracts.bakc.address);
    expect(await (contracts.stakeManager as Contract).boundBayc()).to.eq(contracts.bBayc.address);
    expect(await (contracts.stakeManager as Contract).boundMayc()).to.eq(contracts.bMayc.address);
    expect(await (contracts.stakeManager as Contract).apeCoin()).to.eq(contracts.apeCoin.address);
    expect(await (contracts.stakeManager as Contract).WETH()).to.eq(contracts.weth.address);
    expect(await (contracts.stakeManager as Contract).apeStaking()).to.eq(contracts.apeStaking.address);
    expect(await (contracts.stakeManager as Contract).proxyImplementation()).to.eq(contracts.stakeProxy.address);
    expect(await (contracts.stakeManager as Contract).lendPoolAddressedProvider()).to.eq(
      contracts.bendAddressesProvider.address
    );
    expect(await (contracts.stakeManager as Contract).owner()).to.eq(env.admin.address);

    await expect(
      (contracts.stakeManager as Contract)
        .connect(env.admin)
        .initialize(
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero,
          constants.AddressZero
        )
    ).to.revertedWith("Initializable: contract is already initialized");
  });

  it("pause & unpause: check state", async () => {
    expect(await (contracts.stakeManager as any).paused()).be.false;
    await (contracts.stakeManager as any).pause();
    expect(await (contracts.stakeManager as any).paused()).be.true;
    await (contracts.stakeManager as any).unpause();
    expect(await (contracts.stakeManager as any).paused()).be.false;
  });

  it("onlyOwner: revertions work as expected", async () => {
    await expect((contracts.stakeManager as any).connect(env.accounts[1]).pause()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );

    await expect((contracts.stakeManager as any).connect(env.accounts[1]).unpause()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );

    await expect(contracts.stakeManager.connect(env.accounts[1]).setMatcher(constants.AddressZero)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );

    await expect(
      contracts.stakeManager.connect(env.accounts[1]).updateFeeRecipient(constants.AddressZero)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(contracts.stakeManager.connect(env.accounts[1]).updateFee(constants.Zero)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
  });

  it("onlyStaker: revertions work as expected", async () => {
    await expect(contracts.stakeManager.claim(constants.AddressZero)).to.be.revertedWith("StakeManager: invalid proxy");
    const [param, withLoan] = fc.sample(fc.tuple(randomStake(env, contracts), randomWithLoan), 1)[0];
    await prepareStake(param, withLoan);
    await doStake(param);
    const proxy = (param as any).proxy;
    await expect(contracts.stakeManager.claim(proxy.address)).to.be.revertedWith("StakeManager: invalid caller");
  });

  it("onlyStakerOrOperator: revertions work as expected", async () => {
    await expect(contracts.stakeManager.unStake(constants.AddressZero)).to.be.revertedWith(
      "StakeManager: invalid proxy"
    );

    const randomParam = () => {
      return randomStake(env, contracts).chain((v) => {
        return fc.tuple(
          fc.constant(v),
          randomWithLoan,
          fc.constantFrom(...env.accounts.map((i) => i.address)).filter((account) => {
            return account !== v.apeStaked.staker && account !== v.bakcStaked.staker && account !== v.coinStaked.staker;
          })
        );
      });
    };
    for (const [param, withLoan, unStaker] of fc.sample(randomParam(), 10)) {
      await snapshots.revert("init");
      await prepareStake(param, withLoan);
      await doStake(param);
      const proxy = (param as any).proxy;
      await expect(
        contracts.stakeManager.connect(await ethers.getSigner(unStaker)).unStake(proxy.address)
      ).to.be.revertedWith("StakeManager: invalid caller");
    }
  });

  it("onlySpecifiedStaker: revertions work as expected", async () => {
    await expect(contracts.stakeManager.claimFor(constants.AddressZero, constants.AddressZero)).to.be.revertedWith(
      "StakeManager: invalid proxy"
    );
    const randomParam = () => {
      return randomStake(env, contracts).chain((v) => {
        return fc.tuple(
          fc.constant(v),
          randomWithLoan,
          fc.constantFrom(...env.accounts.map((i) => i.address)).filter((account) => {
            return account !== v.apeStaked.staker && account !== v.bakcStaked.staker && account !== v.coinStaked.staker;
          })
        );
      });
    };

    for (const [param, withLoan, claimFor] of fc.sample(randomParam(), 10)) {
      await snapshots.revert("init");
      await prepareStake(param, withLoan);
      await doStake(param);
      const proxy = (param as any).proxy;
      await expect(contracts.stakeManager.claimFor(proxy.address, claimFor)).to.be.revertedWith(
        "StakeManager: invalid caller"
      );
    }
  });

  it("onlyProxy: revertions work as expected", async () => {
    await expect(contracts.stakeManager.claimable(constants.AddressZero, constants.AddressZero)).to.be.revertedWith(
      "StakeManager: invalid proxy"
    );

    await expect(contracts.stakeManager.totalStaked(constants.AddressZero, constants.AddressZero)).to.be.revertedWith(
      "StakeManager: invalid proxy"
    );
  });

  it("onlyLendPool: revertions work as expected", async () => {
    await expect(
      (contracts.stakeManager as Contract).beforeLoanRepaid(constants.AddressZero, constants.Zero)
    ).to.be.revertedWith("StakeManager: caller must be lend pool");

    await expect(
      (contracts.stakeManager as Contract).afterLoanRepaid(constants.AddressZero, constants.Zero)
    ).to.be.revertedWith("StakeManager: caller must be lend pool");
    const lendPoolAddr = await contracts.bendAddressesProvider.getLendPoolLoan();
    await impersonateAccount(lendPoolAddr);
    const lendPoolSigner = await ethers.getSigner(lendPoolAddr);
    await setBalance(lendPoolAddr, makeBN18(1));
    await expect(
      (contracts.stakeManager as any).connect(lendPoolSigner).beforeLoanRepaid(constants.AddressZero, constants.Zero)
    ).not.revertedWith("StakeManager: caller must be lend pool");

    await expect(
      (contracts.stakeManager as any).connect(lendPoolSigner).afterLoanRepaid(constants.AddressZero, constants.Zero)
    ).not.revertedWith("StakeManager: caller must be lend pool");
  });

  it("onlyMatcher: revertions work as expected", async () => {
    await fc.assert(
      fc.asyncProperty(randomStake(env, contracts), randomWithLoan, async (param, withLoan) => {
        await prepareStake(param, withLoan);
        await expect(
          contracts.stakeManager.connect(env.accounts[1]).stake(param.apeStaked, param.bakcStaked, param.coinStaked)
        ).to.be.revertedWith("StakeManager: caller must be matcher");
      }),
      { numRuns: 1 }
    );
  });

  it("stake: revert - stake with invalid ape", async () => {
    await fc.assert(
      fc.asyncProperty(randomStake(env, contracts), async (param) => {
        param.apeStaked.collection = constants.AddressZero;
        await expect(contracts.stakeManager.stake(param.apeStaked, param.bakcStaked, param.coinStaked)).to.revertedWith(
          "StakeManager: not ape collection"
        );
      }),
      { numRuns: 10 }
    );
  });

  it("stake: revert - stake with ape not own", async () => {
    await fc.assert(
      fc.asyncProperty(randomStake(env, contracts), async (param) => {
        param.apeStaked.collection = constants.AddressZero;
        await expect(contracts.stakeManager.stake(param.apeStaked, param.bakcStaked, param.coinStaked)).to.revertedWith(
          "StakeManager: not ape collection"
        );
      }),
      { numRuns: 10 }
    );
  });

  it("stake: revert - staker with bnft not own", async () => {
    const randomParams = () => {
      return fc
        .tuple(randomSingleStake(env, contracts), randomSingleStake(env, contracts), randomWithLoan)
        .filter((v) => {
          return (
            v[0].apeStaked.collection === v[1].apeStaked.collection &&
            v[0].apeStaked.tokenId === v[1].apeStaked.tokenId &&
            // different staker
            v[0].apeStaked.staker !== v[1].apeStaked.staker
          );
        });
    };

    await fc.assert(
      fc.asyncProperty(randomParams(), async (v) => {
        const [param1, param2, withLoan] = v;
        const ape = await getContract("MintableERC721", param1.apeStaked.collection);
        lastRevert = "init";
        await snapshots.revert(lastRevert);
        const apeStaker = await ethers.getSigner(param1.apeStaked.staker);
        await ape.connect(apeStaker).mint(param1.apeStaked.tokenId);

        if (withLoan) {
          // bnft minted by lend pool
          await ape.connect(apeStaker).approve(contracts.lendPool.address, param1.apeStaked.tokenId);
          await contracts.lendPool
            .connect(apeStaker)
            .borrow(
              contracts.weth.address,
              makeBN18("0.001"),
              ape.address,
              param1.apeStaked.tokenId,
              apeStaker.address,
              0
            );
        } else {
          // bnft minted by staker manager
          await ape
            .connect(apeStaker)
            .transferFrom(apeStaker.address, contracts.stakeManager.address, param1.apeStaked.tokenId);
          const totalStaked = param1.apeStaked.coinAmount
            .add(param1.bakcStaked.coinAmount)
            .add(param1.coinStaked.coinAmount);
          await contracts.apeCoin.transfer(contracts.stakeManager.address, totalStaked);
          contracts.stakeManager.stake(param1.apeStaked, param1.bakcStaked, param1.coinStaked);
        }

        const totalStaked = param2.apeStaked.coinAmount
          .add(param2.bakcStaked.coinAmount)
          .add(param2.coinStaked.coinAmount);
        await contracts.apeCoin.transfer(contracts.stakeManager.address, totalStaked);

        await expect(contracts.stakeManager.stake(param2.apeStaked, param2.bakcStaked, param2.coinStaked)).revertedWith(
          "StakeManager: not bound ape owner"
        );
      }),
      { numRuns: 10 }
    );
  });

  it("stake: revert - stake twice with same ape to the ape pool", async () => {
    const randomParams = () => {
      return fc
        .tuple(randomSingleStake(env, contracts), randomSingleStake(env, contracts), randomWithLoan)
        .filter((v) => {
          return (
            v[0].apeStaked.collection === v[1].apeStaked.collection &&
            v[0].apeStaked.tokenId === v[1].apeStaked.tokenId &&
            v[0].apeStaked.staker === v[1].apeStaked.staker
          );
        });
    };
    await fc.assert(
      fc
        .asyncProperty(randomParams(), async (v) => {
          const [param1, param2, withLoan] = v;
          await prepareStake(param1, withLoan);
          await doStake(param1);
          await assertStake(param1);

          await prepareStake(param2, withLoan);
          await expect(
            contracts.stakeManager.stake(param2.apeStaked, param2.bakcStaked, param2.coinStaked)
          ).revertedWith("StakeProxy: ape already staked");
        })
        .beforeEach(async () => {
          await snapshots.revert("init");
        }),
      { numRuns: 10 }
    );
  });

  it("stake: revert - stake twice with same bakc to the bakc pool", async () => {
    const randomParams = () => {
      return fc
        .tuple(randomPairedStake(env, contracts), randomWithLoan, randomPairedStake(env, contracts), randomWithLoan)
        .filter((v) => {
          return v[0].bakcStaked.tokenId === v[2].bakcStaked.tokenId;
        });
    };
    await fc.assert(
      fc
        .asyncProperty(randomParams(), async (v) => {
          const [param1, withLoan1, param2, withLoan2] = v;
          await prepareStake(param1, withLoan1);
          await doStake(param1);
          await assertStake(param1);
          if (
            param1.apeStaked.collection === param2.apeStaked.collection &&
            param1.apeStaked.tokenId === param2.apeStaked.tokenId
          ) {
            param2.apeStaked.tokenId += 1;
          }
          await prepareStake(param2, withLoan2);

          await expect(
            contracts.stakeManager.stake(param2.apeStaked, param2.bakcStaked, param2.coinStaked)
          ).to.revertedWith("StakeManager: not bakc owner");
        })
        .beforeEach(async () => {
          await snapshots.revert("init");
        }),
      { numRuns: 10 }
    );
  });

  it("stake: stake twice, different proxy with same ape", async () => {
    const randomTwoStakes = fc.oneof(
      fc.tuple(randomSingleStake(env, contracts), randomPairedStake(env, contracts)),
      fc.tuple(randomPairedStake(env, contracts), randomSingleStake(env, contracts))
    );
    const randomParams = () => {
      return fc.tuple(randomTwoStakes, randomWithLoan).filter((v) => {
        return (
          v[0][0].apeStaked.collection === v[0][1].apeStaked.collection &&
          v[0][0].apeStaked.tokenId === v[0][1].apeStaked.tokenId &&
          v[0][0].apeStaked.staker === v[0][1].apeStaked.staker
        );
      });
    };
    await fc.assert(
      fc
        .asyncProperty(randomParams(), async (v) => {
          const [[param1, param2], withLoan] = v;
          await prepareStake(param1, withLoan);
          await doStake(param1);
          await assertStake(param1);

          await prepareStake(param2, withLoan);
          await doStake(param2);
          await assertStake(param2);
        })
        .beforeEach(async () => {
          await snapshots.revert("init");
        }),
      { numRuns: 10 }
    );
  });

  it("unStake: revert - unStake twice, same proxy", async () => {
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
        const randomUnStaker = fc.constantFrom(...v.stakers);
        return fc.tuple(fc.constant(v), randomWithLoan, randomUnStaker);
      });
    };

    for (const [param, withLoan, unStaker1] of fc.sample(randomParams(), 10)) {
      await snapshots.revert("init");
      await prepareStake(param, withLoan);
      await doStake(param);
      await assertUnStake(unStaker1, param);
      await expect(
        contracts.stakeManager.connect(await ethers.getSigner(unStaker1)).unStake((param as any).proxy.address)
      ).revertedWith("StakeManager: already unStaked");
    }
  });

  it("unStake: unStake twice, different proxy with same ape", async () => {
    const now = await latest();
    const randomTwoStakes = fc.oneof(
      fc.tuple(randomSingleStake(env, contracts), randomPairedStake(env, contracts)),
      fc.tuple(randomPairedStake(env, contracts), randomSingleStake(env, contracts))
    );
    const randomParams = () => {
      return randomTwoStakes
        .filter((v) => {
          return (
            v[0].apeStaked.collection === v[1].apeStaked.collection &&
            v[0].apeStaked.tokenId === v[1].apeStaked.tokenId &&
            v[0].apeStaked.staker === v[1].apeStaked.staker
          );
        })
        .chain((v) => {
          let times = getPoolTime(v[0].poolId);
          const randomTime = fc.integer({ min: Math.max(now + 100, times[0]), max: times[1] });
          times = getPoolTime(v[1].poolId);
          const randomTimes = fc.tuple(randomTime, randomTime).filter((v) => {
            return v[0] < v[1] && Math.abs(v[0] - v[1]) > 100;
          });
          return fc.tuple(
            randomWithLoan,
            fc.constant(v[0]),
            fc.constantFrom(...v[0].stakers),
            fc.constant(v[1]),
            fc.constantFrom(...v[1].stakers),
            randomTimes
          );
        });
    };

    for (const [withLoan, param1, unStaker1, param2, unStaker2, times] of fc.sample(randomParams(), 10)) {
      await snapshots.revert("init");
      await prepareStake(param1, withLoan);
      await doStake(param1);
      await prepareStake(param2, withLoan);
      await doStake(param2);
      await increaseTo(BigNumber.from(times[0]));
      await advanceBlock();
      await assertUnStake(unStaker1, param1);
      await increaseTo(BigNumber.from(times[1]));
      await advanceBlock();
      await assertUnStake(unStaker2, param2);
    }
  }).timeout(40000);

  it("unStake: unStake by all staker, same proxy", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
        const times = getPoolTime(v.poolId);
        const randomTime = fc.integer({ min: Math.max(now + 100, times[0]), max: times[1] });
        const randomTimes = fc.tuple(randomTime, randomTime, randomTime).filter((t) => {
          return t[0] < t[1] && Math.abs(t[0] - t[1]) > 100 && t[1] < t[2] && Math.abs(t[1] - t[2]) > 100;
        });
        return fc.tuple(fc.constant(v), randomWithLoan, randomTimes);
      });
    };

    for (const [param, withLoan, times] of fc.sample(randomParams(), 10)) {
      await snapshots.revert("init");
      await prepareStake(param, withLoan);
      await doStake(param);
      let index = 0;
      for (const staker of param.stakers) {
        await increaseTo(BigNumber.from(times[index]));
        await advanceBlock();
        if (index === 0) {
          await assertUnStake(staker, param);
        } else {
          await expect(
            contracts.stakeManager.connect(await ethers.getSigner(staker)).unStake((param as any).proxy.address)
          ).revertedWith("StakeManager: already unStaked");
        }
        index += 1;
      }
    }
  });

  it("approveOperator & revokeOperator: work as expected", async () => {
    const randomParam = () => {
      return randomStake(env, contracts).chain((v) => {
        return fc.tuple(
          fc.constant(v),
          randomWithLoan,
          fc.constantFrom(...v.stakers),
          fc.constantFrom(...env.accounts.map((i) => i.address)).filter((account) => {
            return account !== v.apeStaked.staker && account !== v.bakcStaked.staker && account !== v.coinStaked.staker;
          })
        );
      });
    };
    for (const [param, withLoan, staker, operator] of fc.sample(randomParam(), 10)) {
      await snapshots.revert("init");
      await prepareStake(param, withLoan);
      await doStake(param);
      const proxy = (param as any).proxy;
      const operatorSigner = await ethers.getSigner(operator);
      await expect(contracts.stakeManager.connect(operatorSigner).unStake(proxy.address)).to.be.revertedWith(
        "StakeManager: invalid caller"
      );
      await contracts.stakeManager.connect(await ethers.getSigner(staker)).approveOperator(operator);
      expect(await contracts.stakeManager.isApproved(staker, operator)).be.true;
      await expect(contracts.stakeManager.connect(operatorSigner).unStake(proxy.address)).not.reverted;
      await contracts.stakeManager.connect(await ethers.getSigner(staker)).revokeOperator();
      expect(await contracts.stakeManager.isApproved(staker, operator)).be.false;
    }
  });

  it("claim: claim by all staker before unStake, same proxy", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
        const times = getPoolTime(v.poolId);
        const randomTime = fc.integer({ min: Math.max(now + 100, times[0]), max: times[1] });

        const randomTimes = fc.tuple(randomTime, randomTime, randomTime).filter((t) => {
          return t[0] < t[1] && Math.abs(t[0] - t[1]) > 100 && t[1] < t[2] && Math.abs(t[1] - t[2]) > 100;
        });
        return fc.tuple(fc.constant(v), randomWithLoan, randomTimes);
      });
    };

    for (const [param, withLoan, times] of fc.sample(randomParams(), 10)) {
      await snapshots.revert("init");
      await prepareStake(param, withLoan);
      await doStake(param);
      let index = 0;
      for (const staker of param.stakers) {
        await increaseTo(BigNumber.from(times[index]));
        await advanceBlock();
        await assertClaim(staker, param);
        index += 1;
      }
    }
  }).timeout(40000);

  it("claim: claim after unStake, same proxy", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
        const times = getPoolTime(v.poolId);
        const randomTime = fc.integer({ min: Math.max(now + 100, times[0]), max: times[1] });
        return fc.tuple(
          fc.constant(v),
          randomWithLoan,
          randomTime,
          fc.constantFrom(...v.stakers),
          fc.constantFrom(...v.stakers)
        );
      });
    };

    for (const [param, withLoan, time, unStaker, claimer] of fc.sample(randomParams(), 10)) {
      await snapshots.revert("init");
      await prepareStake(param, withLoan);
      await doStake(param);

      await increaseTo(BigNumber.from(time));
      await advanceBlock();
      await skipHourBlocks();
      await assertUnStake(unStaker, param);

      await expect(
        contracts.stakeManager.connect(await ethers.getSigner(claimer)).claim((param as any).proxy.address)
      ).revertedWith("StakeManager: already unStaked");
    }
  });

  it("claimFor: claim for all staker before unStake, same proxy", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
        const times = getPoolTime(v.poolId);
        const randomTime = fc.integer({ min: Math.max(now + 100, times[0]), max: times[1] });

        const randomTimes = fc.tuple(randomTime, randomTime, randomTime).filter((t) => {
          return t[0] < t[1] && Math.abs(t[0] - t[1]) > 100 && t[1] < t[2] && Math.abs(t[1] - t[2]) > 100;
        });
        return fc.tuple(fc.constant(v), randomWithLoan, randomTimes);
      });
    };

    for (const [param, withLoan, times] of fc.sample(randomParams(), 10)) {
      await snapshots.revert("init");
      await prepareStake(param, withLoan);
      await doStake(param);
      let index = 0;
      for (const staker of param.stakers) {
        await increaseTo(BigNumber.from(times[index]));
        await advanceBlock();
        await assertClaim(staker, param, true);
        index += 1;
      }
    }
  }).timeout(40000);

  it("claimFor: claim for staker after unStake, same proxy", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
        const times = getPoolTime(v.poolId);
        const randomTime = fc.integer({ min: Math.max(now + 200, times[0]), max: times[1] });
        return fc.tuple(
          fc.constant(v),
          randomWithLoan,
          randomTime,
          fc.constantFrom(...v.stakers),
          fc.constantFrom(...v.stakers)
        );
      });
    };

    for (const [param, withLoan, time, unStaker, claimer] of fc.sample(randomParams(), 10)) {
      await snapshots.revert("init");
      await prepareStake(param, withLoan);
      await doStake(param);

      await increaseTo(BigNumber.from(time));
      await advanceBlock();
      await skipHourBlocks();
      await assertUnStake(unStaker, param);

      await expect(contracts.stakeManager.claimFor((param as any).proxy.address, claimer)).revertedWith(
        "StakeManager: already unStaked"
      );
    }
  });

  it("borrowETH: revert - borrowETH with bnft not own", async () => {
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
        return fc.tuple(
          fc.constant(v),
          fc.constantFrom(...env.accounts.map((i) => i.address)).filter((s) => {
            return s !== v.apeStaked.staker;
          })
        );
      });
    };
    await fc.assert(
      fc
        .asyncProperty(randomParams(), async (v) => {
          const [param, staker] = v;
          await prepareStake(param, false);
          await doStake(param);
          const apeStaked = await (param as any).proxy.apeStaked();
          const apeContract = (param as any).apeContract;
          const boundApeContract = (param as any).boundApeContract;

          const tokenId = BigNumber.from(apeStaked.tokenId).add(1);
          const stakerSigner = await ethers.getSigner(staker);
          await apeContract.connect(stakerSigner).mint(tokenId);
          await apeContract.connect(stakerSigner).approve(boundApeContract.address, tokenId);
          await boundApeContract.connect(stakerSigner).mint(staker, tokenId);

          const siger = await ethers.getSigner(apeStaked.staker);
          const amount = makeBN18("0.001");
          await expect(
            contracts.stakeManager.connect(siger).borrowETH(amount, apeStaked.collection, tokenId)
          ).revertedWith("StakeManager: not BNFT owner");
        })
        .beforeEach(async () => {
          await snapshots.revert("init");
        }),
      { numRuns: 10 }
    );
  });

  it("borrowETH: revert - borrowETH with bnft not minted by StakeManager", async () => {
    await fc.assert(
      fc
        .asyncProperty(randomStake(env, contracts), async (param) => {
          await prepareStake(param, true);
          await doStake(param);
          const apeStaked = await (param as any).proxy.apeStaked();
          const stakerSigner = await ethers.getSigner(apeStaked.staker);

          await expect(
            contracts.stakeManager
              .connect(stakerSigner)
              .borrowETH(makeBN18("0.001"), apeStaked.collection, apeStaked.tokenId)
          ).revertedWith("StakeManager: invalid BNFT minter");
        })
        .beforeEach(async () => {
          await snapshots.revert("init");
        }),
      { numRuns: 10 }
    );
  });

  it("borrowETH: revert - borrowETH with non ape collection", async () => {
    await expect(
      contracts.stakeManager.borrowETH(makeBN18("0.001"), constants.AddressZero, constants.Zero)
    ).revertedWith("StakeManager: not ape collection");
  });

  it("borrowETH: borrowETH then unStake", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
        const times = getPoolTime(v.poolId);
        const randomTime = fc.integer({ min: Math.max(now + 200, times[0]), max: times[1] });
        const randomUnStaker = fc.constantFrom(...v.stakers);
        return fc.tuple(fc.constant(v), randomTime, randomUnStaker);
      });
    };

    for (const [param, time, unStaker] of fc.sample(randomParams(), 10)) {
      await snapshots.revert("init");
      await prepareStake(param, false);
      await doStake(param);

      await increaseTo(BigNumber.from(time));
      await advanceBlock();

      const proxy = (param as any).proxy;
      const apeStaked = await proxy.apeStaked();
      const bakcStaked = await proxy.bakcStaked();
      const coinStaked = await proxy.coinStaked();

      const stakerSigner = await ethers.getSigner(apeStaked.staker);

      await contracts.debtWETH
        .connect(stakerSigner)
        .approveDelegation(contracts.stakeManager.address, constants.MaxUint256);

      await skipHourBlocks();

      const apeClaimable = await contracts.stakeManager.claimable(proxy.address, apeStaked.staker);
      const bakcClaimable = await contracts.stakeManager.claimable(proxy.address, bakcStaked.staker);
      const coinClaimable = await contracts.stakeManager.claimable(proxy.address, coinStaked.staker);

      const apeTotalStaked = await contracts.stakeManager.totalStaked(proxy.address, apeStaked.staker);
      const bakcTotalStaked = await contracts.stakeManager.totalStaked(proxy.address, bakcStaked.staker);
      const coinTotalStake = await contracts.stakeManager.totalStaked(proxy.address, coinStaked.staker);

      const amount = makeBN18("0.001");
      const preDebt = await contracts.debtWETH.balanceOf(apeStaked.staker);
      await expect(
        contracts.stakeManager.connect(stakerSigner).borrowETH(amount, apeStaked.collection, apeStaked.tokenId)
      ).changeEtherBalance(apeStaked.staker, amount);
      const debtDiff = (await contracts.debtWETH.balanceOf(apeStaked.staker)).sub(preDebt);
      expect(debtDiff).closeTo(amount, amount.div(10000));

      expect(await contracts.stakeManager.claimable(proxy.address, apeStaked.staker)).eq(apeClaimable);
      expect(await contracts.stakeManager.claimable(proxy.address, bakcStaked.staker)).eq(bakcClaimable);
      expect(await contracts.stakeManager.claimable(proxy.address, coinStaked.staker)).eq(coinClaimable);

      expect(await contracts.stakeManager.totalStaked(proxy.address, apeStaked.staker)).eq(apeTotalStaked);
      expect(await contracts.stakeManager.totalStaked(proxy.address, bakcStaked.staker)).eq(bakcTotalStaked);
      expect(await contracts.stakeManager.totalStaked(proxy.address, coinStaked.staker)).eq(coinTotalStake);

      await assertUnStake(unStaker, param);
    }
  }).timeout(40000);
});
