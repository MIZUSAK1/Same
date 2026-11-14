import { type FormEvent, useState } from 'react';
import { ListMusic, Music2, Play, Trash2, Users } from 'lucide-react';
import type { Participant, Role, Track } from '../types/room';

interface TrackThumbnailProps {
  src: string;
  alt: string;
}

function TrackThumbnail({ src, alt }: TrackThumbnailProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div className="flex h-10 w-[72px] shrink-0 items-center justify-center rounded-md border border-white/8 bg-[#1B1E25] text-[#9CA3AF]">
        <Music2 className="h-4 w-4" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-10 w-[72px] shrink-0 rounded-md object-cover bg-[#1B1E25]"
    />
  );
}

interface QueueAndMembersPanelProps {
  role: Role;
  participantId: string;
  participants: Participant[];
  queue: Track[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onSwitchTrack: (trackId: string) => void;
  onRemoveTrack: (trackId: string) => void;
  onClearQueue: () => void;
  onRenameSelf: (name: string) => void;
}

export function QueueAndMembersPanel({
  role,
  participantId,
  participants,
  queue,
  currentTrackId,
  isPlaying,
  onSwitchTrack,
  onRemoveTrack,
  onClearQueue,
  onRenameSelf,
}: QueueAndMembersPanelProps) {
  const [activeTab, setActiveTab] = useState<'queue' | 'members'>('queue');

  const selfParticipant = participants.find((p) => p.id === participantId);
  const [nameInput, setNameInput] = useState('');
  const [nameSaved, setNameSaved] = useState(false);

  const isHost = role === 'host';
  const currentIdx = currentTrackId ? queue.findIndex((t) => t.id === currentTrackId) : -1;

  const handleNameSubmit = (e: FormEvent) => {
    e.preventDefault();
    const target = nameInput.trim();
    if (!target) return;
    onRenameSelf(target);
    setNameInput('');
    setNameSaved(true);
    window.setTimeout(() => setNameSaved(false), 1800);
  };

  return (
    <aside className="flex flex-col rounded-xl border border-white/10 bg-[#15171C] overflow-hidden">
      {/* Segmented Tab Switch */}
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-3.5">
        <div className="flex items-center gap-1 rounded-lg bg-[#0D0E11] p-1">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'queue'
                ? 'bg-[#1E222B] text-[#F3F4F6]'
                : 'text-[#9CA3AF] hover:text-[#F3F4F6]'
            }`}
          >
            <ListMusic className="h-3.5 w-3.5" />
            <span>播放清單 ({queue.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('members')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'members'
                ? 'bg-[#1E222B] text-[#F3F4F6]'
                : 'text-[#9CA3AF] hover:text-[#F3F4F6]'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>在線成員 ({participants.length})</span>
          </button>
        </div>

        {activeTab === 'queue' && isHost && queue.length > 0 && (
          <button
            type="button"
            onClick={onClearQueue}
            className="text-xs font-medium text-[#9CA3AF] transition-colors hover:text-[#F87171] whitespace-nowrap shrink-0 cursor-pointer"
          >
            清空清單
          </button>
        )}
      </div>

      {/* Persistent Playlist View */}
      {activeTab === 'queue' && (
        <div className="flex flex-1 flex-col">
          {queue.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-14 text-center">
              <ListMusic className="h-7 w-7 text-[#6B7280]" />
              <p className="mt-3 text-sm font-medium text-[#F3F4F6]">播放清單目前是空的</p>
              <p className="mt-1 max-w-xs text-xs text-[#9CA3AF]">
                在上方貼上 YouTube 連結即可加入歌曲。播過的歌曲會保留在清單中，並自動接續播放下一首。
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-white/8 max-h-[520px] overflow-y-auto">
              {queue.map((track, idx) => {
                const isCurrent = track.id === currentTrackId;
                const isPlayed = currentIdx !== -1 && idx < currentIdx;

                return (
                  <li
                    key={track.id}
                    className={`flex items-center gap-3 px-5 py-3.5 transition-colors ${
                      isCurrent ? 'bg-[#E59F3C]/[0.07]' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <span
                      className={`w-6 shrink-0 font-mono text-xs tabular-nums ${
                        isCurrent ? 'font-semibold text-[#E59F3C]' : 'text-[#6B7280]'
                      }`}
                    >
                      {String(idx + 1).padStart(2, '0')}
                    </span>

                    <TrackThumbnail src={track.thumbnailUrl} alt={track.title} />

                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm font-medium ${
                          isCurrent
                            ? 'text-[#E59F3C]'
                            : isPlayed
                              ? 'text-[#D1D5DB]'
                              : 'text-[#F3F4F6]'
                        }`}
                      >
                        {track.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-[#9CA3AF]">
                        <span className="text-[#D1D5DB]">點歌：{track.addedBy}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{track.author}</span>
                        {isCurrent && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="text-[#E59F3C]">
                              {isPlaying ? '播放中' : '目前曲目'}
                            </span>
                          </>
                        )}
                        {!isCurrent && isPlayed && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span>已播放</span>
                          </>
                        )}
                      </p>
                    </div>

                    {isHost && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={() => onSwitchTrack(track.id)}
                            aria-label={`播放 ${track.title}`}
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-white/10 bg-[#1B1E25] px-2.5 text-xs font-medium text-[#F3F4F6] transition-colors hover:border-[#E59F3C]/50 hover:text-[#E59F3C] whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Play className="h-3 w-3 fill-current" />
                            <span>播放</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemoveTrack(track.id)}
                          aria-label={`從播放清單移除 ${track.title}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-[#9CA3AF] transition-colors hover:bg-white/8 hover:text-[#F87171] cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Online Members View */}
      {activeTab === 'members' && (
        <div className="flex flex-1 flex-col divide-y divide-white/8">
          {/* Rename Self */}
          <div className="px-5 py-4">
            <form onSubmit={handleNameSubmit} className="flex items-center gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={24}
                placeholder={`目前暱稱：${selfParticipant?.name || (isHost ? '房主' : '朋友')}`}
                aria-label="修改我的顯示暱稱"
                className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0D0E11] px-3 text-xs text-[#F3F4F6] placeholder-[#6B7280] focus:border-[#E59F3C] focus:outline-none"
              />
              <button
                type="submit"
                disabled={!nameInput.trim()}
                className="inline-flex h-9 items-center rounded-lg border border-white/12 bg-[#1B1E25] px-3.5 text-xs font-medium text-[#F3F4F6] transition-colors hover:bg-[#232730] disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {nameSaved ? '已更新' : '修改暱稱'}
              </button>
            </form>
          </div>

          {/* Connected Listeners */}
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-[#9CA3AF]">
              目前在線成員 ({participants.length} 人)
            </p>
            <ul className="mt-3 divide-y divide-white/8">
              {participants.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#F3F4F6]">
                      {member.name}
                      {member.id === participantId ? '（你）' : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-[#9CA3AF]">
                      {member.role === 'host'
                        ? '房主 · 可換歌、控制播放進度與管理清單'
                        : '朋友 · 僅可加入歌曲至播放清單'}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-[#E59F3C] whitespace-nowrap shrink-0">
                    {member.role === 'host' ? '房主' : '朋友'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </aside>
  );
}
