// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Gift NFTs for ViktorychApp. Lazy minting: nothing exists until a person
// mints a gift they received, from their own wallet, paying the network fee.
// The contract takes no money, has no sale, royalty or withdraw function, and
// holds no funds. Deploy steps are in docs/gift-nfts.md (an owner step).
//
// Token id = the app's sha256 key for one received gift, so each gift can be
// minted once. art = index into the app's append-only art list; the metadata
// is baseURI + art + ".json" (nft/<index>.json on the Pages site).

import "@openzeppelin/contracts@5.0.2/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts@5.0.2/access/Ownable.sol";
import "@openzeppelin/contracts@5.0.2/utils/Strings.sol";

contract ViktorychGiftNFT is ERC721, Ownable {
    string private baseURI;
    uint16 public artCount;
    mapping(uint256 => uint16) public artOf;

    constructor(string memory baseURI_, uint16 artCount_) ERC721("Viktorych Gifts", "VGIFT") Ownable(msg.sender) {
        baseURI = baseURI_;
        artCount = artCount_;
    }

    // Selector 0xe9dbe8d5. Reverts if this gift was already minted.
    function mint(bytes32 giftKey, uint16 art) external {
        require(art < artCount, "unknown art");
        uint256 id = uint256(giftKey);
        artOf[id] = art;
        _mint(msg.sender, id);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return string.concat(baseURI, Strings.toString(artOf[id]), ".json");
    }

    // New art is appended in the app first, then the owner raises the count.
    function setArtCount(uint16 count) external onlyOwner {
        require(count > artCount, "append only");
        artCount = count;
    }

    // Only if the site moves; the metadata path stays <base><index>.json.
    function setBaseURI(string calldata base) external onlyOwner {
        baseURI = base;
    }
}
