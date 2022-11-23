import { expect } from "chai";
import fc from "fast-check";
import { ethers } from "hardhat";
import { Contracts, Env, makeSuite, Snapshots } from "./_setup";
import { constants, Contract } from "ethers";

import { IStakeProxy } from "../typechain-types/contracts/interfaces/IStakeProxy";
import {
  emptyBytes32,
  getContract,
  hashApeOffer,
  hashBakcOffer,
  hashCoinOffer,
  makeBN18,
  randomMatchBakc,
  randomMatchBakcAndCoin,
  randomMatchCoin,
  signApeOffer,
  signBakcOffer,
  signCoinOffer,
  signOffers,
} from "./utils";
import { latest } from "./helpers/block-traveller";
import { parseEvents } from "./helpers/transaction-helper";
import { findPrivateKey } from "./helpers/hardhat-keys";

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

  const assertMatchState = async (param: any) => {
    const apeStakedStorage = await param.proxy.apeStaked();
    const bakcStakedStorage = await param.proxy.bakcStaked();
    const coinStakedStorage = await param.proxy.coinStaked();

    const apeOffer = param.apeOffer;
    const bakcOffer = param.bakcOffer;
    const coinOffer = param.coinOffer;

    expect(await hashApeOffer(apeOffer)).to.eq(apeStakedStorage.offerHash);
    expect(await apeOffer.staker).to.eq(apeStakedStorage.staker);
    expect(await apeOffer.collection).to.eq(apeStakedStorage.collection);
    expect(await apeOffer.tokenId).to.eq(apeStakedStorage.tokenId);
    expect(await apeOffer.share).to.eq(apeStakedStorage.share);
    expect(await apeOffer.coinAmount).to.eq(apeStakedStorage.coinAmount);

    expect(await bakcOffer.staker).to.eq(bakcStakedStorage.staker);
    expect(await bakcOffer.tokenId).to.eq(bakcStakedStorage.tokenId);
    expect(await bakcOffer.share).to.eq(bakcStakedStorage.share);
    expect(await bakcOffer.coinAmount).to.eq(bakcStakedStorage.coinAmount);

    expect(await coinOffer.staker).to.eq(coinStakedStorage.staker);
    expect(await coinOffer.share).to.eq(coinStakedStorage.share);
    expect(await coinOffer.coinAmount).to.eq(coinStakedStorage.coinAmount);

    expect(await contracts.stakeManager.getStakedProxies(apeOffer.collection, apeOffer.tokenId)).contains(
      param.proxy.address
    );
    if (bakcOffer.staker !== constants.AddressZero) {
      expect(await hashBakcOffer(bakcOffer)).to.eq(bakcStakedStorage.offerHash);
      expect(await contracts.stakeManager.getStakedProxies(contracts.bakc.address, bakcOffer.tokenId)).contains(
        param.proxy.address
      );
      expect(await contracts.bakc.ownerOf(bakcOffer.tokenId)).eq(param.proxy.address);
    } else {
      expect(emptyBytes32).to.eq(bakcStakedStorage.offerHash);
      expect(await contracts.stakeManager.getStakedProxies(contracts.bakc.address, bakcOffer.tokenId)).not.contains(
        param.proxy.address
      );
    }
    if (coinOffer.staker !== constants.AddressZero) {
      expect(await hashCoinOffer(coinOffer)).to.eq(coinStakedStorage.offerHash);
    } else {
      expect(emptyBytes32).to.eq(coinStakedStorage.offerHash);
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
    const nonces = fc.tuple(fc.uniqueArray(fc.nat(), { maxLength: 3, minLength: 1 }), fc.nat()).filter((v) => {
      return !new Set(v[0]).has(v[1]);
    });
    await fc.assert(
      fc
        .asyncProperty(nonces, async (v) => {
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
        })
        .beforeEach(async () => {
          lastRevert = "init";
          await snapshots.revert(lastRevert);
        }),
      { numRuns: 10 }
    );
  });

  it("matchWithBakcAndCoin", async () => {
    const now = await latest();
    await fc.assert(
      fc
        .asyncProperty(
          randomMatchBakcAndCoin(env, contracts, now),
          fc.boolean(),
          fc.constantFrom(...env.accounts),
          async (param, withLoan, matcher) => {
            await prepareMatch(param, withLoan);
            await signOffers(env, contracts, matcher.address, param);
            await matchWithBakcAndCoin(param, matcher.address);
            await assertMatchState(param);
          }
        )
        .beforeEach(async () => {
          lastRevert = "init";
          await snapshots.revert(lastRevert);
        }),
      { numRuns: 10 }
    );
  });

  it("matchWithBakc", async () => {
    const now = await latest();
    await fc.assert(
      fc
        .asyncProperty(
          randomMatchBakc(env, contracts, now),
          fc.boolean(),
          fc.constantFrom(...env.accounts),
          async (param, withLoan, matcher) => {
            await prepareMatch(param, withLoan);
            await signOffers(env, contracts, matcher.address, param);
            await matchWithBakc(param, matcher.address);
            await assertMatchState(param);
          }
        )
        .beforeEach(async () => {
          lastRevert = "init";
          await snapshots.revert(lastRevert);
        }),
      { numRuns: 10 }
    );
  });

  it("matchWithCoin", async () => {
    const now = await latest();
    await fc.assert(
      fc
        .asyncProperty(
          randomMatchCoin(env, contracts, now),
          fc.boolean(),
          fc.constantFrom(...env.accounts),
          async (param, withLoan, matcher) => {
            await prepareMatch(param, withLoan);
            await signOffers(env, contracts, matcher.address, param);
            await matchWithCoin(param, matcher.address);
            await assertMatchState(param);
          }
        )
        .beforeEach(async () => {
          lastRevert = "init";
          await snapshots.revert(lastRevert);
        }),
      { numRuns: 10 }
    );
  });

  it("matchWithBakcAndCoin: revert - invalid offer nonce", async () => {
    const now = await latest();
    const [param, withLoan, matcher] = fc.sample(
      fc.tuple(
        randomMatchBakcAndCoin(env, contracts, now).filter((v) => {
          return v.apeOffer.staker !== v.bakcOffer.staker;
        }),
        fc.boolean(),
        fc.constantFrom(...env.accounts)
      ),
      1
    )[0];

    await prepareMatch(param, withLoan);
    await signOffers(env, contracts, matcher.address, param);
    await matchWithBakcAndCoin(param, matcher.address);
    await snapshots.capture("matchWithBakcAndCoin");

    const matchSigner = await ethers.getSigner(matcher.address);

    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithBakcAndCoin(param.apeOffer, param.bakcOffer, param.coinOffer)
    ).revertedWith("Offer: not bakc owner");

    if (matcher.address !== param.apeOffer.staker) {
      await contracts.stakeMatcher
        .connect(await ethers.getSigner(param.apeOffer.staker))
        .cancelOffers([param.apeOffer.nonce]);

      await expect(
        contracts.stakeMatcher
          .connect(matchSigner)
          .matchWithBakcAndCoin(param.apeOffer, param.bakcOffer, param.coinOffer)
      ).revertedWith("Offer: invalid ape offer nonce");
    }

    if (param.bakcOffer.staker !== matcher.address) {
      await snapshots.revert("matchWithBakcAndCoin");
      await contracts.stakeMatcher
        .connect(await ethers.getSigner(param.bakcOffer.staker))
        .cancelOffers([param.bakcOffer.nonce]);

      await expect(
        contracts.stakeMatcher
          .connect(matchSigner)
          .matchWithBakcAndCoin(param.apeOffer, param.bakcOffer, param.coinOffer)
      ).revertedWith("Offer: invalid bakc offer nonce");
    }
  });

  it("matchWithBakcAndCoin: revert - validate ape offer", async () => {
    const now = await latest();
    const [param, withLoan, matcher] = fc.sample(
      fc.tuple(randomMatchBakcAndCoin(env, contracts, now), fc.boolean(), fc.constantFrom(...env.accounts)),
      1
    )[0];
    const matchSigner = await ethers.getSigner(matcher.address);

    let invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.staker = constants.AddressZero;

    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(invalidApeOffer, param.bakcOffer, param.coinOffer)
    ).revertedWith("Offer: invalid ape staker");

    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.startTime = (await latest()) + 2;
    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(invalidApeOffer, param.bakcOffer, param.coinOffer)
    ).revertedWith("Offer: ape offer not start");

    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.endTime = (await latest()) - 2;
    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(invalidApeOffer, param.bakcOffer, param.coinOffer)
    ).revertedWith("Offer: ape offer expired");

    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.collection = constants.AddressZero;
    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(invalidApeOffer, param.bakcOffer, param.coinOffer)
    ).revertedWith("Offer: not ape collection");

    await prepareMatch(param, withLoan);
    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.tokenId = 101;
    await (param as any).apeContract.mint(invalidApeOffer.tokenId);
    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(invalidApeOffer, param.bakcOffer, param.coinOffer)
    ).revertedWith("ERC721: owner query for nonexistent token");

    await snapshots.revert("init");
    await prepareMatch(param, withLoan);
    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.tokenId = 101;
    await (param as any).apeContract.mint(invalidApeOffer.tokenId);
    await (param as any).apeContract.approve(contracts.lendPool.address, invalidApeOffer.tokenId);
    await contracts.lendPool.borrow(
      contracts.weth.address,
      makeBN18("0.001"),
      invalidApeOffer.collection,
      invalidApeOffer.tokenId,
      env.admin.address,
      0
    );
    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(invalidApeOffer, param.bakcOffer, param.coinOffer)
    ).revertedWith("Offer: not ape owner");
    await snapshots.revert("init");

    await prepareMatch(param, withLoan);

    invalidApeOffer = await signApeOffer(env, contracts, await findPrivateKey(env.admin.address), param.apeOffer);
    await expect(
      contracts.stakeMatcher.connect(env.admin).matchWithBakcAndCoin(invalidApeOffer, param.bakcOffer, param.coinOffer)
    ).revertedWith("Offer: invalid ape offer signature");

    const signedApeOffer = await signApeOffer(
      env,
      contracts,
      await findPrivateKey(param.apeOffer.staker),
      param.apeOffer
    );
    await expect(
      contracts.stakeMatcher.connect(env.admin).matchWithBakcAndCoin(signedApeOffer, param.bakcOffer, param.coinOffer)
    ).not.revertedWith("Offer: invalid ape offer signature");
  }).timeout(40000);

  it("matchWithBakcAndCoin: revert - validate bakc offer", async () => {
    const now = await latest();
    const [param, withLoan, matcher] = fc.sample(
      fc.tuple(randomMatchBakcAndCoin(env, contracts, now), fc.boolean(), fc.constantFrom(...env.accounts)),
      1
    )[0];
    const matchSigner = await ethers.getSigner(matcher.address);

    await prepareMatch(param, withLoan);
    await signOffers(env, contracts, matcher.address, param);

    let invalidBakcOffer = { ...param.bakcOffer };
    invalidBakcOffer.staker = constants.AddressZero;

    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(param.apeOffer, invalidBakcOffer, param.coinOffer)
    ).revertedWith("Offer: invalid bakc staker");

    invalidBakcOffer = { ...param.bakcOffer };
    invalidBakcOffer.startTime = (await latest()) + 2;
    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(param.apeOffer, invalidBakcOffer, param.coinOffer)
    ).revertedWith("Offer: bakc offer not start");

    invalidBakcOffer = { ...param.bakcOffer };
    invalidBakcOffer.endTime = (await latest()) - 2;
    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(param.apeOffer, invalidBakcOffer, param.coinOffer)
    ).revertedWith("Offer: bakc offer expired");

    invalidBakcOffer = { ...param.bakcOffer };
    invalidBakcOffer.tokenId = 101;
    await contracts.bakc.mint(invalidBakcOffer.tokenId);
    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(param.apeOffer, invalidBakcOffer, param.coinOffer)
    ).revertedWith("Offer: not bakc owner");

    await signOffers(env, contracts, env.admin.address, param);
    invalidBakcOffer = await signBakcOffer(env, contracts, await findPrivateKey(env.admin.address), param.bakcOffer);
    await expect(
      contracts.stakeMatcher.connect(env.admin).matchWithBakcAndCoin(param.apeOffer, invalidBakcOffer, param.coinOffer)
    ).revertedWith("Offer: invalid bakc offer signature");
  });

  it("matchWithBakcAndCoin: revert - validate coin offer", async () => {
    const now = await latest();
    const [param, withLoan, matcher] = fc.sample(
      fc.tuple(randomMatchBakcAndCoin(env, contracts, now), fc.boolean(), fc.constantFrom(...env.accounts)),
      1
    )[0];
    const matchSigner = await ethers.getSigner(matcher.address);

    await prepareMatch(param, withLoan);
    await signOffers(env, contracts, matcher.address, param);

    let invalidCoinOffer = { ...param.coinOffer };
    invalidCoinOffer.staker = constants.AddressZero;

    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(param.apeOffer, param.bakcOffer, invalidCoinOffer)
    ).revertedWith("Offer: invalid coin staker");

    invalidCoinOffer = { ...param.coinOffer };
    invalidCoinOffer.startTime = (await latest()) + 2;
    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(param.apeOffer, param.bakcOffer, invalidCoinOffer)
    ).revertedWith("Offer: coin offer not start");

    invalidCoinOffer = { ...param.coinOffer };
    invalidCoinOffer.endTime = (await latest()) - 2;
    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(param.apeOffer, param.bakcOffer, invalidCoinOffer)
    ).revertedWith("Offer: coin offer expired");

    invalidCoinOffer = { ...param.coinOffer };
    invalidCoinOffer.coinAmount = 0;
    await expect(
      contracts.stakeMatcher
        .connect(matchSigner)
        .matchWithBakcAndCoin(param.apeOffer, param.bakcOffer, invalidCoinOffer)
    ).revertedWith("Offer: coin amount can't be 0");

    await signOffers(env, contracts, env.admin.address, param);
    invalidCoinOffer = await signCoinOffer(env, contracts, await findPrivateKey(env.admin.address), param.coinOffer);
    await expect(
      contracts.stakeMatcher.connect(env.admin).matchWithBakcAndCoin(param.apeOffer, param.bakcOffer, invalidCoinOffer)
    ).revertedWith("Offer: invalid coin offer signature");
  });

  it("matchWithBakc: revert - invalid offer nonce", async () => {
    const now = await latest();
    const [param, withLoan, matcher] = fc.sample(
      fc.tuple(
        randomMatchBakc(env, contracts, now).filter((v) => {
          return v.apeOffer.staker !== v.bakcOffer.staker;
        }),
        fc.boolean(),
        fc.constantFrom(...env.accounts)
      ),
      1
    )[0];

    await prepareMatch(param, withLoan);
    await signOffers(env, contracts, matcher.address, param);
    await matchWithBakc(param, matcher.address);
    await snapshots.capture("matchWithBakc");

    const matchSigner = await ethers.getSigner(matcher.address);

    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithBakc(param.apeOffer, param.bakcOffer)
    ).revertedWith("Offer: not bakc owner");

    if (matcher.address !== param.apeOffer.staker) {
      await contracts.stakeMatcher
        .connect(await ethers.getSigner(param.apeOffer.staker))
        .cancelOffers([param.apeOffer.nonce]);

      await expect(
        contracts.stakeMatcher.connect(matchSigner).matchWithBakc(param.apeOffer, param.bakcOffer)
      ).revertedWith("Offer: invalid ape offer nonce");
    }

    if (param.bakcOffer.staker !== matcher.address) {
      await snapshots.revert("matchWithBakc");
      await contracts.stakeMatcher
        .connect(await ethers.getSigner(param.bakcOffer.staker))
        .cancelOffers([param.bakcOffer.nonce]);

      await expect(
        contracts.stakeMatcher.connect(matchSigner).matchWithBakc(param.apeOffer, param.bakcOffer)
      ).revertedWith("Offer: invalid bakc offer nonce");
    }
  });

  it("matchWithBakc: revert - validate ape offer", async () => {
    const now = await latest();
    const [param, withLoan, matcher] = fc.sample(
      fc.tuple(randomMatchBakc(env, contracts, now), fc.boolean(), fc.constantFrom(...env.accounts)),
      1
    )[0];
    const matchSigner = await ethers.getSigner(matcher.address);

    let invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.staker = constants.AddressZero;

    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithBakc(invalidApeOffer, param.bakcOffer)
    ).revertedWith("Offer: invalid ape staker");

    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.startTime = (await latest()) + 2;
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithBakc(invalidApeOffer, param.bakcOffer)
    ).revertedWith("Offer: ape offer not start");

    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.endTime = (await latest()) - 2;
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithBakc(invalidApeOffer, param.bakcOffer)
    ).revertedWith("Offer: ape offer expired");

    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.collection = constants.AddressZero;
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithBakc(invalidApeOffer, param.bakcOffer)
    ).revertedWith("Offer: not ape collection");

    await prepareMatch(param, withLoan);
    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.tokenId = 101;
    await (param as any).apeContract.mint(invalidApeOffer.tokenId);
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithBakc(invalidApeOffer, param.bakcOffer)
    ).revertedWith("ERC721: owner query for nonexistent token");

    await snapshots.revert("init");
    await prepareMatch(param, withLoan);
    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.tokenId = 101;
    await (param as any).apeContract.mint(invalidApeOffer.tokenId);
    await (param as any).apeContract.approve(contracts.lendPool.address, invalidApeOffer.tokenId);
    await contracts.lendPool.borrow(
      contracts.weth.address,
      makeBN18("0.001"),
      invalidApeOffer.collection,
      invalidApeOffer.tokenId,
      env.admin.address,
      0
    );
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithBakc(invalidApeOffer, param.bakcOffer)
    ).revertedWith("Offer: not ape owner");
    await snapshots.revert("init");

    await prepareMatch(param, withLoan);

    invalidApeOffer = await signApeOffer(env, contracts, await findPrivateKey(env.admin.address), param.apeOffer);
    await expect(
      contracts.stakeMatcher.connect(env.admin).matchWithBakc(invalidApeOffer, param.bakcOffer)
    ).revertedWith("Offer: invalid ape offer signature");

    const signedApeOffer = await signApeOffer(
      env,
      contracts,
      await findPrivateKey(param.apeOffer.staker),
      param.apeOffer
    );
    await expect(
      contracts.stakeMatcher.connect(env.admin).matchWithBakc(signedApeOffer, param.bakcOffer)
    ).not.revertedWith("Offer: invalid ape offer signature");
  }).timeout(40000);

  it("matchWithBakc: revert - validate bakc offer", async () => {
    const now = await latest();
    const [param, withLoan, matcher] = fc.sample(
      fc.tuple(randomMatchBakc(env, contracts, now), fc.boolean(), fc.constantFrom(...env.accounts)),
      1
    )[0];
    const matchSigner = await ethers.getSigner(matcher.address);

    await prepareMatch(param, withLoan);
    await signOffers(env, contracts, matcher.address, param);

    let invalidBakcOffer = { ...param.bakcOffer };
    invalidBakcOffer.staker = constants.AddressZero;

    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithBakc(param.apeOffer, invalidBakcOffer)
    ).revertedWith("Offer: invalid bakc staker");

    invalidBakcOffer = { ...param.bakcOffer };
    invalidBakcOffer.startTime = (await latest()) + 2;
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithBakc(param.apeOffer, invalidBakcOffer)
    ).revertedWith("Offer: bakc offer not start");

    invalidBakcOffer = { ...param.bakcOffer };
    invalidBakcOffer.endTime = (await latest()) - 2;
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithBakc(param.apeOffer, invalidBakcOffer)
    ).revertedWith("Offer: bakc offer expired");

    invalidBakcOffer = { ...param.bakcOffer };
    invalidBakcOffer.tokenId = 101;
    await contracts.bakc.mint(invalidBakcOffer.tokenId);
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithBakc(param.apeOffer, invalidBakcOffer)
    ).revertedWith("Offer: not bakc owner");

    await signOffers(env, contracts, env.admin.address, param);
    invalidBakcOffer = await signBakcOffer(env, contracts, await findPrivateKey(env.admin.address), param.bakcOffer);
    await expect(
      contracts.stakeMatcher.connect(env.admin).matchWithBakc(param.apeOffer, invalidBakcOffer)
    ).revertedWith("Offer: invalid bakc offer signature");
  });

  it("matchWithCoin: revert - invalid offer nonce", async () => {
    const now = await latest();
    const [param, withLoan, matcher] = fc.sample(
      fc.tuple(
        randomMatchCoin(env, contracts, now).filter((v) => {
          return v.apeOffer.staker !== v.coinOffer.staker;
        }),
        fc.boolean(),
        fc.constantFrom(...env.accounts)
      ),
      1
    )[0];

    await prepareMatch(param, withLoan);
    await signOffers(env, contracts, matcher.address, param);
    await matchWithCoin(param, matcher.address);
    await snapshots.capture("matchWithCoin");

    const matchSigner = await ethers.getSigner(matcher.address);

    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithCoin(param.apeOffer, param.coinOffer)
    ).revertedWith("StakeProxy: ape already staked");

    if (matcher.address !== param.apeOffer.staker) {
      await contracts.stakeMatcher
        .connect(await ethers.getSigner(param.apeOffer.staker))
        .cancelOffers([param.apeOffer.nonce]);

      await expect(
        contracts.stakeMatcher.connect(matchSigner).matchWithCoin(param.apeOffer, param.coinOffer)
      ).revertedWith("Offer: invalid ape offer nonce");
    }

    if (param.coinOffer.staker !== matcher.address) {
      await snapshots.revert("matchWithCoin");
      await contracts.stakeMatcher
        .connect(await ethers.getSigner(param.coinOffer.staker))
        .cancelOffers([param.coinOffer.nonce]);

      await expect(
        contracts.stakeMatcher.connect(matchSigner).matchWithCoin(param.apeOffer, param.coinOffer)
      ).revertedWith("Offer: invalid coin offer nonce");
    }
  });

  it("matchWithCoin: revert - validate ape offer", async () => {
    const now = await latest();
    const [param, withLoan, matcher] = fc.sample(
      fc.tuple(randomMatchCoin(env, contracts, now), fc.boolean(), fc.constantFrom(...env.accounts)),
      1
    )[0];
    const matchSigner = await ethers.getSigner(matcher.address);

    let invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.staker = constants.AddressZero;

    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithCoin(invalidApeOffer, param.coinOffer)
    ).revertedWith("Offer: invalid ape staker");

    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.startTime = (await latest()) + 2;
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithCoin(invalidApeOffer, param.coinOffer)
    ).revertedWith("Offer: ape offer not start");

    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.endTime = (await latest()) - 2;
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithCoin(invalidApeOffer, param.coinOffer)
    ).revertedWith("Offer: ape offer expired");

    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.collection = constants.AddressZero;
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithCoin(invalidApeOffer, param.coinOffer)
    ).revertedWith("Offer: not ape collection");

    await prepareMatch(param, withLoan);
    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.tokenId = 101;
    await (param as any).apeContract.mint(invalidApeOffer.tokenId);
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithCoin(invalidApeOffer, param.coinOffer)
    ).revertedWith("ERC721: owner query for nonexistent token");

    await snapshots.revert("init");
    await prepareMatch(param, withLoan);
    invalidApeOffer = { ...param.apeOffer };
    invalidApeOffer.tokenId = 101;
    await (param as any).apeContract.mint(invalidApeOffer.tokenId);
    await (param as any).apeContract.approve(contracts.lendPool.address, invalidApeOffer.tokenId);
    await contracts.lendPool.borrow(
      contracts.weth.address,
      makeBN18("0.001"),
      invalidApeOffer.collection,
      invalidApeOffer.tokenId,
      env.admin.address,
      0
    );
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithCoin(invalidApeOffer, param.coinOffer)
    ).revertedWith("Offer: not ape owner");
    await snapshots.revert("init");

    await prepareMatch(param, withLoan);

    invalidApeOffer = await signApeOffer(env, contracts, await findPrivateKey(env.admin.address), param.apeOffer);
    await expect(
      contracts.stakeMatcher.connect(env.admin).matchWithCoin(invalidApeOffer, param.coinOffer)
    ).revertedWith("Offer: invalid ape offer signature");

    const signedApeOffer = await signApeOffer(
      env,
      contracts,
      await findPrivateKey(param.apeOffer.staker),
      param.apeOffer
    );
    await expect(
      contracts.stakeMatcher.connect(env.admin).matchWithCoin(signedApeOffer, param.coinOffer)
    ).not.revertedWith("Offer: invalid ape offer signature");
  }).timeout(40000);

  it("matchWithCoin: revert - validate coin offer", async () => {
    const now = await latest();
    const [param, withLoan, matcher] = fc.sample(
      fc.tuple(randomMatchCoin(env, contracts, now), fc.boolean(), fc.constantFrom(...env.accounts)),
      1
    )[0];
    const matchSigner = await ethers.getSigner(matcher.address);

    await prepareMatch(param, withLoan);
    await signOffers(env, contracts, matcher.address, param);

    let invalidCoinOffer = { ...param.coinOffer };
    invalidCoinOffer.staker = constants.AddressZero;

    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithCoin(param.apeOffer, invalidCoinOffer)
    ).revertedWith("Offer: invalid coin staker");

    invalidCoinOffer = { ...param.coinOffer };
    invalidCoinOffer.startTime = (await latest()) + 2;
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithCoin(param.apeOffer, invalidCoinOffer)
    ).revertedWith("Offer: coin offer not start");

    invalidCoinOffer = { ...param.coinOffer };
    invalidCoinOffer.endTime = (await latest()) - 2;
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithCoin(param.apeOffer, invalidCoinOffer)
    ).revertedWith("Offer: coin offer expired");

    invalidCoinOffer = { ...param.coinOffer };
    invalidCoinOffer.coinAmount = 0;
    await expect(
      contracts.stakeMatcher.connect(matchSigner).matchWithCoin(param.apeOffer, invalidCoinOffer)
    ).revertedWith("Offer: coin amount can't be 0");

    await signOffers(env, contracts, env.admin.address, param);
    invalidCoinOffer = await signCoinOffer(env, contracts, await findPrivateKey(env.admin.address), param.coinOffer);
    await expect(
      contracts.stakeMatcher.connect(env.admin).matchWithCoin(param.apeOffer, invalidCoinOffer)
    ).revertedWith("Offer: invalid coin offer signature");
  });
});
