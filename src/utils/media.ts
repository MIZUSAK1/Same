import type { MediaProvider } from '../types/room';

export interface ParsedMediaUrl {
  provider: MediaProvider;
  mediaId: string;
  sourceUrl: string;
  needsResolve?: boolean;
}

export function getProviderLabel(provider: MediaProvider): string {
  switch (provider) {
    case 'youtube':
      return 'YouTube';
    case 'soundcloud':
      return 'SoundCloud';
    case 'bilibili':
      return 'Bilibili';
    case 'twitch':
      return 'Twitch';
    case 'spotify':
      return 'Spotify';
    case 'apple_music':
      return 'Apple Music';
    case 'kkbox':
      return 'KKBOX';
  }
}

export function supportsFullPlaybackSync(provider: MediaProvider): boolean {
  return provider === 'youtube' || provider === 'soundcloud' || provider === 'twitch';
}

export function isShortLinkNeedingResolve(rawInput: string): boolean {
  const input = rawInput.trim();
  if (!input) return false;
  try {
    const normalized = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'b23.tv' || host === 'on.soundcloud.com' || host === 'kkbox.fm';
  } catch {
    return false;
  }
}

export function parseMediaUrl(rawInput: string): ParsedMediaUrl | null {
  const input = rawInput.trim();
  if (!input) return null;

  // Direct 11-char YouTube video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return {
      provider: 'youtube',
      mediaId: input,
      sourceUrl: `https://www.youtube.com/watch?v=${input}`,
    };
  }

  let url: URL;
  try {
    const normalized = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    url = new URL(normalized);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '').toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  // 1. YouTube
  if (host === 'youtu.be') {
    const id = parts[0];
    if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
      return {
        provider: 'youtube',
        mediaId: id,
        sourceUrl: `https://www.youtube.com/watch?v=${id}`,
      };
    }
    return null;
  }

  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    const vParam = url.searchParams.get('v');
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
      return {
        provider: 'youtube',
        mediaId: vParam,
        sourceUrl: `https://www.youtube.com/watch?v=${vParam}`,
      };
    }
    if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) {
      const id = parts[1];
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) {
        return {
          provider: 'youtube',
          mediaId: id,
          sourceUrl: `https://www.youtube.com/watch?v=${id}`,
        };
      }
    }
    return null;
  }

  // 2. SoundCloud
  if (host === 'on.soundcloud.com') {
    return {
      provider: 'soundcloud',
      mediaId: url.toString(),
      sourceUrl: url.toString(),
      needsResolve: true,
    };
  }

  if (host === 'soundcloud.com') {
    if (parts.length >= 2) {
      const cleanUrl = `https://soundcloud.com/${parts.join('/')}`;
      return {
        provider: 'soundcloud',
        mediaId: cleanUrl,
        sourceUrl: cleanUrl,
      };
    }
    return null;
  }

  // 3. Bilibili
  if (host === 'b23.tv') {
    return {
      provider: 'bilibili',
      mediaId: url.toString(),
      sourceUrl: url.toString(),
      needsResolve: true,
    };
  }

  if (host === 'bilibili.com' || host === 'player.bilibili.com') {
    const bvMatch = url.pathname.match(/(BV[0-9A-Za-z]+)/);
    if (bvMatch) {
      const bvid = bvMatch[1];
      return {
        provider: 'bilibili',
        mediaId: `bvid:${bvid}`,
        sourceUrl: `https://www.bilibili.com/video/${bvid}`,
      };
    }
    const avMatch = url.pathname.match(/av(\d+)/i);
    if (avMatch) {
      const aid = avMatch[1];
      return {
        provider: 'bilibili',
        mediaId: `aid:${aid}`,
        sourceUrl: `https://www.bilibili.com/video/av${aid}`,
      };
    }
    const bvidParam = url.searchParams.get('bvid');
    if (bvidParam) {
      return {
        provider: 'bilibili',
        mediaId: `bvid:${bvidParam}`,
        sourceUrl: `https://www.bilibili.com/video/${bvidParam}`,
      };
    }
    return null;
  }

  // 4. Twitch
  if (host === 'clips.twitch.tv' && parts[0]) {
    return {
      provider: 'twitch',
      mediaId: `clip:${parts[0]}`,
      sourceUrl: `https://clips.twitch.tv/${parts[0]}`,
    };
  }

  if (host === 'twitch.tv') {
    if (parts[0] === 'videos' && parts[1] && /^\d+$/.test(parts[1])) {
      return {
        provider: 'twitch',
        mediaId: `video:${parts[1]}`,
        sourceUrl: `https://www.twitch.tv/videos/${parts[1]}`,
      };
    }
    if (parts[1] === 'clip' && parts[2]) {
      return {
        provider: 'twitch',
        mediaId: `clip:${parts[2]}`,
        sourceUrl: `https://www.twitch.tv/${parts[0]}/clip/${parts[2]}`,
      };
    }
    if (parts[0] && !['directory', 'downloads', 'jobs', 'p', 'settings'].includes(parts[0])) {
      return {
        provider: 'twitch',
        mediaId: `channel:${parts[0]}`,
        sourceUrl: `https://www.twitch.tv/${parts[0]}`,
      };
    }
    return null;
  }

  // 5. Spotify
  if (host === 'open.spotify.com') {
    // Strip optional /intl-xx prefix
    const normalizedParts = parts[0]?.startsWith('intl-') ? parts.slice(1) : parts;
    const kind = normalizedParts[0];
    const id = normalizedParts[1];
    if (kind && id && ['track', 'album', 'playlist', 'episode', 'show'].includes(kind)) {
      return {
        provider: 'spotify',
        mediaId: `${kind}:${id}`,
        sourceUrl: `https://open.spotify.com/${kind}/${id}`,
      };
    }
    return null;
  }

  // 6. Apple Music
  if (host === 'music.apple.com' || host === 'embed.music.apple.com') {
    if (parts.length >= 3) {
      const embedPath = `${url.pathname}${url.search}`;
      return {
        provider: 'apple_music',
        mediaId: embedPath,
        sourceUrl: `https://music.apple.com${embedPath}`,
      };
    }
    return null;
  }

  // 7. KKBOX
  if (host === 'kkbox.fm') {
    return {
      provider: 'kkbox',
      mediaId: url.toString(),
      sourceUrl: url.toString(),
      needsResolve: true,
    };
  }

  if (host === 'kkbox.com' || host === 'play.kkbox.com') {
    // e.g. /tw/tc/song/Gp3v... or /tw/tc/album/... or /tw/tc/playlist/...
    const idx = parts.findIndex((p) => ['song', 'album', 'playlist'].includes(p));
    if (idx !== -1 && parts[idx + 1]) {
      const kind = parts[idx];
      const id = parts[idx + 1];
      return {
        provider: 'kkbox',
        mediaId: `${kind}:${id}`,
        sourceUrl: url.toString(),
      };
    }
    return null;
  }

  return null;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const totalSeconds = Math.floor(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}
