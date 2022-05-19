const twitter = require("twitter-api-client");
const twtrHook = require("twitter-autohook");
const fetch = require("node-fetch");
const OAuth = require("oauth-1.0a");
const crypto = require("crypto");

const {
  ts,
  fetchImage,
  readLocalImage,
  extractMessageMedia,
  extractTargets,
  getTweetImagesAndAlts,
  splitText
} = require("./util");
const {
  saveEnabled,
  pollLiveTweeters,
  getListRecord
} = require("./live-tweeters");
const {
  tweet,
  reply,
  getTweet,
  sendDM,
  replyChain,
  uploadImageWithAltText
} = require("./twtr");
const { ocr, ocrRaw, ocrTweetImages } = require("./ocr");
const { checkUserTweets, checkTweet } = require("./check");
const {
  hashImage,
  fetchAltText,
  fetchAltTextForTweet
} = require("./alt-text-org");
const { analyzeUrls, getUrls } = require("./analyze-links");

const config = {
  list: process.env.LIST,
  myUser: process.env.USER,
  twitterClientConfig: {
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    apiKey: process.env.TWITTER_CONSUMER_KEY,
    apiSecret: process.env.TWITTER_CONSUMER_SECRET,
    disableCache: true
  },
  twitterToken: {
    key: process.env.TWITTER_ACCESS_TOKEN,
    secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
  },
  activityApiConfig: {
    token: process.env.TWITTER_ACCESS_TOKEN,
    token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    oauth_token: process.env.TWITTER_ACCESS_TOKEN,
    oauth_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    ngrok_secret: process.env.NGROK_SECRET,
    env: "prod"
  }
};

const auxOCRImages = [
  "img/more-alt-text-1.png",
  "img/more-alt-text-2.png",
  "img/more-alt-text-3.png"
];

async function ocrDMCmd(twtr, oauth, msg, text) {
  let reply = [];
  let foundTarget = false;
  let targets = await extractTargets(text);
  let rawImage = await extractMessageMedia(oauth, config.twitterToken, msg);
  if (rawImage) {
    foundTarget = true;
    let imageOcr = await ocrRaw(rawImage)
      .catch()
      .catch(e => {
        console.log("Error OCRing image: " + JSON.stringify(e));
        return null;
      });
    if (imageOcr) {
      reply.push(imageOcr);
    } else {
      reply.push("Couldn't extract text from attached image");
    }
  } else if (targets.web.size > 0) {
    foundTarget = true;
    for (const url of targets.web) {
      let imgOcr = await ocr(url);
      if (imgOcr) {
        reply.push(`${url}: ${imgOcr}`);
      } else {
        reply.push(`${url}: No text extracted`);
      }
    }
  } else if (targets.tweet.size > 0) {
    foundTarget = true;
    for (const tweetId of targets.tweet) {
      let tweet = await getTweet(twtr, tweetId);
      if (tweet) {
        let ocrs = await ocrTweetImages(twtr, tweet);
        let annotated = ocrs.map(
          ocr => `${tweet.user.screen_name}/${tweetId}: ${ocr.text}`
        );
        reply.push(...annotated);
      } else {
        reply.push(`Couldn't fetch tweet: ${tweetId}`);
      }
    }
  }

  if (!foundTarget) {
    reply.push("I don't see anything to OCR");
  }

  return reply;
}

async function checkDMCmd(twtr, text) {
  let reply = [];
  let foundTarget = false;
  let targets = await extractTargets(text);

  if (targets.tweet.size > 0) {
    foundTarget = true;
    let checks = await Promise.all(
      Array.from(targets.tweet).map(tweetId => checkTweet(twtr, tweetId))
    );

    checks.forEach(check => reply.push(...check));
  }

  if (targets.user.size > 0) {
    foundTarget = true;
    let checks = await Promise.all(
      Array.from(targets.user).map(userName => checkUserTweets(twtr, userName))
    );

    reply.push(...checks);
  }

  let chunks = text.match(/check\s+(.+)/i);
  if (chunks && chunks.length > 1) {
    let split = chunks[1].split(/\s+/g);
    let toCheck = split.filter(item => item.match(/^@?\w+$/));
    foundTarget = foundTarget || toCheck.length > 0;
    let checks = await Promise.all(
      toCheck.map(userName => checkUserTweets(twtr, userName))
    );

    reply.push(...checks);
  }

  if (!foundTarget) {
    reply.push("I don't see anything to check");
  }

  return reply;
}

async function fetchDMCmd(twtr, oauth, msg, text) {
  let reply = [];
  let foundTarget = false;
  let targets = await extractTargets(text);
  let rawImage = await extractMessageMedia(oauth, config.twitterToken, msg);
  if (rawImage) {
    foundTarget = true;
    let hash = hashImage(rawImage);
    let lang = text.match(/fetch (..)(?:\s|$)/i) || [null, "en"];
    let alts = await fetchAltText(hash, null, lang[1]);
    if (alts.length > 0) {
      reply.push(alts[0]);
    } else {
      reply.push("Attached image: No saved description found");
    }
  }

  if (targets.tweet.size > 0) {
    foundTarget = true;
    let fetched = await Promise.all(
      Array.from(targets.tweet).flatMap(async tweetId =>
        fetchAltTextForTweet(twtr, tweetId)
      )
    );

    reply.push(...fetched);
  }

  if (!foundTarget) {
    reply.push("I don't see anything to check");
  }

  return reply;
}

const help = `Tweet/Reply commands: 
To use these, tag the bot in either the tweet to be examined or a reply to that tweet. If a tweet is a reply, only the parent will be processed. 
Save: Saves alt text to the alt-text.org database for any images on the tweet or its parent.
OCR: Attempts tp extract text from the images on a tweet or its parent.
Analyze links: Produces a report on alt text usage for any linked websites.
Explain: Respond with a quick explanation of alt text and how to add it.

DM Commands:
fetch <images or tweets>: Searches the alt-text.org database for alt text for an image or the images on a tweet.
ocr <images or tweets>: Attempts to extract text from an image or the images on a tweet.
check <tweets or users>: Checks a tweet for alt text on images, or produces a report on a user's alt text usage.
help: Print this help message.`;

async function handleDMEvent(twtr, oauth, msg) {
  if (msg.type && msg.type === "message_create") {
    if (
      msg.message_create &&
      msg.message_create.sender_id !== config.myUser &&
      msg.message_create.message_data &&
      msg.message_create.message_data.text
    ) {
      let text = msg.message_create.message_data.text.trim();
      console.log(`Found DM text: '${text}'`);

      let reply = [];
      if (text.toUpperCase() === "PAUSE") {
        saveEnabled(msg.message_create.sender_id, false);
        reply.push("Pausing boost of tweets without alt text");
        tweet(
          twtr,
          msg.message_create.sender_id,
          (name, username) => `${name} (@${username}) is signing off.`
        );
      } else if (text.toUpperCase() === "START") {
        saveEnabled(msg.message_create.sender_id, true);
        reply.push("Beginning boost of tweets without alt text");
        tweet(
          twtr,
          msg.message_create.sender_id,
          (name, username) =>
            `${name} (@${username}) is going live. Please reply to this tweet if you're able to assist them with descriptions.`
        );
      } else if (text.match(/^ocr/i)) {
        let ocrReply = await ocrDMCmd(twtr, oauth, msg, text);
        reply.push(...ocrReply);
      } else if (text.match(/^check/i)) {
        let checkReply = await checkDMCmd(twtr, text);
        reply.push(...checkReply);
      } else if (text.match(/^fetch/i)) {
        reply.push("Fetch is currently disabled, please contact @hbeckpdx with any questions")
        //let fetched = await fetchDMCmd(twtr, oauth, msg, text);
        //reply.push(...fetched);
      } else if (text.match(/^help/i)) {
        reply.push(help);
      } else {
        console.log("Got non-understood DM: '" + text + "'");
        reply.push(
          "Unknown command. Try 'help' for a full list of commands. DM @hbeckpdx with questions."
        );
      }

      await Promise.all(
        reply.map(dm => sendDM(twtr, msg.message_create.sender_id, dm))
      );
    }
  }
}

function splitOcrReply(ocrs) {
  return ocrs.flatMap((ocr, imgIdx) => {
    let ocrSplit = splitText(ocr.text, 200);
    return ocrSplit.map(
      (segment, segmentIdx) =>
        `Image ${imgIdx + 1}/${ocrs.length}\nPart ${segmentIdx + 1}/${
          ocrSplit.length
        }:\n${segment}`
    );
  });
}

const explain = `Alt text allows people who can't see images to know what's in them

What in your image is needed to enable someone who can't see it to be a full participant in the conversation?

To add it click "Add Description" in browser or "+Alt" on mobile`;

async function handleMention(twtr, oauth, tweet) {
  if (tweet.user.id_str === "1374555039528669184") {
    console.log(`${ts()}: Got tweetId ${tweet.id_str}, but it was from me`);
    return;
  } else if (tweet.retweeted_status) {
    console.log(`${ts()}: Got tweetId ${tweet.id_str}, but it was a retweet`);
    return;
  }

  let text;
  if (tweet.extended_tweet && tweet.extended_tweet.full_text) {
    text = tweet.extended_tweet.full_text;
  } else if (tweet.text) {
    text = tweet.text;
  } else {
    console.log(
      `${ts()}: Got tweet ${tweet.id_str} with no text??? ${JSON.stringify(
        tweet
      )}`
    );
  }

  if (!text.match(/@AltTextCrew/i)) {
    console.log(
      `${ts()}: Got mention, but it didn't actually contain my name.`
    );
    return;
  }

  let targetTweet = null;
  let tweetTargetStr = null;
  if (tweet.quoted_status_id_str) {
    tweetTargetStr = "quoted tweet";
    targetTweet = await getTweet(twtr, tweet.quoted_status_id_str);
  } else if (tweet.in_reply_to_status_id_str) {
    tweetTargetStr = "parent tweet";
    targetTweet = await getTweet(twtr, tweet.in_reply_to_status_id_str);
  } else {
    tweetTargetStr = "tweet";
    targetTweet = await getTweet(twtr, tweet.id_str);
  }

  if (!targetTweet) {
    await reply(
      twtr,
      tweet.id_str,
      tweet.user.screen_name,
      "Couldn't fetch tweet, is the account private?"
    );
    return;
  }

  let cmdReply = [];
  if (text.match(/(ocr)|(extract text)/i)) {
    let ocrs = await ocrTweetImages(twtr, targetTweet);
    if (ocrs) {
      let splitOcrs = ocrs.map(ocr => {
        return {
          img: ocr.img,
          text: ocr.text,
          split: splitText(ocr.text, 1000)
        };
      });

      let auxImageIdx = 0;
      let imageGroups = [];
      let uploadFailures = false;
      for (let i = 0; i < splitOcrs.length; i++) {
        let ocrRecord = splitOcrs[i];
        let imageRecord = await fetchImage(ocrRecord.img);
        if (imageRecord) {
          let origMediaId = await uploadImageWithAltText(
            twtr,
            imageRecord.data,
            ocrRecord.split[0]
          );

          if (!origMediaId) {
            uploadFailures = true;
          }

          let uploadsForImage = [
            { mediaId: origMediaId, text: ocrRecord.split[0] }
          ];

          for (let j = 1; j < ocrRecord.split.length; j++) {
            let auxImage = readLocalImage(auxOCRImages[auxImageIdx]);
            auxImageIdx++;
            auxImageIdx = auxImageIdx % 3;
            let auxMediaId = await uploadImageWithAltText(
              twtr,
              auxImage.data,
              ocrRecord.split[j]
            );

            if (!auxMediaId) {
              uploadFailures = true;
            }

            uploadsForImage.push({
              mediaId: auxMediaId,
              text: ocrRecord.split[j]
            });
          }

          imageGroups.push(uploadsForImage);
        } else {
          console.log(
            `${ts()}: Failed to fetch image ${ocrRecord.img}. Tweet: ${
              tweet.user.screen_name
            }/${tweet.id_str}`
          );
          break;
        }
      }

      let totalImagesToUpload = imageGroups
        .map(group => group.length)
        .reduce((prev, cur) => prev + cur);
      console.log(`Image groups: ${JSON.stringify(imageGroups)}`);

      if (uploadFailures) {
        console.log(
          `${ts()}: Failed to upload images for response to ${
            tweet.user.screen_name
          }/${tweet.id_str}`
        );
        cmdReply.push(
          "Failed to re-upload images, if the problem persists please contact @hbeckpdx"
        );
      } else {
        if (totalImagesToUpload <= 4) {
          cmdReply.push({
            text: "Extracted text in image descriptions.",
            media: imageGroups.flatMap(group => group.map(img => img.mediaId))
          });
        } else {
          let tweetNum = 1;
          let numTweets = imageGroups
            .map(
              group =>
                Math.floor(group.length / 4) + (group.length % 4 === 0 ? 0 : 1)
            )
            .reduce((prev, curr) => prev + curr);

          imageGroups.forEach((group, idx) => {
            for (let idxStart = 0; idxStart < group.length; idxStart += 4) {
              cmdReply.push({
                text: `Extracted text in image descriptions. Reply ${tweetNum}/${numTweets}`,
                media: group
                  .slice(idxStart, idxStart + 4)
                  .map(img => img.mediaId)
              });
              tweetNum++;
            }
          });
        }
      }
    } else {
      console.log(
        `${ts()}: No images found on tweet ${tweet.user.screen_name}/${
          tweet.id_str
        }`
      );
      cmdReply.push("No images found to OCR");
    }
  } else if (text.match(/analyze link(s?)/i)) {
    let urls = getUrls(targetTweet);
    if (urls.length === 0) {
      cmdReply.push(
        `Hmm, I don't see any links to analyze on ${tweetTargetStr}.`
      );
    } else {
      let analysis = await analyzeUrls(urls, tweetTargetStr);
      cmdReply.push(...analysis);
    }
  } else if (text.match(/save/i)) {
    let imagesAndAlts = getTweetImagesAndAlts(targetTweet);
    let sent = 0;
    for (const [image, alt] of Object.entries(imagesAndAlts)) {
      fetch("https://api.alt-text.org/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          image_url: image,
          language: targetTweet.lang || "en",
          alt_text: alt,
          id_scope: "twitter",
          author_id: targetTweet.user.id_str
        })
      }).catch(e =>
        console.log(
          `Failed to save description for ${targetTweet.user.screen_name}/${targetTweet.id_str}: ${e}`
        )
      );
    }
  } else if (text.match(/explain/i)) {
    if (targetTweet.id_str === tweet.id_str) {
      cmdReply.push(explain);
    } else {
      cmdReply.push(`@${targetTweet.user.screen_name} ` + explain);
    }
  } else {
    console.log(
      `${ts()}: Got tweet ${tweet.user.screen_name}/${
        tweet.id_str
      }, but it didn't contain a command. Text: ${text}`
    );
    return;
  }

  if (cmdReply.length > 0) {
    await replyChain(twtr, cmdReply, tweet.id_str, tweet.user.screen_name);
  } else {
    console.log(`${ts()}: Command '${text}' processed, but no reply generated`);
  }
}

function handleEvent(twtr, oauth) {
  return async event => {
    if (event.direct_message_events && event.direct_message_events.forEach) {
      // console.log(`Got webhook event: ${JSON.stringify(event)}`);
      event.direct_message_events.forEach(msg =>
        handleDMEvent(twtr, oauth, msg)
      );
    } else if (event.tweet_create_events && event.tweet_create_events.forEach) {
      // console.log(`Got webhook event: ${JSON.stringify(event)}`);
      event.tweet_create_events.forEach(tweet =>
        handleMention(twtr, oauth, tweet)
      );
    }
  };
}

async function checkWebhook(hook) {
  console.log("Webhooks: " + JSON.stringify(await hook.getWebhooks()));
}

async function startMonitor(twtr, oauth) {
  const hook = new twtrHook.Autohook(config.activityApiConfig);
  await hook.removeWebhooks();
  hook.on("event", handleEvent(twtr, oauth));
  await hook.start();
  await hook.subscribe(config.activityApiConfig);
  return hook;
}

async function run() {
  const twtr = new twitter.TwitterClient(config.twitterClientConfig);
  let list = getListRecord(config.list);
  console.log("Found list:");
  console.log(list);

  const oauth = OAuth({
    consumer: {
      key: config.twitterClientConfig.apiKey,
      secret: config.twitterClientConfig.apiSecret
    },
    signature_method: "HMAC-SHA1",
    hash_function(base_string, key) {
      return crypto
        .createHmac("sha1", key)
        .update(base_string)
        .digest("base64");
    }
  });

  startMonitor(twtr, oauth)
    .catch(err => {
      console.log(err);
    });
  setInterval(pollLiveTweeters(twtr, list), 3000);
}

run();
