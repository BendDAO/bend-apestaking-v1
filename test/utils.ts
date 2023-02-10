/* eslint-disable node/no-extraneous-import */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-explicit-any */

import fc from "fast-check";
import { defaultAbiCoder, formatBytes32String, keccak256 } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { Contracts, Env } from "./_setup";
import { BigNumber, constants, Contract } from "ethers";
import { advanceBlock, latest } from "./helpers/block-traveller";
import { TypedDataDomain } from "@ethersproject/abstract-signer";
import { DataTypes } from "../typechain-types/contracts/interfaces/IBendApeStaking";
import { signTypedData } from "./helpers/signature-helper";
import { findPrivateKey } from "./helpers/hardhat-keys";
import { parseEvents } from "./helpers/transaction-helper";
import { IStakeProxy } from "../typechain-types/contracts/interfaces/IStakeProxy";

const NAME = "BendApeStaking";
const VERSION = "1";

export const APE_TOKEN_ID = 101;
export const BAKC_TOKEN_ID = 102;

export function makeBN18(num: any): BigNumber {
  return ethers.utils.parseUnits(num.toString(), 18);
}

export const getContract = async <ContractType extends Contract>(
  contractName: string,
  address: string
): Promise<ContractType> => (await ethers.getContractAt(contractName, address)) as ContractType;

export const emptyBytes32 = formatBytes32String("");

export const skipHourBlocks = async () => {
  const currentTime = await latest();
  // skip hour blocks
  if (currentTime % 3600 === 3599) {
    await advanceBlock();
  }
};

export const randomApeBakcCoin = (env: Env, contracts: Contracts, maxCap: number) => {
  const shares = fc
    .array(fc.integer({ min: 100, max: 10000 }), { minLength: 3, maxLength: 3 })
    .filter((t) => t[0] + t[1] + t[2] === 10000);
  const stakers = fc.array(fc.integer({ min: 1, max: 5 }), {
    minLength: 3,
    maxLength: 3,
  });

  const coins = fc.integer({ min: 1, max: maxCap }).chain((minCap) => {
    return fc.tuple(
      fc.constant(minCap),
      fc
        .array(fc.integer({ min: 0, max: minCap }), { minLength: 3, maxLength: 3 })
        .filter((t) => t[0] + t[1] + t[2] >= minCap && t[0] + t[1] + t[2] <= maxCap && t[2] > 0)
    );
  });

  const ape = fc.constantFrom(contracts.bayc.address, contracts.mayc.address);

  return fc.tuple(shares, stakers, coins, ape).map((t) => {
    const [_shares, _stakers, [_minCoinCap, _coins], _ape] = t;

    return {
      apeStaked: {
        offerHash: emptyBytes32,
        staker: env.accounts[_stakers[0]].address,
        collection: _ape,
        tokenId: APE_TOKEN_ID,
        coinAmount: makeBN18(_coins[0]),
        share: _shares[0],
      },
      bakcStaked: {
        offerHash: emptyBytes32,
        staker: env.accounts[_stakers[1]].address,
        tokenId: BAKC_TOKEN_ID,
        coinAmount: makeBN18(_coins[1]),
        share: _shares[1],
      },
      coinStaked: {
        offerHash: emptyBytes32,
        staker: env.accounts[_stakers[2]].address,
        coinAmount: makeBN18(_coins[2]),
        share: _shares[2],
      },
      poolId: 3,
      minCoinCap: makeBN18(_minCoinCap),
      stakers: new Set<string>([
        env.accounts[_stakers[0]].address,
        env.accounts[_stakers[1]].address,
        env.accounts[_stakers[2]].address,
      ]),
    };
  });
};

export const randomApeAndBakc = (env: Env, contracts: Contracts, maxCap: number) => {
  const shares = fc
    .array(fc.integer({ min: 100, max: 10000 }), { minLength: 2, maxLength: 2 })
    .filter((t) => t[0] + t[1] === 10000);
  const stakers = fc.array(fc.integer({ min: 1, max: 5 }), {
    minLength: 2,
    maxLength: 2,
  });

  const coins = fc.integer({ min: 1, max: maxCap }).chain((minCap) => {
    return fc.tuple(
      fc.constant(minCap),
      fc
        .array(fc.integer({ min: 0, max: minCap }), { minLength: 3, maxLength: 3 })
        .filter((t) => t[0] + t[1] >= minCap && t[0] + t[1] <= maxCap)
    );
  });

  const ape = fc.constantFrom(contracts.bayc.address, contracts.mayc.address);

  return fc.tuple(shares, stakers, coins, ape).map((t) => {
    const [_shares, _stakers, [_minCoinCap, _coins], _ape] = t;
    return {
      apeStaked: {
        offerHash: emptyBytes32,
        staker: env.accounts[_stakers[0]].address,
        collection: _ape,
        tokenId: APE_TOKEN_ID,
        coinAmount: makeBN18(_coins[0]),
        share: _shares[0],
      },
      bakcStaked: {
        offerHash: emptyBytes32,
        staker: env.accounts[_stakers[1]].address,
        tokenId: BAKC_TOKEN_ID,
        coinAmount: makeBN18(_coins[1]),
        share: _shares[1],
      },
      coinStaked: {
        offerHash: emptyBytes32,
        staker: constants.AddressZero,
        coinAmount: constants.Zero,
        share: constants.Zero,
      },
      poolId: 3,
      minCoinCap: makeBN18(_minCoinCap),
      stakers: new Set<string>([env.accounts[_stakers[0]].address, env.accounts[_stakers[1]].address]),
    };
  });
};

export const randomApeAndCoin = (env: Env, contracts: Contracts, maxCap: number, ape: string) => {
  const shares = fc
    .array(fc.integer({ min: 1, max: 10000 }), { minLength: 2, maxLength: 2 })
    .filter((t) => t[0] + t[1] === 10000);

  const stakers = fc.array(fc.integer({ min: 1, max: 5 }), {
    minLength: 2,
    maxLength: 2,
  });

  const coins = fc.integer({ min: 1, max: maxCap }).chain((minCap) => {
    return fc.tuple(
      fc.constant(minCap),
      fc
        .array(fc.integer({ min: 0, max: minCap }), { minLength: 3, maxLength: 3 })
        .filter((t) => t[0] + t[1] >= minCap && t[0] + t[1] <= maxCap && t[1] > 0)
    );
  });

  let poolId = 1;
  if (ape === contracts.mayc.address) {
    poolId = 2;
  }

  return fc.tuple(shares, stakers, coins).map((t) => {
    const [_shares, _stakers, [_minCoinCap, _coins]] = t;
    return {
      apeStaked: {
        offerHash: emptyBytes32,
        staker: env.accounts[_stakers[0]].address,
        collection: ape,
        tokenId: APE_TOKEN_ID,
        coinAmount: makeBN18(_coins[0]),
        share: _shares[0],
      },
      bakcStaked: {
        offerHash: emptyBytes32,
        staker: constants.AddressZero,
        tokenId: 0,
        coinAmount: constants.Zero,
        share: constants.Zero,
      },
      coinStaked: {
        offerHash: emptyBytes32,
        staker: env.accounts[_stakers[1]].address,
        coinAmount: makeBN18(_coins[1]),
        share: _shares[1],
      },
      poolId,
      minCoinCap: makeBN18(_minCoinCap),
      stakers: new Set<string>([env.accounts[_stakers[0]].address, env.accounts[_stakers[1]].address]),
    };
  });
};

export const randomStake = (env: Env, contracts: Contracts) => {
  return fc.oneof(
    randomApeBakcCoin(env, contracts, 856),
    randomApeAndBakc(env, contracts, 856),
    randomApeAndCoin(env, contracts, 2042, contracts.mayc.address),
    randomApeAndCoin(env, contracts, 10094, contracts.bayc.address)
  );
};

export const randomPairedStake = (env: Env, contracts: Contracts) => {
  return fc.oneof(randomApeBakcCoin(env, contracts, 856), randomApeAndBakc(env, contracts, 856));
};

export const randomSingleStake = (env: Env, contracts: Contracts) => {
  return fc.oneof(
    randomApeAndCoin(env, contracts, 2042, contracts.mayc.address),
    randomApeAndCoin(env, contracts, 10094, contracts.bayc.address)
  );
};

export const randomStakeSelfApeBakcCoin = (env: Env, contracts: Contracts, maxCap: number) => {
  const coinAmount = fc.integer({ min: 1, max: maxCap });
  return fc.record({
    staker: fc.constantFrom(...env.accounts.slice(1, 6).map((v) => v.address)),
    apeCollection: fc.constantFrom(contracts.bayc.address, contracts.mayc.address),
    apeTokenId: fc.constant(APE_TOKEN_ID),
    bakcTokenId: fc.constant(BAKC_TOKEN_ID),
    coinAmount: coinAmount.map((v) => makeBN18(v)),
  });
};

export const randomStakeSelfApeAndCoin = (env: Env, maxCap: number, ape: string) => {
  const coinAmount = fc.integer({ min: 1, max: maxCap });
  return fc.record({
    staker: fc.constantFrom(...env.accounts.slice(1, 6).map((v) => v.address)),
    apeCollection: fc.constant(ape),
    apeTokenId: fc.constant(APE_TOKEN_ID),
    bakcTokenId: fc.constant(constants.MaxUint256),
    coinAmount: coinAmount.map((v) => makeBN18(v)),
  });
};

export const randomStakeSelfPairedPool = (env: Env, contracts: Contracts) => {
  return randomStakeSelfApeBakcCoin(env, contracts, 856);
};

export const randomStakeSelfSinglePool = (env: Env, contracts: Contracts) => {
  return fc.oneof(
    randomStakeSelfApeAndCoin(env, 2042, contracts.mayc.address),
    randomStakeSelfApeAndCoin(env, 10094, contracts.bayc.address)
  );
};

export const randomStakeSelf = (env: Env, contracts: Contracts) => {
  return fc.oneof(
    randomStakeSelfApeBakcCoin(env, contracts, 856),
    randomStakeSelfApeAndCoin(env, 2042, contracts.mayc.address),
    randomStakeSelfApeAndCoin(env, 10094, contracts.bayc.address)
  );
};

const mapToOffer = (nowTime: number) => {
  return (t: any) => {
    const { apeStaked, bakcStaked, coinStaked, poolId, minCoinCap, stakers } = t;
    return {
      apeOffer: {
        poolId,
        bakcOfferee: bakcStaked.staker,
        coinOfferee: coinStaked.staker,
        ...apeStaked,
        minCoinCap,
        startTime: nowTime,
        endTime: nowTime + 3600 * 24,
        nonce: constants.Zero,
        v: constants.Zero,
        r: emptyBytes32,
        s: emptyBytes32,
      },
      bakcOffer: {
        apeOfferee: apeStaked.staker,
        coinOfferee: coinStaked.staker,
        ...bakcStaked,
        minCoinCap,
        startTime: nowTime,
        endTime: nowTime + 3600 * 24,
        nonce: constants.Zero,
        v: constants.Zero,
        r: emptyBytes32,
        s: emptyBytes32,
      },
      coinOffer: {
        poolId,
        apeOfferee: apeStaked.staker,
        bakcOfferee: bakcStaked.staker,
        ...coinStaked,
        minCoinCap,
        startTime: nowTime,
        endTime: nowTime + 3600 * 24,
        nonce: constants.Zero,
        v: constants.Zero,
        r: emptyBytes32,
        s: emptyBytes32,
      },
      poolId,
      stakers,
    };
  };
};

export const randomMatchBakcAndCoin = (env: Env, contracts: Contracts, nowTime: number) => {
  return randomApeBakcCoin(env, contracts, 856).map(mapToOffer(nowTime));
};

export const randomMatchCoin = (env: Env, contracts: Contracts, nowTime: number) => {
  return fc
    .oneof(
      randomApeAndCoin(env, contracts, 2042, contracts.mayc.address),
      randomApeAndCoin(env, contracts, 10094, contracts.bayc.address)
    )
    .map(mapToOffer(nowTime));
};

export const randomMatchBakc = (env: Env, contracts: Contracts, nowTime: number) => {
  return randomApeAndBakc(env, contracts, 856).map(mapToOffer(nowTime));
};

export const signOffers = async (
  env: Env,
  contracts: Contracts,
  sender: string,
  offers: {
    apeOffer: DataTypes.ApeOfferStruct;
    bakcOffer: DataTypes.BakcOfferStruct;
    coinOffer: DataTypes.CoinOfferStruct;
  }
) => {
  if (sender !== offers.apeOffer.staker) {
    offers.apeOffer = await signApeOffer(
      env,
      contracts,
      await findPrivateKey(await offers.apeOffer.staker),
      offers.apeOffer
    );
  }

  if (offers.bakcOffer.staker !== constants.AddressZero && sender !== offers.bakcOffer.staker) {
    offers.bakcOffer = await signBakcOffer(
      env,
      contracts,
      await findPrivateKey(await offers.bakcOffer.staker),
      offers.bakcOffer
    );
  }

  if (offers.coinOffer.staker !== constants.AddressZero && sender !== offers.coinOffer.staker) {
    offers.coinOffer = await signCoinOffer(
      env,
      contracts,
      await findPrivateKey(await offers.coinOffer.staker),
      offers.coinOffer
    );
  }
};

export const signApeOffer = async (
  env: Env,
  contracts: Contracts,
  privateKey: string,
  apeOffer: DataTypes.ApeOfferStruct
) => {
  const sig = await _signApeOffer(env.chainId, contracts.bendApeStaking.address, privateKey, apeOffer);
  return {
    ...apeOffer,
    r: sig.r,
    s: sig.s,
    v: sig.v,
  };
};

export const _signApeOffer = async (
  chainId: number,
  matcher: string,
  privateKey: string,
  apeOffer: DataTypes.ApeOfferStruct
) => {
  const types = [
    "bytes32", // type hash
    "uint8", // poolId
    "address", // staker
    "address", // bakcOfferee
    "address", // coinOfferee
    "address", // collection
    "uint256", // tokenId
    "uint256", // minCoinCap
    "uint256", // coinAmount
    "uint256", // share
    "uint256", // startTime
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0xc38085c5e613d2865782e3362ed85519b287c59a900b8b9996482b5f15fc297a",
    await apeOffer.poolId,
    await apeOffer.staker,
    await apeOffer.bakcOfferee,
    await apeOffer.coinOfferee,
    await apeOffer.collection,
    await apeOffer.tokenId,
    await apeOffer.minCoinCap,
    await apeOffer.coinAmount,
    await apeOffer.share,
    await apeOffer.startTime,
    await apeOffer.endTime,
    await apeOffer.nonce,
  ];

  const domain: TypedDataDomain = {
    name: NAME,
    version: VERSION,
    chainId: chainId,
    verifyingContract: matcher,
  };
  return await signTypedData(privateKey, types, values, domain);
};

export const hashApeOffer = async (apeOffer: DataTypes.ApeOfferStruct) => {
  const types = [
    "bytes32", // type hash
    "uint8", // poolId
    "address", // staker
    "address", // bakcOfferee
    "address", // coinOfferee
    "address", // collection
    "uint256", // tokenId
    "uint256", // minCoinCap
    "uint256", // coinAmount
    "uint256", // share
    "uint256", // startTime
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0xc38085c5e613d2865782e3362ed85519b287c59a900b8b9996482b5f15fc297a",
    await apeOffer.poolId,
    await apeOffer.staker,
    await apeOffer.bakcOfferee,
    await apeOffer.coinOfferee,
    await apeOffer.collection,
    await apeOffer.tokenId,
    await apeOffer.minCoinCap,
    await apeOffer.coinAmount,
    await apeOffer.share,
    await apeOffer.startTime,
    await apeOffer.endTime,
    await apeOffer.nonce,
  ];

  return keccak256(defaultAbiCoder.encode(types, values));
};

export const signBakcOffer = async (
  env: Env,
  contracts: Contracts,
  privateKey: string,
  bakcOffer: DataTypes.BakcOfferStruct
) => {
  const sig = await _signBakcOffer(env.chainId, contracts.bendApeStaking.address, privateKey, bakcOffer);
  return {
    ...bakcOffer,
    r: sig.r,
    s: sig.s,
    v: sig.v,
  };
};

export const _signBakcOffer = async (
  chainId: number,
  matcher: string,
  privateKey: string,
  bakcOffer: DataTypes.BakcOfferStruct
) => {
  const types = [
    "bytes32", // type hash
    "address", // staker
    "address", // apeOfferee
    "address", // coinOfferee
    "uint256", // tokenId
    "uint256", // minCoinCap
    "uint256", // coinAmount
    "uint256", // share
    "uint256", // startTime
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0x31aa707589f3376f67b74747df0ab3c242e76ef4612bceb0edc253db2f48f280",
    await bakcOffer.staker,
    await bakcOffer.apeOfferee,
    await bakcOffer.coinOfferee,
    await bakcOffer.tokenId,
    await bakcOffer.minCoinCap,
    await bakcOffer.coinAmount,
    await bakcOffer.share,
    await bakcOffer.startTime,
    await bakcOffer.endTime,
    await bakcOffer.nonce,
  ];

  const domain: TypedDataDomain = {
    name: NAME,
    version: VERSION,
    chainId: chainId,
    verifyingContract: matcher,
  };
  return await signTypedData(privateKey, types, values, domain);
};

export const hashBakcOffer = async (bakcOffer: DataTypes.BakcOfferStruct) => {
  const types = [
    "bytes32", // type hash
    "address", // staker
    "address", // apeOfferee
    "address", // coinOfferee
    "uint256", // tokenId
    "uint256", // minCoinCap
    "uint256", // coinAmount
    "uint256", // share
    "uint256", // startTime
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0x31aa707589f3376f67b74747df0ab3c242e76ef4612bceb0edc253db2f48f280",
    await bakcOffer.staker,
    await bakcOffer.apeOfferee,
    await bakcOffer.coinOfferee,
    await bakcOffer.tokenId,
    await bakcOffer.minCoinCap,
    await bakcOffer.coinAmount,
    await bakcOffer.share,
    await bakcOffer.startTime,
    await bakcOffer.endTime,
    await bakcOffer.nonce,
  ];

  return keccak256(defaultAbiCoder.encode(types, values));
};

export const signCoinOffer = async (
  env: Env,
  contracts: Contracts,
  privateKey: string,
  coinOffer: DataTypes.CoinOfferStruct
) => {
  const sig = await _signCoinOffer(env.chainId, contracts.bendApeStaking.address, privateKey, coinOffer);
  return {
    ...coinOffer,
    r: sig.r,
    s: sig.s,
    v: sig.v,
  };
};

export const hashCoinOffer = async (coinOffer: DataTypes.CoinOfferStruct) => {
  const types = [
    "bytes32", // type hash
    "uint8", // poolId
    "address", // staker
    "address", // apeOfferee
    "address", // bakcOfferee
    "uint256", // minCoinCap
    "uint256", // coinAmount
    "uint256", // share
    "uint256", // startTime
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0xa55f9461c3793469cf78e03c1360fe52ee97f5d3aa1c9effe4a35cec8bac64ee",
    await coinOffer.poolId,
    await coinOffer.staker,
    await coinOffer.apeOfferee,
    await coinOffer.bakcOfferee,
    await coinOffer.minCoinCap,
    await coinOffer.coinAmount,
    await coinOffer.share,
    await coinOffer.startTime,
    await coinOffer.endTime,
    await coinOffer.nonce,
  ];

  return keccak256(defaultAbiCoder.encode(types, values));
};

export const _signCoinOffer = async (
  chainId: number,
  matcher: string,
  privateKey: string,
  coinOffer: DataTypes.CoinOfferStruct
) => {
  const types = [
    "bytes32", // type hash
    "uint8", // poolId
    "address", // staker
    "address", // apeOfferee
    "address", // bakcOfferee
    "uint256", // minCoinCap
    "uint256", // coinAmount
    "uint256", // share
    "uint256", // startTime
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0xa55f9461c3793469cf78e03c1360fe52ee97f5d3aa1c9effe4a35cec8bac64ee",
    await coinOffer.poolId,
    await coinOffer.staker,
    await coinOffer.apeOfferee,
    await coinOffer.bakcOfferee,
    await coinOffer.minCoinCap,
    await coinOffer.coinAmount,
    await coinOffer.share,
    await coinOffer.startTime,
    await coinOffer.endTime,
    await coinOffer.nonce,
  ];

  const domain: TypedDataDomain = {
    name: NAME,
    version: VERSION,
    chainId: chainId,
    verifyingContract: matcher,
  };
  return await signTypedData(privateKey, types, values, domain);
};

export const prepareStake = async (contracts: Contracts, param: any, withLoan_: boolean): Promise<any> => {
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

export const randomWithLoan = fc.boolean();

export const doStake = async (contracts: Contracts, param: any) => {
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
