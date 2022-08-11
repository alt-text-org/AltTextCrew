const { ts } = require("./util");

async function tweet(twtr, userId, contentFun) {
  await twtr.accountsAndUsers
    .usersShow({
      user_id: userId,
      "user.fields": "name,username"
    })
    .then(async user => {
      let content = contentFun(user.name, user.screen_name);
      console.log(`${ts()}: Tweeting '${content}'`);
      return await twtr.tweets.statusesUpdate({
        status: content
      });
    })
    .catch(err => {
      console.log(err);
      return null;
    });
}

async function retweet(twtr, tweet, qtStatus) {
  let tweetLink = `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`;
  console.log(`Retweeting '${tweetLink}' with status '${qtStatus}'`);
  return await twtr.tweets
    .statusesUpdate({
      status: qtStatus,
      attachment_url: tweetLink
    })
    .catch(err => {
      console.log(err);
      return null;
    });
}

async function fetchListTweets(twtr, list) {
  let params;
  if (list.lastSeen) {
    params = {
      list_id: list.id,
      since_id: list.lastSeen,
      include_rts: false,
      include_entities: true,
      include_ext_alt_text: true,
      tweet_mode: "extended"
    };
  } else {
    params = {
      list_id: list.id,
      include_rts: false,
      include_entities: true,
      include_ext_alt_text: true,
      count: 1,
      tweet_mode: "extended"
    };
  }

  return twtr.accountsAndUsers.listsStatuses(params);
}

async function sendDM(twtr, userId, message) {
  await twtr.directMessages
    .eventsNew({
      event: {
        type: "message_create",
        message_create: {
          target: {
            recipient_id: userId
          },
          message_data: {
            text: message
          }
        }
      }
    })
    .catch(err => {
      console.log("DM Error: " + JSON.stringify(err));
    });
  console.log(`${ts()}: DMing: ${message}`);
}

async function getUserId(twtr, userName) {
  const result = await twtr.accountsAndUsers
    .usersShow({
      screen_name: userName
    })
    .catch(e => {
      console.log(JSON.stringify(e));
      return null;
    });
  if (result) {
    return result.id_str;
  } else {
    return null;
  }
}

async function getTweets(twtr, userId, limit) {
  let tweets = [];
  let batch = await twtr.tweets.statusesUserTimeline({
    user_id: userId,
    count: limit < 200 ? limit : 200,
    include_rts: false,
    include_ext_alt_text: true,
    tweet_mode: "extended"
  });
  batch.forEach(tweet => tweets.push(tweet));

  return tweets;
}

async function getTweet(twtr, tweetId) {
  console.log(`${ts()}: Attempting to fetch tweetId: '${tweetId}'`);
  return await twtr.tweets
    .statusesShow({
      id: tweetId,
      include_entities: true,
      trim_user: false,
      include_ext_alt_text: true,
      tweet_mode: "extended"
    })
    .catch(err => {
      console.log(
        `${ts()}: Fetch tweetId ${tweetId} failed: '${JSON.stringify(err)}'`
      );
      return null;
    });
}

async function reply(twtr, replyToId, replyToUsername, body) {
  console.log(
    `Got body to reply: ${JSON.stringify(body)} of type ${typeof body}`
  );
  if (typeof body === "string") {
    body = {
      text: body,
      quoted: null,
      media: null
    };
  }

  let request = {
    status: `@${replyToUsername} ${body.text}`,
    in_reply_to_status_id: replyToId
  };

  if (body.media) {
    request.media_ids = body.media.join(",");
  }

  if (body.quoted) {
    request.attachment_url = body.quoted;
  }

  console.log(
    `${ts()}: Replying ${body.text.replace(
      "\n",
      "\\n"
    )} media: ${body.media ? body.media.join(
      ","
    ) : "N/A"} to tweet ${replyToId} and username ${replyToUsername}`
  );
  return await twtr.tweets
    .statusesUpdate(request)
    .then(resp => {
      return resp.id_str;
    })
    .catch(err => {
      console.log(err);
      return replyToId;
    });
}

async function replyChain(twtr, split, replyToId, replyToUsername) {
  if (split.length === 1) {
    return await reply(twtr, replyToId, replyToUsername, split[0]);
  } else {
    let replyChainId = replyToId;
    let replyChainUsername = replyToUsername;
    for (let i = 0; i < split.length; i++) {
      let message = null;
      if (typeof split[i] === "string") {
        message =
          replyChainUsername === replyToUsername
            ? split[i]
            : `@${replyToUsername} ${split[i]}`;
      } else {
        message = {
          text:
            (replyChainUsername === replyToUsername
              ? split[i].text
              : `@${replyToUsername} ${split[i].text}`),
          media: split[i].media,
          quoted: split[i].quoted
        };
      }

      replyChainId = await reply(twtr, replyChainId, replyChainUsername, message);
      replyChainUsername = "AltTextUtil";
    }
  }
}

async function uploadMedia(twtr, mediaBytes) {
  return await twtr.media
    .mediaUpload({ media_data: mediaBytes })
    .then(resp => {
      return resp.media_id_string;
    })
    .catch(err => {
      console.log(`${ts()}: Failed to upload media: ${JSON.stringify(err)}`);
      return null;
    });
}

async function setAltText(twtr, mediaId, altText) {
  return twtr.media.mediaMetadataCreate({
    media_id: mediaId,
    alt_text: { text: altText }
  });
}

async function uploadImageWithAltText(twtr, mediaBytes, altText) {
  let mediaId = await uploadMedia(twtr, mediaBytes);
  if (!mediaId) {
    return null;
  }

  await setAltText(twtr, mediaId, altText);
  return mediaId;
}

exports.tweet = tweet;
exports.retweet = retweet;
exports.fetchListTweets = fetchListTweets;
exports.sendDM = sendDM;
exports.getUserId = getUserId;
exports.getTweets = getTweets;
exports.getTweet = getTweet;
exports.reply = reply;
exports.replyChain = replyChain;
exports.uploadMedia = uploadMedia;
exports.setAltText = setAltText;
exports.uploadImageWithAltText = uploadImageWithAltText;
