import fc from "fast-check";
import { formatBytes32String } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { Contracts, Env } from "./_setup";
import { BigNumber, constants, Contract } from "ethers";

/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

export function makeBN18(num: string | number): BigNumber {
  return ethers.utils.parseUnits(num.toString(), 18);
}

export const getContract = async <ContractType extends Contract>(
  contractName: string,
  address: string
): Promise<ContractType> => (await ethers.getContractAt(contractName, address)) as ContractType;

export const emptyBytes32 = formatBytes32String("");

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
      poolId: 3,
      stakers: new Set<string>([
        env.accounts[_stakers[0]].address,
        env.accounts[_stakers[1]].address,
        env.accounts[_stakers[2]].address,
      ]),
    };
  });
};

export const randomApeBakc = (env: Env, contracts: Contracts, maxCap: number) => {
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

export const randomApeCoin = (env: Env, contracts: Contracts, maxCap: number, ape: string) => {
  const shares = fc
    .array(fc.integer({ min: 1, max: 10000 }), { minLength: 2, maxLength: 2 })
    .filter((t) => t[0] + t[1] === 10000);
  const stakers = fc.array(fc.integer({ min: 1, max: 5 }), {
    minLength: 2,
    maxLength: 2,
  });

  const coins = fc
    .array(fc.integer({ min: 0, max: maxCap }), { minLength: 2, maxLength: 2 })
    .filter((t) => t[0] + t[1] === maxCap);
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

export const randomStakeParam = (env: Env, contracts: Contracts) => {
  return fc.oneof(
    randomApeBakcCoin(env, contracts, 856),
    randomApeBakc(env, contracts, 856),
    randomApeCoin(env, contracts, 2042, contracts.mayc.address),
    randomApeCoin(env, contracts, 10094, contracts.bayc.address)
  );
};

export const randomPairedStakeParam = (env: Env, contracts: Contracts) => {
  return fc.oneof(randomApeBakcCoin(env, contracts, 856), randomApeBakc(env, contracts, 856));
};

export const randomSingleStakeParam = (env: Env, contracts: Contracts) => {
  return fc.oneof(
    randomApeCoin(env, contracts, 2042, contracts.mayc.address),
    randomApeCoin(env, contracts, 10094, contracts.bayc.address)
  );
};
