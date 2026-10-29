# Gift NFTs (optional, off by default)

People can turn a gift they received into a collectible NFT on Base, from
their own wallet. It costs ViktorychApp nothing to run:

- **Lazy minting.** Nothing is minted ahead of time. The person who received
  the gift mints it and their wallet pays the network fee. The contract takes
  no money: no sale, price, royalty or withdraw function.
- **No server keys.** The Worker only tells the app the public contract
  address (`GET /v1/nft/config`). It never signs or sends a transaction. No
  private key, seed phrase or wallet secret belongs in this repo, in chat or in
  Worker secrets.
- **No paid services.** The wallet talks to the chain. The app only names the
  public Base RPC (`https://mainnet.base.org`) when it asks a wallet to add
  the network. Metadata and art are served from our Pages site
  (`nft/<index>.json`, `icons/gifts/<id>.webp`).
- **Content-addressed art.** Each metadata file lists the image's sha256 and
  its IPFS CID (CIDv1, raw leaves), so anyone can pin the exact file for free
  and check it matches.
- **Our own art only.** Only the 75 illustrations marked SAFE TO SELL in
  [GIFTS-LICENSES.md](GIFTS-LICENSES.md) are offered (`NFT_ART` in
  `nft-ui.js`). Noto emoji gifts and limited editions are never offered.
- **Collectibles only.** Not an investment. ViktorychApp never buys one back,
  pays out for one, or turns Viktorychs into money. No card data is involved.
- **Gifts work without a wallet.** The button only appears on your own
  received gifts when the switch is on and a contract is set. Minting doesn't
  change, move or hide the gift in the app.

## How it works

1. In your gifts, tap **Make it an NFT** and confirm the notice.
2. The app asks the wallet (EIP-1193: a wallet browser or extension) for an
   account and switches it to Base.
3. The token id is `sha256("viktorych-gift-nft:v1:" + giftRecordId + ":" + art)`.
   The record id is random and only shown to the recipient, so in practice
   only they can mint it, and each gift can be minted once.
4. The wallet sends `mint(bytes32 key, uint16 art)` with no value. The
   metadata is `<base>/<art>.json`.

Limits, honestly: the chain can't check app accounts. Anyone who learns a
gift's record id could mint that gift first, and anyone can call `mint` with
their own made-up key to get a copy of an art piece. That is acceptable for
free collectibles with no cash value. Do not sell them or promise scarcity.

## Owner steps (once)

Nothing here needs a server key. You deploy from your own wallet and pay the
one-time deploy fee yourself.

1. Test first on Base Sepolia. In a browser wallet (for example Coinbase
   Wallet or MetaMask), add Base Sepolia and get free test ETH from a faucet.
2. Open https://remix.ethereum.org, create `ViktorychGiftNFT.sol` and paste
   [`contracts/ViktorychGiftNFT.sol`](../contracts/ViktorychGiftNFT.sol).
3. In **Solidity compiler**, pick 0.8.24 or newer and compile. Remix fetches
   OpenZeppelin 5.0.2 from the import lines.
4. In **Deploy & run**, set the environment to **Injected Provider**
   (your wallet, on Base Sepolia). Constructor values:
   - `baseURI_`: `https://viktorychgroup.github.io/ViktorychApp/nft/`
   - `artCount_`: `75`
   Click **Deploy** and confirm in the wallet. Copy the contract address.
5. Set the address and chain on the Worker (a public address, but kept as a
   Worker setting so it isn't hard-coded). From `worker/`:
   ```sh
   npx wrangler secret put NFT_CONTRACT   # paste the 0x… address
   npx wrangler secret put NFT_CHAIN_ID   # 84532 for Base Sepolia
   ```
6. In the app, open **Settings**, turn on **Gift NFTs**, then try minting
   one of your own received gifts.
7. When it works, repeat steps 2 to 5 on **Base** (mainnet) and set
   `NFT_CHAIN_ID` to `8453`.

To turn it off at any time, switch **Gift NFTs** off in Settings. NFTs that
were already minted stay in people's wallets.

### Adding art later

Append new ids to the end of `NFT_ART` in `nft-ui.js` (never reorder or
remove ids), run `node scripts/build_nft_meta.mjs`, ship the site, then call
`setArtCount(<new total>)` from the deploying wallet in Remix.

### Optional: free IPFS copy

Each `nft/<index>.json` lists `image_ipfs`. To keep a copy on IPFS for free,
pin the images with any free pinning service or your own IPFS node, using
`ipfs add --cid-version=1 --raw-leaves icons/gifts/<id>.webp`. The CID will
match. The app never depends on IPFS.
