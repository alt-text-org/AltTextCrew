const { getUserId, getTweets, getTweet } = require("./twtr");
const { hasImage, hasImageWithoutAltText } = require("./tweet-predicates");
const { getTweetImagesAndAlts } = require("./util");

async function checkUserTweets(twtr, screenName) {
  if (!screenName.match(/^@/)) {
    screenName = "@" + screenName;
  }

  let userId = await getUserId(twtr, screenName);
  if (userId) {
    let userTweets = await getTweets(twtr, userId, 200);
    let hasImages = userTweets.filter(t => hasImage(t));
    let hasNoAlt = hasImages.filter(t => hasImageWithoutAltText(t));

    return `User: ${screenName}: Checked ${userTweets.length} tweets and found ${hasImages.length} with images, of which ${hasNoAlt.length} were missing alt text.`;
  } else {
    return `User: ${screenName}: Couldn't find user`;
  }
}

async function checkTweet(twtr, tweetId) {
  let reply = [];
  let tweet = await getTweet(twtr, tweetId);
  if (tweet) {
    let texts = Object.values(getTweetImagesAndAlts(tweet));
    if (texts.length > 0) {
      texts.forEach((text, idx) => {
        if (text) {
          reply.push(`Image ${idx + 1}/${texts.length}: ${text}`);
        } else {
          reply.push(`Image ${idx + 1}/${texts.length}: No alt text provided`);
        }
      });
    } else {
      reply.push("I don't see any images on that tweet");
    }
  } else {
    reply.push(`Couldn't fetch tweet: ${tweetId}`);
  }

  return reply;
}

exports.checkUserTweets = checkUserTweets;
exports.checkTweet = checkTweet;
