import { createPublicClient, http, erc20Abi, type Address } from 'viem';
import { baseSepolia, avalancheFuji } from 'viem/chains';

const wallets: Record<string, Address> = {
  GAS: '0xe32fB27E65F50C39aCc4329650C4cC7a7f668b0B',
  X402_AGENT: '0xA9A48d73f67b0c820fDE57c8B0639c6f850Ae96e',
};

const chainConfigs = [
  { chain: baseSepolia, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address, name: 'Base Sepolia' },
  { chain: avalancheFuji, usdc: '0x5425890298aed601595a70ab815c96711a31bc65' as Address, name: 'Avax Fuji' },
  {
    chain: {
      id: 5042002, name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
      rpcUrls: { default: { http: ['https://rpc.testnet.arc.network/c0ca2582063a5bbd5db2f98c139775e982b16919'] } },
    } as any,
    usdc: '0x3600000000000000000000000000000000000000' as Address,
    name: 'Arc Testnet',
  },
];

async function main() {
  for (const c of chainConfigs) {
    const client = createPublicClient({ chain: c.chain, transport: http() });
    for (const [name, addr] of Object.entries(wallets)) {
      const bal = await client.readContract({
        address: c.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [addr],
      });
      const eth = await client.getBalance({ address: addr });
      console.log(`${c.name} | ${name} (${addr.slice(0, 8)}...) | USDC: ${(Number(bal) / 1e6).toFixed(6)} | ETH: ${(Number(eth) / 1e18).toFixed(6)}`);
    }
  }
}

main().catch(console.error);
