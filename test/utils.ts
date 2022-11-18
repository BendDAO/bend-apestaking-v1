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
import { DataTypes } from "../typechain-types/contracts/interfaces/IStakeMatcher";
import { signTypedData } from "./helpers/signature-helper";
import { findPrivateKey } from "./helpers/hardhat-keys";

const NAME = "BendStakeMatcher";
const VERSION = "1";

export function makeBN18(num: string | number): BigNumber {
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
  const coins = fc
    .array(fc.integer({ min: 0, max: maxCap }), { minLength: 3, maxLength: 3 })
    .filter((t) => t[0] + t[1] + t[2] === maxCap && t[2] > 0);

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
        share: _shares[0],
      },
      bakcStaked: {
        offerHash: emptyBytes32,
        staker: env.accounts[_stakers[1]].address,
        tokenId: 100,
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
  const coins = fc
    .array(fc.integer({ min: 0, max: maxCap }), { minLength: 2, maxLength: 2 })
    .filter((t) => t[0] + t[1] === maxCap);

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
        share: _shares[0],
      },
      bakcStaked: {
        offerHash: emptyBytes32,
        staker: env.accounts[_stakers[1]].address,
        tokenId: 100,
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

  const coins = fc
    .array(fc.integer({ min: 0, max: maxCap }), { minLength: 2, maxLength: 2 })
    .filter((t) => t[0] + t[1] === maxCap && t[1] > 0);
  let poolId = 1;
  if (ape === contracts.mayc.address) {
    poolId = 2;
  }

  return fc.tuple(shares, stakers, coins).map((t) => {
    const [_shares, _stakers, _coins] = t;
    return {
      apeStaked: {
        offerHash: emptyBytes32,
        staker: env.accounts[_stakers[0]].address,
        collection: ape,
        tokenId: 100,
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

const mapToOffer = (nowTime: number) => {
  return (t: any) => {
    const { apeStaked, bakcStaked, coinStaked, poolId, stakers } = t;
    return {
      apeOffer: {
        poolId,
        bakcOfferee: bakcStaked.staker,
        coinOfferee: coinStaked.staker,
        ...apeStaked,
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
  offers: {
    apeOffer: DataTypes.ApeOfferStruct;
    bakcOffer: DataTypes.BakcOfferStruct;
    coinOffer: DataTypes.CoinOfferStruct;
  }
) => {
  const apeOfferSig = await signApeOffer(
    env,
    contracts,
    await findPrivateKey(await offers.apeOffer.staker),
    offers.apeOffer
  );

  offers.apeOffer.r = apeOfferSig.r;
  offers.apeOffer.s = apeOfferSig.s;
  offers.apeOffer.v = apeOfferSig.v;

  if (offers.bakcOffer.staker !== constants.AddressZero) {
    const bakcOfferSig = await signBakcOffer(
      env,
      contracts,
      await findPrivateKey(await offers.bakcOffer.staker),
      offers.bakcOffer
    );
    offers.bakcOffer.r = bakcOfferSig.r;
    offers.bakcOffer.s = bakcOfferSig.s;
    offers.bakcOffer.v = bakcOfferSig.v;
  }

  if (offers.coinOffer.staker !== constants.AddressZero) {
    const coinOfferSig = await signCoinOffer(
      env,
      contracts,
      await findPrivateKey(await offers.coinOffer.staker),
      offers.coinOffer
    );

    offers.coinOffer.r = coinOfferSig.r;
    offers.coinOffer.s = coinOfferSig.s;
    offers.coinOffer.v = coinOfferSig.v;
  }
};

export const signApeOffer = async (
  env: Env,
  contracts: Contracts,
  privateKey: string,
  apeOffer: DataTypes.ApeOfferStruct
) => {
  return await _signApeOffer(env.chainId, contracts.stakeMatcher.address, privateKey, apeOffer);
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
    "uint256", // coinAmount
    "uint256", // share
    "uint256", // startTime
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0x0d25ac8a2eb3886bb519915926ca9aad501599e935bca3ba360313f89fd84c1f",
    await apeOffer.poolId,
    await apeOffer.staker,
    await apeOffer.bakcOfferee,
    await apeOffer.coinOfferee,
    await apeOffer.collection,
    await apeOffer.tokenId,
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
    "uint256", // coinAmount
    "uint256", // share
    "uint256", // startTime
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0x0d25ac8a2eb3886bb519915926ca9aad501599e935bca3ba360313f89fd84c1f",
    await apeOffer.poolId,
    await apeOffer.staker,
    await apeOffer.bakcOfferee,
    await apeOffer.coinOfferee,
    await apeOffer.collection,
    await apeOffer.tokenId,
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
  return await _signBakcOffer(env.chainId, contracts.stakeMatcher.address, privateKey, bakcOffer);
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
    "uint256", // coinAmount
    "uint256", // share
    "uint256", // startTime
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0x7663fdea75f14fe999486aacbb9f2cc2a805c44d01ddfd827ac5b1529d848a24",
    await bakcOffer.staker,
    await bakcOffer.apeOfferee,
    await bakcOffer.coinOfferee,
    await bakcOffer.tokenId,
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
    "uint256", // coinAmount
    "uint256", // share
    "uint256", // startTime
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0x7663fdea75f14fe999486aacbb9f2cc2a805c44d01ddfd827ac5b1529d848a24",
    await bakcOffer.staker,
    await bakcOffer.apeOfferee,
    await bakcOffer.coinOfferee,
    await bakcOffer.tokenId,
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
  return await _signCoinOffer(env.chainId, contracts.stakeMatcher.address, privateKey, coinOffer);
};

export const hashCoinOffer = async (coinOffer: DataTypes.CoinOfferStruct) => {
  const types = [
    "bytes32", // type hash
    "uint8", // poolId
    "address", // staker
    "address", // apeOfferee
    "address", // bakcOfferee
    "uint256", // coinAmount
    "uint256", // share
    "uint256", // startTime
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0x1ee48a7f548126fdd0125dc5358eb4a17d8698a0e540c58f3f1dbdebc802e653",
    await coinOffer.poolId,
    await coinOffer.staker,
    await coinOffer.apeOfferee,
    await coinOffer.bakcOfferee,
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
    "uint256", // coinAmount
    "uint256", // share
    "uint256", // startTime
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0x1ee48a7f548126fdd0125dc5358eb4a17d8698a0e540c58f3f1dbdebc802e653",
    await coinOffer.poolId,
    await coinOffer.staker,
    await coinOffer.apeOfferee,
    await coinOffer.bakcOfferee,
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