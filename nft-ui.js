/* Optional "Make it an NFT" for gifts. Off by default: it shows only when the
   owner turns on the "nft" server feature AND sets the contract address on the
   Worker. Lazy minting: nothing is minted until the person asks, and their own
   wallet (any EIP-1193 wallet on Base) sends the transaction and pays the fee.
   We hold no keys, run no RPC and take no money. Gifts work without a wallet.
   Collectibles only: no resale, cash-out or investment promises from us.
   See docs/gift-nfts.md. */
(function (root) {
  "use strict";

  /* Gifts whose art is ours and marked SAFE TO SELL in the license audit.
     Append-only: a token stores the index into this list, so never reorder
     or remove an entry. New art goes at the end, plus nft/<index>.json. */
  var NFT_ART = ["alien_monster","balloon","bat","bear","beating_heart","black_cat","blow_kiss","bouquet","cake","candle","candy","cat_love","cat_smile","chestnut","chipmunk","comet","crown","crystal_ball","cupid","dog","doughnut","fox","frog","gem","ghost","gift_heart","hamster","heart","heart_eyes","hedgehog","hot_drink","hug","imp","kiss","koala","leaf","lion","lollipop","love_letter","magic_wand","maple","monkey","mushroom","octopus","otter","panda","party_popper","penguin","pie","poodle","present","pumpkin","ring","rocket","rose","seal","skull","sloth","snowman","spark","sparkling_heart","spider","star","sunflower","thanks","trophy","turtle","two_hearts","umbrella","unicorn","vampire","web","witch_broom","xmas_tree","zombie"];

  /* Function selectors (first 4 bytes of keccak256 of the signature). */
  var SEL_MINT = "0xe9dbe8d5"; /* mint(bytes32,uint16) */
  var SEL_OWNER_OF = "0x6352211e"; /* ownerOf(uint256) */
  var CHAINS = {
    8453: { chainId: "0x2105", chainName: "Base", rpcUrls: ["https://mainnet.base.org"], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: ["https://basescan.org"] },
    84532: { chainId: "0x14a34", chainName: "Base Sepolia", rpcUrls: ["https://sepolia.base.org"], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: ["https://sepolia.basescan.org"] }
  };

  var config = null;
  var loading = null;
  var busy = false;

  function tr(key, vars) {
    var fn = root.t || function (k) { return k; };
    var text = fn(key);
    if (vars) Object.keys(vars).forEach(function (name) { text = text.split("{" + name + "}").join(String(vars[name])); });
    return text;
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function toast(message) {
    var el = root.document && root.document.getElementById("toast");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 3200);
  }

  function artIndex(artId) { return NFT_ART.indexOf(String(artId || "")); }

  /* The server feature list is synced by app.js; unknown means off. */
  function featureOn() {
    try { return !!(root.ViktorychServerFeature && root.ViktorychServerFeature("nft")); } catch (err) { return false; }
  }

  function validConfig(body) {
    if (!body || !/^0x[0-9a-fA-F]{40}$/.test(String(body.contract || ""))) return null;
    var chain = Number(body.chainId) || 0;
    if (!CHAINS[chain]) return null;
    return { contract: String(body.contract).toLowerCase(), chainId: chain };
  }

  function loadConfig() {
    if (config || loading || !featureOn()) return loading || Promise.resolve(config);
    if (!root.ViktorychAccounts || !root.ViktorychAccounts.call) return Promise.resolve(null);
    loading = root.ViktorychAccounts.call("/v1/nft/config", {}).then(function (body) {
      config = validConfig(body);
      loading = null;
      if (config && root.GiftNFT.onReady) root.GiftNFT.onReady();
      return config;
    }).catch(function () { loading = null; return null; });
    return loading;
  }

  /* The button for one of your own received gifts. Empty unless the feature
     is on, the contract is set, and the gift's art is on the safe list. */
  function buttonHtml(gift) {
    if (!gift || !featureOn()) return "";
    if (!config) { loadConfig(); return ""; }
    var art = gift.giftId || gift.gift_id || "";
    if (artIndex(art) < 0 || !gift.id) return "";
    return '<button type="button" class="gift-nft" data-gift-nft="' + esc(gift.id) + '" data-art="' + esc(art) + '">' + esc(tr("Make it an NFT")) + "</button>";
  }

  function hex32(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return out;
  }
  function pad32(hexNoPrefix) {
    var text = String(hexNoPrefix);
    while (text.length < 64) text = "0" + text;
    return text;
  }

  /* One token per received gift: sha256 of a fixed prefix, the gift's id and
     its art. The gift id is random and private to the recipient's account. */
  function tokenKey(giftId, art) {
    var data = new TextEncoder().encode("viktorych-gift-nft:v1:" + giftId + ":" + art);
    return root.crypto.subtle.digest("SHA-256", data).then(function (buf) { return hex32(new Uint8Array(buf)); });
  }

  function mintData(keyHex, index) {
    return SEL_MINT + pad32(keyHex) + pad32(index.toString(16));
  }

  function request(provider, method, params) {
    return provider.request({ method: method, params: params || [] });
  }

  function useChain(provider, chainId) {
    var info = CHAINS[chainId];
    return request(provider, "eth_chainId").then(function (current) {
      if (parseInt(current, 16) === chainId) return null;
      return request(provider, "wallet_switchEthereumChain", [{ chainId: info.chainId }]).catch(function (err) {
        if (err && (err.code === 4902 || (err.data && err.data.originalError && err.data.originalError.code === 4902))) {
          return request(provider, "wallet_addEthereumChain", [info]);
        }
        throw err;
      });
    });
  }

  function alreadyMinted(provider, keyHex) {
    return request(provider, "eth_call", [{ to: config.contract, data: SEL_OWNER_OF + pad32(keyHex) }, "latest"])
      .then(function (result) { return !!result && !/^0x0*$/.test(result); })
      .catch(function () { return false; });
  }

  function mint(giftId, art) {
    if (busy) return Promise.resolve("busy");
    var index = artIndex(art);
    if (!config || index < 0) return Promise.resolve("off");
    var provider = root.ethereum;
    if (!provider || typeof provider.request !== "function") {
      toast(tr("No wallet found. Open this page in your wallet app's browser, or add a wallet extension."));
      return Promise.resolve("nowallet");
    }
    var notice = tr("This makes a collectible NFT of this gift on {chain}. Your wallet pays the network fee. It is a collectible, not an investment, and we never buy it back or pay out for it. Your gift stays here either way.", { chain: CHAINS[config.chainId].chainName });
    if (root.confirm && !root.confirm(notice)) return Promise.resolve("cancelled");
    busy = true;
    var from = "";
    var key = "";
    return request(provider, "eth_requestAccounts").then(function (accounts) {
      from = accounts && accounts[0];
      if (!from) throw new Error("no account");
      return useChain(provider, config.chainId);
    }).then(function () {
      return tokenKey(giftId, art);
    }).then(function (keyHex) {
      key = keyHex;
      return alreadyMinted(provider, key);
    }).then(function (minted) {
      if (minted) { toast(tr("This gift is already an NFT.")); return "minted-before"; }
      toast(tr("Confirm in your wallet…"));
      return request(provider, "eth_sendTransaction", [{ from: from, to: config.contract, data: mintData(key, index), value: "0x0" }]).then(function (hash) {
        try { root.localStorage.setItem("gift-nft:" + giftId, String(hash || "")); } catch (err) { /* private mode */ }
        toast(tr("Sent to the network. It shows in your wallet once it is confirmed."));
        return "sent";
      });
    }).catch(function (err) {
      toast(err && err.code === 4001 ? tr("Cancelled.") : tr("Couldn't make this gift an NFT."));
      return "error";
    }).then(function (result) { busy = false; return result; });
  }

  function onClick(event) {
    var el = event.target && event.target.closest ? event.target.closest("[data-gift-nft]") : null;
    if (!el) return;
    event.preventDefault();
    mint(el.getAttribute("data-gift-nft"), el.getAttribute("data-art"));
  }

  root.GiftNFT = { NFT_ART: NFT_ART, artIndex: artIndex, buttonHtml: buttonHtml, mintData: mintData, tokenKey: tokenKey, validConfig: validConfig, mint: mint, loadConfig: loadConfig, onReady: null };
  if (root.document && root.document.addEventListener) {
    root.document.addEventListener("click", onClick);
    /* Fetch the contract once, a little after start, only when the feature is on. */
    root.setTimeout(function () { loadConfig(); }, 4000);
  }
})(typeof window !== "undefined" ? window : globalThis);
