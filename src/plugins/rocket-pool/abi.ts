export const RETH_ADDRESS: `0x${string}` = "0xae78736Cd615f374D3085123A210448E74Fc6393";
export const ROCKET_DEPOSIT_POOL: `0x${string}` = "0xDD3f50F8A6CafbE9b31a427582963f465E745AF8";

export const RETH_ABI = [
  {
    name: "getExchangeRate",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "burn",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_rethAmount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "getTotalCollateral",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const DEPOSIT_POOL_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
] as const;
