function getMedia(tweet) {
  let entities = tweet["extended_entities"];
  if (!entities) {
    return null;
  }

  return entities["media"];
}

function hasImageWithoutAltTextOrVideo(tweet) {
  let media = getMedia(tweet);
  if (!media) {
    return false;
  }
  
  let hasPicWithoutAltText = false;
  media.forEach(m => {
    if (
      ((m["type"] === "photo" || m["type"] === "animated_gif") &&
        !m["ext_alt_text"]) ||
      m["type"] === "video"
    ) {
      hasPicWithoutAltText = true;
    }
  });

  return hasPicWithoutAltText;
}

function hasImageWithoutAltText(tweet) {
  let media = getMedia(tweet);
  if (!media) {
    return false;
  }

  let hasPicWithoutAltText = false;
  media.forEach(m => {
    if (
      (m["type"] === "photo" || m["type"] === "animated_gif") &&
      !m["ext_alt_text"]
    ) {
      hasPicWithoutAltText = true;
    }
  });

  return hasPicWithoutAltText;
}

function hasImage(tweet) {
  let media = getMedia(tweet);
  if (!media) {
    return false;
  }

  let hasPic = false;
  media.forEach(m => {
    if (m["type"] === "photo" || m["type"] === "animated_gif") {
      hasPic = true;
    }
  });

  return hasPic;
}

exports.getMedia = getMedia;
exports.hasImageWithoutAltTextOrVideo = hasImageWithoutAltTextOrVideo;
exports.hasImageWithoutAltText = hasImageWithoutAltText;
exports.hasImage = hasImage;
