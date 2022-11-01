import { task } from "hardhat/config";
import { IStakeManager } from "../typechain-types";
import {
  APE_COIN,
  APE_STAKING,
  BAKC,
  BAYC,
  bBAYC,
  BendAddressesProviders,
  bMAYC,
  FEE,
  FEE_RECIPIENT,
  getParams,
  MAYC,
  WETH,
} from "./config";
import {
  deployContract,
  deployProxyContract,
  getContractAddressFromDB,
  getContractFromDB,
  getDeploySigner,
  waitForTx,
} from "./utils/helpers";

task("deploy:full", "Deploy all contracts").setAction(async (_, { run }) => {
  await run("set-DRE");
  await run("compile");

  await run("deploy:StakeProxy");
  await run("deploy:StakeManager");
  await run("deploy:BendStakeMatcher");
  await run("deploy:Config");
});

task("deploy:StakeProxy", "Deploy StakeProxy").setAction(async (_, { run }) => {
  await run("set-DRE");
  await run("compile");
  await deployContract("StakeProxy", [], true);
});

task("deploy:StakeManager", "Deploy StakeManager").setAction(async (_, { network, run }) => {
  await run("set-DRE");
  await run("compile");
  // configs
  const weth = getParams(WETH, network.name);

  const apeCoin = getParams(APE_COIN, network.name);
  const bayc = getParams(BAYC, network.name);
  const bBayc = getParams(bBAYC, network.name);
  const mayc = getParams(MAYC, network.name);
  const bMayc = getParams(bMAYC, network.name);
  const bakc = getParams(BAKC, network.name);
  const bendAddressesProvider = getParams(BendAddressesProviders, network.name);
  const apeStaking = getParams(APE_STAKING, network.name);
  const stakerProxy = await getContractAddressFromDB("StakeProxy");
  await deployProxyContract(
    "StakeManager",
    [bayc, mayc, bakc, bBayc, bMayc, apeCoin, weth, apeStaking, stakerProxy, bendAddressesProvider],
    true
  );
});

task("deploy:BendStakeMatcher", "Deploy BendStakeMatcher").setAction(async (_, { network, run }) => {
  await run("set-DRE");
  await run("compile");
  // configs
  const apeCoin = getParams(APE_COIN, network.name);
  const bayc = getParams(BAYC, network.name);
  const bBayc = getParams(bBAYC, network.name);
  const mayc = getParams(MAYC, network.name);
  const bMayc = getParams(bMAYC, network.name);
  const bakc = getParams(BAKC, network.name);
  const bendAddressesProvider = getParams(BendAddressesProviders, network.name);

  const stakeManager = await getContractAddressFromDB("StakeManager");
  await deployProxyContract(
    "BendStakeMatcher",
    [bayc, mayc, bakc, bBayc, bMayc, apeCoin, stakeManager, bendAddressesProvider],
    true
  );
});

task("deploy:Config", "Config Contracts").setAction(async (_, { network, run }) => {
  await run("set-DRE");
  await run("compile");

  const deployer = await getDeploySigner();

  const stakeManager = await getContractFromDB<IStakeManager>("StakeManager");
  const bendStakeMatcher = getContractAddressFromDB("BendStakeMatcher");

  const fee = getParams(FEE, network.name);
  const feeRecipient = getParams(FEE_RECIPIENT, network.name);

  // config contracts
  await waitForTx(await stakeManager.connect(deployer).setMatcher(bendStakeMatcher));
  await waitForTx(await stakeManager.connect(deployer).updateFee(fee));
  await waitForTx(await stakeManager.connect(deployer).updateFeeRecipient(feeRecipient));
});
