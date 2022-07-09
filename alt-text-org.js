const {ts, getTweetImagesAndAlts} = require("./util");
const {getTweet} = require("./twtr");

const crypto = require("crypto");
const fetch = require("node-fetch");
const Base64 = require("@stablelib/base64");
const {createCanvas, loadImage, Image} = require('canvas')

async function loadImageFromUrl(url) {
    console.log("In loadImageFromUrl")
    return await fetch(url)
        .then(async resp => {
            console.log("In loadImageFromUrl post-fetch")
            if (resp && resp.ok) {
                return await resp.arrayBuffer()
            } else {
                console.log(`${ts()}: Failed to fetch ${url}: ${resp.status} ${resp.statusText}`)
                return null;
            }
        })
        .then(async buf => {
            if (buf) {
                console.log("Pre-loadImage")
                return await loadImage(Buffer.from(buf))
            } else {
                return null
            }
        })
        .catch(err => {
            console.log(`${ts()}: Failed to fetch ${url}: ${err}`)
            return null
        })
}

function searchablesForImageData(imageData) {
    return {
        sha256: sha256Image(imageData),
        dctHash: dctHash(imageData),
        averageHash: averageHash(imageData),
        intensityHist: intensityHist(imageData)
    }
}

async function searchablesForUrl(url) {
    console.log("In searchablesForUrl")
    let image = await loadImageFromUrl(url)
    if (!image) {
        console.log(`Failed to load image for ${url}`)
        return null
    }

    console.log("Post load ")
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image);
    console.log("Post canvas")
    const imageData = canvas.getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height);

    return searchablesForImageData(imageData)
}

async function saveAltTextForImage(url, lang, alt, userId) {
    return await searchablesForUrl(url)
        .then(async searchables => {
            console.log("In post-searchables")
            return await fetch("https://api.alt-text.org/v1/alt-library/save", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    searchables: searchables,
                    image_url: url,
                    language: lang || "en",
                    alt_text: alt,
                    id_scope: "twitter",
                    author_id: userId
                })
            }).then(resp => {
                return resp.statusCode === 204
            })
        })
        .catch(err => {
            console.log(err)
            console.log(`${ts()}: Failed to save alt for '${url}: ${err}`);
            return false;
        })
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
                        if (foundText.length > 0) {
                            return foundText.map(text => `${tweet.user.screen_name}/${tweetId}: ${idx + 1}/${images.length}: ${text}`);
                        } else {
                            return [`${tweet.user.screen_name}/${tweetId}: ${idx + 1}/${images.length}: Couldn't find any saved alt text`];
                        }
                    })
                    .catch(e => {
                        console.log(`Error fetching text for image ${img}: ${JSON.stringify(e)}`);
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
    return await searchablesForUrl(url)
        .then(async searchables => {
            return await fetch("https://api.alt-text.org/v1/alt-library/fetch", {
                method: "POST", headers: {
                    "Content-Type": "application/json"
                }, body: JSON.stringify({
                    searches: searchables, language: lang || "en"
                })
            }).then(async resp => {
                if (resp.ok) {
                    return await resp.json();
                } else if (resp.status === 404) {
                    return {};
                } else {
                    console.log(`${ts()}: Failed to fetch for url '${url}': Status: ${resp.status} Body: ${await resp.text()}`);
                    return {};
                }
            }).catch(err => {
                console.log(`${ts()}: Failed to fetch alt for '${url}: ${err}`);
                return {};
            })
        })
}

function imageBase64ToImageData(imageObj) {
    const image = new Image();
    image.src = imageObj.data;

    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext("2d");
    canvas.width = image.width;
    canvas.height = image.height;
    ctx.clearRect(0, 0, image.width, image.height)
    ctx.drawImage(image, 0, 0)

    return ctx.getImageData(0, 0, image.width, image.height);
}

async function fetchAltForImageBase64(image, lang) {
    let imageData = imageBase64ToImageData(image)
    return fetchAltTextForRaw(imageData, lang)
}

async function fetchAltTextForRaw(imageData, lang) {
    let searches = searchablesForImageData(imageData)

    let resp = await fetch("https://api.alt-text.org/v1/alt-library/fetch", {
        method: "POST", headers: {
            "Content-Type": "application/json"
        }, body: JSON.stringify({
            searches: searches, language: lang || "en"
        })
    });

    if (resp.ok) {
        return await resp.json();
    } else if (resp.status === 404) {
        return {};
    } else {
        console.log(`${ts()}: Failed to fetch for raw image hash: ${searches.sha256}: Status: ${resp.status} Body: ${await resp.text()}`);
        return {};
    }
}

function shrinkImage(imageData, edgeLength) {
    let canvas = createCanvas(edgeLength, edgeLength);

    let ctx = canvas.getContext("2d");
    ctx.putImageData(imageData, 0, 0);

    return ctx.getImageData(0, 0, edgeLength, edgeLength);
}

function toGreyscale(imageData) {
    let rgba = new Uint8Array(imageData.data.buffer);
    let greyscale = new Uint8Array(rgba.length / 4);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
        let intensity = (rgba[i] + rgba[i + 1] + rgba[i + 2]) * (rgba[i + 3] / 255.0);
        greyscale[j] = Math.round((intensity / 765) * 255);
    }

    return greyscale;
}

function averageColor(pixels) {
    let sum = pixels.reduce((a, b) => a + b, 0);
    return Math.round(sum / pixels.length);
}

function averageFloats(floats) {
    let sum = floats.reduce((a, b) => a + b, 0);
    return sum / floats.length;
}

function constructHashBits(pixels, average) {
    let bits = new Uint8Array(pixels.length);
    pixels.forEach((val, idx) => (bits[idx] = val >= average ? 1 : 0));
    return bits;
}

function compressHashBits(bits) {
    let bytes = new Uint8Array(bits.length / 8);
    for (let bit = 0, byteBit = 0; bit < bits.length; bit++, byteBit++) {
        let byte = Math.floor(bit / 8);
        byteBit = byteBit % 8;
        bytes[byte] = bytes[byte] | (bits[bit] << byteBit);
        console.log(bits[bit] << byteBit);
    }

    return bytes;
}

function hexEncode(bytes) {
    return bytes.reduce((sum, byte) => sum + byte.toString(16).padStart(2, "0"), "");
}

function getTopLeft(pixels, edgeLength) {
    let result = new Array(edgeLength * edgeLength);
    let originalEdgeLength = Math.sqrt(pixels.length);
    if (originalEdgeLength !== Math.floor(originalEdgeLength)) {
        throw new Error("'pixels' must be a square");
    }

    for (let row = 0, resultIdx = 0; row < edgeLength; row++) {
        for (let col = 0; col < edgeLength; col++, resultIdx++) {
            result[resultIdx] = pixels[row * originalEdgeLength + col];
        }
    }

    return result;
}

/*===========================================================================*\
 * Discrete Cosine Transform
 *
 * (c) Vail Systems. Joshua Jung and Ben Bryan. 2015
 *
 * This code is not designed to be highly optimized but as an educational
 * tool to understand the Mel-scale and its related coefficients used in
 * human speech analysis.
 *
 * Some minor modifications by Hannah Kolbeck 2021
\*===========================================================================*/
const cosMap = {};

function getCosines(signalLen) {
    if (cosMap[signalLen]) {
        return cosMap[signalLen];
    }

    let cosines = new Array(signalLen * signalLen);

    const PI_N = Math.PI / signalLen;

    for (let k = 0; k < signalLen; k++) {
        for (let n = 0; n < signalLen; n++) {
            cosines[n + k * signalLen] = Math.cos(PI_N * (n + 0.5) * k);
        }
    }

    cosMap[signalLen] = cosines;

    return cosines;
}

function computeDCT(signal) {
    const signalLen = signal.length;

    const cosines = getCosines(signalLen);
    const coefficients = signal.map(() => 0);

    return coefficients.map((__, ix) => signal.reduce((prev, cur, ix_) => prev + cur * cosines[ix_ + ix * signalLen], 0));
}

// End Vail Systems code. It is distributed under the MIT license found at the root of this repository

/**
 * Calculates a feature vector for the image based on an intensity histogram.
 *  1. Calculate the scale factor, used to bucket values in the range 0 - 765, where 765 is the max value of
 *     (red + green + blue) * alpha for a pixel.
 *  2. For each pixel in the array, calculate the intensity, scale the result, then increment the appropriate
 *     bucket.
 *  3. For each bucket, calculate the fraction of pixels in the image that are in that bucket, will always be in
 *     the range [0.0,1.0]
 *  4. Stringify and base64 the result. The output is ~3k, so hefty.
 */
function intensityHist(imageData) {
    console.log("In intensity")

    return new Promise(resolve => {
        const maxIntensity = 255 * 3;
        const buckets = 100;

        // Floor to two places, don't want to round so we don't accidentally round up.
        const scale = Math.floor((buckets / maxIntensity) * buckets) / buckets;

        let counts = new Array(buckets).fill(0);
        let data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            let intensity = (data[i] + data[i + 1] + data[i + 2]) * (data[i + 3] / 255.0);
            let bucket = Math.floor(intensity * scale);
            counts[bucket]++;
        }

        const pixels = data.length / 4;
        let floats = new Array(buckets);
        for (let i = 0; i < buckets; i++) {
            floats[i] = Math.fround(counts[i] / pixels);
        }

        resolve(Base64.encodeURLSafe(new Uint8Array(floats.buffer)));
    });
}

function averageHash(imageData) {
    console.log("In avg")

    return new Promise(resolve => {
        let shrunk = shrinkImage(imageData, 64);
        let greyed = toGreyscale(shrunk);
        let average = averageColor(greyed);
        let hashBits = constructHashBits(greyed, average);
        let hash = compressHashBits(hashBits);
        resolve(hexEncode(hash));
    });
}

function dctHash(imageData) {
    console.log("In dct")

    return new Promise(resolve => {
        let shrunk = shrinkImage(imageData, 32);
        let greyed = toGreyscale(shrunk);
        let dct = computeDCT(greyed);
        let trimmed = getTopLeft(dct, 8);
        let avg = averageFloats(trimmed.slice(1));
        let hashBits = constructHashBits(trimmed, avg);
        let hash = compressHashBits(hashBits);
        resolve(hexEncode(hash));
    });
}

function sha256Image(imageData) {
    console.log("In sha")
    return crypto
        .createHash("sha256")
        .update(Buffer.from(imageData.data))
        .digest("hex");
}

exports.fetchAltTextForUrl = fetchAltTextForUrl;
exports.fetchAltTextForRaw = fetchAltTextForRaw;
exports.fetchAltTextForTweet = fetchAltTextForTweet;
exports.fetchAltForImageBase64 = fetchAltForImageBase64;
exports.saveAltTextForImage = saveAltTextForImage;
