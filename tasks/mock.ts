/* eslint-disable node/no-unsupported-features/es-syntax */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable node/no-missing-import */
import { constants } from "ethers";
import { task } from "hardhat/config";
import { IStakeMatcher } from "../typechain-types";
import { APE_COIN, BAKC, BAYC, getParams } from "./config";
import { getContractAddressFromDB, getContractFromDB, waitForTx } from "./utils/helpers";

task("mock:matchWithBakcAndCoin", "Mock matchWithBakcAndCoin")
  .addParam("argspath", "offers args")
  .setAction(async ({ argspath }, { ethers, network, run }) => {
    await run("set-DRE");
    // @ts-ignore
    const keys = await import("./keys");
    const args = await import(argspath);
    const utils = await import("../test/utils");

    const apeCoin = await ethers.getContractAt("IERC20", getParams(APE_COIN, network.name));

    const matcher = await getContractFromDB<IStakeMatcher>("BendStakeMatcher");

    const senderSigner = new ethers.Wallet(keys.findPrivateKey(args.sender), ethers.provider);
    const apeSigner = new ethers.Wallet(keys.findPrivateKey(args.apeOffer.staker), ethers.provider);
    const bakcSigner = new ethers.Wallet(keys.findPrivateKey(args.bakcOffer.staker), ethers.provider);
    const coinSigner = new ethers.Wallet(keys.findPrivateKey(args.coinOffer.staker), ethers.provider);

    const matcherContract = await getContractAddressFromDB("BendStakeMatcher");
    const apeContract = await ethers.getContractAt("MintableERC721", getParams(BAYC, network.name));
    const bakcContract = await ethers.getContractAt("MintableERC721", getParams(BAKC, network.name));
    const chainId = (await ethers.provider.getNetwork()).chainId;

    if (args.sender !== args.apeOffer.staker) {
      console.log("sign ape offer");
      const sig = await utils._signApeOffer(
        chainId,
        matcherContract,
        keys.findPrivateKey(args.apeOffer.staker),
        args.apeOffer
      );
      args.apeOffer.r = sig.r;
      args.apeOffer.s = sig.s;
      args.apeOffer.v = sig.v;
    }

    if (args.sender !== args.bakcOffer.staker) {
      console.log("sign bakc offer");
      const sig = await utils._signBakcOffer(
        chainId,
        matcherContract,
        keys.findPrivateKey(args.bakcOffer.staker),
        args.bakcOffer
      );
      args.bakcOffer.r = sig.r;
      args.bakcOffer.s = sig.s;
      args.bakcOffer.v = sig.v;
    }

    if (args.sender !== args.coinOffer.staker) {
      console.log("sign coin offer");
      const sig = await utils._signBakcOffer(
        chainId,
        matcherContract,
        keys.findPrivateKey(args.coinOffer.staker),
        args.coinOffer
      );
      args.coinOffer.r = sig.r;
      args.coinOffer.s = sig.s;
      args.coinOffer.v = sig.v;
    }

    console.log("approve ape coin for ape staker");
    await waitForTx(await apeCoin.connect(apeSigner).approve(matcherContract, constants.MaxUint256));
    console.log("approve ape coin for bakc staker");
    await waitForTx(await apeCoin.connect(bakcSigner).approve(matcherContract, constants.MaxUint256));
    console.log("approve ape coin for coin staker");
    await waitForTx(await apeCoin.connect(coinSigner).approve(matcherContract, constants.MaxUint256));

    console.log("approve ape nft");
    await waitForTx(await apeContract.connect(apeSigner).approve(matcherContract, args.apeOffer.tokenId));

    console.log("approve bakc nft");
    await waitForTx(await bakcContract.connect(bakcSigner).approve(matcherContract, args.bakcOffer.tokenId));

    console.log("match offers");
    await waitForTx(
      await matcher.connect(senderSigner).matchWithBakcAndCoin(args.apeOffer, args.bakcOffer, args.coinOffer)
    );
  });

task("mock:matchWithBakc", "Mock matchWithBakc")
  .addParam("argspath", "offers args")
  .setAction(async ({ argspath }, { ethers, network, run }) => {
    await run("set-DRE");
    // @ts-ignore
    const keys = await import("./keys");
    const args = await import(argspath);
    const utils = await import("../test/utils");

    const apeCoin = await ethers.getContractAt("IERC20", getParams(APE_COIN, network.name));

    const matcher = await getContractFromDB<IStakeMatcher>("BendStakeMatcher");

    const senderSigner = new ethers.Wallet(keys.findPrivateKey(args.sender), ethers.provider);
    const apeSigner = new ethers.Wallet(keys.findPrivateKey(args.apeOffer.staker), ethers.provider);
    const bakcSigner = new ethers.Wallet(keys.findPrivateKey(args.bakcOffer.staker), ethers.provider);

    const matcherContract = await getContractAddressFromDB("BendStakeMatcher");
    const apeContract = await ethers.getContractAt("MintableERC721", getParams(BAYC, network.name));
    const bakcContract = await ethers.getContractAt("MintableERC721", getParams(BAKC, network.name));
    const chainId = (await ethers.provider.getNetwork()).chainId;

    if (args.sender !== args.apeOffer.staker) {
      console.log("sign ape offer");
      const sig = await utils._signApeOffer(
        chainId,
        matcherContract,
        keys.findPrivateKey(args.apeOffer.staker),
        args.apeOffer
      );
      args.apeOffer.r = sig.r;
      args.apeOffer.s = sig.s;
      args.apeOffer.v = sig.v;
    }

    if (args.sender !== args.bakcOffer.staker) {
      console.log("sign bakc offer");
      const sig = await utils._signBakcOffer(
        chainId,
        matcherContract,
        keys.findPrivateKey(args.bakcOffer.staker),
        args.bakcOffer
      );
      args.bakcOffer.r = sig.r;
      args.bakcOffer.s = sig.s;
      args.bakcOffer.v = sig.v;
    }

    console.log("approve ape coin for ape staker");
    await waitForTx(await apeCoin.connect(apeSigner).approve(matcherContract, constants.MaxUint256));
    console.log("approve ape coin for bakc staker");
    await waitForTx(await apeCoin.connect(bakcSigner).approve(matcherContract, constants.MaxUint256));

    console.log("approve ape nft");
    await waitForTx(await apeContract.connect(apeSigner).approve(matcherContract, args.apeOffer.tokenId));

    console.log("approve bakc nft");
    await waitForTx(await bakcContract.connect(bakcSigner).approve(matcherContract, args.bakcOffer.tokenId));

    console.log("match offers");
    await waitForTx(await matcher.connect(senderSigner).matchWithBakc(args.apeOffer, args.bakcOffer));
  });

task("mock:matchWithCoin", "Mock matchWithCoin")
  .addParam("argspath", "offers args")
  .setAction(async ({ argspath }, { ethers, network, run }) => {
    await run("set-DRE");

    // @ts-ignore
    const keys = await import("./keys");
    const args = await import(argspath);
    const utils = await import("../test/utils");

    const apeCoin = await ethers.getContractAt("IERC20", getParams(APE_COIN, network.name));

    const matcher = await getContractFromDB<IStakeMatcher>("BendStakeMatcher");

    const senderSigner = new ethers.Wallet(keys.findPrivateKey(args.sender), ethers.provider);
    const apeSigner = new ethers.Wallet(keys.findPrivateKey(args.apeOffer.staker), ethers.provider);
    const coinSigner = new ethers.Wallet(keys.findPrivateKey(args.coinOffer.staker), ethers.provider);

    const matcherContract = await getContractAddressFromDB("BendStakeMatcher");
    const apeContract = await ethers.getContractAt("MintableERC721", getParams(BAYC, network.name));
    const chainId = (await ethers.provider.getNetwork()).chainId;

    if (args.sender !== args.apeOffer.staker) {
      console.log("sign ape offer");
      const sig = await utils._signApeOffer(
        chainId,
        matcherContract,
        keys.findPrivateKey(args.apeOffer.staker),
        args.apeOffer
      );
      args.apeOffer.r = sig.r;
      args.apeOffer.s = sig.s;
      args.apeOffer.v = sig.v;
    }

    if (args.sender !== args.coinOffer.staker) {
      console.log("sign coin offer");
      const sig = await utils._signBakcOffer(
        chainId,
        matcherContract,
        keys.findPrivateKey(args.coinOffer.staker),
        args.coinOffer
      );
      args.coinOffer.r = sig.r;
      args.coinOffer.s = sig.s;
      args.coinOffer.v = sig.v;
    }

    console.log("approve ape coin for ape staker");
    await waitForTx(await apeCoin.connect(apeSigner).approve(matcherContract, constants.MaxUint256));
    console.log("approve ape coin for coin staker");
    await waitForTx(await apeCoin.connect(coinSigner).approve(matcherContract, constants.MaxUint256));

    console.log("approve ape nft");
    await waitForTx(await apeContract.connect(apeSigner).approve(matcherContract, args.apeOffer.tokenId));

    console.log("match offers");
    await waitForTx(await matcher.connect(senderSigner).matchWithCoin(args.apeOffer, args.coinOffer));
  });
