import { expect } from "chai";
import fc from "fast-check";
import { ethers } from "hardhat";
import { Contracts, Env, makeSuite, Snapshots } from "./_setup";
import { constants, Contract } from "ethers";

import { IStakeProxy } from "../typechain-types/contracts/interfaces/IStakeProxy";
import { getContract, makeBN18, randomMatchBakc, randomMatchBakcAndCoin, randomMatchCoin, signOffers } from "./utils";
import { latest } from "./helpers/block-traveller";
import { parseEvents } from "./helpers/transaction-helper";

fc.configureGlobal({
  numRuns: 10,
  endOnFailure: true,
});

/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-explicit-any */
makeSuite("BendStakeMatcher", (contracts: Contracts, env: Env, snapshots: Snapshots) => {
  let lastRevert: string;

  const prepareMatch = async (param: any, withLoan_: boolean): Promise<any> => {
    param.withLoan = withLoan_;
    param.apeContract = await getContract("MintableERC721", param.apeOffer.collection);
    const bnft = await contracts.bnftRegistry.getBNFTAddresses(param.apeOffer.collection);
    param.boundApeContract = await getContract("IBNFT", bnft[0]);

    const apeStaker = await ethers.getSigner(await param.apeOffer.staker);
    const bakcStaker = await ethers.getSigner(await param.bakcOffer.staker);
    let apeOwner = constants.AddressZero;
    try {
      apeOwner = await param.apeContract.ownerOf(param.apeStaked.tokenId);
    } catch (error) {}
    if (apeOwner === constants.AddressZero) {
      await param.apeContract.connect(apeStaker).mint(await param.apeOffer.tokenId);
      if (param.withLoan) {
        await param.apeContract.connect(apeStaker).approve(contracts.lendPool.address, param.apeOffer.tokenId);
        await contracts.lendPool
          .connect(apeStaker)
          .borrow(
            contracts.weth.address,
            makeBN18("0.001"),
            param.apeOffer.collection,
            param.apeOffer.tokenId,
            param.apeOffer.staker,
            0
          );
      } else {
        await param.apeContract.connect(apeStaker).approve(contracts.stakeMatcher.address, param.apeOffer.tokenId);
      }
    }

    if (param.poolId === 3) {
      try {
        await contracts.bakc.connect(bakcStaker).mint(await param.bakcOffer.tokenId);
        await contracts.bakc.connect(bakcStaker).approve(contracts.stakeMatcher.address, param.bakcOffer.tokenId);
      } catch (error) {}
    }
    return param;
  };

  const matchWithBakcAndCoin = async (param: any, matcher: string = env.admin.address) => {
    const matchSigner = await ethers.getSigner(matcher);
    const tx = await contracts.stakeMatcher
      .connect(matchSigner)
      .matchWithBakcAndCoin(param.apeOffer, param.bakcOffer, param.coinOffer);
    const events = parseEvents(await tx.wait(), contracts.stakeManager.interface);
    const stakedEvent = events.Staked;
    if (stakedEvent) {
      param.proxy = await getContract<IStakeProxy>("IStakeProxy", stakedEvent.proxy);
      return param;
    } else {
      throw new Error("match error");
    }
  };

  const matchWithCoin = async (param: any, matcher: string = env.admin.address) => {
    const matchSigner = await ethers.getSigner(matcher);
    const tx = await contracts.stakeMatcher.connect(matchSigner).matchWithCoin(param.apeOffer, param.coinOffer);
    const events = parseEvents(await tx.wait(), contracts.stakeManager.interface);
    const stakedEvent = events.Staked;
    if (stakedEvent) {
      param.proxy = await getContract<IStakeProxy>("IStakeProxy", stakedEvent.proxy);
      return param;
    } else {
      throw new Error("match error");
    }
  };

  const matchWithBakc = async (param: any, matcher: string = env.admin.address) => {
    const matchSigner = await ethers.getSigner(matcher);
    const tx = await contracts.stakeMatcher.connect(matchSigner).matchWithBakc(param.apeOffer, param.bakcOffer);
    const events = parseEvents(await tx.wait(), contracts.stakeManager.interface);
    const stakedEvent = events.Staked;
    if (stakedEvent) {
      param.proxy = await getContract<IStakeProxy>("IStakeProxy", stakedEvent.proxy);
      return param;
    } else {
      throw new Error("match error");
    }
  };

  before(async () => {
    await contracts.stakeManager.setMatcher(contracts.stakeMatcher.address);
    for (const staker of env.accounts) {
      await contracts.apeCoin.connect(staker).approve(contracts.stakeMatcher.address, constants.MaxUint256);
    }
    lastRevert = "init";
    await snapshots.capture(lastRevert);
  });

  afterEach(async () => {
    if (lastRevert) {
      await snapshots.revert(lastRevert);
    }
  });

  it("initialized: check init state and revert if reInit", async () => {
    expect(await (contracts.stakeMatcher as Contract).stakeManager()).to.eq(contracts.stakeManager.address);
    expect(await (contracts.stakeMatcher as Contract).bayc()).to.eq(contracts.bayc.address);
    expect(await (contracts.stakeMatcher as Contract).mayc()).to.eq(contracts.mayc.address);
    expect(await (contracts.stakeMatcher as Contract).bakc()).to.eq(contracts.bakc.address);
    expect(await (contracts.stakeMatcher as Contract).apeCoin()).to.eq(contracts.apeCoin.address);
    expect(await (contracts.stakeMatcher as Contract).lendPoolAddressedProvider()).to.eq(
      contracts.bendAddressesProvider.address
    );
    expect(await (contracts.stakeMatcher as Contract).boundBayc()).to.eq(contracts.bBayc.address);
    expect(await (contracts.stakeMatcher as Contract).boundMayc()).to.eq(contracts.bMayc.address);
    expect(await (contracts.stakeMatcher as Contract).owner()).to.eq(env.admin.address);

    await expect(
      (contracts.stakeMatcher as Contract)
        .connect(env.admin)
        .initialize(
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

  it("cancelOffers", async () => {
    const nonces = fc.tuple(fc.uniqueArray(fc.nat(), { maxLength: 3 }), fc.nat()).filter((v) => {
      return !new Set(v[0]).has(v[1]);
    });
    fc.assert(
      fc.asyncProperty(nonces, async (v) => {
        const [noncesCanceled, nonceNotCanceled] = v;
        expect(await contracts.stakeMatcher.isCancelled(env.admin.address, nonceNotCanceled)).be.false;
        for (const i of noncesCanceled) {
          expect(await contracts.stakeMatcher.isCancelled(env.admin.address, i)).be.false;
        }
        await contracts.stakeMatcher.cancelOffers(noncesCanceled);
        expect(await contracts.stakeMatcher.isCancelled(env.admin.address, nonceNotCanceled)).be.false;
        for (const i of noncesCanceled) {
          expect(await contracts.stakeMatcher.isCancelled(env.admin.address, i)).be.true;
        }
      }),
      { numRuns: 1 }
    );
  });

  it("matchWithBakcAndCoin", async () => {
    const now = await latest();
    const [param, withLoan, matcher] = fc.sample(
      fc.tuple(randomMatchBakcAndCoin(env, contracts, now), fc.boolean(), fc.constantFrom(...env.accounts)),
      1
    )[0];
    await prepareMatch(param, withLoan);
    await signOffers(env, contracts, param);
    await matchWithBakcAndCoin(param, matcher.address);
  });

  it("matchWithBakc", async () => {
    const now = await latest();
    const [param, withLoan, matcher] = fc.sample(
      fc.tuple(randomMatchBakc(env, contracts, now), fc.boolean(), fc.constantFrom(...env.accounts)),
      1
    )[0];
    await prepareMatch(param, withLoan);
    await signOffers(env, contracts, param);
    await matchWithBakc(param, matcher.address);
  });

  it("matchWithCoin", async () => {
    const now = await latest();
    const [param, withLoan, matcher] = fc.sample(
      fc.tuple(randomMatchCoin(env, contracts, now), fc.boolean(), fc.constantFrom(...env.accounts)),
      1
    )[0];
    await prepareMatch(param, withLoan);
    await signOffers(env, contracts, param);
    await matchWithCoin(param, matcher.address);
  });
});
