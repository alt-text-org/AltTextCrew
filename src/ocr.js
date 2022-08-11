const vision = require("@google-cloud/vision");
const { ts, getTweetImagesAndAlts } = require("./util");

const visionClient = new vision.ImageAnnotatorClient();
async function ocr(url) {
  console.log(`${ts()}: Attempting to recognize ${url}`);
  let [result] = await visionClient
    .textDetection(url)
    .catch(err => console.log(err));
  let texts = result.textAnnotations;
  if (texts) {
    return texts
      .filter(text => !!text.locale)
      .map(text => text.description)
      .join(" ")
      .replace(/(\r\n|\n|\r)/gm, " ");
  } else {
    return "";
  }
}

async function ocrRaw(rawImage) {
  let requests = [
    {
      image: {
        content: rawImage.data
      },
      features: [{ type: "TEXT_DETECTION" }]
    }
  ];

  let result = await visionClient
    .batchAnnotateImages({ requests })
    .catch(err => console.log(err));

  if (
    result[0] &&
    result[0].responses &&
    result[0].responses[0] &&
    result[0].responses[0].fullTextAnnotation &&
    result[0].responses[0].fullTextAnnotation.text
  ) {
    return result[0].responses[0].fullTextAnnotation.text;
  } else {
    console.log("No text found. Full response: " + JSON.stringify(result));
    return null;
  }
}

async function ocrTweetImages(twtr, tweet) {
  let images = Object.keys(getTweetImagesAndAlts(tweet));
  if (images.length > 0) {
    let ocrs = await Promise.all(
      images.map((img, idx) => {
        return ocr(img)
          .then(imgOcr => {
            if (imgOcr) {
              return {img: img, text: imgOcr};
            } else {
              return {img: img, text: "No text extracted"};
            }
          })
          .catch(e => {
            console.log(
              `Error fetching OCR for image ${img}: ${JSON.stringify(e)}`
            );
            return {img: img, text: "Error extracting text"};
          });
      })
    );

    return ocrs;
  } else {
    return null
  }
}

exports.ocr = ocr;
exports.ocrRaw = ocrRaw;
exports.ocrTweetImages = ocrTweetImages;