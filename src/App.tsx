import { useState } from 'react';
import { AlertTriangle, Loader2, LogOut, Radio, X } from 'lucide-react';
import { AddTrackBar } from './components/AddTrackBar';
import { EntryScreen } from './components/EntryScreen';
import { MediaStage } from './components/MediaStage';
import { QueueAndMembersPanel } from './components/QueueAndMembersPanel';
import { useListenRoom } from './hooks/useListenRoom';

export default function App() {
  const {
    phase,
    roomStatus,
    isEntering,
    role,
    participantId,
    participants,
    queue,
    playback,
    serverTimeOffset,
    connectionStatus,
    errorMessage,
    clearError,
    enterAsFriend,
    enterAsHost,
    returnToEntry,
    addTrack,
    switchTrack,
    removeTrack,
    clearQueue,
    play,
    pause,
    seek,
    next,
    prev,
    notifyEnded,
    renameSelf,
    requestSync,
  } = useListenRoom();

  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);

  if (phase === 'checking') {
    return (
      <div className="min-h-screen bg-[#0D0E11] text-[#F3F4F6] flex items-center justify-center">
        <div className="flex items-center gap-2.5 text-sm text-[#9CA3AF]">
          <Loader2 className="h-4 w-4 animate-spin text-[#E59F3C]" />
          <span>正在確認房間狀態…</span>
        </div>
      </div>
    );
  }

  if (phase === 'entry') {
    return (
      <EntryScreen
        roomStatus={roomStatus}
        isEntering={isEntering}
        errorMessage={errorMessage}
        onEnterAsFriend={(nickname) => void enterAsFriend(nickname)}
        onEnterAsHost={(nickname, password) => void enterAsHost(nickname, password)}
      />
    );
  }

  const connectionLabel =
    connectionStatus === 'connected'
      ? '已同步連線'
      : connectionStatus === 'reconnecting'
        ? '重新連線中'
        : connectionStatus === 'error'
          ? '連線中斷'
          : '連線中';

  return (
    <div className="min-h-screen bg-[#0D0E11] text-[#F3F4F6] flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-white/8 bg-[#0D0E11]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-4 py-3.5 sm:px-6">
          <span className="text-base font-bold tracking-tight text-[#F3F4F6] whitespace-nowrap shrink-0">
            私密點歌室
          </span>

          <div className="flex items-center gap-4 text-xs text-[#9CA3AF]">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
              <Radio
                className={`h-3.5 w-3.5 ${
                  connectionStatus === 'connected' ? 'text-[#E59F3C]' : 'text-[#9CA3AF]'
                }`}
              />
              <span>{connectionLabel}</span>
            </span>
            <span className="hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="hidden sm:inline whitespace-nowrap shrink-0">
              權限：{role === 'host' ? '房主（可換歌與控制進度）' : '好友（僅可加入待播）'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
              在線 {participants.length} 人
            </span>
            <button
              type="button"
              onClick={() => void returnToEntry()}
              title="切換身分或重新登入"
              className="inline-flex items-center gap-1 text-xs text-[#9CA3AF] transition-colors hover:text-[#F3F4F6] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden md:inline">切換身分</span>
            </button>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {errorMessage && (
        <div role="alert" className="border-b border-[#F87171]/25 bg-[#2A1417]">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-3 text-xs text-[#FCA5A5] sm:px-6">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-[#F87171]" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={clearError}
              aria-label="關閉提示"
              className="rounded p-1 hover:bg-white/10 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Multi-Platform URL Input Bar */}
      <AddTrackBar onAddTrack={addTrack} />

      {/* Main Listening Studio (Supports Theater Expand) */}
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
          {/* Dominant Focal Anchor: Multi-Platform Sync Player */}
          <div className={isPlayerExpanded ? 'lg:col-span-12' : 'lg:col-span-7 xl:col-span-8'}>
            <MediaStage
              role={role}
              playback={playback}
              serverTimeOffset={serverTimeOffset}
              queueLength={queue.length}
              isExpanded={isPlayerExpanded}
              onToggleExpand={() => setIsPlayerExpanded((prev) => !prev)}
              onPlay={play}
              onPause={pause}
              onSeek={seek}
              onNext={next}
              onPrev={prev}
              onTrackEnded={notifyEnded}
              onRequestSync={requestSync}
            />
          </div>

          {/* Persistent Playlist & Online Members */}
          <div className={isPlayerExpanded ? 'lg:col-span-12' : 'lg:col-span-5 xl:col-span-4'}>
            <QueueAndMembersPanel
              role={role}
              participantId={participantId}
              participants={participants}
              queue={queue}
              currentTrackId={playback.currentTrack?.id ?? null}
              isPlaying={playback.isPlaying}
              onSwitchTrack={switchTrack}
              onRemoveTrack={removeTrack}
              onClearQueue={clearQueue}
              onRenameSelf={renameSelf}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
