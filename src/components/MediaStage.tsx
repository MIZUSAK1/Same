import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Expand,
  ExternalLink,
  Lock,
  Maximize2,
  Minimize2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Shrink,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { PlaybackState, Role } from '../types/room';
import { formatTime, getProviderLabel, supportsFullPlaybackSync } from '../utils/media';

// --- External Player SDK Types & Loaders ---

interface YTPlayerInstance {
  loadVideoById: (options: { videoId: string; startSeconds?: number }) => void;
  cueVideoById: (options: { videoId: string; startSeconds?: number }) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setVolume: (volume: number) => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  getIframe?: () => HTMLIFrameElement;
  destroy: () => void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId?: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YTPlayerInstance }) => void;
        onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayerInstance;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

interface SCWidgetInstance {
  bind: (eventName: string, listener: (...args: unknown[]) => void) => void;
  unbind: (eventName: string) => void;
  load: (url: string, options?: Record<string, unknown>) => void;
  play: () => void;
  pause: () => void;
  seekTo: (milliseconds: number) => void;
  setVolume: (volume: number) => void;
  getPosition: (callback: (ms: number) => void) => void;
  getDuration: (callback: (ms: number) => void) => void;
  isPaused: (callback: (paused: boolean) => void) => void;
  getSounds: (callback: (sounds: unknown[]) => void) => void;
  getCurrentSoundIndex: (callback: (index: number) => void) => void;
}

interface SCNamespace {
  Widget: ((iframe: HTMLIFrameElement) => SCWidgetInstance) & {
    Events: {
      READY: string;
      PLAY: string;
      PAUSE: string;
      FINISH: string;
      ERROR: string;
    };
  };
}

interface TwitchPlayerInstance {
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  isPaused: () => boolean;
  addEventListener: (event: string, listener: () => void) => void;
  removeEventListener: (event: string, listener: () => void) => void;
  destroy?: () => void;
}

interface TwitchNamespace {
  Player: (new (
    element: HTMLElement | string,
    options: {
      width: string | number;
      height: string | number;
      channel?: string;
      video?: string;
      parent: string[];
      autoplay?: boolean;
      muted?: boolean;
    },
  ) => TwitchPlayerInstance) & {
    READY: string;
    PLAY: string;
    PAUSE: string;
    ENDED: string;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
    SC?: SCNamespace;
    Twitch?: TwitchNamespace;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeIframeAPI(): Promise<YTNamespace> {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<YTNamespace>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      if (window.YT) resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return ytApiPromise;
}

let scApiPromise: Promise<SCNamespace> | null = null;
function loadSoundCloudAPI(): Promise<SCNamespace> {
  if (window.SC) return Promise.resolve(window.SC);
  if (scApiPromise) return scApiPromise;

  scApiPromise = new Promise<SCNamespace>((resolve, reject) => {
    const existing = document.querySelector('script[src="https://w.soundcloud.com/player/api.js"]');
    if (existing) {
      const check = window.setInterval(() => {
        if (window.SC) {
          window.clearInterval(check);
          resolve(window.SC);
        }
      }, 100);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://w.soundcloud.com/player/api.js';
    script.async = true;
    script.onload = () => {
      if (window.SC) resolve(window.SC);
      else reject(new Error('SoundCloud SDK unavailable'));
    };
    script.onerror = () => reject(new Error('SoundCloud SDK load failed'));
    document.head.appendChild(script);
  });
  return scApiPromise;
}

let twitchApiPromise: Promise<TwitchNamespace> | null = null;
function loadTwitchAPI(): Promise<TwitchNamespace> {
  if (window.Twitch) return Promise.resolve(window.Twitch);
  if (twitchApiPromise) return twitchApiPromise;

  twitchApiPromise = new Promise<TwitchNamespace>((resolve, reject) => {
    const existing = document.querySelector('script[src="https://player.twitch.tv/js/embed/v1.js"]');
    if (existing) {
      const check = window.setInterval(() => {
        if (window.Twitch) {
          window.clearInterval(check);
          resolve(window.Twitch);
        }
      }, 100);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://player.twitch.tv/js/embed/v1.js';
    script.async = true;
    script.onload = () => {
      if (window.Twitch) resolve(window.Twitch);
      else reject(new Error('Twitch SDK unavailable'));
    };
    script.onerror = () => reject(new Error('Twitch SDK load failed'));
    document.head.appendChild(script);
  });
  return twitchApiPromise;
}

// --- Component ---

interface MediaStageProps {
  role: Role;
  playback: PlaybackState;
  serverTimeOffset: number;
  queueLength: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onPlay: (positionSeconds?: number) => void;
  onPause: (positionSeconds?: number) => void;
  onSeek: (positionSeconds: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onTrackEnded: (trackId: string) => void;
  onRequestSync: () => void;
}

export function MediaStage({
  role,
  playback,
  serverTimeOffset,
  queueLength,
  isExpanded,
  onToggleExpand,
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrev,
  onTrackEnded,
  onRequestSync,
}: MediaStageProps) {
  const isHost = role === 'host';
  const stageRootRef = useRef<HTMLDivElement | null>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const ytReadyRef = useRef(false);
  const ytLoadedTrackIdRef = useRef<string | null>(null);

  const scIframeRef = useRef<HTMLIFrameElement | null>(null);
  const scWidgetRef = useRef<SCWidgetInstance | null>(null);
  const scReadyRef = useRef(false);
  const scSoundCountRef = useRef(1);
  const scCurrentIndexRef = useRef(0);
  const scLastPosMsRef = useRef(0);
  const scPlaylistTransitionUntilRef = useRef(0);

  const twitchContainerRef = useRef<HTMLDivElement | null>(null);
  const twitchPlayerRef = useRef<TwitchPlayerInstance | null>(null);
  const twitchReadyRef = useRef(false);

  const isRemoteSyncRef = useRef(false);
  const remoteSyncTimerRef = useRef<number | null>(null);
  const endedDispatchedTrackIdRef = useRef<string | null>(null);
  const lastSyncedPlaybackRef = useRef<{
    trackId: string | null;
    isPlaying: boolean;
    positionSeconds: number;
    updatedAt: number;
  } | null>(null);

  const [localTime, setLocalTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const currentTrack = playback.currentTrack;
  const provider = currentTrack?.provider ?? null;
  const fullSyncSupported = currentTrack ? supportsFullPlaybackSync(currentTrack.provider) : true;
  const isTwitchClip =
    currentTrack?.provider === 'twitch' && currentTrack.mediaId.startsWith('clip:');
  const isTwitchLive =
    currentTrack?.provider === 'twitch' && currentTrack.mediaId.startsWith('channel:');

  const latestPropsRef = useRef({
    isHost,
    playback,
    serverTimeOffset,
    volume,
    isMuted,
    onPlay,
    onPause,
    onSeek,
    onNext,
    onPrev,
    onTrackEnded,
    onRequestSync,
  });
  latestPropsRef.current = {
    isHost,
    playback,
    serverTimeOffset,
    volume,
    isMuted,
    onPlay,
    onPause,
    onSeek,
    onNext,
    onPrev,
    onTrackEnded,
    onRequestSync,
  };

  const localTimeRef = useRef(0);
  localTimeRef.current = localTime;

  const getAuthoritativePosition = (pb: PlaybackState, offset: number) => {
    if (!pb.currentTrack) return 0;
    if (!pb.isPlaying) return pb.positionSeconds;
    const estimatedServerNow = Date.now() + offset;
    const elapsed = Math.max(0, (estimatedServerNow - pb.updatedAt) / 1000);
    return pb.positionSeconds + elapsed;
  };

  const markRemoteSync = (durationMs = 1000) => {
    isRemoteSyncRef.current = true;
    if (remoteSyncTimerRef.current) window.clearTimeout(remoteSyncTimerRef.current);
    remoteSyncTimerRef.current = window.setTimeout(() => {
      isRemoteSyncRef.current = false;
    }, durationMs);
  };

  // Track native fullscreen changes
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleToggleFullscreen = async () => {
    if (!stageRootRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stageRootRef.current.requestFullscreen();
      }
    } catch {
      // Fallback: toggle expanded mode if fullscreen API is restricted in an iframe
      onToggleExpand();
    }
  };

  // --- 1. YouTube Player Lifecycle ---
  useEffect(() => {
    if (provider !== 'youtube') {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore
        }
        ytPlayerRef.current = null;
        ytReadyRef.current = false;
        ytLoadedTrackIdRef.current = null;
      }
      return;
    }

    let cancelled = false;
    loadYouTubeIframeAPI().then((YT) => {
      if (cancelled || !ytContainerRef.current || ytPlayerRef.current) return;

      const mountTarget = document.createElement('div');
      mountTarget.className = 'h-full w-full';
      ytContainerRef.current.innerHTML = '';
      ytContainerRef.current.appendChild(mountTarget);

      ytPlayerRef.current = new YT.Player(mountTarget, {
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: isHost ? 1 : 0,
          disablekb: isHost ? 0 : 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: (event) => {
            if (cancelled) return;
            ytReadyRef.current = true;
            try {
              const iframe = event.target.getIframe?.();
              if (iframe) {
                iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
              }
            } catch {
              // Ignore
            }
            const { playback: pb, serverTimeOffset: offset, volume: vol, isMuted: muted } =
              latestPropsRef.current;
            event.target.setVolume(muted ? 0 : vol);
            if (muted) event.target.mute();
            if (pb.currentTrack && pb.currentTrack.provider === 'youtube') {
              const targetPos = getAuthoritativePosition(pb, offset);
              ytLoadedTrackIdRef.current = pb.currentTrack.id;
              endedDispatchedTrackIdRef.current = null;
              markRemoteSync();
              if (pb.isPlaying) {
                event.target.loadVideoById({ videoId: pb.currentTrack.mediaId, startSeconds: targetPos });
              } else {
                event.target.cueVideoById({ videoId: pb.currentTrack.mediaId, startSeconds: targetPos });
              }
            }
          },
          onStateChange: (event) => {
            if (cancelled) return;
            const {
              isHost: hostMode,
              playback: pb,
              onPlay: emitPlay,
              onPause: emitPause,
              onTrackEnded: emitEnded,
            } = latestPropsRef.current;
            const YTState = window.YT?.PlayerState;
            if (!YTState) return;

            if (event.data === YTState.PLAYING) {
              setAutoplayBlocked(false);
              setPlayerError(null);
              endedDispatchedTrackIdRef.current = null;
              const { volume: vol, isMuted: muted } = latestPropsRef.current;
              event.target.setVolume(muted ? 0 : vol);
              if (muted || vol === 0) event.target.mute();
              else if (event.target.isMuted()) event.target.unMute();
              const dur = event.target.getDuration();
              if (dur > 0) setDuration(dur);
            }

            if (event.data === YTState.ENDED) {
              if (
                hostMode &&
                pb.currentTrack &&
                endedDispatchedTrackIdRef.current !== pb.currentTrack.id
              ) {
                endedDispatchedTrackIdRef.current = pb.currentTrack.id;
                emitEnded(pb.currentTrack.id);
              }
              return;
            }

            if (isRemoteSyncRef.current) return;

            if (hostMode && pb.currentTrack) {
              const currentPos = event.target.getCurrentTime();
              if (event.data === YTState.PLAYING && !pb.isPlaying) {
                emitPlay(currentPos);
              } else if (event.data === YTState.PAUSED && pb.isPlaying && !document.hidden) {
                emitPause(currentPos);
              }
            }
          },
          onError: (event) => {
            if (cancelled) return;
            if (event.data === 101 || event.data === 150) {
              setPlayerError('此 YouTube 影片未開放外部網頁嵌入播放，請換另一首連結。');
            } else if (event.data === 100) {
              setPlayerError('找不到此 YouTube 影片，可能已被刪除或設為私人影片。');
            } else {
              setPlayerError('YouTube 播放器載入失敗，請檢查連結或更換歌曲。');
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore
        }
        ytPlayerRef.current = null;
        ytReadyRef.current = false;
        ytLoadedTrackIdRef.current = null;
      }
    };
  }, [provider, isHost]);

  // --- 2. SoundCloud Widget Lifecycle ---
  useEffect(() => {
    if (provider !== 'soundcloud' || !currentTrack) {
      scWidgetRef.current = null;
      scReadyRef.current = false;
      scSoundCountRef.current = 1;
      scCurrentIndexRef.current = 0;
      scLastPosMsRef.current = 0;
      scPlaylistTransitionUntilRef.current = 0;
      return;
    }

    let cancelled = false;
    scReadyRef.current = false;
    scSoundCountRef.current = currentTrack.sourceUrl.includes('/sets/') ? 2 : 1;
    scCurrentIndexRef.current = 0;
    scLastPosMsRef.current = 0;
    scPlaylistTransitionUntilRef.current = 0;
    setPlayerError(null);
    setAutoplayBlocked(false);
    setLocalTime(0);
    setDuration(0);

    loadSoundCloudAPI()
      .then((SC) => {
        if (cancelled || !scIframeRef.current) return;
        const widget = SC.Widget(scIframeRef.current);
        scWidgetRef.current = widget;

        widget.bind(SC.Widget.Events.READY, () => {
          if (cancelled) return;
          scReadyRef.current = true;
          const { playback: pb, serverTimeOffset: offset, volume: vol, isMuted: muted } =
            latestPropsRef.current;
          widget.setVolume(muted ? 0 : vol);
          widget.getSounds((sounds) => {
            if (!cancelled && Array.isArray(sounds) && sounds.length > 0) {
              scSoundCountRef.current = sounds.length;
            }
          });
          widget.getCurrentSoundIndex((idx) => {
            if (!cancelled && typeof idx === 'number') {
              scCurrentIndexRef.current = idx;
            }
          });
          widget.getDuration((ms) => {
            if (!cancelled && ms > 0) setDuration(ms / 1000);
          });
          if (pb.currentTrack && pb.currentTrack.id === currentTrack.id) {
            const isSet = currentTrack.sourceUrl.includes('/sets/');
            const targetPos = isSet ? pb.positionSeconds : getAuthoritativePosition(pb, offset);
            markRemoteSync(1500);
            if (targetPos > 0.5) widget.seekTo(targetPos * 1000);
            if (pb.isPlaying) widget.play();
            else widget.pause();
          }
        });

        widget.bind(SC.Widget.Events.PLAY, () => {
          if (cancelled) return;
          setAutoplayBlocked(false);
          const { isHost: hostMode, playback: pb, volume: vol, isMuted: muted, onPlay: emitPlay } =
            latestPropsRef.current;
          // Re-apply user volume when SoundCloud resumes/starts audio element
          const targetVol = muted ? 0 : vol;
          widget.setVolume(targetVol);
          window.setTimeout(() => {
            if (!cancelled && scWidgetRef.current === widget) {
              widget.setVolume(latestPropsRef.current.isMuted ? 0 : latestPropsRef.current.volume);
            }
          }, 150);

          widget.getCurrentSoundIndex((idx) => {
            if (!cancelled && typeof idx === 'number') {
              scCurrentIndexRef.current = idx;
            }
          });
          widget.getDuration((ms) => {
            if (!cancelled && ms > 0) setDuration(ms / 1000);
          });

          if (
            !isRemoteSyncRef.current &&
            Date.now() >= scPlaylistTransitionUntilRef.current &&
            hostMode &&
            pb.currentTrack &&
            !pb.isPlaying
          ) {
            widget.getPosition((ms) => emitPlay(ms / 1000));
          }
        });

        widget.bind(SC.Widget.Events.PAUSE, () => {
          if (cancelled) return;
          if (Date.now() < scPlaylistTransitionUntilRef.current) return;
          const { isHost: hostMode, playback: pb, onPause: emitPause } = latestPropsRef.current;
          if (
            !isRemoteSyncRef.current &&
            hostMode &&
            pb.currentTrack &&
            pb.isPlaying &&
            !document.hidden
          ) {
            widget.getPosition((ms) => {
              if (cancelled) return;
              if (isRemoteSyncRef.current || Date.now() < scPlaylistTransitionUntilRef.current) {
                return;
              }
              widget.getDuration((durMs) => {
                if (cancelled) return;
                const nearEnd = durMs > 0 && ms >= durMs - 1500;
                const jumpedToStartOnPlaylist =
                  scSoundCountRef.current > 1 && ms <= 500 && scLastPosMsRef.current > 2000;
                if (nearEnd || jumpedToStartOnPlaylist) {
                  return;
                }
                emitPause(ms / 1000);
              });
            });
          }
        });

        widget.bind(SC.Widget.Events.FINISH, () => {
          if (cancelled) return;
          const { isHost: hostMode, playback: pb, onTrackEnded: emitEnded } = latestPropsRef.current;
          if (!pb.currentTrack) return;

          const prevIdx = scCurrentIndexRef.current;
          const knownCount = scSoundCountRef.current;

          widget.getSounds((sounds) => {
            if (cancelled) return;
            const total = Array.isArray(sounds) && sounds.length > 0 ? sounds.length : knownCount;
            scSoundCountRef.current = total;

            widget.getCurrentSoundIndex((currentIdx) => {
              if (cancelled) return;
              const isPlaylist = total > 1;
              const hasMoreInPlaylist =
                isPlaylist && (prevIdx < total - 1 || currentIdx < total - 1);

              if (hasMoreInPlaylist) {
                scPlaylistTransitionUntilRef.current = Date.now() + 2500;
                scLastPosMsRef.current = 0;
                markRemoteSync(2500);

                const ensurePlaylistContinues = () => {
                  if (cancelled || scWidgetRef.current !== widget) return;
                  widget.getCurrentSoundIndex((nextIdx) => {
                    if (!cancelled && typeof nextIdx === 'number') {
                      scCurrentIndexRef.current = nextIdx;
                    }
                  });
                  widget.getDuration((ms) => {
                    if (!cancelled && ms > 0) setDuration(ms / 1000);
                  });
                  if (latestPropsRef.current.playback.isPlaying) {
                    widget.isPaused((paused) => {
                      if (!cancelled && paused && scWidgetRef.current === widget) {
                        widget.setVolume(
                          latestPropsRef.current.isMuted ? 0 : latestPropsRef.current.volume,
                        );
                        widget.play();
                      }
                    });
                  }
                };

                window.setTimeout(ensurePlaylistContinues, 300);
                window.setTimeout(ensurePlaylistContinues, 800);
                return;
              }

              if (
                hostMode &&
                pb.currentTrack &&
                endedDispatchedTrackIdRef.current !== pb.currentTrack.id
              ) {
                endedDispatchedTrackIdRef.current = pb.currentTrack.id;
                emitEnded(pb.currentTrack.id);
              }
            });
          });
        });
      })
      .catch(() => {
        if (!cancelled) setPlayerError('SoundCloud 播放器載入失敗，請確認連結是否有效。');
      });

    return () => {
      cancelled = true;
      scReadyRef.current = false;
      scWidgetRef.current = null;
    };
  }, [provider, currentTrack?.id]);

  // --- 3. Twitch Player SDK Lifecycle (channels & VODs) ---
  useEffect(() => {
    if (provider !== 'twitch' || !currentTrack || isTwitchClip) {
      if (twitchPlayerRef.current) {
        try {
          twitchPlayerRef.current.destroy?.();
        } catch {
          // Ignore
        }
        twitchPlayerRef.current = null;
        twitchReadyRef.current = false;
      }
      return;
    }

    let cancelled = false;
    twitchReadyRef.current = false;
    setPlayerError(null);
    setAutoplayBlocked(false);
    setLocalTime(0);
    setDuration(0);

    loadTwitchAPI()
      .then((Twitch) => {
        if (cancelled || !twitchContainerRef.current) return;
        twitchContainerRef.current.innerHTML = '';
        const mountDiv = document.createElement('div');
        mountDiv.className = 'h-full w-full';
        twitchContainerRef.current.appendChild(mountDiv);

        const [kind, val] = currentTrack.mediaId.split(':');
        const options = {
          width: '100%',
          height: '100%',
          parent: [window.location.hostname],
          autoplay: playback.isPlaying,
          muted: false,
          ...(kind === 'video' ? { video: val } : { channel: val }),
        };

        const player = new Twitch.Player(mountDiv, options);
        twitchPlayerRef.current = player;

        player.addEventListener(Twitch.Player.READY, () => {
          if (cancelled) return;
          twitchReadyRef.current = true;
          const { playback: pb, serverTimeOffset: offset, volume: vol, isMuted: muted } =
            latestPropsRef.current;
          player.setVolume((muted ? 0 : vol) / 100);
          player.setMuted(muted);
          if (kind === 'video' && pb.currentTrack) {
            const targetPos = getAuthoritativePosition(pb, offset);
            markRemoteSync();
            if (targetPos > 1) player.seek(targetPos);
          }
          if (pb.isPlaying) player.play();
          else player.pause();
        });

        player.addEventListener(Twitch.Player.PLAY, () => {
          if (cancelled) return;
          setAutoplayBlocked(false);
          const { isHost: hostMode, playback: pb, volume: vol, isMuted: muted, onPlay: emitPlay } =
            latestPropsRef.current;
          player.setVolume((muted ? 0 : vol) / 100);
          player.setMuted(muted || vol === 0);
          if (!isRemoteSyncRef.current && hostMode && pb.currentTrack && !pb.isPlaying) {
            emitPlay(kind === 'video' ? player.getCurrentTime() : 0);
          }
        });

        player.addEventListener(Twitch.Player.PAUSE, () => {
          if (cancelled) return;
          const { isHost: hostMode, playback: pb, onPause: emitPause } = latestPropsRef.current;
          if (
            !isRemoteSyncRef.current &&
            hostMode &&
            pb.currentTrack &&
            pb.isPlaying &&
            !document.hidden
          ) {
            emitPause(kind === 'video' ? player.getCurrentTime() : 0);
          }
        });

        player.addEventListener(Twitch.Player.ENDED, () => {
          if (cancelled) return;
          const { isHost: hostMode, playback: pb, onTrackEnded: emitEnded } = latestPropsRef.current;
          if (
            hostMode &&
            pb.currentTrack &&
            endedDispatchedTrackIdRef.current !== pb.currentTrack.id
          ) {
            endedDispatchedTrackIdRef.current = pb.currentTrack.id;
            emitEnded(pb.currentTrack.id);
          }
        });
      })
      .catch(() => {
        if (!cancelled) setPlayerError('Twitch 播放器載入失敗，請確認頻道名稱或網址。');
      });

    return () => {
      cancelled = true;
      twitchReadyRef.current = false;
      if (twitchPlayerRef.current) {
        try {
          twitchPlayerRef.current.destroy?.();
        } catch {
          // Ignore
        }
        twitchPlayerRef.current = null;
      }
    };
  }, [provider, currentTrack?.id, isTwitchClip]);

  // --- Sync Authoritative State to Active SDK Player ---
  useEffect(() => {
    const track = playback.currentTrack;
    const prevSynced = lastSyncedPlaybackRef.current;
    if (
      prevSynced &&
      prevSynced.trackId === (track?.id ?? null) &&
      prevSynced.isPlaying === playback.isPlaying &&
      prevSynced.positionSeconds === playback.positionSeconds &&
      prevSynced.updatedAt === playback.updatedAt
    ) {
      return;
    }
    lastSyncedPlaybackRef.current = {
      trackId: track?.id ?? null,
      isPlaying: playback.isPlaying,
      positionSeconds: playback.positionSeconds,
      updatedAt: playback.updatedAt,
    };

    if (!track) {
      setLocalTime(0);
      setDuration(0);
      setPlayerError(null);
      setAutoplayBlocked(false);
      return;
    }

    const targetPos = getAuthoritativePosition(playback, serverTimeOffset);

    // YouTube Sync
    if (track.provider === 'youtube' && ytPlayerRef.current && ytReadyRef.current) {
      const player = ytPlayerRef.current;
      if (ytLoadedTrackIdRef.current !== track.id) {
        ytLoadedTrackIdRef.current = track.id;
        endedDispatchedTrackIdRef.current = null;
        setPlayerError(null);
        setLocalTime(targetPos);
        setDuration(0);
        markRemoteSync();
        if (playback.isPlaying) {
          player.loadVideoById({ videoId: track.mediaId, startSeconds: targetPos });
        } else {
          player.cueVideoById({ videoId: track.mediaId, startSeconds: targetPos });
        }
        return;
      }

      const state = player.getPlayerState();
      const YTState = window.YT?.PlayerState;
      const currentPos = player.getCurrentTime() || 0;
      const drift = Math.abs(currentPos - targetPos);

      markRemoteSync();
      if (playback.isPlaying) {
        if (drift > 1.8) {
          player.seekTo(targetPos, true);
          setLocalTime(targetPos);
        }
        if (YTState && state !== YTState.PLAYING && state !== YTState.BUFFERING) {
          player.playVideo();
        }
      } else if (YTState && state === YTState.ENDED) {
        player.cueVideoById({ videoId: track.mediaId, startSeconds: targetPos });
        setLocalTime(targetPos);
      } else {
        if (YTState && state === YTState.PLAYING) {
          player.pauseVideo();
        }
        if (drift > 1.8) {
          player.seekTo(targetPos, true);
          setLocalTime(targetPos);
        }
      }
      return;
    }

    // SoundCloud Sync
    if (track.provider === 'soundcloud' && scWidgetRef.current && scReadyRef.current) {
      const widget = scWidgetRef.current;
      const { volume: vol, isMuted: muted } = latestPropsRef.current;
      const isPlaylist = scSoundCountRef.current > 1 || track.sourceUrl.includes('/sets/');
      markRemoteSync(1500);
      widget.setVolume(muted ? 0 : vol);
      if (!isPlaylist) {
        widget.getPosition((ms) => {
          const curSec = ms / 1000;
          if (Math.abs(curSec - targetPos) > 2.2) {
            markRemoteSync(1500);
            widget.seekTo(targetPos * 1000);
            setLocalTime(targetPos);
          }
        });
      } else if (
        prevSynced &&
        prevSynced.trackId === track.id &&
        Math.abs(playback.positionSeconds - localTimeRef.current) > 2.2 &&
        Date.now() + serverTimeOffset - playback.updatedAt < 3000
      ) {
        widget.seekTo(playback.positionSeconds * 1000);
        setLocalTime(playback.positionSeconds);
      }
      if (playback.isPlaying) {
        widget.play();
      } else {
        widget.pause();
      }
      return;
    }

    // Twitch Sync
    if (track.provider === 'twitch' && twitchPlayerRef.current && twitchReadyRef.current) {
      const player = twitchPlayerRef.current;
      markRemoteSync();
      if (!isTwitchLive) {
        const cur = player.getCurrentTime() || 0;
        if (Math.abs(cur - targetPos) > 2.2) {
          player.seek(targetPos);
          setLocalTime(targetPos);
        }
      }
      if (playback.isPlaying) player.play();
      else player.pause();
    }
  }, [playback, serverTimeOffset, isTwitchLive]);

  // --- 500ms Timer for Scrubber, Drift Check & Background Auto-Advance ---
  useEffect(() => {
    const interval = window.setInterval(() => {
      const { playback: pb, serverTimeOffset: offset, isHost: hostMode } = latestPropsRef.current;
      const track = pb.currentTrack;
      if (!track) return;

      if (track.provider === 'youtube' && ytPlayerRef.current && ytReadyRef.current) {
        const player = ytPlayerRef.current;
        const dur = player.getDuration();
        if (dur > 0) setDuration(dur);

        const cur = player.getCurrentTime();
        if (!isScrubbing && Number.isFinite(cur)) setLocalTime(cur);

        const YTState = window.YT?.PlayerState;
        const pState = player.getPlayerState();

        if (
          hostMode &&
          pb.isPlaying &&
          YTState &&
          pState === YTState.ENDED &&
          endedDispatchedTrackIdRef.current !== track.id
        ) {
          endedDispatchedTrackIdRef.current = track.id;
          latestPropsRef.current.onTrackEnded(track.id);
          return;
        }

        if (!hostMode && pb.isPlaying && YTState) {
          if (pState === YTState.UNSTARTED || pState === YTState.PAUSED || pState === YTState.CUED) {
            setAutoplayBlocked(true);
          } else if (pState === YTState.PLAYING) {
            setAutoplayBlocked(false);
          }
        }

        if (!hostMode && pb.isPlaying && YTState && pState === YTState.PLAYING) {
          const expected = getAuthoritativePosition(pb, offset);
          if (Math.abs(cur - expected) > 2.2) {
            markRemoteSync();
            player.seekTo(expected, true);
          }
        }
      } else if (track.provider === 'soundcloud' && scWidgetRef.current && scReadyRef.current) {
        const widget = scWidgetRef.current;
        widget.getDuration((ms) => {
          if (ms > 0) setDuration(ms / 1000);
        });
        widget.getCurrentSoundIndex((idx) => {
          if (typeof idx === 'number') scCurrentIndexRef.current = idx;
        });
        widget.getPosition((ms) => {
          scLastPosMsRef.current = ms;
          const cur = ms / 1000;
          if (!isScrubbing && Number.isFinite(cur)) setLocalTime(cur);
          if (!hostMode && pb.isPlaying && scSoundCountRef.current <= 1 && !track.sourceUrl.includes('/sets/')) {
            const expected = getAuthoritativePosition(pb, offset);
            if (Math.abs(cur - expected) > 2.5) {
              markRemoteSync();
              widget.seekTo(expected * 1000);
            }
          }
        });
      } else if (
        track.provider === 'twitch' &&
        twitchPlayerRef.current &&
        twitchReadyRef.current &&
        !track.mediaId.startsWith('channel:')
      ) {
        const player = twitchPlayerRef.current;
        const dur = player.getDuration();
        if (dur > 0) setDuration(dur);
        const cur = player.getCurrentTime();
        if (!isScrubbing && Number.isFinite(cur)) setLocalTime(cur);
      }
    }, 500);

    return () => window.clearInterval(interval);
  }, [isScrubbing]);

  // --- Media Session API for Background Playback ---
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    if (!currentTrack) {
      ms.metadata = null;
      ms.playbackState = 'none';
      return;
    }

    try {
      ms.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.author,
        album: `點歌：${currentTrack.addedBy} · ${getProviderLabel(currentTrack.provider)}`,
        artwork: currentTrack.thumbnailUrl
          ? [{ src: currentTrack.thumbnailUrl, sizes: '480x360', type: 'image/jpeg' }]
          : [],
      });
      ms.playbackState = playback.isPlaying ? 'playing' : 'paused';
    } catch {
      // Ignore
    }

    const safeSet = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Unsupported
      }
    };

    safeSet('play', () => {
      if (latestPropsRef.current.isHost) {
        latestPropsRef.current.onPlay(localTimeRef.current);
      }
    });
    safeSet('pause', () => {
      if (latestPropsRef.current.isHost) {
        latestPropsRef.current.onPause(localTimeRef.current);
      }
    });
    safeSet('previoustrack', isHost ? () => latestPropsRef.current.onPrev() : null);
    safeSet('nexttrack', isHost ? () => latestPropsRef.current.onNext() : null);

    return () => {
      safeSet('play', null);
      safeSet('pause', null);
      safeSet('previoustrack', null);
      safeSet('nexttrack', null);
    };
  }, [currentTrack, playback.isPlaying, isHost]);

  // --- Resync friends when returning from background tab ---
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !latestPropsRef.current.isHost) {
        latestPropsRef.current.onRequestSync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const handleTogglePlay = () => {
    if (!isHost || !currentTrack) return;
    applyVolumeToActivePlayer(volume, isMuted);
    if (playback.isPlaying) onPause(localTime);
    else onPlay(localTime);
  };

  const applyVolumeToActivePlayer = (nextVol: number, muted: boolean) => {
    if (ytPlayerRef.current && ytReadyRef.current) {
      ytPlayerRef.current.setVolume(nextVol);
      if (muted || nextVol === 0) ytPlayerRef.current.mute();
      else ytPlayerRef.current.unMute();
    }
    if (scWidgetRef.current && scReadyRef.current) {
      scWidgetRef.current.setVolume(muted ? 0 : nextVol);
    }
    if (twitchPlayerRef.current && twitchReadyRef.current) {
      twitchPlayerRef.current.setVolume((muted ? 0 : nextVol) / 100);
      twitchPlayerRef.current.setMuted(muted || nextVol === 0);
    }
  };

  const handleVolumeChange = (nextVolume: number) => {
    setVolume(nextVolume);
    const muted = nextVolume === 0;
    setIsMuted(muted);
    applyVolumeToActivePlayer(nextVolume, muted);
  };

  const handleToggleMute = () => {
    if (isMuted) {
      const restored = volume === 0 ? 70 : volume;
      setVolume(restored);
      setIsMuted(false);
      applyVolumeToActivePlayer(restored, false);
    } else {
      setIsMuted(true);
      applyVolumeToActivePlayer(volume, true);
    }
  };

  const handleManualUnlockAudio = () => {
    if (currentTrack?.provider === 'youtube' && ytPlayerRef.current && ytReadyRef.current) {
      const expected = getAuthoritativePosition(playback, serverTimeOffset);
      markRemoteSync();
      ytPlayerRef.current.seekTo(expected, true);
      ytPlayerRef.current.playVideo();
      setAutoplayBlocked(false);
    }
  };

  const renderEmbedViewport = () => {
    if (!currentTrack) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-[#15171C] text-[#E59F3C]">
            <Music2 className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-balance text-[#F3F4F6]">
            尚未播放任何歌曲
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-[#9CA3AF]">
            {isHost
              ? '在上方輸入框貼上 YouTube、SoundCloud、Bilibili、Twitch、Spotify、Apple Music 或 KKBOX 連結即可開始。'
              : '等待房主開始播放歌曲，你也可以在上方貼上各平台連結加入待播清單。'}
          </p>
        </div>
      );
    }

    if (currentTrack.provider === 'youtube') {
      return <div ref={ytContainerRef} className="h-full w-full" />;
    }

    if (currentTrack.provider === 'soundcloud') {
      const scSrc = `https://w.soundcloud.com/player/?url=${encodeURIComponent(
        currentTrack.sourceUrl,
      )}&color=%23E59F3C&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=true`;
      return (
        <iframe
          ref={scIframeRef}
          key={currentTrack.id}
          title={currentTrack.title}
          src={scSrc}
          allow="autoplay"
          className="h-full w-full border-0"
        />
      );
    }

    if (currentTrack.provider === 'twitch') {
      if (isTwitchClip) {
        const slug = currentTrack.mediaId.slice(5);
        const clipSrc = `https://clips.twitch.tv/embed?clip=${encodeURIComponent(
          slug,
        )}&parent=${encodeURIComponent(window.location.hostname)}&autoplay=true`;
        return (
          <iframe
            key={currentTrack.id}
            title={currentTrack.title}
            src={clipSrc}
            allowFullScreen
            className="h-full w-full border-0"
          />
        );
      }
      return <div ref={twitchContainerRef} className="h-full w-full" />;
    }

    if (currentTrack.provider === 'bilibili') {
      const [kind, id] = currentTrack.mediaId.split(':');
      const query = kind === 'aid' ? `aid=${encodeURIComponent(id)}` : `bvid=${encodeURIComponent(id)}`;
      const biliSrc = `https://player.bilibili.com/player.html?${query}&page=1&high_quality=1&danmaku=0&autoplay=1`;
      return (
        <iframe
          key={currentTrack.id}
          title={currentTrack.title}
          src={biliSrc}
          allowFullScreen
          allow="autoplay; fullscreen"
          referrerPolicy="no-referrer"
          className="h-full w-full border-0"
        />
      );
    }

    if (currentTrack.provider === 'spotify') {
      const [kind, id] = currentTrack.mediaId.split(':');
      const spSrc = `https://open.spotify.com/embed/${encodeURIComponent(kind)}/${encodeURIComponent(
        id,
      )}?utm_source=generator&theme=0`;
      return (
        <div className="flex h-full w-full items-center justify-center bg-[#0B0C0F] p-4 sm:p-8">
          <iframe
            key={currentTrack.id}
            title={currentTrack.title}
            src={spSrc}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            className="h-full max-h-[380px] w-full max-w-2xl rounded-xl border-0"
          />
        </div>
      );
    }

    if (currentTrack.provider === 'apple_music') {
      const amSrc = `https://embed.music.apple.com${currentTrack.mediaId}`;
      return (
        <div className="flex h-full w-full items-center justify-center bg-[#0B0C0F] p-4 sm:p-8">
          <iframe
            key={currentTrack.id}
            title={currentTrack.title}
            src={amSrc}
            allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write"
            sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
            className="h-full max-h-[450px] w-full max-w-2xl rounded-xl border-0 bg-transparent"
          />
        </div>
      );
    }

    if (currentTrack.provider === 'kkbox') {
      const [kind, id] = currentTrack.mediaId.split(':');
      const kkSrc = `https://widget.kkbox.com/v1/?id=${encodeURIComponent(
        id,
      )}&type=${encodeURIComponent(kind)}&terr=tw&lang=tc`;
      return (
        <div className="flex h-full w-full items-center justify-center bg-[#0B0C0F] p-4 sm:p-8">
          <iframe
            key={currentTrack.id}
            title={currentTrack.title}
            src={kkSrc}
            allow="autoplay; encrypted-media"
            className="h-full max-h-[360px] w-full max-w-2xl rounded-xl border-0"
          />
        </div>
      );
    }

    return null;
  };

  const displayTime = isScrubbing ? scrubValue : localTime;
  const maxDuration = duration > 0 ? duration : Math.max(displayTime, 1);

  return (
    <div
      ref={stageRootRef}
      className={`flex flex-col rounded-xl border border-white/10 bg-[#15171C] overflow-hidden ${
        isFullscreen ? 'h-screen w-screen rounded-none border-0' : ''
      }`}
    >
      {/* Top Stage Header Bar with Enlarge / Fullscreen Controls */}
      <div className="flex items-center justify-between gap-4 border-b border-white/8 px-4 py-2.5 text-xs text-[#9CA3AF]">
        <span className="truncate">
          {currentTrack ? (
            <>
              <span className="font-medium text-[#E59F3C]">
                {getProviderLabel(currentTrack.provider)}
              </span>
              <span aria-hidden="true"> · </span>
              <span>點歌：{currentTrack.addedBy}</span>
            </>
          ) : (
            <span>多平台同步播放器</span>
          )}
        </span>

        <div className="flex items-center gap-2 shrink-0">
          {currentTrack && (
            <a
              href={currentTrack.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 bg-[#1B1E25] px-2.5 text-xs text-[#D1D5DB] transition-colors hover:border-white/20 hover:text-[#F3F4F6] whitespace-nowrap shrink-0"
            >
              <ExternalLink className="h-3 w-3" />
              <span className="hidden sm:inline">原連結</span>
            </a>
          )}

          {!isFullscreen && (
            <button
              type="button"
              onClick={onToggleExpand}
              aria-label={isExpanded ? '縮小播放器' : '放大播放器'}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-[#1B1E25] px-2.5 text-xs font-medium text-[#F3F4F6] transition-colors hover:border-[#E59F3C]/50 hover:text-[#E59F3C] whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isExpanded ? (
                <>
                  <Minimize2 className="h-3.5 w-3.5" />
                  <span>還原大小</span>
                </>
              ) : (
                <>
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span>放大播放器</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleToggleFullscreen()}
            aria-label={isFullscreen ? '退出全螢幕' : '全螢幕播放'}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-[#1B1E25] px-2.5 text-xs font-medium text-[#F3F4F6] transition-colors hover:border-[#E59F3C]/50 hover:text-[#E59F3C] whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isFullscreen ? (
              <>
                <Shrink className="h-3.5 w-3.5" />
                <span>退出全螢幕</span>
              </>
            ) : (
              <>
                <Expand className="h-3.5 w-3.5" />
                <span>全螢幕</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Media Viewport */}
      <div
        className={`relative w-full bg-[#090A0C] ${
          isFullscreen
            ? 'flex-1 min-h-0'
            : isExpanded
              ? 'aspect-video max-h-[76vh]'
              : 'aspect-video'
        }`}
      >
        {renderEmbedViewport()}

        {/* Protect friend from desyncing full-sync SDK players */}
        {!isHost && currentTrack && fullSyncSupported && !isTwitchClip && !autoplayBlocked && (
          <div
            className="absolute inset-0 z-10 cursor-default"
            aria-label="同步播放畫面（由房主控制播放）"
          />
        )}

        {/* Autoplay blocked overlay for friends */}
        {!isHost && currentTrack?.provider === 'youtube' && autoplayBlocked && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#090A0C]/85 px-6 text-center backdrop-blur-sm">
            <p className="text-base font-semibold text-[#F3F4F6]">房間正在同步播放中</p>
            <p className="mt-1.5 max-w-sm text-xs text-[#9CA3AF]">
              瀏覽器預設會阻擋未互動前自動播放聲音，點擊下方按鈕即可加入同步聽歌。
            </p>
            <button
              type="button"
              onClick={handleManualUnlockAudio}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#E59F3C] px-5 py-2.5 text-sm font-semibold text-[#0D0E11] transition-colors hover:bg-[#EDA94B] cursor-pointer"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>點擊加入同步播放</span>
            </button>
          </div>
        )}

        {/* Embed error overlay */}
        {playerError && currentTrack && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#090A0C]/90 px-6 text-center">
            <AlertCircle className="h-8 w-8 text-[#F87171]" />
            <p className="mt-3 max-w-md text-sm font-medium text-[#F3F4F6]">{playerError}</p>
            {isHost && queueLength > 0 && (
              <button
                type="button"
                onClick={onNext}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#E59F3C] px-4 py-2 text-xs font-semibold text-[#0D0E11] hover:bg-[#EDA94B] cursor-pointer"
              >
                <SkipForward className="h-3.5 w-3.5" />
                <span>跳至下一首</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Track Metadata & Studio Transport Bar */}
      <div className="flex flex-col gap-4 border-t border-white/8 p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight text-[#F3F4F6]">
              {currentTrack ? currentTrack.title : '等待點播中'}
            </h1>
            <p className="mt-1 truncate text-xs text-[#9CA3AF]">
              {currentTrack ? (
                <>
                  <span className="text-[#D1D5DB]">點歌：{currentTrack.addedBy}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{getProviderLabel(currentTrack.provider)}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{currentTrack.author}</span>
                </>
              ) : (
                <span>支援 YouTube、SoundCloud、Bilibili、Twitch、Spotify、Apple Music、KKBOX</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {!isHost && (
              <span className="inline-flex items-center gap-1.5 text-xs text-[#9CA3AF]">
                <Lock className="h-3.5 w-3.5 text-[#E59F3C]" />
                <span>僅房主可換歌</span>
              </span>
            )}
          </div>
        </div>

        {/* Progress Scrubber (only for SDK-syncable non-live platforms) */}
        {fullSyncSupported && !isTwitchLive && !isTwitchClip ? (
          <div className="flex items-center gap-3">
            <span className="w-12 font-mono text-xs tabular-nums text-[#9CA3AF]">
              {formatTime(displayTime)}
            </span>
            <input
              type="range"
              min={0}
              max={maxDuration}
              step={1}
              value={Math.min(displayTime, maxDuration)}
              disabled={!isHost || !currentTrack}
              onChange={(e) => {
                const val = Number(e.target.value);
                setIsScrubbing(true);
                setScrubValue(val);
              }}
              onMouseUp={(e) => {
                if (!isHost) return;
                const val = Number((e.target as HTMLInputElement).value);
                setIsScrubbing(false);
                onSeek(val);
              }}
              onTouchEnd={(e) => {
                if (!isHost) return;
                const val = Number((e.target as HTMLInputElement).value);
                setIsScrubbing(false);
                onSeek(val);
              }}
              aria-label="播放進度"
              className="h-1.5 flex-1 cursor-pointer rounded-full bg-white/14 accent-[#E59F3C] disabled:cursor-not-allowed"
            />
            <span className="w-12 text-right font-mono text-xs tabular-nums text-[#9CA3AF]">
              {formatTime(duration)}
            </span>
          </div>
        ) : currentTrack ? (
          <p className="text-xs text-[#9CA3AF]">
            {currentTrack.provider === 'spotify' ||
            currentTrack.provider === 'apple_music' ||
            currentTrack.provider === 'kkbox'
              ? `${getProviderLabel(currentTrack.provider)} 官方嵌入播放器依各裝置登入狀態提供試聽或完整播放，請於畫面內點擊播放；換歌仍由房主統一切換。`
              : `${getProviderLabel(currentTrack.provider)} 目前採用官方內嵌播放器，進度與播放請直接在播放器畫面內操作；換歌仍由房主統一切換。`}
          </p>
        ) : null}

        {/* Transport & Local Volume Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              disabled={!isHost || (!currentTrack && queueLength === 0)}
              aria-label="上一首"
              title={isHost ? '上一首' : '僅房主可切換歌曲'}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#1B1E25] text-[#F3F4F6] transition-colors hover:bg-[#232730] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              <SkipBack className="h-4 w-4" />
            </button>

            {fullSyncSupported && !isTwitchClip && (
              <button
                type="button"
                onClick={handleTogglePlay}
                disabled={!isHost || (!currentTrack && queueLength === 0)}
                aria-label={playback.isPlaying ? '暫停播放' : '開始播放'}
                title={isHost ? (playback.isPlaying ? '暫停' : '播放') : '僅房主可控制播放'}
                className="flex h-10 min-w-24 items-center justify-center gap-2 rounded-lg bg-[#E59F3C] px-4 text-sm font-semibold text-[#0D0E11] transition-colors hover:bg-[#EDA94B] disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {playback.isPlaying ? (
                  <>
                    <Pause className="h-4 w-4 fill-current" />
                    <span>暫停</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    <span>播放</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onNext}
              disabled={!isHost || (!currentTrack && queueLength === 0)}
              aria-label="下一首"
              title={isHost ? '下一首' : '僅房主可切換歌曲'}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#1B1E25] text-[#F3F4F6] transition-colors hover:bg-[#232730] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              <SkipForward className="h-4 w-4" />
            </button>

            {!isHost && fullSyncSupported && !isTwitchClip && (
              <button
                type="button"
                onClick={() => {
                  onRequestSync();
                  if (
                    currentTrack?.provider === 'youtube' &&
                    ytPlayerRef.current &&
                    ytReadyRef.current
                  ) {
                    const expected = getAuthoritativePosition(playback, serverTimeOffset);
                    markRemoteSync();
                    ytPlayerRef.current.seekTo(expected, true);
                  }
                }}
                className="ml-1 inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/10 bg-[#1B1E25] px-3 text-xs font-medium text-[#D1D5DB] transition-colors hover:bg-[#232730] hover:text-[#F3F4F6] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>重新對時</span>
              </button>
            )}
          </div>

          {/* Local Volume (for SDK-supported players) */}
          {fullSyncSupported && !isTwitchClip && (
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={isMuted ? '取消靜音' : '靜音'}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9CA3AF] transition-colors hover:bg-white/8 hover:text-[#F3F4F6] cursor-pointer"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                aria-label="本機音量"
                className="h-1.5 w-24 cursor-pointer rounded-full bg-white/14 accent-[#F3F4F6]"
              />
              <span className="w-8 text-right font-mono text-xs tabular-nums text-[#9CA3AF]">
                {isMuted ? 0 : volume}%
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
