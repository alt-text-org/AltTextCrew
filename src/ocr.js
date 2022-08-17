const vision = require("@google-cloud/vision");
const {createCanvas} = require("canvas");
const {default: canvasTxt} = require('canvas-txt')

const {ts, getTweetImagesAndAlts} = require("./util");

const visionClient = new vision.ImageAnnotatorClient();

async function ocr(url) {
    console.log(`${ts()}: Attempting to recognize ${url}`);
    let [result] = await visionClient
        .textDetection(url)
        .catch(err => console.log(err));
    let texts = result.textAnnotations;
    if (texts) {
        const text = texts
            .filter(t => !!t.locale)
            .map(t => t.description)
            .join(" ")
            .replace(/(\r\n|\n|\r)/gm, " ");

        const locales = texts
            .filter(t => !!t.locale)
            .reduce((loc, t) => {
                loc[t.locale] = (loc[t.locale] || 0) + 1
                return loc
            }, {})

        const localeAndCount = Object.entries(locales)
            .sort((entryA, entryB) => entryA[1] - entryB[1])[0] || ["default", 0]

        return {
            text: text,
            locale: localeAndCount[0]
        };
    } else {
        return null;
    }
}

async function ocrRaw(rawImage) {
    let requests = [
        {
            image: {
                content: rawImage.data
            },
            features: [{type: "TEXT_DETECTION"}]
        }
    ];

    let result = await visionClient
        .batchAnnotateImages({requests})
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
        return await Promise.all(
            images.map((img, idx) => {
                return ocr(img)
                    .then(imgOcr => {
                        if (imgOcr) {
                            return {img: img, text: imgOcr.text, locale: imgOcr.locale};
                        } else {
                            return {img: img, text: "No text extracted", locale: "default"};
                        }
                    })
                    .catch(e => {
                        console.log(
                            `Error fetching OCR for image ${img}: ${JSON.stringify(e)}`
                        );
                        return {img: img, text: "Error extracting text", locale: "default"};
                    });
            })
        );
    } else {
        return null
    }
}

const additionalImageText = {
    default: "Alt Text Continued",
    ca: "Continuació de la descripció de les imatges",
    en: "Alt Text Continued",
    es: "Continuación de la descripción de las imágenes",
    fa: "توضیحات عکس ادامه دارد",
    fr: "Description de l'image, suite",
    ja: "画像の説明（続き",
    nl: "overloop van tekst uit het vorige plaatje",
    pt: "descrição da imagem continuação"
}

const auxImageEdgeLength = 1000;
const auxImageFontPixels = 100
function getAuxImage(locale, num, total) {
    const canvas = createCanvas(auxImageEdgeLength, auxImageEdgeLength);
    const ctx = canvas.getContext('2d');
    const text = additionalImageText[locale] || additionalImageText.default

    ctx.fillStyle = "white"
    ctx.fillRect(0,0, auxImageEdgeLength, auxImageEdgeLength)

    ctx.fillStyle = "black"
    ctx.font = `bold ${auxImageFontPixels}px sans-serif`;

    // ctx.fillText(text, center, center - (textMetrics.actualBoundingBoxDescent / 2), auxImageEdgeLength - 20)
    canvasTxt.fontSize = 100
    canvasTxt.fontStyle = "bold"
    canvasTxt.align = "center"
    canvasTxt.vAlign = "middle"
    canvasTxt.drawText(ctx, text, 50, 0, auxImageEdgeLength - 100, auxImageEdgeLength - 100)

    ctx.textAlign = "right"
    ctx.textBaseline = "bottom"
    ctx.font = `${auxImageFontPixels / 2}px sans-serif`
    ctx.fillText(`${num}/${total}`, auxImageEdgeLength - 20, auxImageEdgeLength - 20)

    return canvas.toDataURL().split(",")[1];
}

const responseText = {
    default: "Extracted text in image descriptions",
    ca: "El text extret és a les descripcions de les imatges",
    en: "Extracted text in image descriptions",
    es: "El texto extraído está en las descripciones de las imágenes",
    fa: "توضیحات چاپی درعکس را درتوضیحات تصویر میخونید",
    fr: "Texte extrait dans les descriptions d'images",
    ja: "抽出されたテキストは画像の説明にあります",
    nl: "Tekst uit afbeeldingsbeschrijvingen gehaald",
    pt: "Texto extraído nas descrições das imagens"
}

function getResponseText(imageRecords) {
    const locales = imageRecords
        .filter(r => r.locale !== "default")
        .reduce((loc, r) => {
            loc[r.locale] = (loc[r.locale] || 0) + 1
            return loc
        }, {})

    const localeAndCount = Object.entries(locales)
        .sort((entryA, entryB) => entryA[1] - entryB[1])[0] || ["default", 0]
    const locale = localeAndCount[0]

    return responseText[locale] || responseText.default
}

exports.ocr = ocr;
exports.ocrRaw = ocrRaw;
exports.ocrTweetImages = ocrTweetImages;
exports.getAuxImage = getAuxImage;
exports.getResponseText = getResponseText;