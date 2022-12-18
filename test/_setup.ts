/* eslint-disable @typescript-eslint/no-explicit-any */
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers, network } from "hardhat";
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
  IBendApeStaking,
  ILendPool,
  IBNFTRegistry,
  ILendPoolLoan,
  IDebtToken,
  BendApeStakedVoting,
} from "../typechain-types";
import {
  APE_COIN,
  APE_COIN_HOLDER,
  APE_STAKING,
  BAKC,
  BAYC,
  bBAYC,
  BendAddressesProviders,
  BendDebtETH,
  bMAYC,
  BNFT_REGISTRY,
  getParams,
  MAYC,
  WETH,
} from "../tasks/config";
import { constants, Contract } from "ethers";

import { impersonateAccount, setBalance } from "@nomicfoundation/hardhat-network-helpers";

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
  bnftRegistry: IBNFTRegistry;

  // bend protocol
  bendAddressesProvider: ILendPoolAddressesProvider;
  lendPool: ILendPool;
  lendPoolLoan: ILendPoolLoan;
  debtWETH: IDebtToken;

  // ape staking
  apeStaking: IApeCoinStaking;

  // bend ape staking
  stakeProxy: IStakeProxy;
  stakeManager: IStakeManager;
  bendApeStaking: IBendApeStaking;
  stakedVoting: BendApeStakedVoting;
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
    await contracts.weth.connect(user).deposit({ value: parseEther("100") });
    // Each user gets 100K ape coin

    await contracts.apeCoin.connect(await ethers.getSigner(apeCoinHolder)).transfer(user.address, parseEther("100000"));
  }

  await contracts.apeCoin
    .connect(await ethers.getSigner(apeCoinHolder))
    .transfer(contracts.apeStaking.address, parseEther("100000000"));

  // add reserve balance for bend
  await contracts.weth.connect(env.admin).approve(contracts.lendPool.address, constants.MaxUint256);

  await contracts.lendPool.connect(env.admin).deposit(contracts.weth.address, parseEther("100"), env.admin.address, 0);

  const configurator = await contracts.bendAddressesProvider.getLendPoolConfigurator();

  await impersonateAccount(configurator);

  await setBalance(configurator, parseEther("1"));

  // approve bnft for staker manager
  await contracts.lendPoolLoan
    .connect(await ethers.getSigner(configurator))
    .approveFlashLoanLocker(contracts.stakeManager.address, true);

  await contracts.lendPoolLoan
    .connect(await ethers.getSigner(configurator))
    .approveLoanRepaidInterceptor(contracts.stakeManager.address, true);
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

  const bnftRegistry = await ethers.getContractAt("IBNFTRegistry", getParams(BNFT_REGISTRY, networkName));

  const apeCoin = await ethers.getContractAt("IERC20", getParams(APE_COIN, networkName));

  // bend protocol
  const bendAddressesProvider = await ethers.getContractAt(
    "ILendPoolAddressesProvider",
    getParams(BendAddressesProviders, networkName)
  );

  const lendPool = await ethers.getContractAt("ILendPool", await bendAddressesProvider.getLendPool());
  const lendPoolLoan = await ethers.getContractAt("ILendPoolLoan", await bendAddressesProvider.getLendPoolLoan());
  const debtWETH = await ethers.getContractAt("IDebtToken", getParams(BendDebtETH, networkName));

  const apeStaking = await ethers.getContractAt("IApeCoinStaking", getParams(APE_STAKING, networkName));

  const stakeProxy = await deployContract<IStakeProxy>("StakeProxy", []);

  const stakeManager = await deployContract("StakeManager", []);
  await stakeManager.initialize(
    bayc.address,
    mayc.address,
    bakc.address,
    bBayc.address,
    bMayc.address,
    apeCoin.address,
    weth.address,
    apeStaking.address,
    stakeProxy.address,
    bendAddressesProvider.address
  );

  const bendApeStaking = await deployContract("BendApeStaking", []);
  await bendApeStaking.initialize(
    bayc.address,
    mayc.address,
    bakc.address,
    bBayc.address,
    bMayc.address,
    apeCoin.address,
    stakeManager.address,
    bendAddressesProvider.address
  );

  const stakedVoting = await deployContract("BendApeStakedVoting", [stakeManager.address]);

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
    bnftRegistry,
    bendAddressesProvider,
    lendPool,
    lendPoolLoan,
    debtWETH,
    apeStaking,
    stakeProxy,
    stakeManager,
    bendApeStaking,
    stakedVoting,
  } as Contracts;
}

async function deployContract<ContractType extends Contract>(contractName: string, args: any[]): Promise<ContractType> {
  const instance = await (await ethers.getContractFactory(contractName)).deploy(...args);

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
