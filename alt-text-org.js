const {ts, getTweetImagesAndAlts} = require("./util");
const {getTweet} = require("./twtr");
const {DCT, diagonalSnake} = require("./dct")

const crypto = require("crypto");
const fetch = require("node-fetch");
const {createCanvas, loadImage, Image} = require('canvas')

async function loadImageFromUrl(url) {
    return await fetch(url)
        .then(async resp => {
            if (resp && resp.ok) {
                return await resp.arrayBuffer()
            } else {
                console.log(`${ts()}: Failed to fetch ${url}: ${resp.status} ${resp.statusText}`)
                return null;
            }
        })
        .then(async buf => {
            if (buf) {
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

async function searchablesForUrl(url) {
    let image = await loadImageFromUrl(url)
    if (!image) {
        console.log(`${ts()}: Failed to load image for ${url}`)
        return null
    }

    const canvas = createCanvas(image.width, image.height);
    let context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);

    const imageData = context
        .getImageData(0, 0, canvas.width, canvas.height);

    return searchablesForImageData(image, imageData)
}

async function saveAltTextForImage(url, lang, alt, userId) {
    return await searchablesForUrl(url)
        .then(async searchables => {
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
                if (resp.ok) {
                    return true
                } else {
                    console.log(`${ts()}: Unsuccessful save for url '${url}': ${resp.status} ${resp.statusText}`)
                    return false
                }
            })
        })
        .catch(err => {
            console.log(`${ts()}: Failed to save alt for '${url}:`);
            console.log(err)
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
                    return null;
                } else {
                    console.log(`${ts()}: Failed to fetch for url '${url}': Status: ${resp.status} Body: ${await resp.text()}`);
                    return null;
                }
            }).catch(err => {
                console.log(`${ts()}: Failed to fetch alt for '${url}: ${err}`);
                return null;
            })
        })
}

async function imageBase64ToImageData(imageObj) {
    const image = new Image();

    let prom = new Promise(res => {
        image.onload = () => {
            res()
        }
    })

    image.src = "data:image/jpeg;base64, " + imageObj.data;
    await prom

    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext("2d");
    canvas.width = image.width;
    canvas.height = image.height;
    ctx.clearRect(0, 0, image.width, image.height)
    ctx.drawImage(image, 0, 0)

    return {
        image: image,
        imageData: ctx.getImageData(0, 0, image.width, image.height)
    };
}

async function fetchAltForImageBase64(imageBase64, lang) {
    let {image, imageData} = await imageBase64ToImageData(imageBase64)
    return fetchAltTextForRaw(image, imageData, lang)
}

async function fetchAltTextForRaw(image, imageData, lang) {
    let searches = await searchablesForImageData(image, imageData)

    let resp = await fetch("https://api.alt-text.org/v1/alt-library/fetch", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            searches: searches, language: lang || "en"
        })
    });

    if (resp.ok) {
        return await resp.json();
    } else if (resp.status === 404) {
        return null;
    } else {
        console.log(`${ts()}: Failed to fetch for raw image hash: ${searches.sha256}: Status: ${resp.status} Body: ${await resp.text()}`);
        return null;
    }
}

function shrinkImage(image, imageData, edgeLength) {
    let canvas = createCanvas(edgeLength, edgeLength);

    let ctx = canvas.getContext("2d");

    ctx.drawImage(image, 0, 0, imageData.width, imageData.height, 0, 0, edgeLength, edgeLength)
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

function getTopLeft(pixels, edgeLength) {
    let res = Array(edgeLength).fill('').map(() => []);

    for (let row = 0; row < edgeLength; row++) {
        for (let col = 0; col < edgeLength; col++) {
            res[row][col] = pixels[row][col];
        }
    }

    return res;
}

function toMatrix(arr, rows, cols) {
    if (arr.length !== rows * cols) {
        throw new Error("Array length must equal requested rows * columns")
    }

    const matrix = [];
    for (let i = 0; i < rows; i++) {
        matrix[i] = [];
        for (let j = 0; j < cols; j++) {
            matrix[i][j] = arr[(i * cols) + j];
        }
    }

    return matrix;
}

async function searchablesForImageData(image, imageData) {
    return {
        sha256: sha256Image(image, imageData),
        dct: await dctImage(image, imageData)
    }
}

function dctImage(image, imageData) {
    return new Promise(resolve => {
        let shrunk = shrinkImage(image, imageData, 32);
        let greyed = toGreyscale(shrunk);
        let matrix = toMatrix(greyed, 32, 32)
        let dct = DCT(matrix);
        let trimmed = getTopLeft(dct, 8);
        let snaked = diagonalSnake(trimmed, 8, 8)
        resolve(snaked)
    })
}

function sha256Image(image, imageData) {
    let resized = shrinkImage(image, imageData, 100)
    let greyscale = toGreyscale(resized)
    return crypto
        .createHash("sha256")
        .update(Buffer.from(greyscale))
        .digest("hex");
}

exports.fetchAltTextForUrl = fetchAltTextForUrl;
exports.fetchAltTextForRaw = fetchAltTextForRaw;
exports.fetchAltTextForTweet = fetchAltTextForTweet;
exports.fetchAltForImageBase64 = fetchAltForImageBase64;
exports.saveAltTextForImage = saveAltTextForImage;
