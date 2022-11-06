import { expect } from "chai";
import fc from "fast-check";
import { formatBytes32String } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { Contracts, Env, makeSuite, Snapshots } from "./_setup";
import { BigNumber, constants, Contract } from "ethers";

import { MintableERC721, Ownable } from "../typechain-types";

import { DataTypes } from "../typechain-types/contracts/interfaces/IStakeProxy";
import { advanceBlock, increaseTo, latest } from "./helpers/block-traveller";

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
        console.log(data);
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

  it("claimable", async () => {
    const now = await latest();
    const pools = await contracts.apeStaking.getPoolsUI();

    const endTimestamp = pools[poolId].currentTimeRange.endTimestampHour.toNumber();
    const startTimestamp = pools[poolId].currentTimeRange.startTimestampHour.toNumber();
    const time = Math.max(now + 1, startTimestamp);
    await fc.assert(
      fc
        .asyncProperty(fc.integer({ min: time, max: endTimestamp }), async (t) => {
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
        })
        .beforeEach(async () => {
          await snapshots.revert(revertTag);
        }),
      { numRuns: 10 }
    );
  });

  it("claim: only one staker claim", async () => {
    const now = await latest();
    const pools = await contracts.apeStaking.getPoolsUI();

    const endTimestamp = pools[poolId].currentTimeRange.endTimestampHour.toNumber();
    const startTimestamp = pools[poolId].currentTimeRange.startTimestampHour.toNumber();
    const time = Math.max(now + 1, startTimestamp);

    await fc.assert(
      fc
        .asyncProperty(fc.integer({ min: time, max: endTimestamp }), async (t) => {
          await increaseTo(BigNumber.from(t));
          await advanceBlock();
          const apeRewards = await contracts.stakeProxy.claimable(apeStaked.staker, constants.Zero);
          const bakcRewards = await contracts.stakeProxy.claimable(bakcStaked.staker, constants.Zero);
          const coinRewards = await contracts.stakeProxy.claimable(coinStaked.staker, constants.Zero);
          // console.log(`diff ${t - now} ape ${apeRewards} bakc ${bakcRewards} coin ${coinRewards}`);
          const fee = 200;
          let apeFee = constants.Zero;
          if (apeRewards.gt(constants.Zero)) {
            apeFee = apeRewards.mul(fee).add(5000).div(10000);
          }
          await apeContract.transferFrom(env.admin.address, contracts.stakeProxy.address, apeStaked.tokenId);

          await expect(contracts.stakeProxy.claim(apeStaked.staker, fee, env.admin.address)).to.changeTokenBalances(
            contracts.apeCoin,
            [apeStaked.staker, env.admin.address, contracts.stakeProxy.address],
            [apeRewards.sub(apeFee), apeFee, bakcRewards.add(coinRewards)]
          );
        })
        .beforeEach(async () => {
          await snapshots.revert(revertTag);
        }),
      { numRuns: 10 }
    );
  });
});
