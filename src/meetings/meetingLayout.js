// Pure helpers for the meeting screen: how many tiles, how big, in what order, and the timer.

export const MAX_TILES = 9; // more than this and a phone cannot show them usefully; the rest are in the people list

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// The grid for `count` tiles in a `width` x `height` area (the area under the top bar and above the buttons).
// Few people get big tiles; on a tall screen they stack, on a wide one they sit side by side.
export function gridMetrics({ width, height, count, gap = 8 }) {
  const n = Math.max(1, Math.min(count, MAX_TILES));
  const landscape = width > height;
  let columns;
  if (n === 1) {
    columns = 1;
  } else if (n === 2) {
    columns = landscape ? 2 : 1;
  } else if (n <= 4) {
    columns = 2;
  } else if (n <= 6) {
    columns = landscape ? 3 : 2;
  } else {
    columns = 3;
  }
  if (landscape && n >= 7) {
    columns = 4;
  }
  const rows = Math.ceil(n / columns);
  const tileWidth = Math.floor((width - gap * (columns - 1)) / columns);
  const tileHeight = Math.floor((height - gap * (rows - 1)) / rows);
  return {
    columns,
    rows,
    count: n,
    tileWidth: clamp(tileWidth, 60, width),
    tileHeight: clamp(tileHeight, 60, height),
    gap,
  };
}

// Who gets a tile when there are more people than tiles: the person sharing first, then you, then whoever is
// talking, then people with a camera on, then the rest in the order they joined.
export function orderTiles(people, { myId, speakingId, sharingId }) {
  const rank = p => {
    if (p.id === sharingId) {
      return 0;
    }
    if (p.id === myId) {
      return 1;
    }
    if (p.id === speakingId) {
      return 2;
    }
    return p.videoOn ? 3 : 4;
  };
  return people
    .map((p, index) => ({ p, index }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.index - b.index)
    .map(x => x.p);
}

export function formatTimer(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = n => String(n).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const clock = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return hours ? `${hours}:${clock}` : clock;
}

// The meeting id as the app shows and shares it, and the link that opens it in the app
export const MEETING_SCHEME = 'atiyaherbs://meeting/';
export const meetingLink = id => `${MEETING_SCHEME}${id}`;
export function parseMeetingLink(url) {
  const match =
    /^atiyaherbs:\/\/meeting\/([A-Za-z]{3}-?[A-Za-z]{4}-?[A-Za-z]{3})\/?$/.exec(
      String(url || '').trim(),
    );
  return match ? match[1].toLowerCase() : null;
}
