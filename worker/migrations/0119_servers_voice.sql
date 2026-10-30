-- Native Messages servers, phase 3: voice and video. Media is peer to peer, so
-- nothing about calls is stored; @everyone gains Connect, Speak and Video
-- (65536 | 131072 | 262144) in servers created before voice existed.
UPDATE srv_roles SET perms = perms | 458752 WHERE id = server_id;
