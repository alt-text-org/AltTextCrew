const twitter = require("twitter-api-client");
const twtrHook = require("twitter-autohook");
const OAuth = require("oauth-1.0a");
const crypto = require("crypto");

const {
    ts,
    fetchImage,
    extractMessageMedia,
    extractTargets,
    getTweetImagesAndAlts,
    splitText
} = require("./src/util");
const {
    saveEnabled,
    pollLiveTweeters,
    getListRecord
} = require("./src/live-tweeters");
const {
    tweet,
    reply,
    getTweet,
    sendDM,
    replyChain,
    uploadImageWithAltText
} = require("./src/twtr");
const {ocr, ocrRaw, ocrTweetImages, getAuxImage, getResponseText} = require("./src/ocr");
const {checkUserTweets, checkTweet} = require("./src/check");
const {
    saveAltTextForImage,
    fetchAltTextForTweet,
    fetchAltTextForBase64
} = require("./src/alt-text-org");
const {analyzeUrls, getUrls} = require("./src/analyze-links");

const config = {
    list: process.env.LIST,
    myUser: process.env.USER,
    writeToken: process.env.API_WRITER_TOKEN,
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
        let lang = text.match(/fetch (..)(?:\s|$)/i) || [null, "en"];
        let alts = await fetchAltTextForBase64(rawImage, lang[1]);
        console.log(JSON.stringify(alts))
        if (alts) {
            if (alts.ocr) {
                reply.push(`Extracted text: ${alts.ocr}`)
            }

            alts.exact.forEach(alt => reply.push(
                `Attached image (exact): ${alt.alt_text}`
            ))

            alts.fuzzy.forEach(alt => {
                if (!alts.exact.some(exact => exact.sha256 === alt.sha256) && alt.score >= 0.98) {
                    reply.push(
                        `Attached image (Similarity ${Math.floor(alt.score * 100)}%): ${alt.alt_text}`
                    )
                }
            })

            if (reply.length === 0) {
                reply.push("Attached image: No saved description found");
            }
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
            } else if (text.match(/^(ocr)|(extract text)/i)) {
                let ocrReply = await ocrDMCmd(twtr, oauth, msg, text);
                reply.push(...ocrReply);
            } else if (text.match(/^check/i)) {
                let checkReply = await checkDMCmd(twtr, text);
                reply.push(...checkReply);
            } else if (text.match(/^fetch/i)) {
                let fetched = await fetchDMCmd(twtr, oauth, msg, text);
                reply.push(...fetched);
            } else if (text.match(/^help/i)) {
                reply.push(help);
            } else {
                console.log("Got non-understood DM: '" + text + "'");
                reply.push(
                    "Unknown command. Try 'help' for a full list of commands. DM @HBeckPDX with questions."
                );
            }

            await Promise.all(
                reply.map(dm => sendDM(twtr, msg.message_create.sender_id, dm))
            );
        }
    }
}

async function handleOcrMention(twtr, tweet, targetTweet, cmdReply) {
    let ocrs = await ocrTweetImages(twtr, targetTweet);
    if (ocrs) {
        let splitOcrs = ocrs.map(ocr => ({
            img: ocr.img,
            text: ocr.text,
            locale: ocr.locale,
            split: splitText(ocr.text, 1000)
        }));

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
                    {mediaId: origMediaId, text: ocrRecord.split[0]}
                ];

                for (let j = 1; j < ocrRecord.split.length; j++) {
                    let auxImage = getAuxImage(ocrRecord.locale, j + 1, ocrRecord.split.length);
                    auxImageIdx++;
                    auxImageIdx = auxImageIdx % 3;
                    let auxMediaId = await uploadImageWithAltText(
                        twtr,
                        auxImage,
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
                "Failed to re-upload images, if the problem persists please contact @HBeckPDX"
            );
        } else {
            if (totalImagesToUpload <= 4) {
                cmdReply.push({
                    text: getResponseText(splitOcrs),
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

                imageGroups.forEach((group) => {
                    for (let idxStart = 0; idxStart < group.length; idxStart += 4) {
                        cmdReply.push({
                            text: `${getResponseText(splitOcrs)} ${tweetNum}/${numTweets}`,
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
}

async function getTargetTweet(twtr, bareTweet, needsImages) {
    let targetTweet;
    let tweetTargetStr = "tweet";


    if (needsImages) {
        let images;
        let tweet;

        tweet = await getTweet(twtr, bareTweet.id_str);
        images = tweet ? Object.keys(getTweetImagesAndAlts(tweet)) : []
        console.log(`Images in tweet: ${images.length}`)
        if (images.length > 0) {
            return {
                targetTweet: tweet,
                tweetTargetStr: "tweet"
            }
        }

        if (bareTweet.quoted_status_id_str) {
            tweet = await getTweet(twtr, bareTweet.quoted_status_id_str);
            images = tweet ? Object.keys(getTweetImagesAndAlts(tweet)) : []
            console.log(`Images in quoted tweet: ${images.length}`)
            if (images.length > 0) {
                return {
                    targetTweet: tweet,
                    tweetTargetStr: "quoted tweet"
                }
            }
        }

        if (bareTweet.in_reply_to_status_id_str) {
            tweet = await getTweet(twtr, bareTweet.in_reply_to_status_id_str);
            images = tweet ? Object.keys(getTweetImagesAndAlts(tweet)) : []
            console.log(`Images in parent tweet: ${images.length}`)
            if (images.length > 0) {
                return {
                    targetTweet: tweet,
                    tweetTargetStr: "parent tweet"
                }
            }

            if (tweet && tweet.quoted_status_id_str) {
                tweet = await getTweet(twtr, tweet.quoted_status_id_str);
                images = tweet ? Object.keys(getTweetImagesAndAlts(tweet)) : []
                console.log(`Images in parent tweet's quoted tweet: ${images.length}`)
                if (images.length > 0) {
                    return {
                        targetTweet: tweet,
                        tweetTargetStr: "parent tweet's quoted tweet"
                    }
                }
            }
        }

        console.log(`${ts()}: Needed image, but none found for ${bareTweet.user.id_str}/${bareTweet.id_str}`)
        return {
            targetTweet: null,
            tweetTargetStr: tweetTargetStr
        }
    } else {
        if (bareTweet.quoted_status_id_str) {
            tweetTargetStr = "quoted tweet";
            targetTweet = await getTweet(twtr, bareTweet.quoted_status_id_str);
        } else if (bareTweet.in_reply_to_status_id_str) {
            tweetTargetStr = "parent tweet";
            targetTweet = await getTweet(twtr, bareTweet.in_reply_to_status_id_str);
        } else {
            tweetTargetStr = "tweet";
            targetTweet = await getTweet(twtr, bareTweet.id_str);
        }

        return {targetTweet, tweetTargetStr}
    }
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

    if (!text.match(/@AltTextUtil/i)) {
        console.log(
            `${ts()}: Got mention, but it didn't actually contain my name.`
        );
        return;
    }

    const {targetTweet, targetTweetStr} = await getTargetTweet(twtr, tweet, text.match(/(ocr)|(extract text)|(save)/i))

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
        await handleOcrMention(twtr, tweet, targetTweet, cmdReply)
    } else if (text.match(/analyze link(s?)/i)) {
        let urls = getUrls(targetTweet);
        if (urls.length === 0) {
            cmdReply.push(
                `Hmm, I don't see any links to analyze on ${targetTweetStr}.`
            );
        } else {
            let analysis = await analyzeUrls(urls, targetTweetStr);
            cmdReply.push(...analysis);
        }
    } else if (text.match(/save/i)) {
        console.log(`${ts()}: Got save request: ${text} for ${targetTweet.user.screen_name}/${targetTweet.id_str}`)
        const imagesAndAlts = getTweetImagesAndAlts(targetTweet);
        console.log(`Found ${JSON.stringify(imagesAndAlts)}`)
        for (const [imageUrl, alt] of Object.entries(imagesAndAlts)) {
            console.log(`Attempting to save alt text for '${imageUrl}'`)
            let sent = await saveAltTextForImage(config.writeToken, imageUrl, targetTweet.lang, alt, targetTweet.user.id_str)
            console.log(`${ts()}: Saved alt text for ${imageUrl}: ${sent}`)
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
