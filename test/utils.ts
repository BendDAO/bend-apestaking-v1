/* eslint-disable node/no-extraneous-import */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-explicit-any */

import fc from "fast-check";
import { formatBytes32String } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { Contracts, Env } from "./_setup";
import { BigNumber, constants, Contract, utils } from "ethers";
import { advanceBlock, latest } from "./helpers/block-traveller";
import { TypedDataDomain } from "@ethersproject/abstract-signer";
import { DataTypes } from "../typechain-types/contracts/interfaces/IStakeMatcher";
import { signTypedData } from "./helpers/signature-helper";
import { findPrivateKey } from "./helpers/hardhat-keys";

const { defaultAbiCoder, keccak256 } = utils;

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
    .array(fc.integer({ min: 100, max: 10000 }), { minLength: 3, maxLength: 3 })
    .filter((t) => t[0] + t[1] + t[2] === 10000);
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
        staker: constants.AddressZero,
        coinAmount: constants.Zero,
        coinShare: constants.Zero,
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
        apeShare: _shares[0],
        coinShare: _shares[1],
      },
      bakcStaked: {
        offerHash: emptyBytes32,
        staker: constants.AddressZero,
        tokenId: 0,
        coinAmount: constants.Zero,
        bakcShare: constants.Zero,
        coinShare: constants.Zero,
      },
      coinStaked: {
        offerHash: emptyBytes32,
        staker: env.accounts[_stakers[1]].address,
        coinAmount: makeBN18(_coins[1]),
        coinShare: _shares[1],
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

export const apeOfferKey = (poolType: number, staker: string, apeCollection: string, tokenId: number) => {
  const types = ["bytes32", "uint8", "address", "address", "uint256"];

  const values = [
    "0x9dfdf7723fed97fb48b5d51a04a654620e8fb4d60a29db3890541900b75776ee",
    poolType,
    staker,
    apeCollection,
    tokenId,
  ];

  return keccak256(defaultAbiCoder.encode(types, values));
};

const mapToOffer = (nowTime: number) => {
  return (t: any) => {
    const { apeStaked, bakcStaked, coinStaked, poolId, stakers } = t;
    const poolType = poolId === 3 ? 2 : 1;
    const key = apeOfferKey(poolType, apeStaked.staker, apeStaked.collection, apeStaked.tokenId);
    return {
      apeOffer: {
        poolType,
        endTime: nowTime + 3600 * 24,
        ...apeStaked,
        nonce: constants.Zero,
        v: constants.Zero,
        r: emptyBytes32,
        s: emptyBytes32,
      },
      bakcOffer: {
        key,
        ...bakcStaked,
        endTime: nowTime + 3600 * 24,
        nonce: constants.Zero,
        v: constants.Zero,
        r: emptyBytes32,
        s: emptyBytes32,
      },
      coinOffer: {
        key,
        ...coinStaked,
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
  const types = [
    "bytes32", // type hash
    "uint8", // poolType
    "address", // staker
    "address", // collection
    "uint256", // tokenId
    "uint256", // coinAmount
    "uint256", // apeShare
    "uint256", // coinShare
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0x5b64381119b32244dd6c5b918d0106988e84c1369594978f0d6d9abc28374990",
    await apeOffer.poolType,
    await apeOffer.staker,
    await apeOffer.collection,
    await apeOffer.tokenId,
    await apeOffer.coinAmount,
    await apeOffer.apeShare,
    await apeOffer.coinShare,
    await apeOffer.endTime,
    await apeOffer.nonce,
  ];

  const domain: TypedDataDomain = {
    name: NAME,
    version: VERSION,
    chainId: env.chainId,
    verifyingContract: contracts.stakeMatcher.address,
  };
  return await signTypedData(privateKey, types, values, domain);
};

export const signBakcOffer = async (
  env: Env,
  contracts: Contracts,
  privateKey: string,
  bakcOffer: DataTypes.BakcOfferStruct
) => {
  const types = [
    "bytes32", // type hash
    "bytes32", // key
    "address", // staker
    "uint256", // tokenId
    "uint256", // coinAmount
    "uint256", // bakcShare
    "uint256", // coinShare
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0x938fe544838afb8000a58d722a79953db542abbbad1738bb81d25f4b0954580b",
    await bakcOffer.key,
    await bakcOffer.staker,
    await bakcOffer.tokenId,
    await bakcOffer.coinAmount,
    await bakcOffer.bakcShare,
    await bakcOffer.coinShare,
    await bakcOffer.endTime,
    await bakcOffer.nonce,
  ];

  const domain: TypedDataDomain = {
    name: NAME,
    version: VERSION,
    chainId: env.chainId,
    verifyingContract: contracts.stakeMatcher.address,
  };
  return await signTypedData(privateKey, types, values, domain);
};

export const signCoinOffer = async (
  env: Env,
  contracts: Contracts,
  privateKey: string,
  coinOffer: DataTypes.CoinOfferStruct
) => {
  const types = [
    "bytes32", // type hash
    "bytes32", // key
    "address", // staker
    "uint256", // coinAmount
    "uint256", // coinShare
    "uint256", // endTime
    "uint256", // nonce
  ];

  const values = [
    "0xc5a5eaf066880d4f397cea39a5e5e2680fcc254976483ff5c5a7235390c85a8e",
    await coinOffer.key,
    await coinOffer.staker,
    await coinOffer.coinAmount,
    await coinOffer.coinShare,
    await coinOffer.endTime,
    await coinOffer.nonce,
  ];

  const domain: TypedDataDomain = {
    name: NAME,
    version: VERSION,
    chainId: env.chainId,
    verifyingContract: contracts.stakeMatcher.address,
  };
  return await signTypedData(privateKey, types, values, domain);
};
