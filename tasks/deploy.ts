/* eslint-disable @typescript-eslint/ban-ts-comment */
import { task } from "hardhat/config";
import { utils } from "ethers";
import { IBendApeCoin } from "../typechain-types";
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
  MIN_COMPOUND_PARAMS,
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
import { verifyEtherscanContract } from "./utils/verification";

task("deploy:full", "Deploy all contracts").setAction(async (_, { run }) => {
  await run("set-DRE");
  await run("compile");

  await run("deploy:StakeProxy");
  await run("deploy:StakeManager");
  await run("deploy:BendApeStaking");
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
  const stakeProxy = await getContractAddressFromDB("StakeProxy");
  await deployProxyContract(
    "StakeManager",
    [bayc, mayc, bakc, bBayc, bMayc, apeCoin, weth, apeStaking, stakeProxy, bendAddressesProvider],
    true
  );
});

task("deploy:BendApeCoin", "Deploy BendApeCoin").setAction(async (_, { network, run }) => {
  await run("set-DRE");
  await run("compile");
  const apeCoin = getParams(APE_COIN, network.name);
  const apeStaking = getParams(APE_STAKING, network.name);
  const stakeManager = await getContractAddressFromDB("StakeManager");
  await deployProxyContract("BendApeCoin", [apeStaking, apeCoin, stakeManager], true);
});

task("deploy:config:BendApeCoin", "Coinfig BendApeCoin").setAction(async (_, { network, run }) => {
  await run("set-DRE");
  await run("compile");
  const deployer = await getDeploySigner();
  const bendApeCoin = await getContractFromDB<IBendApeCoin>("BendApeCoin");

  const fee = getParams(FEE, network.name);
  const feeRecipient = getParams(FEE_RECIPIENT, network.name);
  const minCompound = getParams(MIN_COMPOUND_PARAMS, network.name);

  await waitForTx(await bendApeCoin.connect(deployer).updateFee(fee));
  await waitForTx(await bendApeCoin.connect(deployer).updateFeeRecipient(feeRecipient));
  await waitForTx(
    await bendApeCoin.connect(deployer).updateMinCompoundAmount(utils.parseUnits(minCompound[0].toString(), 18))
  );
  await waitForTx(await bendApeCoin.connect(deployer).updateMinCompoundInterval(minCompound[1]));
});

task("deploy:BendApeStaking", "Deploy BendApeStaking").setAction(async (_, { network, run }) => {
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
    "BendApeStaking",
    [bayc, mayc, bakc, bBayc, bMayc, apeCoin, stakeManager, bendAddressesProvider],
    true
  );
});

task("prepareUpgrade", "Deploy new implmentation for upgrade")
  .addParam("proxyid", "The proxy contract id")
  .addParam("implid", "The new impl contract id")
  .setAction(async ({ proxyid, implid }, { ethers, upgrades, run }) => {
    await run("set-DRE");
    await run("compile");
    const proxyAddress = await getContractAddressFromDB(proxyid);
    const upgradeable = await ethers.getContractFactory(implid);
    console.log(`Preparing ${proxyid} upgrade at proxy ${proxyAddress}`);
    // @ts-ignore
    const implAddress = await upgrades.prepareUpgrade(proxyAddress, upgradeable);
    console.log("Implmentation at:", implAddress);
    const adminAddress = await upgrades.erc1967.getAdminAddress(proxyAddress);
    console.log("Proxy admin at:", adminAddress);
    await verifyEtherscanContract(implAddress.toString(), []);
  });

task("upgrade", "upgrade contract")
  .addParam("proxyid", "The proxy contract id")
  .addOptionalParam("implid", "The new impl contract id")
  .addOptionalParam("skipcheck", "Skip upgrade storage check or not")
  .setAction(async ({ skipcheck, proxyid, implid }, { ethers, upgrades, run }) => {
    await run("set-DRE");
    await run("compile");
    if (!implid) {
      implid = proxyid;
    }
    const proxyAddress = await getContractAddressFromDB(proxyid);
    const upgradeable = await ethers.getContractFactory(implid);
    console.log(`Preparing upgrade proxy ${proxyid}: ${proxyAddress} with new ${implid}`);
    // @ts-ignore
    const upgraded = await upgrades.upgradeProxy(proxyAddress, upgradeable, { unsafeSkipStorageCheck: !!skipcheck });
    await upgraded.deployed();
    const implAddress = await upgrades.erc1967.getImplementationAddress(upgraded.address);
    console.log("New implmentation at: ", implAddress);
    await verifyEtherscanContract(implAddress, []);
  });

task("forceImport", "force import implmentation to proxy")
  .addParam("proxy", "The proxy address")
  .addParam("implid", "The new impl contract id")
  .setAction(async ({ proxy, implid }, { ethers, upgrades, run }) => {
    await run("set-DRE");
    await run("compile");
    const upgradeable = await ethers.getContractFactory(implid);
    console.log(`Import proxy: ${proxy} with ${implid}`);
    // @ts-ignore
    await upgrades.forceImport(proxy, upgradeable);
  });
