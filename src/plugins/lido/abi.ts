/** stETH contract ABI — submit(referral) is payable, sends ETH and receives stETH */
export const STETH_ABI = [
  {
    name: "submit",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "_referral", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** wstETH contract ABI — wrap stETH→wstETH, unwrap wstETH→stETH */
export const WSTETH_ABI = [
  {
    name: "wrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_stETHAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "unwrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_wstETHAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
