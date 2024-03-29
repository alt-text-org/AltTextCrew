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
    uploadImageWithAltText, uploadMedia
} = require("./src/twtr");
const {ocr, ocrRaw, ocrTweetImages, getAuxImage, getResponseText} = require("./src/ocr");
const {checkUserTweets, checkTweet} = require("./src/check");
const {
    saveAltTextForImage,
    fetchAltTextForTweet,
    fetchAltTextForBase64, fetchAltTextForUrl
} = require("./src/alt-text-org");
const {analyzeUrls, getUrls} = require("./src/analyze-links");
const {describeRaw, describeUrl, describeTweetImages} = require("./src/describe");

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
    },
    azure: {
        descriptionKey: process.env.AZURE_KEY,
        descriptionEndpoint: process.env.AZURE_DESCRIPTION_ENDPOINT
    }
};

async function describeDMCmd(twtr, oauth, msg, text) {
    let reply = [];
    let targets = await extractTargets(text);
    let rawImage = await extractMessageMedia(oauth, config.twitterToken, msg);

    if (rawImage) {
        const description = await describeRaw(config.azure.descriptionEndpoint, config.azure.descriptionKey, rawImage)
        if (description) {
            reply.push(description);
        } else {
            reply.push("Couldn't describe attached image");
        }
    } else if (targets.web.size > 0) {
        for (const url of targets.web) {
            const description = await describeUrl(config.azure.descriptionEndpoint, config.azure.descriptionKey, url)
            if (description) {
                reply.push(`${url}: ${description}`);
            } else {
                reply.push(`${url}: No description found`);
            }
        }
    } else if (targets.tweet.size > 0) {
        for (const tweetId of targets.tweet) {
            let tweet = await getTweet(twtr, tweetId);
            if (tweet) {
                const descriptions = await describeTweetImages(config.azure.descriptionEndpoint, config.azure.descriptionKey, tweet);
                let annotated = descriptions.map(
                    desc => `${tweet.user.screen_name}'s tweet: ${desc.text}`
                );
                reply.push(...annotated);
            } else {
                reply.push(`Couldn't fetch tweet: ${tweetId}`);
            }
        }
    } else {
        reply.push("I don't see anything to describe");
    }

    return reply;
}

async function ocrDMCmd(twtr, oauth, msg, text) {
    let ocrTexts = [];
    let targets = await extractTargets(text);
    let rawImage = await extractMessageMedia(oauth, config.twitterToken, msg);
    if (rawImage) {
        let imageOcr = await ocrRaw(rawImage)
            .catch(err => {
                console.log("Error OCRing raw image");
                console.log(err)
                return null;
            });
        if (imageOcr) {
            ocrTexts.push(imageOcr);
        } else {
            ocrTexts.push("Couldn't extract text from attached image");
        }
    } else if (targets.web.size > 0) {
        for (const url of targets.web) {
            let imgOcr = await ocr(url);
            if (imgOcr) {
                ocrTexts.push(imgOcr);
            } else {
                ocrTexts.push(`${url}: No text extracted`);
            }
        }
    } else if (targets.tweet.size > 0) {
        for (const tweetId of targets.tweet) {
            let tweet = await getTweet(twtr, tweetId);
            if (tweet) {
                let ocrs = await ocrTweetImages(twtr, tweet);
                ocrTexts.push(...ocrs);
            } else {
                ocrTexts.push(`Couldn't fetch tweet: ${tweetId}`);
            }
        }
    } else {
        ocrTexts.push("I don't see anything to OCR");
    }

    if (text.match(/one reply/i)) {
        return ocrTexts.map(ocr => {
            if (ocr.text) {
                return ocr.text
            } else {
                return ocr
            }
        })
    }

    const reply = []
    for (let text of ocrTexts) {
        if (text.text) {
            if (text.text.length > 1000) {
                const split = splitText(text.text, 1000)
                reply.push(split[0])
                for (let i = 1; i < split.length; i++) {
                    const image = getAuxImage(text.locale, i + 1, split.length)
                    const auxMediaId = await uploadMedia(twtr, image);
                    if (auxMediaId) {
                        reply.push({
                            text: split[i],
                            mediaId: auxMediaId
                        })
                    } else {
                        reply.push("Image upload failed. Text: " + split[i])
                    }
                }
            } else {
                reply.push(text.text)
            }
        } else {
            reply.push(text)
        }
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
OCR or extract text: Attempts tp extract text from the images on a tweet or its parent.
Analyze links: Produces a report on alt text usage for any linked websites.
Explain: Respond with a quick explanation of alt text and how to add it.

DM Commands:
fetch <images or tweets>: Searches the alt-text.org database for alt text for an image or the images on a tweet.
ocr or extract text <images or tweets>: Attempts to extract text from an image or the images on a tweet.
check <tweets or users>: Checks a tweet for alt text on images, or produces a report on a user's alt text usage.
describe <images or tweets>: Attempts to describe an image or the images on a tweet
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
            } else if (text.match(/^(fetch)|(search)/i)) {
                let fetched = await fetchDMCmd(twtr, oauth, msg, text);
                reply.push(...fetched);
            } else if (text.match(/^describe/i)) {
                let descReply = await describeDMCmd(twtr, oauth, msg, text)
                reply.push(...descReply)
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
        const anySucceeded = ocrs.map(ocr => ocr.extracted).reduce((a, b) => a || b, false)
        if (!anySucceeded) {
            cmdReply.push(`Couldn't extract text from any images found`)
            return
        }

        let splitOcrs = ocrs.map(ocr => ({
            img: ocr.img,
            text: ocr.text,
            locale: ocr.locale,
            split: splitText(ocr.text, 1000)
        }));

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
        console.log(`${ts()}: Image groups: ${JSON.stringify(imageGroups)}`);

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

async function handleFetchMention(twtr, targetTweet, cmdReply) {
    const images = Object.keys(getTweetImagesAndAlts(targetTweet));
    const results = [];

    let foundAny = false;
    for (let image of images) {
        const parts = []
        const alt = await fetchAltTextForUrl(image, "en")

        let resultAlt;
        if (alt) {
            foundAny = true;
            if (alt.ocr) {
                if (alt.ocr.length < 100) {
                    parts.push(`OCR: ${alt.ocr}`)
                } else {
                    parts.push("Has long OCR available, try OCR as well")
                }
            }

            for (let exactMatch of alt.exact) {
                parts.push(`Exact: ${exactMatch.alt_text}`)
            }

            for (let fuzzyMatch of alt.fuzzy) {
                parts.push(`${Math.floor(fuzzyMatch.score * 100)}% confidence: ${fuzzyMatch.alt_text}`)
            }

            resultAlt = parts.join("\n");
            if (resultAlt.length > 1000) {
                const andMore = "More results available, try searching in DMs or on alt-text.org"
                const subset = []
                for (let part of parts) {
                    const lengthSoFar = subset.join("\n").length
                    if (lengthSoFar + andMore.length + part.length + 1 < 1000) {
                        subset.push(part)
                    } else {
                        break
                    }
                }
                subset.push(andMore)
                resultAlt = subset.join("\n")
            }
        } else {
            resultAlt = "No alt text found."
        }


        const rawImage = await fetchImage(image)
        if (rawImage) {
            const mediaId = await uploadImageWithAltText(twtr, rawImage.data, resultAlt)
            if (mediaId) {
                results.push(mediaId)
            } else {
                console.log(`${ts()}: Failed to upload image for alt-text.org search: '${image}': '${resultAlt}'`)
            }
        } else {
            console.log(`${ts()}: Failed to fetch image for alt-text.org search: '${image}'`)
        }
    }

    if (foundAny && results.length > 0) {
        cmdReply.push({
            text: "Search results in image descriptions",
            media: results
        })
    } else {
        cmdReply.push("No results found for any images, or error re-uploading them. To help fill the database, sign up " +
            "at https://alt-text.org/sign-up.html, or include the #SaveAltText hashtag on your tweets with images")
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
        if (images.length > 0) {
            console.log(`${ts()}: Found ${images.length} on tweet`)
            return {
                targetTweet: tweet,
                tweetTargetStr: "tweet"
            }
        }

        if (bareTweet.quoted_status_id_str) {
            tweet = await getTweet(twtr, bareTweet.quoted_status_id_str);
            images = tweet ? Object.keys(getTweetImagesAndAlts(tweet)) : []
            if (images.length > 0) {
                console.log(`${ts()}: Found ${images.length} on quoted tweet`)
                return {
                    targetTweet: tweet,
                    tweetTargetStr: "quoted tweet"
                }
            }
        }

        if (bareTweet.in_reply_to_status_id_str) {
            tweet = await getTweet(twtr, bareTweet.in_reply_to_status_id_str);
            images = tweet ? Object.keys(getTweetImagesAndAlts(tweet)) : []
            if (images.length > 0) {
                console.log(`${ts()}: Found ${images.length} on parent tweet`)
                return {
                    targetTweet: tweet,
                    tweetTargetStr: "parent tweet"
                }
            }

            if (tweet && tweet.quoted_status_id_str) {
                tweet = await getTweet(twtr, tweet.quoted_status_id_str);
                images = tweet ? Object.keys(getTweetImagesAndAlts(tweet)) : []
                if (images.length > 0) {
                    console.log(`${ts()}: Found ${images.length} on parent tweet's quoted tweet`)
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
            tweetTargetStr: "no-images-found"
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
            `${ts()}: Got mention, but it didn't actually contain my name: '${text}'`
        );
        return;
    }

    const {
        targetTweet,
        tweetTargetStr
    } = await getTargetTweet(twtr, tweet, text.match(/(ocr)|(extract text)|(save)|(search)|(fetch)|(^(\s*@\w+)*\s*@AltTextUtil\s*$)/i))

    if (tweetTargetStr === "no-images-found") {
        await reply(
            twtr,
            tweet.id_str,
            tweet.user.screen_name,
            "I don't see any images to process, sorry."
        );
        return
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
    if (text.match(/(ocr)|(extract text)/i) || text.match(/^(\s*@\w+)*\s*@AltTextUtil\s*$/i)) {
        await handleOcrMention(twtr, tweet, targetTweet, cmdReply)
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
    } else if (text.match(/(fetch)|(search)/i)) {
        await handleFetchMention(twtr, targetTweet, cmdReply)
    } else {
        console.log(
            `${ts()}: Got tweet https://twitter.com/status/${tweet.user.screen_name}/${
                tweet.id_str
            }, but it didn't contain a command. Text: '${text}'`
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
                handleDMEvent(twtr, oauth, msg).catch(err => {
                    console.log(`${ts()}: Uncaught error in DM handler`)
                    console.log(err)
                })
            );
        } else if (event.tweet_create_events && event.tweet_create_events.forEach) {
            // console.log(`Got webhook event: ${JSON.stringify(event)}`);
            event.tweet_create_events.forEach(tweet =>
                handleMention(twtr, oauth, tweet).catch(err => {
                    console.log(`${ts()}: Uncaught error in mention handler`)
                    console.log(err)
                })
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
