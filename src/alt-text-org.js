const {ts, getTweetImagesAndAlts} = require("./util");
const {getTweet} = require("./twtr");

const fetch = require("node-fetch");

async function saveAltTextForImage(token, url, lang, alt, userId) {
    return await fetch("https://api.alt-text.org/library/v1/save", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
            image: {
                url: url
            },
            image_url: url,
            language: lang || "en",
            alt_text: alt,
            id_scope: "twitter",
            author_id: userId
        })
    }).then(resp => {
        if (resp.ok) {
            return true;
        } else {
            console.log(`${ts()}: Unsuccessful save for url '${url}': ${resp.status} ${resp.statusText}`);
            return false;
        }
    }).catch(err => {
        console.log(`${ts()}: Failed to save alt for '${url}:`);
        console.log(err);
        return false;
    });
}

async function fetchAltTextForTweet(twtr, tweetId) {
    let reply = [];
    let tweet = await getTweet(twtr, tweetId);
    if (tweet) {
        let images = Object.keys(getTweetImagesAndAlts(twtr, tweet));
        if (images.length > 0) {
            let fetched = await Promise.all(images.map((img, idx) => {
                return fetchAltTextForUrl(img, tweet.lang || "en")
                    .then(foundText => {
                        if (foundText) {
                            foundText.exact.map(text =>
                                `${tweet.user.screen_name}/${tweetId}: ${idx + 1}/${images.length} (exact): ${text.alt_text}`
                            ).concat(foundText.fuzzy.map(text =>
                                `${tweet.user.screen_name}/${tweetId}: ${idx + 1}/${images.length} (Similarity: ${text.score}): ${text.alt_text}`
                            ));
                        } else {
                            return [`${tweet.user.screen_name}/${tweetId}: ${idx + 1}/${images.length}: Couldn't find any saved alt text`];
                        }
                    })
                    .catch(e => {
                        console.log(`${ts()}: Error fetching text for image ${img}: ${JSON.stringify(e)}`);
                        return `${tweet.user.screen_name}/${tweetId}: ${idx + 1}/${images.length}: Error fetching altText`;
                    });
            }));

            fetched.forEach(texts => reply.push(...texts));
        } else {
            reply.push(`${tweet.user.screen_name}/${tweetId}: No images found`);
        }
    } else {
        reply.push(`Couldn't fetch tweet ${tweetId}`);
    }

    return reply;
}

async function fetchAltTextForUrl(url, lang) {
    return await fetch("https://api.alt-text.org/library/v1/fetch", {
        method: "POST", headers: {
            "Content-Type": "application/json"
        }, body: JSON.stringify({
            image: {
                url: url
            },
            language: lang || "en"
        })
    }).then(async resp => {
        if (resp.ok) {
            return await resp.json();
        } else if (resp.status === 404) {
            return null;
        } else {
            console.log(`${ts()}: Failed to fetch for url '${url}': Status: ${resp.status} Body: ${await resp.text()}`);
            return null;
        }
    }).catch(err => {
        console.log(`${ts()}: Failed to fetch alt for '${url}: ${err}`);
        return null;
    });
}

async function fetchAltTextForBase64(image, lang) {
    let resp = await fetch("https://api.alt-text.org/library/v1/fetch", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            image:{
                base64: `data:${image.mimeType};base64,${image.data}`
            },
            language: lang || "en"
        })
    });

    if (resp.ok) {
        return await resp.json();
    } else if (resp.status === 404) {
        return null;
    } else {
        console.log(`${ts()}: Failed to fetch for raw image: Status: ${resp.status} Body: ${await resp.text()}`);
        return null;
    }
}

exports.fetchAltTextForUrl = fetchAltTextForUrl;
exports.fetchAltTextForTweet = fetchAltTextForTweet;
exports.fetchAltTextForBase64 = fetchAltTextForBase64;
exports.saveAltTextForImage = saveAltTextForImage;
