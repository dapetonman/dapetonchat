import { useState, useEffect, useRef } from "react";
import {
  Volume2, Mic, MicOff, Phone, PhoneOff, Camera, Video, VideoOff,
  Monitor, MonitorX, RefreshCw, VolumeX, Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const ADMIN_USERNAME = "dapetonman";

function useVideoRef(stream: MediaStream | null) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
    }
  }, [stream]);
  return ref;
}

function RemoteVideo({ stream, username, onClick, speaking, volume, onVolumeChange }: {
  stream: MediaStream; username: string; onClick?: () => void; speaking?: boolean;
  volume: number; onVolumeChange: (user: string, vol: number) => void;
}) {
  const ref = useVideoRef(stream);
  const hasVideo = stream.getVideoTracks().length > 0;
  const containerRef = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={containerRef}
      onClick={onClick}
      className={`group relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-900 flex items-center justify-center cursor-pointer transition-all ${speaking ? "ring-2 ring-green-500 shadow-[0_0_12px_rgba(34,197,94,0.5)]" : "hover:ring-2 ring-primary"}`}
    >
      {hasVideo ? (
        <video ref={ref} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2">
          <div className={`w-16 h-16 rounded-full bg-muted flex items-center justify-center text-2xl font-bold uppercase transition-all ${speaking ? "ring-2 ring-green-500" : ""} ${username === ADMIN_USERNAME ? "text-red-500" : "text-foreground"}`}>{username[0]}</div>
          <span className={`text-sm font-medium ${username === ADMIN_USERNAME ? "text-red-500" : "text-muted-foreground"}`}>{username}</span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 z-10 text-xs font-semibold px-2 py-0.5 rounded-full bg-black/60 text-white">{username}</div>
      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between px-2 pb-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-1.5 bg-black/60 rounded-full px-2 py-1">
          <Volume2 className="w-3 h-3 text-white shrink-0" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => { e.stopPropagation(); onVolumeChange(username, parseFloat(e.target.value)); }}
            onClick={(e) => e.stopPropagation()}
            className="w-14 h-1 accent-white cursor-pointer"
          />
        </div>
        {hasVideo && (
          <button
            onClick={(e) => { e.stopPropagation(); containerRef.current?.requestFullscreen(); }}
            className="bg-black/60 rounded-full p-1.5 text-white hover:text-blue-400 transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

interface VoicePanelProps {
  username: string;
  voiceUsers: string[];
  inVoice: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  micError: string | null;
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  volumes: Map<string, number>;
  desktopAudioEnabled: boolean;
  screenQuality: string;
  joinVoice: (withCamera: boolean, withScreen?: boolean) => void;
  leaveVoice: () => void;
  toggleCamera: () => void;
  shareScreen: () => void;
  stopScreenShare: () => void;
  setScreenQuality: (quality: string) => void;
  toggleDesktopAudio: () => void;
  renegotiate: () => void;
  deafened: boolean;
  onDeafenToggle: () => void;
  onVolumeChange: (user: string, volume: number) => void;
}

export default function VoicePanel({
  username, voiceUsers, inVoice, cameraEnabled, screenSharing,
  micError, localStream, remoteStreams, volumes, desktopAudioEnabled, screenQuality,
  joinVoice, leaveVoice, toggleCamera, shareScreen, stopScreenShare,
  setScreenQuality, toggleDesktopAudio, renegotiate,
  deafened, onDeafenToggle, onVolumeChange,
}: VoicePanelProps) {
  const { toast } = useToast();
  const [joinWithCamera, setJoinWithCamera] = useState(false);
  const [joinWithScreen, setJoinWithScreen] = useState(false);

  useEffect(() => {
    if (micError === "camera-denied") {
      toast({ description: "camera access denied. joining with voice only." });
    }
  }, [micError, toast]);
  const [micMuted, setMicMuted] = useState(false);
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());
  const localVideoRef = useVideoRef(localStream);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserMapRef = useRef<Map<string, { analyser: AnalyserNode; data: Uint8Array }>>(new Map());

  useEffect(() => {
    if (micError) toast({ title: "device error", description: micError, variant: "destructive" });
  }, [micError, toast]);

  useEffect(() => {
    return () => {
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      analyserMapRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!inVoice) {
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      analyserMapRef.current.clear();
      setSpeakingUsers(new Set());
      return;
    }
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;

    remoteStreams.forEach((stream, user) => {
      if (!analyserMapRef.current.has(user)) {
        try {
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          analyserMapRef.current.set(user, { analyser, data });
        } catch {}
      }
    });
    analyserMapRef.current.forEach((_, user) => {
      if (!remoteStreams.has(user)) analyserMapRef.current.delete(user);
    });

    const interval = setInterval(() => {
      const speaking = new Set<string>();
      analyserMapRef.current.forEach(({ analyser, data }, user) => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a: number, b: number) => a + b, 0) / data.length;
        if (avg > 8) speaking.add(user);
      });
      setSpeakingUsers(speaking);
    }, 80);

    return () => clearInterval(interval);
  }, [inVoice, remoteStreams]);

  const toggleMic = () => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setMicMuted((m) => !m);
  };

  const handleDeafen = () => {
    if (!deafened) {
      localStream?.getAudioTracks().forEach((t) => { t.enabled = false; });
      setMicMuted(true);
    } else {
      if (!micMuted) localStream?.getAudioTracks().forEach((t) => { t.enabled = true; });
    }
    onDeafenToggle();
  };

  const handleJoin = () => {
    joinVoice(joinWithCamera, joinWithScreen);
  };

  const remoteEntries = [...remoteStreams.entries()];
  const showLocalVideo = cameraEnabled || screenSharing;
  const totalStreams = remoteEntries.length + (showLocalVideo ? 1 : 0);
  const gridCols = totalStreams <= 1 ? "grid-cols-1" : totalStreams <= 4 ? "grid-cols-2" : "grid-cols-3";

  const isLocalFocused = focusedUserId === "local";
  const focusStream = isLocalFocused
    ? { stream: localStream, username, isLocal: true }
    : focusedUserId
      ? { stream: remoteStreams.get(focusedUserId) ?? null, username: focusedUserId, isLocal: false }
      : null;

  const focusStreamRef = useVideoRef(focusStream?.stream ?? null);
  const focusHasVideo = (focusStream?.stream?.getVideoTracks().length ?? 0) > 0;

  const otherRemoteEntries = remoteEntries.filter(([u]) => u !== focusedUserId);
  const showLocalInGallery = showLocalVideo && !isLocalFocused;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">
      <div className="h-14 border-b border-border flex items-center gap-3 px-6 shrink-0 bg-card/40">
        <Volume2 className="w-4 h-4 text-muted-foreground" />
        <span className="font-semibold text-sm">general</span>
        <span className="text-[10px] uppercase tracking-wider font-bold text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">voice</span>
        {voiceUsers.length > 0 && <span className="text-xs text-muted-foreground ml-1">{voiceUsers.length} in channel</span>}
      </div>

      {!inVoice ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Volume2 className="w-9 h-9 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-1">voice channel &mdash; general</h2>
            <p className="text-muted-foreground text-sm">
              {voiceUsers.length > 0
                ? `${voiceUsers.join(", ")} ${voiceUsers.length === 1 ? "is" : "are"} already here`
                : "no one is here yet. be the first!"}
            </p>
          </div>

          {voiceUsers.length > 0 && (
            <div className="flex flex-wrap justify-center gap-3">
              {voiceUsers.map((u) => (
                <div key={u} className="flex flex-col items-center gap-1">
                  <div className={`w-12 h-12 rounded-full bg-muted flex items-center justify-center text-lg font-bold uppercase ${u === ADMIN_USERNAME ? "text-red-500" : ""}`}>{u[0]}</div>
                  <span className={`text-xs ${u === ADMIN_USERNAME ? "text-red-500" : "text-muted-foreground"}`}>{u}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col items-center gap-3 w-full max-w-xs">
            <div className="flex gap-3 w-full">
              <button
                data-testid="button-prejoin-camera"
                onClick={() => { setJoinWithCamera((v) => !v); if (!joinWithCamera) setJoinWithScreen(false); }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all flex-1 justify-center ${joinWithCamera ? "border-blue-500 bg-blue-500/10 text-blue-400" : "border-border text-muted-foreground hover:border-muted-foreground"}`}
              >
                {joinWithCamera ? <Camera className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                camera {joinWithCamera ? "on" : "off"}
              </button>
              <button
                data-testid="button-prejoin-screen"
                onClick={() => { setJoinWithScreen((v) => !v); if (!joinWithScreen) setJoinWithCamera(false); }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all flex-1 justify-center ${joinWithScreen ? "border-purple-500 bg-purple-500/10 text-purple-400" : "border-border text-muted-foreground hover:border-muted-foreground"}`}
              >
                {joinWithScreen ? <Monitor className="w-4 h-4" /> : <MonitorX className="w-4 h-4" />}
                screen {joinWithScreen ? "on" : "off"}
              </button>
            </div>
            <Button
              data-testid="button-join-voice"
              onClick={handleJoin}
              className="w-full h-11 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-xl gap-2"
            >
              <Phone className="w-4 h-4" /> join voice channel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 p-6 overflow-y-auto max-h-full">
            {remoteEntries.length === 0 && !showLocalVideo ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Mic className="w-10 h-10" />
                <p className="text-sm">connected &mdash; waiting for others to join</p>
              </div>
            ) : focusedUserId && focusStream?.stream ? (
              <div className="flex flex-col gap-4 h-full">
                <div
                  onClick={() => setFocusedUserId(null)}
                  className="relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-900 flex items-center justify-center cursor-pointer hover:ring-2 ring-primary transition-all"
                >
                  {focusHasVideo ? (
                    <video ref={focusStreamRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className={`w-20 h-20 rounded-full bg-muted flex items-center justify-center text-4xl font-bold uppercase ${focusStream.username === ADMIN_USERNAME ? "text-red-500" : "text-foreground"}`}>{focusStream.username[0]}</div>
                      <span className={`text-xl font-medium ${focusStream.username === ADMIN_USERNAME ? "text-red-500" : "text-muted-foreground"}`}>{focusStream.username}{focusStream.isLocal ? " (you)" : ""}</span>
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 z-10 text-xs font-semibold px-2 py-0.5 rounded-full bg-black/60 text-white">click to exit focus</div>
                </div>
                {otherRemoteEntries.length > 0 || showLocalInGallery ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {showLocalInGallery && localStream && (
                      <div
                        onClick={() => setFocusedUserId("local")}
                        className="relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-900 flex items-center justify-center cursor-pointer hover:ring-2 ring-primary transition-all"
                      >
                        <video
                          ref={localVideoRef}
                          autoPlay
                          playsInline
                          muted
                          className={`absolute inset-0 w-full h-full object-cover ${cameraEnabled && !screenSharing ? "scale-x-[-1]" : ""}`}
                        />
                        <div className="absolute bottom-2 left-2 z-10 text-xs font-semibold px-2 py-0.5 rounded-full bg-black/60 text-white">
                          {username} (you){screenSharing ? " · screen" : ""}
                        </div>
                      </div>
                    )}
                    {otherRemoteEntries.map(([remoteUser, stream]) => (
                      <RemoteVideo
                        key={remoteUser}
                        stream={stream}
                        username={remoteUser}
                        onClick={() => setFocusedUserId(remoteUser)}
                        speaking={speakingUsers.has(remoteUser)}
                        volume={volumes.get(remoteUser) ?? 1}
                        onVolumeChange={onVolumeChange}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {showLocalVideo && localStream ? (
                  <div
                    onClick={() => setFocusedUserId("local")}
                    className="relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-900 flex items-center justify-center cursor-pointer hover:ring-2 ring-primary transition-all"
                  >
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`absolute inset-0 w-full h-full object-cover ${cameraEnabled && !screenSharing ? "scale-x-[-1]" : ""}`}
                    />
                    <div className="absolute bottom-2 left-2 z-10 text-xs font-semibold px-2 py-0.5 rounded-full bg-black/60 text-white">
                      {username} (you){screenSharing ? " · screen" : ""}
                    </div>
                  </div>
                ) : (
                  <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-900/60 flex flex-col items-center justify-center gap-2 border border-border">
                    <div className={`w-16 h-16 rounded-full bg-muted flex items-center justify-center text-2xl font-bold uppercase ${username === ADMIN_USERNAME ? "text-red-500" : ""}`}>{username[0]}</div>
                    <span className="text-sm text-muted-foreground">{username} (you)</span>
                    {micMuted && <MicOff className="w-4 h-4 text-red-400" />}
                  </div>
                )}
                {remoteEntries.map(([remoteUser, stream]) => (
                  <RemoteVideo
                    key={remoteUser}
                    stream={stream}
                    username={remoteUser}
                    onClick={() => setFocusedUserId(remoteUser)}
                    speaking={speakingUsers.has(remoteUser)}
                    volume={volumes.get(remoteUser) ?? 1}
                    onVolumeChange={onVolumeChange}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border bg-card/20 p-4 shrink-0">
            <div className="flex items-center justify-center gap-3">
              <button
                data-testid="button-toggle-mic"
                onClick={toggleMic}
                title={micMuted ? "unmute mic" : "mute mic"}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${micMuted ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-muted hover:bg-accent text-foreground"}`}
              >
                {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                data-testid="button-deafen"
                onClick={handleDeafen}
                title={deafened ? "undeafen" : "deafen (mute mic + audio)"}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${deafened ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30" : "bg-muted hover:bg-accent text-foreground"}`}
              >
                <VolumeX className="w-4 h-4" />
              </button>
              <button
                data-testid="button-toggle-camera"
                onClick={toggleCamera}
                title={cameraEnabled ? "turn camera off" : "turn camera on"}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${cameraEnabled ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" : "bg-muted hover:bg-accent text-foreground"}`}
              >
                {cameraEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
              </button>
              <button
                data-testid="button-toggle-screen"
                onClick={screenSharing ? stopScreenShare : shareScreen}
                title={screenSharing ? "stop sharing screen" : "share screen"}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${screenSharing ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30" : "bg-muted hover:bg-accent text-foreground"}`}
              >
                {screenSharing ? <MonitorX className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
              </button>
              {screenSharing && (
                <>
                  <div className="h-8 w-px bg-border" />
                  <select
                    value={screenQuality}
                    onChange={(e) => setScreenQuality(e.target.value)}
                    title="stream quality"
                    className="h-9 rounded-lg bg-muted px-2 text-xs text-foreground border border-border cursor-pointer"
                  >
                    <option value="480p">480p 30</option>
                    <option value="720p">720p 30</option>
                    <option value="1080p">1080p 30</option>
                  </select>
                  <button
                    onClick={toggleDesktopAudio}
                    title={desktopAudioEnabled ? "mute desktop audio" : "unmute desktop audio"}
                    className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${desktopAudioEnabled ? "bg-green-500/20 text-green-400 hover:bg-green-500/30" : "bg-muted hover:bg-accent text-foreground"}`}
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </>
              )}
              <button
                data-testid="button-sync"
                onClick={renegotiate}
                title="sync streams"
                className="w-11 h-11 rounded-full bg-muted hover:bg-accent text-foreground flex items-center justify-center transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                data-testid="button-end-call"
                onClick={leaveVoice}
                title="end call"
                className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition-colors"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>
            {voiceUsers.length > 0 && (
              <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
                {voiceUsers.map((u) => (
                  <div key={u} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mic className={`w-3 h-3 ${u === username ? "text-green-400" : ""}`} />
                    <span className={u === ADMIN_USERNAME ? "text-red-500" : u === username ? "text-green-400" : ""}>{u === username ? `${u} (you)` : u}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
