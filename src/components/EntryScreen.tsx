import { type FormEvent, useState } from 'react';
import { ArrowRight, Headphones, Loader2 } from 'lucide-react';
import { loadSavedDisplayName, type RoomPreviewStatus } from '../hooks/useListenRoom';

interface EntryScreenProps {
  pendingRoomId: string | null;
  roomPreview: RoomPreviewStatus | null;
  isEntering: boolean;
  errorMessage: string | null;
  onEnter: (nickname: string) => void;
}

export function EntryScreen({
  pendingRoomId,
  roomPreview,
  isEntering,
  errorMessage,
  onEnter,
}: EntryScreenProps) {
  const [nickname, setNickname] = useState(() => loadSavedDisplayName());
  const [inputError, setInputError] = useState<string | null>(null);

  const isJoiningFriendRoom = Boolean(pendingRoomId);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed) {
      setInputError('請先輸入你的暱稱，方便大家辨識是誰點的歌。');
      return;
    }
    setInputError(null);
    onEnter(trimmed);
  };

  return (
    <div className="min-h-screen bg-[#0D0E11] text-[#F3F4F6] flex flex-col">
      <header className="border-b border-white/8 bg-[#0D0E11]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          <span className="text-base font-bold tracking-tight text-[#F3F4F6] whitespace-nowrap shrink-0">
            私密點歌室
          </span>
          <span className="text-xs text-[#9CA3AF] whitespace-nowrap shrink-0">
            不公開同步聽歌空間
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#15171C] p-6 sm:p-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-[#0D0E11] text-[#E59F3C]">
            <Headphones className="h-5 w-5" />
          </div>

          <h1 className="mt-5 text-xl font-semibold tracking-tight text-balance text-[#F3F4F6]">
            {isJoiningFriendRoom ? '加入好友的私密點歌室' : '建立你的私密點歌室'}
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-[#9CA3AF]">
            {isJoiningFriendRoom
              ? '請輸入你的暱稱後進入房間。進入後你可以貼上 YouTube 連結加入播放清單，列表上會顯示每首歌的點歌人。'
              : '請先輸入你的房主暱稱。建立後可將網址傳給朋友，一起同步聽歌。'}
          </p>

          {isJoiningFriendRoom && roomPreview && (
            <div className="mt-4 flex items-center gap-2 text-xs text-[#9CA3AF]">
              <span className="font-mono tabular-nums">
                目前在線 {roomPreview.participantCount} 人
              </span>
              <span aria-hidden="true">·</span>
              <span>你的權限：好友（可點歌加入清單）</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="nickname-input" className="block text-xs font-medium text-[#D1D5DB]">
                你的顯示暱稱
              </label>
              <input
                id="nickname-input"
                type="text"
                autoFocus
                maxLength={24}
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                  if (inputError) setInputError(null);
                }}
                placeholder={isJoiningFriendRoom ? '例如：小明、阿華' : '例如：房主、Alex'}
                className="mt-2 h-11 w-full rounded-lg border border-white/12 bg-[#0D0E11] px-3.5 text-sm text-[#F3F4F6] placeholder-[#6B7280] transition-colors focus:border-[#E59F3C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E59F3C]/40"
              />
              {(inputError || errorMessage) && (
                <p role="alert" className="mt-2 text-xs text-[#F87171]">
                  {inputError || errorMessage}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isEntering}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#E59F3C] px-5 text-sm font-semibold text-[#0D0E11] transition-colors hover:bg-[#EDA94B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E59F3C] disabled:opacity-60 cursor-pointer"
            >
              {isEntering ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              <span>{isJoiningFriendRoom ? '進入房間同步聽歌' : '建立並進入點歌室'}</span>
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
