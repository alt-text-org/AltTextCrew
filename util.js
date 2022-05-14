const splitter = require("unicode-default-word-boundary");
const fetch = require("node-fetch");
const base64 = require("base64-arraybuffer");
const fs = require("fs");

function ts() {
  return new Date().toISOString();
}

async function resolveTCoUrl(shortUrl) {
  let resp = await fetch(shortUrl, { method: "HEAD", redirect: "manual" });
  if (resp.status === 301) {
    return resp.headers.get("location");
  } else {
    console.log(`Got status ${resp.status} attempting to HEAD '${shortUrl}'`);
    return null;
  }
}

async function extractTargets(text) {
  let result = {
    tweet: new Set(),
    user: new Set(),
    web: new Set()
  };

  let chunks = text.split(/\s+/g);
  let toCheck = chunks.filter(chunk =>
    chunk.match(/^https:\/\/t.co\/\S*$/gi)
  );
  if (toCheck.length === 0) {
    return result;
  }

  for (let i = 0; i < toCheck.length; i++) {
    let redirect = await resolveTCoUrl(toCheck[i]);
    let tweetId = redirect.match(
      /^https:\/\/twitter.com\/[^\/]*\/status\/(\d+)/i
    );
    let profile = redirect.match(/^https:\/\/twitter.com\/([^?\/]+)$/i);

    if (tweetId) {
      result.tweet.add(tweetId[1]);
    } else if (profile) {
      result.user.add(profile[1]);
    } else {
      result.web.add(redirect);
    }
  }

  return result;
}

async function extractMessageMedia(oauth, token, msg) {
  if (
    msg.message_create.message_data &&
    msg.message_create.message_data.attachment &&
    msg.message_create.message_data.attachment.media &&
    msg.message_create.message_data.attachment.media.media_url_https
  ) {
    return await fetchImage(
      msg.message_create.message_data.attachment.media.media_url_https,
      oauth,
      token
    ).catch(e => {
      console.log("Error fetching raw image: " + JSON.stringify(e));
      return null;
    });
  } else {
    return null;
  }
}

async function fetchImage(url, oauth, token) {
  const request_data = {
    url: url,
    method: "GET"
  };

  const headers =
    oauth && token ? oauth.toHeader(oauth.authorize(request_data, token)) : {};
  let resp = await fetch(url, { headers: headers, redirect: "manual" }).catch(
    err => {
      console.log(
        `${ts()}: Failed to issue fetch for url '${url}': ${JSON.stringify(
          err
        )}`
      );
      return null;
    }
  );

  let mimeType = null;
  if (url.match(/jpe?g/i)) {
    mimeType = "image/jpeg";
  } else if (url.match(/\.png/i)) {
    mimeType = "image/png";  
  }
  
  if (!mimeType) {
    console.log(`${ts()}: Unable to extract MIME type from URL '${url}'`);
    return null;
  }
  
  if (resp) {
    if (resp.ok) {
      return { mimeType: mimeType, data: base64.encode(await resp.arrayBuffer()) };
    } else {
      console.log(
        `${ts()}: Failed to fetch image: ${url}. Status: ${resp.status}`
      );
      return null;
    }
  } else {
    return null;
  }
}

function readLocalImage(path) {
  let raw = null;
  try {
    raw = fs.readFileSync(path)
  } catch (e) {
    console.log(`${ts()}: Couldn't find file '${path}'`);
    return null;
  }

  if (!raw) {
    console.log(`${ts()}: File read returned null for '${path}'`);
    return null;
  }

  let mimeType = null;
  if (path.match(/jpe?g/i)) {
    mimeType = "image/jpeg";
  } else if (path.match(/png/i)) {
    mimeType = "image/png";
  }

  if (!mimeType) {
    console.log(`${ts()}: Unable to extract MIME type from path '${path}'`);
    return null;
  }

  return {mimeType: mimeType, data: raw.toString("base64")};
}

function splitText(text, maxLen) {
  let result = [];
  let lastSpan = { end: 0 };
  let lenBase = 0;
  let split = Array.from(splitter.findSpans(text));
  split.forEach(span => {
    if (span.end - lenBase > maxLen) {
      result.push(text.substring(lenBase, lastSpan.end));
      lenBase = span.start;
    }
    lastSpan = span;
  });

  if (text.length > lenBase) {
    result.push(text.substring(lenBase, text.length));
  }

  return result;
}

function getTweetImagesAndAlts(tweet) {
  let entities = tweet["extended_entities"];
  if (!entities) {
    return {};
  }

  let media = entities["media"];
  if (!media) {
    return {};
  }

  let images = {};
  media.forEach(m => {
    if (m["type"] === "photo" || m["type"] === "animated_gif") {
      images[m["media_url_https"]] = m["ext_alt_text"] || null;
    }
  });

  return images;
}

exports.ts = ts;
exports.resolveTCoUrl = resolveTCoUrl;
exports.extractTargets = extractTargets;
exports.extractMessageMedia = extractMessageMedia;
exports.fetchImage = fetchImage;
exports.readLocalImage = readLocalImage;
exports.splitText = splitText;
exports.getTweetImagesAndAlts = getTweetImagesAndAlts;
