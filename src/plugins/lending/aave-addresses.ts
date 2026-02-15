/** Aave V3 contract addresses per chain */
export interface AaveV3Addresses {
  pool: `0x${string}`;
  poolAddressesProvider: `0x${string}`;
  uiPoolDataProvider: `0x${string}`;
}

export const AAVE_V3_ADDRESSES: Record<string, AaveV3Addresses> = {
  ethereum: {
    pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    poolAddressesProvider: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
    uiPoolDataProvider: "0x3F78BBD206e4D3c504Eb854232EdA7e47E9Fd8FC",
  },
  arbitrum: {
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    uiPoolDataProvider: "0x145dE30c929a065582da84Cf96F88460dB9745A7",
  },
  polygon: {
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    uiPoolDataProvider: "0x68100bD5345eA474D93577127C11F39FF8463e93",
  },
  base: {
    pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    poolAddressesProvider: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
    uiPoolDataProvider: "0x174446a6741300cD2E7C1b1A636Fee99c8F83502",
  },
  optimism: {
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    uiPoolDataProvider: "0x91c0eA31b49B69Ea18607702c5d9aC360bf3dE7d",
  },
  avalanche: {
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    uiPoolDataProvider: "0xdBbFaFc45B7E4B5CD4400eda05F0951AEb1f0d24",
  },
};

export function getSupportedLendingChains(): string[] {
  return Object.keys(AAVE_V3_ADDRESSES);
}
