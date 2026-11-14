import { type FormEvent, useState } from 'react';
import { ArrowRight, Headphones, KeyRound, Loader2 } from 'lucide-react';
import { loadSavedDisplayName } from '../hooks/useListenRoom';
import type { RoomStatusResponse } from '../types/room';

interface EntryScreenProps {
  roomStatus: RoomStatusResponse | null;
  isEntering: boolean;
  errorMessage: string | null;
  onEnterAsFriend: (nickname: string) => void;
  onEnterAsHost: (nickname: string, password: string) => void;
}

export function EntryScreen({
  roomStatus,
  isEntering,
  errorMessage,
  onEnterAsFriend,
  onEnterAsHost,
}: EntryScreenProps) {
  const [selectedRole, setSelectedRole] = useState<'friend' | 'host'>('friend');
  const [nickname, setNickname] = useState(() => loadSavedDisplayName());
  const [hostPassword, setHostPassword] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const hasHostPassword = roomStatus?.hasHostPassword ?? false;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = nickname.trim();
    if (!trimmedName) {
      setInputError('請先輸入你的顯示暱稱，方便大家辨識是誰點的歌。');
      return;
    }

    if (selectedRole === 'host') {
      if (!hostPassword.trim()) {
        setInputError(hasHostPassword ? '請輸入房主密碼。' : '請設定一組房主密碼。');
        return;
      }
      setInputError(null);
      onEnterAsHost(trimmedName, hostPassword);
      return;
    }

    setInputError(null);
    onEnterAsFriend(trimmedName);
  };

  return (
    <div className="min-h-screen bg-[#0D0E11] text-[#F3F4F6] flex flex-col">
      <header className="border-b border-white/8 bg-[#0D0E11]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          <span className="text-base font-bold tracking-tight text-[#F3F4F6] whitespace-nowrap shrink-0">
            私密點歌室
          </span>
          <span className="text-xs text-[#9CA3AF] whitespace-nowrap shrink-0">
            同步聽歌空間
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#15171C] p-6 sm:p-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-[#0D0E11] text-[#E59F3C]">
            <Headphones className="h-5 w-5" />
          </div>

          <h1 className="mt-5 text-xl font-semibold tracking-tight text-balance text-[#F3F4F6]">
            進入私密點歌室
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-[#9CA3AF]">
            輸入你的暱稱即可加入同步聽歌，播放清單上會顯示每首歌是誰點的。
            {roomStatus ? `（目前在線 ${roomStatus.participantCount} 人）` : ''}
          </p>

          {/* Role Selection Segmented Tabs */}
          <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg bg-[#0D0E11] p-1">
            <button
              type="button"
              onClick={() => {
                setSelectedRole('friend');
                setInputError(null);
              }}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                selectedRole === 'friend'
                  ? 'bg-[#1E222B] text-[#F3F4F6]'
                  : 'text-[#9CA3AF] hover:text-[#F3F4F6]'
              }`}
            >
              朋友加入（僅點歌）
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedRole('host');
                setInputError(null);
              }}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                selectedRole === 'host'
                  ? 'bg-[#1E222B] text-[#F3F4F6]'
                  : 'text-[#9CA3AF] hover:text-[#F3F4F6]'
              }`}
            >
              我是房主（可換歌）
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
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
                placeholder={selectedRole === 'host' ? '例如：房主、Alex' : '例如：小明、阿華'}
                className="mt-2 h-11 w-full rounded-lg border border-white/12 bg-[#0D0E11] px-3.5 text-sm text-[#F3F4F6] placeholder-[#6B7280] transition-colors focus:border-[#E59F3C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E59F3C]/40"
              />
            </div>

            {selectedRole === 'host' && (
              <div>
                <label htmlFor="host-password-input" className="block text-xs font-medium text-[#D1D5DB]">
                  {hasHostPassword ? '輸入房主密碼' : '設定房主密碼（首次登入設定）'}
                </label>
                <div className="relative mt-2">
                  <KeyRound
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]"
                    aria-hidden="true"
                  />
                  <input
                    id="host-password-input"
                    type="password"
                    value={hostPassword}
                    onChange={(e) => {
                      setHostPassword(e.target.value);
                      if (inputError) setInputError(null);
                    }}
                    placeholder={
                      hasHostPassword ? '請輸入房主密碼' : '設定密碼以防止朋友誤拿換歌權限'
                    }
                    className="h-11 w-full rounded-lg border border-white/12 bg-[#0D0E11] pl-10 pr-3.5 text-sm text-[#F3F4F6] placeholder-[#6B7280] transition-colors focus:border-[#E59F3C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E59F3C]/40"
                  />
                </div>
              </div>
            )}

            {(inputError || errorMessage) && (
              <p role="alert" className="text-xs text-[#F87171]">
                {inputError || errorMessage}
              </p>
            )}

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
              <span>{selectedRole === 'host' ? '以房主身份進入' : '進入房間同步聽歌'}</span>
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
