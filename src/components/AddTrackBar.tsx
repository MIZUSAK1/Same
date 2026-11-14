import { type FormEvent, useEffect, useState } from 'react';
import { Link2, Loader2, Plus, X } from 'lucide-react';
import type { Role } from '../types/room';
import { extractYouTubeVideoId, getYouTubeThumbnail } from '../utils/youtube';

interface PreviewMeta {
  videoId: string;
  title: string;
  author: string;
  thumbnailUrl: string;
}

interface AddTrackBarProps {
  role: Role;
  onAddTrack: (
    track: { id: string; videoId: string; title: string; author: string; thumbnailUrl: string },
    playImmediately: boolean,
  ) => void;
}

export function AddTrackBar({ role, onAddTrack }: AddTrackBarProps) {
  const [inputUrl, setInputUrl] = useState('');
  const [preview, setPreview] = useState<PreviewMeta | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const parsedId = extractYouTubeVideoId(inputUrl);

  useEffect(() => {
    if (!inputUrl.trim()) {
      setPreview(null);
      setValidationError(null);
      setIsLoadingMeta(false);
      return;
    }

    if (!parsedId) {
      setPreview(null);
      setIsLoadingMeta(false);
      return;
    }

    let cancelled = false;
    setValidationError(null);
    setIsLoadingMeta(true);

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/youtube-meta?videoId=${encodeURIComponent(parsedId)}`);
        if (!res.ok) throw new Error('meta error');
        const data = (await res.json()) as PreviewMeta;
        if (!cancelled) {
          setPreview(data);
        }
      } catch {
        if (!cancelled) {
          setPreview({
            videoId: parsedId,
            title: `YouTube 影片 (${parsedId})`,
            author: 'YouTube',
            thumbnailUrl: getYouTubeThumbnail(parsedId),
          });
        }
      } finally {
        if (!cancelled) setIsLoadingMeta(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inputUrl, parsedId]);

  const submitTrack = async () => {
    const videoId = extractYouTubeVideoId(inputUrl);
    if (!videoId) {
      setValidationError('請貼上有效的 YouTube 影片連結（例如 youtube.com/watch?v=... 或 youtu.be/...）');
      return;
    }

    let meta = preview && preview.videoId === videoId ? preview : null;
    if (!meta) {
      setIsLoadingMeta(true);
      try {
        const res = await fetch(`/api/youtube-meta?videoId=${encodeURIComponent(videoId)}`);
        if (res.ok) {
          meta = (await res.json()) as PreviewMeta;
        }
      } catch {
        // Fallback below
      } finally {
        setIsLoadingMeta(false);
      }
    }

    const finalMeta: PreviewMeta = meta || {
      videoId,
      title: `YouTube 影片 (${videoId})`,
      author: 'YouTube',
      thumbnailUrl: getYouTubeThumbnail(videoId),
    };

    const uniqueId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    onAddTrack(
      {
        id: uniqueId,
        videoId: finalMeta.videoId,
        title: finalMeta.title,
        author: finalMeta.author,
        thumbnailUrl: finalMeta.thumbnailUrl,
      },
      false,
    );

    setInputUrl('');
    setPreview(null);
    setValidationError(null);
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submitTrack();
  };

  return (
    <section aria-label="加入 YouTube 歌曲" className="border-b border-white/8 bg-[#121419]">
      <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6">
        <form onSubmit={handleFormSubmit} className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Link2
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]"
              aria-hidden="true"
            />
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => {
                setInputUrl(e.target.value);
                if (validationError) setValidationError(null);
              }}
              placeholder="貼上 YouTube 連結（支援 watch、youtu.be、Shorts 或 YouTube Music）"
              aria-label="YouTube 影片連結"
              className="h-11 w-full rounded-lg border border-white/12 bg-[#0D0E11] pl-10 pr-10 text-sm text-[#F3F4F6] placeholder-[#6B7280] transition-colors focus:border-[#E59F3C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E59F3C]/40"
            />
            {inputUrl && (
              <button
                type="button"
                onClick={() => {
                  setInputUrl('');
                  setPreview(null);
                  setValidationError(null);
                }}
                aria-label="清除連結輸入"
                className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[#9CA3AF] transition-colors hover:bg-white/8 hover:text-[#F3F4F6]"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="submit"
              disabled={isLoadingMeta}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#E59F3C] px-5 text-sm font-semibold text-[#0D0E11] transition-colors hover:bg-[#EDA94B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E59F3C] disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isLoadingMeta ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span>加入待播清單</span>
            </button>
          </div>
        </form>

        {validationError && (
          <p role="alert" className="mt-2.5 text-xs text-[#F87171]">
            {validationError}
          </p>
        )}

        {!validationError && preview && (
          <div className="mt-3 flex items-center gap-3 text-xs text-[#9CA3AF]">
            <img
              src={preview.thumbnailUrl}
              alt={preview.title}
              referrerPolicy="no-referrer"
              className="h-9 w-16 rounded object-cover bg-[#1B1E25] shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-[#F3F4F6]">{preview.title}</p>
              <p className="truncate text-[#9CA3AF]">
                {preview.author}
                <span aria-hidden="true"> · </span>
                <span>解析成功，可加入待播</span>
              </p>
            </div>
          </div>
        )}

        {!validationError && !preview && role === 'friend' && (
          <p className="mt-2 text-xs text-[#9CA3AF]">
            你目前以朋友身份加入：你可以自由貼上 YouTube 連結加入待播清單，切換歌曲與播放進度由房主統一控制。
          </p>
        )}
      </div>
    </section>
  );
}
