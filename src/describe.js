const fetch = require("node-fetch")
const {ts, getTweetImagesAndAlts} = require("./util");

function responseToMessage(descriptionBody) {
    const lines = []
    if (descriptionBody.captions && descriptionBody.captions.length > 0) {
        descriptionBody.captions.forEach(caption => {
            lines.push(`${Math.floor(caption.confidence * 100)}% confidence: ${caption.text}`)
        })
    } else {
        lines.push("No descriptions could be generated")
    }

    if (descriptionBody.tags && descriptionBody.tags.length > 0) {
        lines.push("Tags: " + descriptionBody.tags.join(" "))
    }

    return lines.join("\n")
}

async function doFetch(azureUrl, fetchArgs) {
    return await fetch(`${azureUrl}/vision/v3.2/describe`, fetchArgs).then(async resp => {
        if (resp) {
            if (resp.ok) {
                const json = await resp.json();
                if (!json.description) {
                    console.log(`${ts()}: Got description response, but without description field: ${JSON.stringify(json)}`)
                    return null
                }

                return responseToMessage(json.description)
            } else {
                console.log(`${ts()}: Failed to fetch image description for type ${fetchArgs.headers["Content-Type"]}: ${resp.status} ${resp.statusText}: ${await resp.text()}`)
                return null
            }
        } else {
            console.log(`${ts()}: Got null response for type ${fetchArgs.headers["Content-Type"]}`)
            return null
        }
    }).catch(err => {
        console.log(`${ts()}: Error fetching image description for type: ${fetchArgs.headers["Content-Type"]}`)
        console.log(err)
        return null
    })
}

async function describeRaw(azureUrl, azureKey, image) {
    return await doFetch(azureUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/octet-stream",
            "Ocp-Apim-Subscription-Key": azureKey
        },
        body: Buffer.from(image.data, "base64")
    })
}

async function describeUrl(azureUrl, azureKey, url) {
    return await doFetch(azureUrl,{
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Ocp-Apim-Subscription-Key": azureKey
        },
        body: JSON.stringify({url})
    })
}

async function describeTweetImages(azureUrl, azureKey, tweet) {
    let images = Object.keys(getTweetImagesAndAlts(tweet));
    if (images.length > 0) {
        return await Promise.all(
            images.map((img) => {
                return describeUrl(azureUrl, azureKey, img)
                    .then(imgDesc => {
                        if (imgDesc) {
                            return {img: img, text: imgDesc};
                        } else {
                            return {img: img, text: "No description found"};
                        }
                    })
                    .catch(e => {
                        console.log(
                            `Error fetching description for image ${img}: ${JSON.stringify(e)}`
                        );
                        return {img: img, text: "Error describing image"};
                    });
            })
        ).catch(err => {
            console.log(`${ts()}: Error attempting to describe images on https://twitter.com/status/${tweet.user.screen_name}/${tweet.id_str}`)
            console.log(err)
            return null
        });
    } else {
        return null
    }
}

exports.describeUrl = describeUrl;
exports.describeRaw = describeRaw;
exports.describeTweetImages = describeTweetImages;