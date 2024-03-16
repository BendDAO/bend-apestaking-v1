export enum Network {
  sepolia = "sepolia",
  goerli = "goerli",
  mainnet = "mainnet",
}

export interface Params<T> {
  [Network.sepolia]: T;
  [Network.goerli]: T;
  [Network.mainnet]: T;
}

export const getParams = <T>({ sepolia, goerli, mainnet }: Params<T>, network: string): T => {
  network = Network[network as keyof typeof Network];
  switch (network) {
    case Network.sepolia:
      return sepolia;
    case Network.goerli:
      return goerli;
    case Network.mainnet:
      return mainnet;
    default:
      return goerli;
  }
};

const INFURA_KEY = process.env.INFURA_KEY || "";
const ALCHEMY_KEY = process.env.ALCHEMY_KEY || "";

export const NETWORKS_RPC_URL: Params<string> = {
  [Network.sepolia]: ALCHEMY_KEY
    ? `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`
    : `https://goerli.infura.io/v3/${INFURA_KEY}`,
  [Network.goerli]: ALCHEMY_KEY
    ? `https://eth-goerli.g.alchemy.com/v2/${ALCHEMY_KEY}`
    : `https://goerli.infura.io/v3/${INFURA_KEY}`,
  [Network.mainnet]: ALCHEMY_KEY
    ? `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`
    : `https://mainnet.infura.io/v3/${INFURA_KEY}`,
};

export const FEE: Params<string> = {
  [Network.sepolia]: "100",
  [Network.goerli]: "100",
  [Network.mainnet]: "400",
};

export const FEE_RECIPIENT: Params<string> = {
  [Network.sepolia]: "0x0e9d6B6B7CEfc88f12ef214eeC5A3DAddB0dD3FD",
  [Network.goerli]: "0x10855337e1b0D2d11F8f59Ba4b04EC8792A58B61",
  [Network.mainnet]: "0x472FcC65Fab565f75B1e0E861864A86FE5bcEd7B",
};

export const WETH: Params<string> = {
  [Network.sepolia]: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  [Network.goerli]: "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6",
  [Network.mainnet]: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
};

export const APE_COIN: Params<string> = {
  [Network.sepolia]: "0x88a2B5Cb33dF5cf2b06214d55E2e26d8Fe418aE6",
  [Network.goerli]: "0x701ca86a355dA5E32b70a9c7e8967B4DFaa735dB",
  [Network.mainnet]: "0x4d224452801ACEd8B2F0aebE155379bb5D594381",
};

export const APE_COIN_HOLDER: Params<string> = {
  [Network.sepolia]: "0xafF5C36642385b6c7Aaf7585eC785aB2316b5db6",
  [Network.goerli]: "0xafF5C36642385b6c7Aaf7585eC785aB2316b5db6",
  [Network.mainnet]: "",
};

export const APE_STAKING: Params<string> = {
  [Network.sepolia]: "0xeecE96DD81B84c8a1670Cb5FB04D8386D61C1333",
  [Network.goerli]: "0xa1d0e0Ac6D1300F47caC9083b23D07F62bB1F833",
  [Network.mainnet]: "0x5954aB967Bc958940b7EB73ee84797Dc8a2AFbb9",
};

export const BAYC: Params<string> = {
  [Network.sepolia]: "0xE15A78992dd4a9d6833eA7C9643650d3b0a2eD2B",
  [Network.goerli]: "0x30d190032A34d6151073a7DB8793c01Aa05987ec",
  [Network.mainnet]: "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d",
};

export const bBAYC: Params<string> = {
  [Network.sepolia]: "0x32c1505FDD059cD03687c105709d0cC8B0c60A0C",
  [Network.goerli]: "0x529710d1e2ab61bDea707039bB841583A983b228",
  [Network.mainnet]: "0xDBfD76AF2157Dc15eE4e57F3f942bB45Ba84aF24",
};

export const MAYC: Params<string> = {
  [Network.sepolia]: "0xD0ff8ae7E3D9591605505D3db9C33b96c4809CDC",
  [Network.goerli]: "0x15596C27900e12A9cfC301248E21888751f61c19",
  [Network.mainnet]: "0x60E4d786628Fea6478F785A6d7e704777c86a7c6",
};

export const bMAYC: Params<string> = {
  [Network.sepolia]: "0xa2C80A3428A84805a01f52f59B98E3Cf7cc7d690",
  [Network.goerli]: "0xe7BD47E781e8758420Df9992ADD1f5ab31555fF7",
  [Network.mainnet]: "0x69f37e419bD1457d2a25ed3f5d418169caAe8D1F",
};

export const BAKC: Params<string> = {
  [Network.sepolia]: "0xE8636AFf2F1Cf508988b471d7e221e1B83873FD9",
  [Network.goerli]: "0x49EdA925C67387b4597F4b41817Aaade0542EeD5",
  [Network.mainnet]: "0xba30E5F9Bb24caa003E9f2f0497Ad287FDF95623",
};

export const BNFT_REGISTRY: Params<string> = {
  [Network.sepolia]: "0x694b86Deef7C2C06d4C40A07a5995815C444170D",
  [Network.goerli]: "0x37A76Db446bDB3EF1b73112a8D5E6868de06464f",
  [Network.mainnet]: "0x79d922DD382E42A156bC0A354861cDBC4F09110d",
};

export const BendAddressesProviders: Params<string> = {
  [Network.sepolia]: "0x95e84AED75EB9A545D817c391A0011E0B34EAf5C",
  [Network.goerli]: "0x1cba0A3e18be7f210713c9AC9FE17955359cC99B",
  [Network.mainnet]: "0x24451f47caf13b24f4b5034e1df6c0e401ec0e46",
};

export const BendDebtETH: Params<string> = {
  [Network.sepolia]: "0x9ca8943Fb310d2c06DFB4D27Ea3d566B4bdC0971",
  [Network.goerli]: "0x9aB83A4886dCE3C0c1011f9D248249DD3eF64784",
  [Network.mainnet]: "0x87ddE3A3f4b629E389ce5894c9A1F34A7eeC5648",
};

export const MIN_COMPOUND_PARAMS: Params<number[]> = {
  [Network.sepolia]: [10, 360],
  [Network.goerli]: [10, 360],
  [Network.mainnet]: [100, 3600],
};
