/* eslint-disable @typescript-eslint/no-explicit-any */
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers, network, upgrades } from "hardhat";
import { parseEther } from "ethers/lib/utils";
import {
  IWETH,
  IERC20,
  MintableERC721,
  IERC721,
  ILendPoolAddressesProvider,
  IApeCoinStaking,
  IStakeProxy,
  IStakeManager,
  IStakeMatcher,
} from "../typechain-types";
import {
  APE_COIN,
  APE_COIN_HOLDER,
  APE_STAKING,
  BAKC,
  BAYC,
  bBAYC,
  BendAddressesProviders,
  bMAYC,
  getParams,
  MAYC,
  WETH,
} from "../tasks/config";
import { waitForTx } from "../tasks/utils/helpers";
import { constants, Contract } from "ethers";

import { impersonateAccount } from "@nomicfoundation/hardhat-network-helpers";

export interface Env {
  initialized: boolean;
  fee: number;
  accounts: SignerWithAddress[];
  admin: SignerWithAddress;
  chainId: number;
}

export interface Contracts {
  initialized: boolean;
  // weth
  weth: IWETH;
  apeCoin: IERC20;

  // nft
  bayc: MintableERC721;
  bBayc: IERC721;
  mayc: MintableERC721;
  bMayc: IERC721;
  bakc: MintableERC721;

  // bend protocol
  bendAddressesProvider: ILendPoolAddressesProvider;

  // ape staking
  apeStaking: IApeCoinStaking;

  // bend ape staking
  stakeProxy: IStakeProxy;
  stakeManager: IStakeManager;
  stakeMatcher: IStakeMatcher;
}

export async function setupEnv(env: Env, contracts: Contracts): Promise<void> {
  env.fee = 100;
  env.accounts = (await ethers.getSigners()).slice(0, 6);
  env.admin = env.accounts[0];
  env.chainId = (await ethers.provider.getNetwork()).chainId;
  const apeCoinHolder = getParams(APE_COIN_HOLDER, network.name);
  await impersonateAccount(apeCoinHolder);
  // init eth
  for (const user of env.accounts) {
    // Each user gets 100 WETH
    waitForTx(await contracts.weth.connect(user).deposit({ value: parseEther("100") }));
    // Each user gets 100K ape coin
    waitForTx(
      await contracts.apeCoin
        .connect(await ethers.getSigner(apeCoinHolder))
        .transfer(user.address, parseEther("100000"))
    );
  }

  waitForTx(
    await contracts.apeCoin
      .connect(await ethers.getSigner(apeCoinHolder))
      .transfer(contracts.apeStaking.address, parseEther("100000000"))
  );

  // add reserve balance for bend
  const lendPool = await ethers.getContractAt("ILendPool", await contracts.bendAddressesProvider.getLendPool());
  waitForTx(await contracts.weth.connect(env.admin).approve(lendPool.address, constants.MaxUint256));

  waitForTx(await lendPool.connect(env.admin).deposit(contracts.weth.address, parseEther("100"), env.admin.address, 0));
}

export async function setupContracts(): Promise<Contracts> {
  const networkName = network.name;

  // weth
  const weth = await ethers.getContractAt("IWETH", getParams(WETH, networkName));

  // nft
  const bayc = await ethers.getContractAt("MintableERC721", getParams(BAYC, networkName));
  const bBayc = await ethers.getContractAt("IERC721", getParams(bBAYC, networkName));

  const mayc = await ethers.getContractAt("MintableERC721", getParams(MAYC, networkName));
  const bMayc = await ethers.getContractAt("IERC721", getParams(bMAYC, networkName));

  const bakc = await ethers.getContractAt("MintableERC721", getParams(BAKC, networkName));

  const apeCoin = await ethers.getContractAt("IERC20", getParams(APE_COIN, networkName));

  // bend protocol
  const bendAddressesProvider = await ethers.getContractAt(
    "ILendPoolAddressesProvider",
    getParams(BendAddressesProviders, networkName)
  );

  const apeStaking = await ethers.getContractAt("IApeCoinStaking", getParams(APE_STAKING, networkName));

  const stakeProxy = await deployContract<IStakeProxy>("StakeProxy", []);

  const stakeManager = await deployProxyContract("StakeManager", [
    bayc.address,
    mayc.address,
    bakc.address,
    bBayc.address,
    bMayc.address,
    apeCoin.address,
    weth.address,
    apeStaking.address,
    stakeProxy.address,
    bendAddressesProvider.address,
  ]);

  const stakeMatcher = await deployProxyContract("BendStakeMatcher", [
    bayc.address,
    mayc.address,
    bakc.address,
    bBayc.address,
    bMayc.address,
    apeCoin.address,
    stakeManager.address,
    bendAddressesProvider.address,
  ]);

  /** Return contracts
   */
  return {
    initialized: true,
    weth,
    apeCoin,
    bayc,
    bBayc,
    mayc,
    bMayc,
    bakc,
    bendAddressesProvider,
    apeStaking,
    stakeProxy,
    stakeManager,
    stakeMatcher,
  } as Contracts;
}

async function deployContract<ContractType extends Contract>(contractName: string, args: any[]): Promise<ContractType> {
  const instance = await (await ethers.getContractFactory(contractName)).deploy(...args);

  return instance as ContractType;
}

async function deployProxyContract<ContractType extends Contract>(
  contractName: string,
  args: any[]
): Promise<ContractType> {
  const factory = await ethers.getContractFactory(contractName);
  const instance = await upgrades.deployProxy(factory, args, {
    timeout: 0,
  });
  return instance as ContractType;
}

export class Snapshots {
  ids = new Map<string, string>();

  async capture(tag: string): Promise<void> {
    this.ids.set(tag, await this.evmSnapshot());
  }

  async revert(tag: string): Promise<void> {
    await this.evmRevert(this.ids.get(tag) || "1");
    await this.capture(tag);
  }

  async evmSnapshot(): Promise<any> {
    return await ethers.provider.send("evm_snapshot", []);
  }

  async evmRevert(id: string): Promise<any> {
    return await ethers.provider.send("evm_revert", [id]);
  }
}

const contracts: Contracts = { initialized: false } as Contracts;
const env: Env = { initialized: false } as Env;
const snapshots = new Snapshots();
export function makeSuite(name: string, tests: (contracts: Contracts, env: Env, snapshots: Snapshots) => void): void {
  describe(name, () => {
    let _id: any;
    before(async () => {
      if (!env.initialized && !contracts.initialized) {
        Object.assign(contracts, await setupContracts());
        await setupEnv(env, contracts);
        env.initialized = true;
        contracts.initialized = true;
        snapshots.capture("setup");
      }
      _id = await snapshots.evmSnapshot();
    });
    tests(contracts, env, snapshots);
    after(async () => {
      await snapshots.evmRevert(_id);
    });
  });
}
