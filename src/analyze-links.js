const { ts } = require("./util");

const html = require("node-html-parser");
const fetch = require("node-fetch");

function fetchPage(url) {
  return fetch(url, {
    method: "GET"
  })
    .then(async resp => {
      if (resp.ok) {
        let text = await resp.text();
        return html.parse(text);
      } else {
        return null;
      }
    })
    .catch(err => {
      console.log(`${ts()}: Failed to fetch page at ${url}: ${err}`);
      return null;
    });
}

function getMetaTagDetails(dom) {
  let metas = dom.querySelectorAll("meta");
  let result = {
    hasPreviewImage: false,
    hasPreviewAltText: false
  };

  metas.forEach(meta => {
    let property = meta.getAttribute("property");
    if (property) {
      if (property === "og:image" || property === "twitter:image") {
        result.hasPreviewImage = true;
      } else if (
        property === "og:image:alt" ||
        property === "twitter:image:alt"
      ) {
        result.hasPreviewAltText = true;
      }
    }
  });

  return result;
}

async function analyzeLink(url) {
  let dom = await fetchPage(url);
  if (!dom) {
    return { error: `${ts()}: Couldn't fetch link: '${url}'` };
  }

  return {
    openGraphDetails: getMetaTagDetails(dom),
    imageStats: await getImageStats(dom)
  };
}

function getUrls(tweet) {
  if (!tweet.entities) {
    console.log(
      `${ts()}: Tweet had no entities. Tweet: ${JSON.stringify(tweet, null, 2)}`
    );
    return [];
  } else if (!tweet.entities.urls) {
    console.log(
      `${ts()}: Tweet entities had no urls. Tweet: ${JSON.stringify(
        tweet.entities,
        null,
        2
      )}`
    );
    return [];
  }

  return tweet.entities.urls.map(url => {
    return {
      expanded: url.expanded_url,
      display: url.display_url
    };
  });
}

async function getImageStats(dom) {
  let imgs = dom.querySelectorAll("img");
  let result = {
    images: 0,
    withAltText: 0
  };

  for (const img of imgs) {
    let src = img.getAttribute("src");
    if (src) {
      result.images++;
      let alt = img.getAttribute("alt");
      if (alt && alt.length > 16) {
        result.withAltText++;
      }
    }
  }

  return result;
}

function stringifyAnalysis(analysis) {
  let parts = [];
  if (analysis.openGraphDetails.hasPreviewImage) {
    if (analysis.openGraphDetails.hasPreviewAltText) {
      parts.push("Preview has alt text,");
    } else {
      parts.push("Preview has no alt text,");
    }
  }

  if (analysis.imageStats.images > 0) {
    parts.push(
      `${analysis.imageStats.withAltText}/${analysis.imageStats.images} images have alt text`
    );
  } else {
    parts.push("No static images on page.");
  }

  return parts.join(" ");
}

async function analyzeUrls(urls, tweetTargetStr) {
  return Promise.all(
    urls.map(async url => {
      let analysis = await analyzeLink(url.expanded);
      return `${url.display}: ${stringifyAnalysis(analysis)}`;
    })
  )
}

exports.analyzeUrls = analyzeUrls;
exports.getUrls = getUrls;