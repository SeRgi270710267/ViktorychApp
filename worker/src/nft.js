/* Gift NFTs: the Worker only tells the app which contract and chain to use.
   It holds no keys and sends no transactions; people mint from their own
   wallet and pay the network fee. The "nft" feature is off by default, and the
   route answers empty until the owner turns it on (see feature-flags.js).
   NFT_CONTRACT is a public contract address, set by the owner:
     npx wrangler secret put NFT_CONTRACT
   NFT_CHAIN_ID is 8453 (Base) by default, or 84532 (Base Sepolia) for testing. */

export const NFT_CHAINS = [8453, 84532];

export function nftConfig(env) {
  const contract = String((env && env.NFT_CONTRACT) || "").trim();
  const chainId = Number((env && env.NFT_CHAIN_ID) || 8453);
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract) || !NFT_CHAINS.includes(chainId)) return { ready: false };
  return { ready: true, contract: contract.toLowerCase(), chainId };
}

export function handleNft(request, env, deps) {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (path === "/v1/nft/config" && request.method === "GET") {
    return deps.json(200, nftConfig(env), { "cache-control": "public, max-age=300" });
  }
  return deps.json(404, { error: "not_found" });
}
