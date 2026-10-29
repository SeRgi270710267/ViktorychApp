-- Our profiles are no longer published to the fediverse: drop the ActivityPub
-- follower list and clear any actor keys. Nostr NIP-05 settings stay.
DROP TABLE IF EXISTS ap_followers;
UPDATE account_federation SET enabled_ap = 0, ap_public_key_pem = '', ap_private_key_pem = '';
