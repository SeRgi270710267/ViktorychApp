/* Tune the on-device For You score here. The numbers match the public
   Heavy Ranker weights: each one multiplies a local 0..1 estimate. */

const WEIGHTS = {
  like: 0.5,
  repost: 1,
  reply: 13.5,
  authorReply: 75,
  profileClick: 12,
  conversationClick: 11,
  longDwell: 10,
  videoWatch: 0.3,
  negative: -74,
  report: -369,
  oonShare: 0.15,
  windowSize: 20,
  maxAuthorInWindow: 2,
  maxAuthorRun: 2,
  decayHalfLifeHours: 18,
  fatigueDrops: 3,
  maxPerAuthorCandidates: 4
};

export { WEIGHTS };
globalThis.ForYouWeights = WEIGHTS;
