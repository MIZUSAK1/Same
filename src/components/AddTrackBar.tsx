import { type FormEvent, useEffect, useState } from 'react';
import { Link2, Loader2, Music2, Plus, X } from 'lucide-react';
import type { MediaProvider } from '../types/room';
import { getProviderLabel, parseMediaUrl } from '../utils/media';

interface PreviewMeta {
  provider: MediaProvider;
  mediaId: string;
  sourceUrl: string;
  title: string;
  author: string;
  thumbnailUrl: string;
}

interface AddTrackBarProps {
  onAddTrack: (
    track: {
      id: string;
      provider: MediaProvider;
      sourceUrl: string;
      mediaId: string;
      title: string;
      author: string;
      thumbnailUrl: string;
    },
    playImmediately: boolean,
  ) => void;
}

export function AddTrackBar({ onAddTrack }: AddTrackBarProps) {
  const [inputUrl, setInputUrl] = useState('');
  const [preview, setPreview] = useState<PreviewMeta | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const parsed = parseMediaUrl(inputUrl);

  useEffect(() => {
    if (!inputUrl.trim()) {
      setPreview(null);
      setValidationError(null);
      setIsLoadingMeta(false);
      return;
    }

    if (!parsed) {
      setPreview(null);
      setIsLoadingMeta(false);
      return;
    }

    let cancelled = false;
    setValidationError(null);
    setIsLoadingMeta(true);

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/media-meta?url=${encodeURIComponent(inputUrl.trim())}`);
        if (!res.ok) throw new Error('meta error');
        const data = (await res.json()) as PreviewMeta;
        if (!cancelled) {
          setPreview(data);
        }
      } catch {
        if (!cancelled) {
          const label = getProviderLabel(parsed.provider);
          setPreview({
            provider: parsed.provider,
            mediaId: parsed.mediaId,
            sourceUrl: parsed.sourceUrl,
            title: `${label} 曲目`,
            author: label,
            thumbnailUrl:
              parsed.provider === 'youtube'
                ? `https://i.ytimg.com/vi/${parsed.mediaId}/hqdefault.jpg`
                : '',
          });
        }
      } finally {
        if (!cancelled) setIsLoadingMeta(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inputUrl]);

  const submitTrack = async () => {
    const trimmed = inputUrl.trim();
    const currentParsed = parseMediaUrl(trimmed);
    if (!currentParsed) {
      setValidationError(
        '請貼上支援的音樂或影片連結（YouTube、SoundCloud、Bilibili、Twitch、Spotify、Apple Music、KKBOX）',
      );
      return;
    }

    let meta = preview && preview.sourceUrl === currentParsed.sourceUrl ? preview : null;
    if (!meta) {
      setIsLoadingMeta(true);
      try {
        const res = await fetch(`/api/media-meta?url=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          meta = (await res.json()) as PreviewMeta;
        }
      } catch {
        // Fallback below
      } finally {
        setIsLoadingMeta(false);
      }
    }

    const label = getProviderLabel(currentParsed.provider);
    const finalMeta: PreviewMeta = meta || {
      provider: currentParsed.provider,
      mediaId: currentParsed.mediaId,
      sourceUrl: currentParsed.sourceUrl,
      title: `${label} 曲目`,
      author: label,
      thumbnailUrl:
        currentParsed.provider === 'youtube'
          ? `https://i.ytimg.com/vi/${currentParsed.mediaId}/hqdefault.jpg`
          : '',
    };

    const uniqueId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    onAddTrack(
      {
        id: uniqueId,
        provider: finalMeta.provider,
        sourceUrl: finalMeta.sourceUrl,
        mediaId: finalMeta.mediaId,
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
    <section aria-label="加入歌曲連結" className="border-b border-white/8 bg-[#121419]">
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
              placeholder="貼上連結（支援 YouTube、SoundCloud、Bilibili、Twitch、Spotify、Apple Music、KKBOX）"
              aria-label="音樂或影片連結"
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
            {preview.thumbnailUrl ? (
              <img
                src={preview.thumbnailUrl}
                alt={preview.title}
                referrerPolicy="no-referrer"
                className="h-9 w-16 rounded object-cover bg-[#1B1E25] shrink-0"
              />
            ) : (
              <div className="flex h-9 w-16 shrink-0 items-center justify-center rounded border border-white/8 bg-[#1B1E25] text-[#9CA3AF]">
                <Music2 className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-[#F3F4F6]">{preview.title}</p>
              <p className="truncate text-[#9CA3AF]">
                <span>{getProviderLabel(preview.provider)}</span>
                <span aria-hidden="true"> · </span>
                <span>{preview.author}</span>
                <span aria-hidden="true"> · </span>
                <span>解析成功，可加入待播</span>
              </p>
            </div>
          </div>
        )}

      </div>
    </section>
  );
}
