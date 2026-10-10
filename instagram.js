// Posting to the brand's Instagram account: the rules and the request shapes.
// Pure -- no database, no network. server.js makes the calls and keeps the
// record; this says what may be sent and reads what came back.
//
// WHICH API. "Instagram API with Instagram Login" (graph.instagram.com), the
// one that needs no Facebook Page: a professional account, an app with the
// `instagram_business_basic` and `instagram_business_content_publish`
// permissions, and a long-lived token for that one account.
//
// A POST IS TWO CALLS, and neither takes a file:
//
//   1. POST /{ig-user-id}/media          image_url=…  -> a CONTAINER id
//   2. POST /{ig-user-id}/media_publish  creation_id=… -> the published post
//
// Instagram FETCHES the picture from `image_url` itself, so the picture has to
// be at a public address before step 1, and it has to be a JPEG. The blog's
// image store already is both: `/blog/img/<id>`, public and immutable.
//
// A CAROUSEL is one container per picture (`is_carousel_item`), then a parent
// container naming them (`media_type=CAROUSEL`), and the parent is what gets
// published. Two to ten pictures, and every one is cropped to the FIRST one's
// shape -- so a carousel of mixed shapes is refused here rather than cropped
// there.
//
// A STORY is the same two calls with `media_type=STORIES`, and it differs in
// three ways: it is ONE picture (several cards are several stories, each
// published by itself, in order), it carries NO caption (the API has no
// field for one), and it may be as tall as 9:16, which is the shape that
// fills the screen. It is gone after a day, by Instagram's doing.
//
// THE TOKEN LASTS SIXTY DAYS and can be refreshed for another sixty any time
// after its first day. The refreshed token replaces the one in the
// environment, which nothing here can write to, so the chain is kept in the
// database (`tokenPlan` below decides which token is the live one).
(function (root) {
  'use strict';

  const HOST = 'https://graph.instagram.com';
  const CAPTION_MAX = 2200;
  const HASHTAG_MAX = 30;
  const CAROUSEL_MAX = 10;
  // The feed's limits on a picture's shape, width over height.
  const RATIO_MIN = 4 / 5;
  const RATIO_MAX = 1.91;
  const STORY_RATIO_MIN = 9 / 16;
  const DAY = 86400000;
  // Refresh weekly: far inside the sixty days, so a month of failed refreshes
  // still leaves a working token and time to notice.
  const REFRESH_AFTER_MS = 7 * DAY;
  const REFRESH_MIN_AGE_MS = DAY;       // Instagram refuses a token younger than this
  const WARN_BEFORE_MS = 14 * DAY;

  const isImageId = (id) => /^[a-f0-9]{8,64}$/.test(String(id || ''));

  // The address Instagram fetches. `.jpg` on the end because a fetcher that
  // judges a picture by its address should be given one that looks like a
  // picture; the route ignores it.
  function imageUrl(base, id) {
    const b = String(base || '').replace(/\/+$/, '');
    if (!/^https:\/\/[^/]+$/i.test(b) || /^https:\/\/(localhost|127\.|\[::1\])/i.test(b)) return null;
    return isImageId(id) ? `${b}/blog/img/${id}.jpg` : null;
  }

  // What is wrong with a post, in words for the person about to send it, or
  // null. `images` is [{ id, mime, w, h }].
  function problem(images, caption, kind) {
    const story = kind === 'story';
    const list = images || [];
    if (!list.length) return 'There is no picture to post.';
    if (list.length > CAROUSEL_MAX) {
      return story ? `That is ${list.length} stories in one go; ${CAROUSEL_MAX} is the most.`
        : `A carousel holds ${CAROUSEL_MAX} pictures at most; this has ${list.length}.`;
    }
    for (const im of list) {
      if (!isImageId(im && im.id)) return 'One of the pictures has no stored id.';
      if (im.mime && im.mime !== 'image/jpeg') return 'Instagram takes JPEG pictures only.';
      if (im.w > 0 && im.h > 0) {
        const r = im.w / im.h;
        if (story && r < STORY_RATIO_MIN - 0.005) return 'That shape is taller than a Story, which is 9:16 at the tallest.';
        if (!story && r < RATIO_MIN - 0.005) {
          return 'That shape is too tall for the feed, which takes 4:5 at the tallest. The 9:16 size is a Story shape.';
        }
        if (r > RATIO_MAX + 0.005) return 'That shape is too wide for the feed, which takes 1.91:1 at the widest.';
      }
    }
    if (new Set(list.map((im) => im.id)).size !== list.length) return 'The same picture is in the post twice.';
    // A story has no caption and no shared shape: each one stands alone.
    if (story) return null;
    const first = list[0];
    if (list.length > 1 && first.w > 0 && first.h > 0) {
      const odd = list.find((im) => im.w > 0 && im.h > 0 && Math.abs(im.w / im.h - first.w / first.h) > 0.01);
      if (odd) return 'A carousel is one shape: Instagram crops every picture to the first one’s. Use one size for all of them.';
    }
    const cap = String(caption || '');
    // Instagram counts characters the way a reader does, so count code points.
    const len = [...cap].length;
    if (len > CAPTION_MAX) return `The caption is ${len} characters and the limit is ${CAPTION_MAX}.`;
    const tags = (cap.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
    if (tags > HASHTAG_MAX) return `The caption has ${tags} hashtags and the limit is ${HASHTAG_MAX}.`;
    return null;
  }

  // The parameters of each call. Plain objects; the caller adds the token.
  const itemParams = (url, single, caption) => (single
    ? { image_url: url, caption: String(caption || '') }
    : { image_url: url, is_carousel_item: 'true' });
  const storyParams = (url) => ({ image_url: url, media_type: 'STORIES' });
  const carouselParams = (childIds, caption) =>
    ({ media_type: 'CAROUSEL', children: childIds.join(','), caption: String(caption || '') });

  // An error body in words. Meta's `error_user_msg` is written for a person
  // and is the better of the two when it is there.
  function errorText(body, status) {
    const e = body && body.error;
    if (!e) return 'Instagram answered ' + (status || 'with nothing');
    const msg = String(e.error_user_msg || e.message || 'an error').slice(0, 300);
    // 190 is the code for a token that has expired or been revoked.
    if (e.code === 190) return 'Instagram refused the access token (expired or revoked): ' + msg;
    return msg + (e.code != null ? ` (code ${e.code}${e.error_subcode ? '/' + e.error_subcode : ''})` : '');
  }

  // WHICH TOKEN IS LIVE, and whether it is due a refresh.
  //
  //   envToken  the one in the environment (IG_ACCESS_TOKEN)
  //   envMark   a short hash of it -- never the token itself
  //   stored    { token, from, at, expires } from the database, or null
  //
  // The stored token descends from an environment token, and `from` records
  // which. While the environment still holds that ancestor the stored one is
  // newer and wins; the moment the environment holds a DIFFERENT token, a
  // person has put a new one there on purpose, and that wins and restarts the
  // chain. Without `from` a replaced token would be shadowed for ever by the
  // dead one it replaced.
  function tokenPlan(envToken, envMark, stored, now) {
    const t = now == null ? Date.now() : now;
    if (!envToken) return { token: null, fresh: false, due: false, expires: null, firstSeen: false };
    const mine = !!stored && stored.from === envMark;
    if (!mine) {
      // First sight of this token: its age is unknown, so it is not refreshed
      // until it has been seen for a week. Only the mark and the time are
      // written down for it -- the token itself stays in the environment
      // until a refresh hands back one that has nowhere else to live.
      return { token: envToken, firstSeen: true, due: false, expires: null, at: t };
    }
    const at = Number(stored.at) || 0;
    const age = t - at;
    return {
      token: stored.token || envToken, firstSeen: false, at,
      due: age >= REFRESH_AFTER_MS && age >= REFRESH_MIN_AGE_MS,
      expires: stored.expires || null,
      expiring: !!stored.expires && stored.expires - t < WARN_BEFORE_MS,
    };
  }

  const api = { HOST, CAPTION_MAX, HASHTAG_MAX, CAROUSEL_MAX, RATIO_MIN, RATIO_MAX,
    REFRESH_AFTER_MS, WARN_BEFORE_MS,
    STORY_RATIO_MIN, isImageId, imageUrl, problem, itemParams, storyParams, carouselParams, errorText, tokenPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Instagram = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
