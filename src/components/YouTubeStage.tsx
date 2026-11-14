import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Lock,
  Music2,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { PlaybackState, Role } from '../types/room';
import { formatTime } from '../utils/youtube';

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

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeIframeAPI(): Promise<YTNamespace> {
  if (window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<YTNamespace>((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (previousReady) previousReady();
      if (window.YT) resolve(window.YT);
    };

    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return ytApiPromise;
}

interface YouTubeStageProps {
  role: Role;
  playback: PlaybackState;
  serverTimeOffset: number;
  queueLength: number;
  onPlay: (positionSeconds?: number) => void;
  onPause: (positionSeconds?: number) => void;
  onSeek: (positionSeconds: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onTrackEnded: (trackId: string) => void;
  onRequestSync: () => void;
}

export function YouTubeStage({
  role,
  playback,
  serverTimeOffset,
  queueLength,
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrev,
  onTrackEnded,
  onRequestSync,
}: YouTubeStageProps) {
  const isHost = role === 'host';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const playerReadyRef = useRef(false);
  const loadedVideoIdRef = useRef<string | null>(null);
  const loadedTrackIdRef = useRef<string | null>(null);
  const isRemoteSyncRef = useRef(false);
  const remoteSyncTimerRef = useRef<number | null>(null);

  const [localTime, setLocalTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const latestPropsRef = useRef({
    isHost,
    playback,
    serverTimeOffset,
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
    onPlay,
    onPause,
    onSeek,
    onNext,
    onPrev,
    onTrackEnded,
    onRequestSync,
  };
  const endedDispatchedTrackIdRef = useRef<string | null>(null);

  const getAuthoritativePosition = (pb: PlaybackState, offset: number) => {
    if (!pb.currentTrack) return 0;
    if (!pb.isPlaying) return pb.positionSeconds;
    const estimatedServerNow = Date.now() + offset;
    const elapsed = Math.max(0, (estimatedServerNow - pb.updatedAt) / 1000);
    return pb.positionSeconds + elapsed;
  };

  const markRemoteSync = () => {
    isRemoteSyncRef.current = true;
    if (remoteSyncTimerRef.current) window.clearTimeout(remoteSyncTimerRef.current);
    remoteSyncTimerRef.current = window.setTimeout(() => {
      isRemoteSyncRef.current = false;
    }, 600);
  };

  // Initialize YT Player when container is mounted
  useEffect(() => {
    let cancelled = false;

    loadYouTubeIframeAPI().then((YT) => {
      if (cancelled || !containerRef.current || playerRef.current) return;

      const mountTarget = document.createElement('div');
      mountTarget.className = 'h-full w-full';
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(mountTarget);

      playerRef.current = new YT.Player(mountTarget, {
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
            playerReadyRef.current = true;
            try {
              const iframe = event.target.getIframe?.();
              if (iframe) {
                iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
              }
            } catch {
              // Ignore iframe attribute errors
            }
            event.target.setVolume(volume);
            const { playback: pb, serverTimeOffset: offset } = latestPropsRef.current;
            if (pb.currentTrack) {
              const targetPos = getAuthoritativePosition(pb, offset);
              loadedVideoIdRef.current = pb.currentTrack.videoId;
              loadedTrackIdRef.current = pb.currentTrack.id;
              endedDispatchedTrackIdRef.current = null;
              markRemoteSync();
              if (pb.isPlaying) {
                event.target.loadVideoById({ videoId: pb.currentTrack.videoId, startSeconds: targetPos });
              } else {
                event.target.cueVideoById({ videoId: pb.currentTrack.videoId, startSeconds: targetPos });
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

            // If browser blocked unmuted autoplay when server says playing
            if (event.data === YTState.UNSTARTED || event.data === YTState.CUED) {
              if (pb.isPlaying && !hostMode) {
                // Keep quiet check in timer below
              }
            }

            if (isRemoteSyncRef.current) return;

            // Only host native iframe interactions propagate to room (ignore OS background-tab auto-pause)
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
              setPlayerError('此影片的擁有者未開放外部網頁嵌入播放，請換另一首 YouTube 連結。');
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
      if (remoteSyncTimerRef.current) window.clearTimeout(remoteSyncTimerRef.current);
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore destroy errors
        }
        playerRef.current = null;
        playerReadyRef.current = false;
        loadedVideoIdRef.current = null;
        loadedTrackIdRef.current = null;
      }
    };
  }, [isHost]);

  // Apply authoritative playback state changes from WebSocket
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) return;

    const track = playback.currentTrack;
    if (!track) {
      loadedVideoIdRef.current = null;
      loadedTrackIdRef.current = null;
      setLocalTime(0);
      setDuration(0);
      setPlayerError(null);
      setAutoplayBlocked(false);
      try {
        markRemoteSync();
        player.pauseVideo();
      } catch {
        // Ignore
      }
      return;
    }

    const targetPos = getAuthoritativePosition(playback, serverTimeOffset);
    const isNewTrack = loadedTrackIdRef.current !== track.id;

    if (isNewTrack) {
      loadedVideoIdRef.current = track.videoId;
      loadedTrackIdRef.current = track.id;
      endedDispatchedTrackIdRef.current = null;
      setPlayerError(null);
      setLocalTime(targetPos);
      setDuration(0);
      markRemoteSync();
      if (playback.isPlaying) {
        player.loadVideoById({ videoId: track.videoId, startSeconds: targetPos });
      } else {
        player.cueVideoById({ videoId: track.videoId, startSeconds: targetPos });
      }
      return;
    }

    // Same track: sync play/pause and position drift
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
    } else {
      if (YTState && state === YTState.ENDED) {
        player.cueVideoById({ videoId: track.videoId, startSeconds: targetPos });
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
    }
  }, [playback, serverTimeOffset]);

  // Poll playback timer & drift correction every 500ms
  useEffect(() => {
    const interval = window.setInterval(() => {
      const player = playerRef.current;
      const { playback: pb, serverTimeOffset: offset, isHost: hostMode } = latestPropsRef.current;

      if (!player || !playerReadyRef.current || !pb.currentTrack) return;

      const dur = player.getDuration();
      if (dur > 0) setDuration(dur);

      const cur = player.getCurrentTime();
      if (!isScrubbing && Number.isFinite(cur)) {
        setLocalTime(cur);
      }

      const YTState = window.YT?.PlayerState;
      const pState = player.getPlayerState();

      // Background auto-advance safeguard if ENDED event was throttled in background tab
      if (
        hostMode &&
        pb.isPlaying &&
        YTState &&
        pState === YTState.ENDED &&
        endedDispatchedTrackIdRef.current !== pb.currentTrack.id
      ) {
        endedDispatchedTrackIdRef.current = pb.currentTrack.id;
        latestPropsRef.current.onTrackEnded(pb.currentTrack.id);
        return;
      }

      // Detect autoplay block for friends when room is playing
      if (!hostMode && pb.isPlaying && YTState) {
        if (pState === YTState.UNSTARTED || pState === YTState.PAUSED || pState === YTState.CUED) {
          setAutoplayBlocked(true);
        } else if (pState === YTState.PLAYING) {
          setAutoplayBlocked(false);
        }
      }

      // Continuous gentle drift check for friends
      if (!hostMode && pb.isPlaying && YTState && pState === YTState.PLAYING) {
        const expected = getAuthoritativePosition(pb, offset);
        if (Math.abs(cur - expected) > 2.2) {
          markRemoteSync();
          player.seekTo(expected, true);
        }
      }
    }, 500);

    return () => window.clearInterval(interval);
  }, [isScrubbing]);

  // Background playback support: Media Session API & visibility resync
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const track = playback.currentTrack;

    if (!track) {
      ms.metadata = null;
      ms.playbackState = 'none';
      return;
    }

    try {
      ms.metadata = new MediaMetadata({
        title: track.title,
        artist: track.author,
        album: `點歌人：${track.addedBy} · 私密點歌室`,
        artwork: track.thumbnailUrl
          ? [{ src: track.thumbnailUrl, sizes: '480x360', type: 'image/jpeg' }]
          : [],
      });
      ms.playbackState = playback.isPlaying ? 'playing' : 'paused';
    } catch {
      // Ignore MediaMetadata errors on unsupported browsers
    }

    const safeSetHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Action not supported on this browser
      }
    };

    safeSetHandler('play', () => {
      const { isHost: hostMode, onPlay: emitPlay } = latestPropsRef.current;
      const player = playerRef.current;
      if (hostMode) {
        emitPlay(player?.getCurrentTime());
      } else if (player && playerReadyRef.current) {
        player.playVideo();
      }
    });

    safeSetHandler('pause', () => {
      const { isHost: hostMode, onPause: emitPause } = latestPropsRef.current;
      const player = playerRef.current;
      if (hostMode) {
        emitPause(player?.getCurrentTime());
      } else if (player && playerReadyRef.current) {
        player.pauseVideo();
      }
    });

    safeSetHandler('previoustrack', isHost ? () => latestPropsRef.current.onPrev() : null);
    safeSetHandler('nexttrack', isHost ? () => latestPropsRef.current.onNext() : null);
    safeSetHandler('seekto', (details) => {
      if (latestPropsRef.current.isHost && typeof details.seekTime === 'number') {
        latestPropsRef.current.onSeek(details.seekTime);
      }
    });

    return () => {
      safeSetHandler('play', null);
      safeSetHandler('pause', null);
      safeSetHandler('previoustrack', null);
      safeSetHandler('nexttrack', null);
      safeSetHandler('seekto', null);
    };
  }, [playback.currentTrack, playback.isPlaying, isHost]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        latestPropsRef.current.onRequestSync();
        const player = playerRef.current;
        const { playback: pb, serverTimeOffset: offset } = latestPropsRef.current;
        if (player && playerReadyRef.current && pb.currentTrack && pb.isPlaying) {
          const expected = getAuthoritativePosition(pb, offset);
          const current = player.getCurrentTime() || 0;
          if (Math.abs(current - expected) > 1.8) {
            markRemoteSync();
            player.seekTo(expected, true);
          }
          const YTState = window.YT?.PlayerState;
          if (YTState && player.getPlayerState() !== YTState.PLAYING) {
            player.playVideo();
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const handleTogglePlay = () => {
    if (!isHost || !playback.currentTrack) return;
    const currentPos = playerRef.current?.getCurrentTime() ?? localTime;
    if (playback.isPlaying) {
      onPause(currentPos);
    } else {
      onPlay(currentPos);
    }
  };

  const handleVolumeChange = (nextVolume: number) => {
    setVolume(nextVolume);
    setIsMuted(nextVolume === 0);
    if (playerRef.current && playerReadyRef.current) {
      playerRef.current.setVolume(nextVolume);
      if (nextVolume === 0) {
        playerRef.current.mute();
      } else if (playerRef.current.isMuted()) {
        playerRef.current.unMute();
      }
    }
  };

  const handleToggleMute = () => {
    if (!playerRef.current || !playerReadyRef.current) return;
    if (isMuted) {
      playerRef.current.unMute();
      const restored = volume === 0 ? 70 : volume;
      setVolume(restored);
      playerRef.current.setVolume(restored);
      setIsMuted(false);
    } else {
      playerRef.current.mute();
      setIsMuted(true);
    }
  };

  const handleManualUnlockAudio = () => {
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) return;
    const expected = getAuthoritativePosition(playback, serverTimeOffset);
    markRemoteSync();
    player.seekTo(expected, true);
    player.playVideo();
    setAutoplayBlocked(false);
  };

  const displayTime = isScrubbing ? scrubValue : localTime;
  const maxDuration = duration > 0 ? duration : Math.max(displayTime, 1);

  return (
    <div className="flex flex-col rounded-xl border border-white/10 bg-[#15171C] overflow-hidden">
      {/* 16:9 YouTube Video Viewport */}
      <div className="relative aspect-video w-full bg-[#090A0C]">
        <div
          ref={containerRef}
          className={`h-full w-full ${playback.currentTrack ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        />

        {/* Protect friend from accidentally clicking YouTube iframe to desync */}
        {!isHost && playback.currentTrack && !autoplayBlocked && (
          <div
            className="absolute inset-0 z-10 cursor-default"
            aria-label="同步播放畫面（由房主控制播放）"
          />
        )}

        {/* Autoplay blocked overlay for friends */}
        {!isHost && playback.currentTrack && autoplayBlocked && (
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

        {/* Empty standby state */}
        {!playback.currentTrack && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-[#15171C] text-[#E59F3C]">
              <Music2 className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-balance text-[#F3F4F6]">
              尚未播放任何歌曲
            </h2>
            <p className="mt-1.5 max-w-md text-sm text-[#9CA3AF]">
              {isHost
                ? '在上方輸入框貼上 YouTube 連結，點擊「立即播放」或「加入待播清單」即可開始與朋友同步聽歌。'
                : '等待房主開始播放歌曲，你也可以在上方先貼上 YouTube 連結加入待播清單。'}
            </p>
          </div>
        )}

        {/* YouTube embed error overlay */}
        {playerError && playback.currentTrack && (
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
        {/* Track Info Row */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight text-[#F3F4F6]">
              {playback.currentTrack ? playback.currentTrack.title : '等待點播中'}
            </h1>
            <p className="mt-1 truncate text-xs text-[#9CA3AF]">
              {playback.currentTrack ? (
                <>
                  <span className="text-[#D1D5DB]">點歌：{playback.currentTrack.addedBy}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{playback.currentTrack.author}</span>
                </>
              ) : (
                <span>支援所有標準 YouTube 影片連結</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {!isHost && (
              <span className="inline-flex items-center gap-1.5 text-xs text-[#9CA3AF]">
                <Lock className="h-3.5 w-3.5 text-[#E59F3C]" />
                <span>僅房主可換歌與調整進度</span>
              </span>
            )}
          </div>
        </div>

        {/* Progress Scrubber */}
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
            disabled={!isHost || !playback.currentTrack}
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

        {/* Transport & Local Volume Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              disabled={!isHost || (!playback.currentTrack && queueLength === 0)}
              aria-label="上一首"
              title={isHost ? '上一首' : '僅房主可切換歌曲'}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#1B1E25] text-[#F3F4F6] transition-colors hover:bg-[#232730] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              <SkipBack className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={handleTogglePlay}
              disabled={!isHost || (!playback.currentTrack && queueLength === 0)}
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

            <button
              type="button"
              onClick={onNext}
              disabled={!isHost || (!playback.currentTrack && queueLength === 0)}
              aria-label="下一首"
              title={isHost ? '下一首' : '僅房主可切換歌曲'}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#1B1E25] text-[#F3F4F6] transition-colors hover:bg-[#232730] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              <SkipForward className="h-4 w-4" />
            </button>

            {!isHost && (
              <button
                type="button"
                onClick={() => {
                  onRequestSync();
                  if (playerRef.current && playerReadyRef.current && playback.currentTrack) {
                    const expected = getAuthoritativePosition(playback, serverTimeOffset);
                    markRemoteSync();
                    playerRef.current.seekTo(expected, true);
                  }
                }}
                className="ml-1 inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/10 bg-[#1B1E25] px-3 text-xs font-medium text-[#D1D5DB] transition-colors hover:bg-[#232730] hover:text-[#F3F4F6] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>重新對時</span>
              </button>
            )}
          </div>

          {/* Local Volume (Always available to every listener) */}
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
        </div>
      </div>
    </div>
  );
}
