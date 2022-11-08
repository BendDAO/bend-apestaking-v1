import { expect } from "chai";
import fc from "fast-check";
import { ethers } from "hardhat";
import { Contracts, Env, makeSuite, Snapshots } from "./_setup";
import { constants, Contract } from "ethers";

import { IBNFT, MintableERC721 } from "../typechain-types";

import { DataTypes, IStakeProxy } from "../typechain-types/contracts/interfaces/IStakeProxy";
import { getContract, makeBN18, randomStakeParam } from "./utils";

/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-explicit-any */
makeSuite("StakeManager", (contracts: Contracts, env: Env, snapshots: Snapshots) => {
  let lastRevert: string;
  let apeStaked: DataTypes.ApeStakedStruct;
  let bakcStaked: DataTypes.BakcStakedStruct;
  let coinStaked: DataTypes.CoinStakedStruct;
  let apeContract: MintableERC721;
  let boundApeContract: IBNFT;
  let poolId: number;
  let lendingPoolBNFT: boolean;

  const prepareForStake = async (param: any) => {
    // console.log(param);
    await snapshots.revert("init");
    poolId = param.poolId;
    apeStaked = param.apeStaked;
    bakcStaked = param.bakcStaked;
    coinStaked = param.coinStaked;
    lendingPoolBNFT = param.lendingPoolBNFT;
    const bakcStaker = await ethers.getSigner(await bakcStaked.staker);
    if (poolId === 3) {
      await contracts.bakc.connect(bakcStaker).mint(await bakcStaked.tokenId);
    }

    apeContract = await getContract("MintableERC721", await apeStaked.collection);
    const apeStaker = await ethers.getSigner(await apeStaked.staker);

    await apeContract.connect(apeStaker).mint(await apeStaked.tokenId);

    if (lendingPoolBNFT) {
      await apeContract.connect(apeStaker).approve(contracts.lendPool.address, apeStaked.tokenId);
      await contracts.lendPool
        .connect(apeStaker)
        .borrow(
          contracts.weth.address,
          makeBN18("0.001"),
          apeStaked.collection,
          apeStaked.tokenId,
          apeStaked.staker,
          0
        );
    } else {
      await apeContract
        .connect(apeStaker)
        .transferFrom(apeStaked.staker, contracts.stakeManager.address, apeStaked.tokenId);
    }
    await contracts.stakeManager.lock(apeStaked.collection, apeStaked.tokenId, apeStaked.staker);
    const bnft = await contracts.bnftRegistry.getBNFTAddresses(apeStaked.collection);
    boundApeContract = await getContract("IBNFT", bnft[0]);
    lastRevert = "prepareForStake";
    await snapshots.capture("prepareForStake");
  };

  const randomLendingPoolBNFT = fc.boolean();

  const stake = async () => {
    await contracts.apeCoin
      .connect(await ethers.getSigner(await apeStaked.staker))
      .transfer(contracts.stakeManager.address, apeStaked.coinAmount);

    if (poolId === 3) {
      await contracts.bakc
        .connect(await ethers.getSigner(await bakcStaked.staker))
        .transferFrom(bakcStaked.staker, contracts.stakeManager.address, bakcStaked.tokenId);
      await contracts.apeCoin
        .connect(await ethers.getSigner(await bakcStaked.staker))
        .transfer(contracts.stakeManager.address, bakcStaked.coinAmount);
    }
    if (coinStaked.coinAmount > 0) {
      await contracts.apeCoin
        .connect(await ethers.getSigner(await coinStaked.staker))
        .transfer(contracts.stakeManager.address, coinStaked.coinAmount);
    }
    await expect(contracts.stakeManager.stake(apeStaked, bakcStaked, coinStaked)).not.to.reverted;
    lastRevert = "stake";
    await snapshots.capture(lastRevert);
  };

  before(async () => {
    await contracts.stakeManager.setMatcher(env.admin.address);
    lastRevert = "init";
    await snapshots.capture("init");
  });

  afterEach(async () => {
    await snapshots.revert(lastRevert);
  });

  it("initialized: check init state and revert if reinit", async () => {
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
    ).to.rejectedWith("Initializable: contract is already initialized");
  });
  it("stake: check stakes", async () => {
    await fc.assert(
      fc.asyncProperty(randomStakeParam(env, contracts), randomLendingPoolBNFT, async (param, lendingPoolBNFT) => {
        await prepareForStake({ ...param, lendingPoolBNFT });
        await stake();

        const proxies = await contracts.stakeManager.getStakedProxies(apeStaked.collection, apeStaked.tokenId);

        expect(proxies.length).to.eq(1);

        const proxy = await getContract<IStakeProxy>("IStakeProxy", proxies[0]);

        expect(await (contracts.stakeManager as Contract).proxies(proxy.address)).to.be.true;

        const apeStakedStorage = await proxy.apeStaked();
        const bakcStakedStorage = await proxy.bakcStaked();
        const coinStakedStorage = await proxy.coinStaked();

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

        expect(await apeContract.ownerOf(apeStaked.tokenId)).to.eq(boundApeContract.address);

        if (poolId === 3) {
          expect(await contracts.bakc.ownerOf(bakcStaked.tokenId)).to.eq(proxy.address);
        }

        expect(await contracts.apeCoin.balanceOf(contracts.stakeManager.address)).to.be.eq(0);
      }),
      { numRuns: 10 }
    );
  });
});
