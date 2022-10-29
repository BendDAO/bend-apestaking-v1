import { task } from "hardhat/config";
import { MintableERC721 } from "../typechain-types";
import { deployContract, waitForTx } from "./utils/helpers";

task("mock:BAKC", "Mock BAKC").setAction(async (_, { run }) => {
  await run("set-DRE");
  await run("compile");
  const bakc = await deployContract<MintableERC721>("MintableERC721", ["BendDAO Mock BAKC", "BAKC"], true, "BAKC");
  waitForTx(await bakc.setBaseURI("ipfs://QmTDcCdt3yb6mZitzWBmQr65AW6Wska295Dg9nbEYpSUDR/"));
});
