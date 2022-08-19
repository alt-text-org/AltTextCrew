const twitter = require("twitter-api-client");
const {getTweet} = require("./src/twtr");
const {ocrTweetImages, getFillImage} = require("./src/ocr");
const {describeUrl, describeRaw} = require("./src/describe")
const fs = require("fs");

const config = {
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
    azure: {
        descriptionKey: process.env.AZURE_KEY,
        descriptionEndpoint: process.env.AZURE_DESCRIPTION_ENDPOINT
    }
};

function generateFillImage(lang) {
    const image = getFillImage(lang, 1, 10)
    fs.writeFileSync(`${lang}.jpg`, image, 'base64')
}

const exampleImg = "https://docs.microsoft.com/en-us/azure/cognitive-services/computer-vision/images/bw_buildings.png"

async function desc() {
    const imageBuf = fs.readFileSync("./img/more-alt-text-1.png")
    const img = {
        data: imageBuf.toString("base64"),
        mimeType: "image/png"
    }

    const description = await describeRaw(config.azure.descriptionEndpoint, config.azure.descriptionKey, img)
    console.log(description)
}

desc()