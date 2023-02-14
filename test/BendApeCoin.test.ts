import { expect } from "chai";
import fc from "fast-check";
import { Contracts, Env, makeSuite, Snapshots } from "./_setup";
import { BigNumber, constants, Contract } from "ethers";
import { ethers } from "hardhat";
import { makeBN18, randomStake, skipHourBlocks, doStake, prepareStake, randomWithLoan } from "./utils";
import { advanceBlock, increaseTo, increaseBy, latest } from "./helpers/block-traveller";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

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
/* eslint-disable node/no-unsupported-features/es-builtins */
makeSuite("BendApeCoin", (contracts: Contracts, env: Env, snapshots: Snapshots) => {
  let lastRevert: string;
  let feeRecipient: string;
  let fee: any;
  let minAmount: number;
  let minInterval: number;
  let startTimestamp: number;
  // let endTimestamp: number;
  let lastDeposit: BigNumber;
  let pools: any;

  const getPoolTime = (poolId_: number): number[] => {
    const startTimestamp = pools[poolId_].currentTimeRange.startTimestampHour;
    const endTimestamp = pools[poolId_].currentTimeRange.endTimestampHour;
    return [startTimestamp, endTimestamp];
  };

  before(async () => {
    pools = await contracts.apeStaking.getPoolsUI();
    startTimestamp = pools[0].currentTimeRange.startTimestampHour;
    // endTimestamp = pools[0].currentTimeRange.endTimestampHour;
    await contracts.stakeManager.setMatcher(env.admin.address);
    for (const a of env.accounts.slice(1, 6)) {
      await contracts.apeCoin.connect(a).approve(contracts.bendApeCoin.address, constants.MaxUint256);
    }
  });

  afterEach(async () => {
    if (lastRevert) {
      await snapshots.revert(lastRevert);
    }
  });

  it("updateFeeRecipient & updateFee", async () => {
    expect(await (contracts.bendApeCoin as any).feeRecipient()).eq(constants.AddressZero);
    expect(await (contracts.bendApeCoin as any).fee()).eq(constants.Zero);

    await expect(contracts.bendApeCoin.updateFeeRecipient(constants.AddressZero)).revertedWith(
      "BendApeCoin: fee recipient can't be zero address"
    );
    await expect(contracts.bendApeCoin.updateFee(10001)).revertedWith("BendApeCoin: fee overflow");
    feeRecipient = env.admin.address;
    fee = 500;
    await contracts.bendApeCoin.updateFeeRecipient(feeRecipient);
    await contracts.bendApeCoin.updateFee(fee);

    expect(await (contracts.bendApeCoin as any).feeRecipient()).eq(env.admin.address);
    expect(await (contracts.bendApeCoin as any).fee()).eq(fee);
  });

  it("updateMinCompoundAmount & updateMinCompoundInterval", async () => {
    expect(await (contracts.bendApeCoin as any).minCompoundAmount()).eq(makeBN18(1));
    expect(await (contracts.bendApeCoin as any).minCompoundInterval()).eq(constants.Zero);
    minAmount = 100;
    minInterval = 3600;

    await contracts.bendApeCoin.updateMinCompoundAmount(makeBN18(minAmount));
    await contracts.bendApeCoin.updateMinCompoundInterval(minInterval);

    lastRevert = "init";
    await snapshots.capture("init");
  });

  it("initialized: check init state and revert if reInit", async () => {
    expect(await contracts.bendApeCoin.asset()).to.eq(contracts.apeCoin.address);
    expect(await (contracts.bendApeCoin as Contract).apeStaking()).to.eq(contracts.apeStaking.address);
    expect(await (contracts.bendApeCoin as Contract).stakeManager()).to.eq(contracts.stakeManager.address);
    expect(await (contracts.bendApeCoin as Contract).owner()).to.eq(env.admin.address);

    await expect(
      (contracts.bendApeCoin as Contract)
        .connect(env.admin)
        .initialize(constants.AddressZero, constants.AddressZero, constants.AddressZero)
    ).to.revertedWith("Initializable: contract is already initialized");
  });

  it("onlyOwner: revertions work as expected", async () => {
    await expect(
      contracts.bendApeCoin.connect(env.accounts[1]).updateMinCompoundAmount(constants.Zero)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(
      contracts.bendApeCoin.connect(env.accounts[1]).updateMinCompoundInterval(constants.Zero)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(contracts.bendApeCoin.connect(env.accounts[1]).updateFee(constants.Zero)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );

    await expect(
      contracts.bendApeCoin.connect(env.accounts[1]).updateFeeRecipient(constants.AddressZero)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("onlyOwner: revertions work as expected", async () => {
    await expect(
      contracts.bendApeCoin.connect(env.accounts[1]).updateMinCompoundAmount(constants.Zero)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(
      contracts.bendApeCoin.connect(env.accounts[1]).updateMinCompoundInterval(constants.Zero)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(contracts.bendApeCoin.connect(env.accounts[1]).updateFee(constants.Zero)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );

    await expect(
      contracts.bendApeCoin.connect(env.accounts[1]).updateFeeRecipient(constants.AddressZero)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  const pendingRewards = async () => {
    const rewards = await contracts.apeStaking.pendingRewards(0, contracts.bendApeCoin.address, 0);
    const toFee = rewards.mul(fee).add(5000).div(10000);
    return [rewards.sub(toFee), toFee];
  };

  const totalUnderlingAsset = async () => {
    const staked = (await contracts.apeStaking.addressPosition(contracts.bendApeCoin.address)).stakedAmount;
    const rewards = (await pendingRewards())[0];
    const pending = await (contracts.bendApeCoin as any).pendingDepositAmount();
    // console.log(
    //   `staked ${staked}, rewards ${rewards}, pending ${pending}, total ${staked.add(rewards).add(pending)} fee ${toFee}`
    // );
    return staked.add(rewards).add(pending);
  };

  const convertToShare = async (amount: BigNumber) => {
    if (amount.eq(constants.Zero)) {
      return constants.Zero;
    }
    const totalShare = await contracts.bendApeCoin.totalSupply();
    if (totalShare.eq(constants.Zero)) {
      return amount;
    }
    return amount.mul(totalShare).div(await totalUnderlingAsset());
  };

  const convertToAsset = async (share: BigNumber) => {
    if (share.eq(constants.Zero)) {
      return constants.Zero;
    }
    const totalShare = await contracts.bendApeCoin.totalSupply();
    if (totalShare.eq(constants.Zero)) {
      return constants.Zero;
    }
    return share.mul(await totalUnderlingAsset()).div(totalShare);
  };

  const assertDeposit = async (staker: SignerWithAddress, amount: BigNumber, claim: boolean, deposit: boolean) => {
    await skipHourBlocks();
    const now = await latest();
    const assetBalance = await contracts.bendApeCoin.assetBalanceOf(staker.address);
    const previewDepisit = await contracts.bendApeCoin.previewDeposit(amount);
    const computedShare = await convertToShare(amount);

    const [rewards, toFee] = await pendingRewards();

    const lastClaimTime = await (contracts.bendApeCoin as any).lastClaimTime();
    const lastDepositTime = await (contracts.bendApeCoin as any).lastDepositTime();
    const pendingDepositAmount = await (contracts.bendApeCoin as any).pendingDepositAmount();

    let feeChange = constants.Zero;
    let aChange = constants.Zero;
    let bChange = amount;

    let willClaim = false;
    if (rewards.gte(minAmount) && lastClaimTime.add(minInterval).lt(now + 1)) {
      willClaim = true;
      aChange = aChange.sub(rewards).sub(toFee);
      bChange = bChange.add(rewards);
      feeChange = feeChange.add(toFee);
    }

    let willDeposit = false;
    let depositAmount = amount.add(pendingDepositAmount);
    if (willClaim) {
      depositAmount = depositAmount.add(rewards);
    }
    if (depositAmount.gte(minAmount) && lastDepositTime.add(minInterval).lt(now + 1)) {
      willDeposit = true;
      aChange = aChange.add(depositAmount);
      bChange = bChange.sub(depositAmount);
    }

    expect(computedShare).eq(previewDepisit);

    expect(willClaim).eq(claim);
    expect(willDeposit).eq(deposit);

    // console.log(`deposit ${amount}, will ${willClaim ? "" : "not "}claim, will ${willDeposit ? "" : "not "}deposit`);

    await expect(contracts.bendApeCoin.connect(staker).deposit(amount, staker.address))
      .changeTokenBalance(contracts.bendApeCoin, staker.address, previewDepisit)
      .changeTokenBalances(
        contracts.apeCoin,
        [staker.address, feeRecipient, contracts.bendApeCoin.address, contracts.apeStaking.address],
        [constants.Zero.sub(amount), feeChange, bChange, aChange]
      );
    expect(await contracts.bendApeCoin.assetBalanceOf(staker.address)).closeTo(assetBalance.add(amount), 10);
    expect(await contracts.bendApeCoin.totalAssets()).eq(await totalUnderlingAsset());
  };

  const assertRedeem = async (
    staker: SignerWithAddress,
    share: BigNumber,
    claim: boolean,
    withdraw: boolean,
    deposit: boolean
  ) => {
    await skipHourBlocks();
    const now = await latest();
    const previewRedeem = await contracts.bendApeCoin.previewRedeem(share);
    const amount = await convertToAsset(share);
    expect(amount).eq(previewRedeem);

    const [rewards, toFee] = await pendingRewards();

    const lastDepositTime = await (contracts.bendApeCoin as any).lastDepositTime();
    const pendingDepositAmount = await (contracts.bendApeCoin as any).pendingDepositAmount();
    let aChange = constants.Zero;
    let bChange = constants.Zero.sub(amount);
    let feeChange = constants.Zero;

    let willClaim = false;
    if (pendingDepositAmount.lt(amount)) {
      willClaim = true;
      aChange = aChange.sub(rewards).sub(toFee);
      bChange = bChange.add(rewards);
      feeChange = feeChange.add(toFee);
    }
    let willWithdraw = false;
    let depositAmount = pendingDepositAmount;
    if (willClaim) {
      depositAmount = depositAmount.add(rewards);
    }
    if (depositAmount.lt(amount)) {
      const withdrawAmount = amount.sub(depositAmount);
      aChange = aChange.sub(withdrawAmount);
      bChange = bChange.add(withdrawAmount);
      depositAmount = depositAmount.add(withdrawAmount);
      willWithdraw = true;
    }

    depositAmount = depositAmount.sub(amount);

    let willDeposit = false;
    if (depositAmount.gte(minAmount) && lastDepositTime.add(minInterval).lt(now + 1)) {
      willDeposit = true;
      aChange = aChange.add(depositAmount);
      bChange = bChange.sub(depositAmount);
    }

    // console.log(
    //   `redeem ${amount}, will ${willClaim ? "" : "not "}claim, will ${willWithdraw ? "" : "not "}withdraw, will ${
    //     willDeposit ? "" : "not "
    //   }deposit`
    // );

    expect(willClaim).eq(claim);
    expect(willWithdraw).eq(withdraw);
    expect(willDeposit).eq(deposit);

    await expect(contracts.bendApeCoin.connect(staker).redeem(share, staker.address, staker.address))
      .changeTokenBalance(contracts.bendApeCoin, staker.address, previewRedeem)
      .changeTokenBalances(
        contracts.apeCoin,
        [staker.address, feeRecipient, contracts.bendApeCoin.address, contracts.apeStaking.address],
        [amount, feeChange, bChange, aChange]
      );

    expect(await contracts.bendApeCoin.totalAssets()).eq(await totalUnderlingAsset());
  };

  it("deposit: will not claim, will deposit", async () => {
    const randomDepist = fc.integer({ min: minAmount * 10, max: 100000 });
    const amount = makeBN18(fc.sample(randomDepist, 1)[0]);
    await assertDeposit(env.accounts[1], amount, false, true);
    const previewRedeem = await contracts.bendApeCoin.previewRedeem(amount);
    expect(previewRedeem).eq(amount);

    lastRevert = "deposit";
    await snapshots.capture("deposit");
  });

  it("deposit: will claim, will deposit", async () => {
    const now = await latest();
    const randomDepist = fc.integer({ min: minAmount, max: 10000 });

    const time = fc.sample(fc.integer({ min: Math.max(now + 3600, startTimestamp), max: now + 7200 }), 1)[0];
    await increaseTo(BigNumber.from(time));
    await advanceBlock();

    const rewards = (await pendingRewards())[0];
    const amount = await contracts.bendApeCoin.balanceOf(env.accounts[1].address);
    const previewRedeem = await contracts.bendApeCoin.previewRedeem(amount);
    expect(previewRedeem).eq(amount.add(rewards));

    await assertDeposit(env.accounts[2], makeBN18(fc.sample(randomDepist, 1)[0]), true, true);
    lastRevert = "deposit";
    await snapshots.capture("deposit");
  });

  it("deposit: will not claim, will not deposit", async () => {
    const lessThanMinAmount = fc.integer({ min: 1, max: minAmount - 1 });
    const lessThanMinInterval = fc.integer({ min: 1, max: minInterval - 1 });
    await increaseBy(BigNumber.from(fc.sample(lessThanMinInterval, 1)[0]));
    await advanceBlock();

    const amount = makeBN18(fc.sample(lessThanMinAmount, 1)[0]);
    lastDeposit = amount;

    await assertDeposit(env.accounts[2], amount, false, false);
    lastRevert = "deposit";
    await snapshots.capture("deposit");
  });

  it("redeem: will not claim, will not withdraw, will not deposit", async () => {
    const previewWithdraw = await contracts.bendApeCoin.previewWithdraw(lastDeposit);

    const amount = BigNumber.from(fc.sample(fc.bigInt({ min: BigInt(1), max: previewWithdraw.toBigInt() }), 1)[0]);
    await assertRedeem(env.accounts[2], amount, false, false, false);
  });

  it("redeem: will claim, will not withdraw, will deposit", async () => {
    const staker = env.accounts[2];
    const amount = await contracts.bendApeCoin.previewWithdraw(lastDeposit);

    await increaseBy(BigNumber.from(3600));
    await advanceBlock();

    await assertRedeem(staker, amount, true, false, true);
  });

  it("redeem: will claim, will withdraw, will not deposit", async () => {
    const staker = env.accounts[2];
    const max = await contracts.bendApeCoin.balanceOf(staker.address);
    await assertRedeem(staker, max, true, true, false);
  });

  it("compound", async () => {
    await increaseBy(BigNumber.from(3600));
    await advanceBlock();
    await skipHourBlocks();
    const toFee = (await pendingRewards())[1];
    const pendingDepositAmount = await (contracts.bendApeCoin as any).pendingDepositAmount();
    await expect(contracts.bendApeCoin.compound()).changeTokenBalances(
      contracts.apeCoin,
      [feeRecipient, contracts.bendApeCoin.address, contracts.apeStaking.address],
      [toFee, constants.Zero.sub(pendingDepositAmount), pendingDepositAmount.sub(toFee)]
    );
  });

  it("claimAndDeposit", async () => {
    const now = await latest();
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
        const times = getPoolTime(v.poolId);
        const randomTime = fc.integer({ min: Math.max(now + 100, times[0]), max: times[1] });
        return fc.tuple(fc.constant(v), randomWithLoan, randomTime);
      });
    };
    const [param, withLoan, time] = fc.sample(randomParams(), 1)[0];
    await snapshots.revert("init");
    await prepareStake(contracts, param, withLoan);
    await doStake(contracts, param);
    await increaseTo(BigNumber.from(time));
    await advanceBlock();
    await skipHourBlocks();

    for (const staker of param.stakers) {
      const claimerSigner = await ethers.getSigner(staker);
      const rewards = await contracts.stakeManager.claimable((param as any).proxy.address, staker);

      await expect(contracts.bendApeCoin.connect(claimerSigner).claimAndDeposit([(param as any).proxy.address]))
        .changeTokenBalance(contracts.apeCoin, staker, constants.Zero)
        .changeTokenBalance(contracts.bendApeCoin, staker, rewards);
    }
  });

  it("claimAndDepositFor", async () => {
    await snapshots.revert("init");
    const now = await latest();
    const randomParams = () => {
      return randomStake(env, contracts).chain((v) => {
        const times = getPoolTime(v.poolId);
        const randomTime = fc.integer({ min: Math.max(now + 100, times[0]), max: times[1] });
        return fc.tuple(fc.constant(v), randomWithLoan, randomTime);
      });
    };
    const [param, withLoan, time] = fc.sample(randomParams(), 1)[0];
    await snapshots.revert("init");
    await prepareStake(contracts, param, withLoan);
    await doStake(contracts, param);
    await increaseTo(BigNumber.from(time));
    await advanceBlock();
    await skipHourBlocks();
    for (const staker of param.stakers) {
      const rewards = await contracts.stakeManager.claimable((param as any).proxy.address, staker);
      await expect(contracts.bendApeCoin.claimAndDepositFor([(param as any).proxy.address], staker))
        .changeTokenBalance(contracts.apeCoin, staker, constants.Zero)
        .changeTokenBalance(contracts.bendApeCoin, staker, rewards);
    }
  });
});
