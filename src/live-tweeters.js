const fs = require("fs");

const { fetchListTweets, retweet } = require("./twtr");
const { hasImageWithoutAltTextOrVideo } = require("./tweet-predicates");

const enabled = getEnabled();

function saveEnabled(userId, isEnabled) {
  enabled[userId] = isEnabled;
  fs.writeFileSync("enabled.json", JSON.stringify(enabled));
}

function getEnabled() {
  return JSON.parse(fs.readFileSync("enabled.json", "utf8"));
}

function getListRecord(listId) {
  let lastSeen;
  try {
    lastSeen = fs.readFileSync(`lists/${listId}.tweet`, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("No file found for list: " + listId);
      lastSeen = null;
    } else {
      throw err;
    }
  }

  return {
    id: listId,
    lastSeen: lastSeen
  };
}

function markLastTweetsSeen(list, tweets) {
  let last = tweets.sort(
    (t1, t2) => Date.parse(t2.created_at) - Date.parse(t1.created_at)
  )[0];

  fs.writeFileSync(`lists/${list.id}.tweet`, last.id_str);
  list.lastSeen = last.id_str;
}

function pollLiveTweeters(twtr, list) {
  return async () => {
    let newTweets = await fetchListTweets(twtr, list).catch(err => {
      console.log(err);
      return [];
    });

    let badTweets = newTweets.filter(hasImageWithoutAltTextOrVideo);
    badTweets.forEach(tweet => {
      if (enabled[tweet.user.id_str]) {
        retweet(twtr, tweet);
      }
    });

    if (newTweets.length > 0) {
      console.log(`Found ${newTweets.length} new tweets for list ${list.id}`);
      markLastTweetsSeen(list, newTweets);
    }
  };
}

exports.saveEnabled = saveEnabled;
exports.getListRecord = getListRecord;
exports.pollLiveTweeters = pollLiveTweeters;