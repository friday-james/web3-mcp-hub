export const STETH_ADDRESS: `0x${string}` =
  "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";

export const WSTETH_ADDRESSES: Record<string, `0x${string}`> = {
  ethereum: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  arbitrum: "0x5979D7b546E38E414F7E9822514be443A4800529",
  optimism: "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb",
  base: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
  polygon: "0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD",
};

export function getSupportedLidoChains(): string[] {
  return Object.keys(WSTETH_ADDRESSES);
}
