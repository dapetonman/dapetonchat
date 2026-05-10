import { useState, useRef, useEffect, useCallback } from "react";
import { format } from "date-fns";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import {
  Send, Loader2, LogOut, Moon, Sun, Users, Reply, Hash, Lock,
  Trash2, MoreVertical, Image, Mic, MicOff, Volume2, PhoneOff,
  Phone, Video, VideoOff, Camera, Monitor, MonitorX, File,
  FileText, FileImage, FileVideo, FileAudio, Download, ArrowLeft, Menu, RefreshCw,
} from "lucide-react";
import { useMessages, useSendMessage, useUsers, useChatWebSocket } from "@/hooks/use-chat";
import { useQueryClient } from "@tanstack/react-query";
import { useVoice } from "@/hooks/use-voice";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { onWsMessage, sendWs } from "@/lib/ws-bus";
import { CHANNEL_MESSAGE_IDS, getDmChatId, MAIN_CHANNELS } from "@shared/schema";
import type { Message } from "@shared/schema";

const ADMIN_USERNAME = "dapetonman";
const APP_TITLE = "dapetonchat";

const markdown = new MarkdownIt({ linkify: true, breaks: true });
markdown.renderer.rules.underline_open = () => "<u>";
markdown.renderer.rules.underline_close = () => "</u>";
markdown.inline.ruler.before("emphasis", "underline", (state, silent) => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x5f || state.src.charCodeAt(start + 1) !== 0x5f) return false;
  const end = state.src.indexOf("__", start + 2);
  if (end === -1) return false;
  if (!silent) {
    state.push("underline_open", "u", 1);
    state.pos = start + 2;
    state.pending = state.src.slice(start + 2, end);
    state.push("text", "", 0).content = state.pending;
    state.push("underline_close", "u", -1);
    state.pos = end + 2;
  }
  return true;
});

function renderMessage(content: string) {
  return { __html: DOMPurify.sanitize(markdown.renderInline(content)) };
}

function isImageMessage(content: string) {
  return content.startsWith("/view/");
}

function isFileMessage(content: string) {
  return content.startsWith("__file__:");
}

interface FileMeta {
  url: string;
  name: string;
  size: number;
}

function parseFileMeta(content: string): FileMeta | null {
  try {
    return JSON.parse(content.slice("__file__:".length)) as FileMeta;
  } catch {
    return null;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext)) return FileImage;
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return FileVideo;
  if (["mp3", "wav", "ogg", "flac", "aac"].includes(ext)) return FileAudio;
  if (["txt", "md", "pdf", "doc", "docx", "csv"].includes(ext)) return FileText;
  return File;
}

function FileCard({ meta, isMe }: { meta: FileMeta; isMe: boolean }) {
  const ext = (meta.name.split(".").pop() ?? "file").toUpperCase();
  const IconComponent = getFileIcon(meta.name);
  return (
    <a
      href={meta.url}
      download={meta.name}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm border transition-all hover:opacity-90 active:scale-[0.99] max-w-[300px] ${
        isMe
          ? "bg-primary/90 text-primary-foreground border-primary/50 rounded-tr-sm"
          : "bg-muted text-foreground border-border rounded-tl-sm"
      }`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isMe ? "bg-white/20" : "bg-background"}`}>
        <IconComponent className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate text-[13px]">{meta.name}</p>
        <p className={`text-[11px] mt-0.5 ${isMe ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
          {ext} &middot; {formatFileSize(meta.size)}
        </p>
      </div>
      <Download className={`w-4 h-4 shrink-0 ${isMe ? "text-primary-foreground/70" : "text-muted-foreground"}`} />
    </a>
  );
}

function useVideoRef(stream: MediaStream | null) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);
  return ref;
}

function AuthScreen({ onAuth }: { onAuth: () => void }) {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    const error = tab === "login" ? await login(username.trim(), password) : await register(username.trim(), password);
    setLoading(false);
    if (error) {
     toast({ title: 'Error', description: error, variant: 'destructive' });
  } else {
     // Force refresh for instant session sync
     window.location.href = '/chat';
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-zinc-950 px-4">
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl p-8 shadow-2xl border border-zinc-800">
        <h1 className="text-3xl text-white mb-2 text-center" style={{ fontFamily: '"Comic Sans MS", "Comic Sans", cursive', fontWeight: "normal" }}>dapetonchat</h1>
        <p className="text-zinc-500 text-center text-sm mb-8">{tab === "login" ? "Sign in to continue" : "Create your account"}</p>
        <div className="flex mb-6 bg-zinc-800 rounded-xl p-1">
          <button onClick={() => setTab("login")} className={`flex-1 py-2 text-sm font-medium rounded-lg ${tab === "login" ? "bg-zinc-700 text-white" : "text-zinc-400"}`}>Sign In</button>
          <button onClick={() => setTab("register")} className={`flex-1 py-2 text-sm font-medium rounded-lg ${tab === "register" ? "bg-zinc-700 text-white" : "text-zinc-400"}`}>Register</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input data-testid="input-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="h-11 bg-zinc-800 border-zinc-700 text-white" />
          <Input data-testid="input-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="h-11 bg-zinc-800 border-zinc-700 text-white" />
          <Button data-testid="button-submit" type="submit" className="w-full h-11 font-semibold bg-white text-black" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : tab === "login" ? "Sign In" : "Create Account"}
          </Button>
        </form>
        <button
          onClick={() => window.location.href = "/"}
          className="fixed bottom-6 left-6 flex items-center gap-2 text-zinc-500 hover:text-white transition-colors"
          style={{ fontFamily: '"Comic Sans MS", "Comic Sans", cursive', fontWeight: "normal", fontSize: "1.1rem" }}
        >
          <ArrowLeft className="w-5 h-5" /> back
        </button>
      </div>
    </div>
  );
}

function ChatWindow({ chatId, username, chatLabel, isPrivate }: { chatId: string; username: string; chatLabel: string; isPrivate: boolean }) {
  const { data: messages = [], isLoading } = useMessages(chatId);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [dragActive, setDragActive] = useState(false);
  const typingTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const isTypingRef = useRef<boolean>(false);
  const typingThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const vp = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (vp) vp.scrollTop = vp.scrollHeight;
  }, [messages]);

  const uploadFile = useCallback((file: Blob, filename: string) => {
    setUploading(true);
    setUploadProgress(0);
    const form = new FormData();
    form.append("image", file, filename);
    form.append("username", username);
    form.append("chatId", chatId);

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploading(false);
        setUploadProgress(0);
      } else {
        setUploading(false);
        setUploadProgress(0);
        toast({ title: "Upload failed", description: "Could not send the file.", variant: "destructive" });
      }
    });
    xhr.addEventListener("error", () => {
      setUploading(false);
      setUploadProgress(0);
      toast({ title: "Upload failed", description: "Could not send the file.", variant: "destructive" });
    });
    xhr.open("POST", "/upload");
    xhr.send(form);
  }, [username, chatId, toast]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items);
      const imgItem = items.find((item) => item.type.startsWith("image/"));
      if (!imgItem) return;
      e.preventDefault();
      const blob = imgItem.getAsFile();
      if (blob) uploadFile(blob, "screenshot.png");
    };
    window.addEventListener("paste", onPaste);

    const unsubTyping = onWsMessage("typing", ({ userId, username: typerName, chatId: typingChatId, status }: { userId: string; username: string; chatId: string; status?: string }) => {
      console.log("RECEIVED TYPING:", { userId, typerName, typingChatId, status, currentChatId: chatId, isMe: userId === username });
      if (userId === username) return;
      if (typingChatId !== chatId) return;
      if (status === "stopped") {
        const existing = typingTimeoutRef.current.get(userId);
        if (existing) { clearTimeout(existing); typingTimeoutRef.current.delete(userId); }
        setTypingUsers((prev) => { const next = new Map(prev); next.delete(userId); return next; });
        return;
      }
      setTypingUsers((prev) => { const next = new Map(prev); next.set(userId, typerName); return next; });
      const existing = typingTimeoutRef.current.get(userId);
      if (existing) { clearTimeout(existing); }
      const timer = setTimeout(() => {
        setTypingUsers((prev) => { const next = new Map(prev); next.delete(userId); return next; });
        typingTimeoutRef.current.delete(userId);
      }, 3000);
      typingTimeoutRef.current.set(userId, timer);
    });

    return () => {
      window.removeEventListener("paste", onPaste);
      unsubTyping();
      typingTimeoutRef.current.forEach((t) => clearTimeout(t));
      typingTimeoutRef.current.clear();
      if (typingThrottleRef.current) clearTimeout(typingThrottleRef.current);
    };
  }, [uploadFile, username, chatId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || isSending) return;
    if (typingThrottleRef.current) { clearTimeout(typingThrottleRef.current); typingThrottleRef.current = null; }
    sendWs({ type: "typing", chatId, userId: username, username, status: "stopped" });
    setTypingUsers((prev) => { const next = new Map(prev); next.delete(username); return next; });
    typingTimeoutRef.current.delete(username);
    isTypingRef.current = false;
    sendMessage({ username, content: trimmed, chatId, replyToId: replyTo?.id ?? null }, { onSuccess: () => { setContent(""); setReplyTo(null); } });
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setContent(e.target.value);
    if (typingThrottleRef.current) return;
    if (!isTypingRef.current) {
      const payload = { type: "typing", chatId, userId: username, username };
      console.log("[ChatWindow] Sending typing (first strike):", payload);
      sendWs(payload);
      isTypingRef.current = true;
    }
    typingThrottleRef.current = setTimeout(() => {
      typingThrottleRef.current = null;
    }, 2000);
  };

  const handleFileDrop = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    await uploadFile(file, file.name);
  }, [uploadFile]);

  return (
    <div
      className={`flex flex-col flex-1 min-h-0 ${dragActive ? "ring-2 ring-primary ring-inset" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFileDrop(e.dataTransfer.files); }}
    >
      <div className="h-14 border-b border-border flex items-center gap-3 px-6 shrink-0 bg-card/40">
        {isPrivate ? <Lock className="w-4 h-4 text-muted-foreground" /> : <Hash className="w-4 h-4 text-muted-foreground" />}
        <span className="font-semibold text-sm">{chatLabel}</span>
        {isPrivate && <span className="text-[10px] uppercase tracking-wider font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">Private</span>}
        <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1"><Image className="w-3 h-3" /> Paste or drag to share</span>
      </div>
      <ScrollArea className="flex-1 px-6 py-4" ref={scrollRef}>
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-1">
            {messages.map((msg, i) => {
              const isMe = msg.username === username;
              const showUsername = i === 0 || messages[i - 1].username !== msg.username;
              const replyTarget = msg.replyToId ? messages.find((m) => m.id === msg.replyToId) : null;
              const isImg = isImageMessage(msg.content);
              const isFile = isFileMessage(msg.content);
              const fileMeta = isFile ? parseFileMeta(msg.content) : null;
              return (
                <div key={msg.id} data-testid={`message-${msg.id}`} className={`flex flex-col ${isMe ? "items-end" : "items-start"} ${showUsername ? "mt-4" : "mt-0.5"}`}>
                  {showUsername && (
                    <div className={`flex items-baseline gap-2 mb-1 ${isMe ? "flex-row-reverse" : ""}`}>
                      <span className={`text-xs font-bold ${msg.username === ADMIN_USERNAME ? "text-red-500" : ""}`}>{isMe ? "You" : msg.username}</span>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(msg.createdAt), "MMM d, h:mm a")}</span>
                    </div>
                  )}
                  {replyTarget && (
                    <div className="mb-1 text-xs text-muted-foreground bg-muted/40 px-2 py-1 rounded-lg border-l-2 border-primary/30 flex items-center gap-1 max-w-[75%]">
                      <Reply className="w-3 h-3 shrink-0" />
                      <span className="truncate">
                        <span className="font-medium">{replyTarget.username}:</span>{" "}
                        {isImageMessage(replyTarget.content) ? "[image]" : isFileMessage(replyTarget.content) ? "[file]" : replyTarget.content}
                      </span>
                    </div>
                  )}
                  {isImg ? (
                    <div className={`relative group max-w-[75%] rounded-2xl overflow-hidden ${isMe ? "rounded-tr-sm" : "rounded-tl-sm"}`}>
                      <a href={msg.content} target="_blank" rel="noopener noreferrer">
                        <img data-testid={`image-${msg.id}`} src={msg.content} alt="shared image" className="max-w-full max-h-80 object-contain block hover:opacity-90 transition-opacity cursor-pointer" />
                      </a>
                    </div>
                  ) : isFile && fileMeta ? (
                    <div className="relative group">
                      <FileCard meta={fileMeta} isMe={isMe} />
                      <button
                        onClick={(e) => { e.stopPropagation(); setReplyTo(msg); }}
                        className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full bg-card border border-border shadow-sm ${isMe ? "-left-8" : "-right-8"}`}
                      >
                        <Reply className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`relative group max-w-[75%] px-4 py-2 rounded-2xl text-sm break-words cursor-pointer select-none transition-all ${isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"} hover:opacity-90 active:scale-[0.99]`}
                      onClick={(e) => { if (e.shiftKey) setReplyTo(msg); }}
                    >
                      <span dangerouslySetInnerHTML={renderMessage(msg.content)} />
                      <button onClick={(e) => { e.stopPropagation(); setReplyTo(msg); }} className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full bg-card border border-border shadow-sm ${isMe ? "-left-8" : "-right-8"}`}><Reply className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
      <div className="p-4 border-t border-border bg-card/20 shrink-0">
        <div className="max-w-3xl mx-auto">
          {replyTo && (
            <div className="mb-2 px-3 py-2 bg-muted/50 rounded-lg flex items-center justify-between text-xs border border-border">
              <span className="flex items-center gap-2 text-muted-foreground"><Reply className="w-3 h-3" /> Replying to <span className="font-semibold text-foreground">@{replyTo.username}</span></span>
              <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
          )}
          {uploading && (
            <div className="mb-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-1.5" />
            </div>
          )}
          <div className="h-4 mb-1.5 text-[10px] text-muted-foreground italic flex items-center">
            {typingUsers.size > 0 && (
              <span>{[...typingUsers.values()].join(", ")} {typingUsers.size === 1 ? "is" : "are"} typing...</span>
            )}
          </div>
          <form onSubmit={handleSubmit} className="flex gap-3">
            <div className="relative flex-1">
              <Input data-testid="input-message" value={content} onChange={handleContentChange} placeholder={isPrivate ? `Message ${chatLabel}... (Ctrl+V to paste image)` : "Message everyone... (Ctrl+V to paste image)"} className="h-11 bg-muted/50 border-border focus-visible:ring-1 focus-visible:ring-primary pr-10" />
              {uploading && <div className="absolute right-3 top-1/2 -translate-y-1/2"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
            </div>
            <Button data-testid="button-send" type="submit" size="icon" className="h-11 w-11 shrink-0 rounded-xl" disabled={!content.trim() || isSending || uploading}>
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function RemoteVideo({ stream, username, onClick }: { stream: MediaStream; username: string; onClick?: () => void }) {
  const ref = useVideoRef(stream);
  const hasVideo = stream.getVideoTracks().length > 0;
  return (
    <div
      onClick={onClick}
      className="relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-900 flex items-center justify-center cursor-pointer hover:ring-2 ring-primary transition-all"
    >
      {hasVideo ? (
        <video ref={ref} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2">
          <div className={`w-16 h-16 rounded-full bg-muted flex items-center justify-center text-2xl font-bold uppercase ${username === ADMIN_USERNAME ? "text-red-500" : "text-foreground"}`}>{username[0]}</div>
          <span className={`text-sm font-medium ${username === ADMIN_USERNAME ? "text-red-500" : "text-muted-foreground"}`}>{username}</span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 z-10 text-xs font-semibold px-2 py-0.5 rounded-full bg-black/60 text-white">{username}</div>
    </div>
  );
}

function VoicePanel({
  username, voiceUsers, inVoice, cameraEnabled, screenSharing,
  micError, localStream, remoteStreams,
  joinVoice, leaveVoice, toggleCamera, shareScreen, stopScreenShare, renegotiate,
}: {
  username: string;
  voiceUsers: string[];
  inVoice: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  micError: string | null;
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  joinVoice: (withCamera: boolean, withScreen?: boolean) => void;
  leaveVoice: () => void;
  toggleCamera: () => void;
  shareScreen: () => void;
  stopScreenShare: () => void;
  renegotiate: () => void;
}) {
  const { toast } = useToast();
  const [joinWithCamera, setJoinWithCamera] = useState(false);
  const [joinWithScreen, setJoinWithScreen] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);
  const localVideoRef = useVideoRef(localStream);

  useEffect(() => {
    if (micError) toast({ title: "Device error", description: micError, variant: "destructive" });
  }, [micError, toast]);

  const toggleMic = () => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setMicMuted((m) => !m);
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
  const focusHasVideo = focusStream?.stream?.getVideoTracks().length > 0;

  const otherRemoteEntries = remoteEntries.filter(([u]) => u !== focusedUserId);
  const showLocalInGallery = showLocalVideo && !isLocalFocused;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">
      <div className="h-14 border-b border-border flex items-center gap-3 px-6 shrink-0 bg-card/40">
        <Volume2 className="w-4 h-4 text-muted-foreground" />
        <span className="font-semibold text-sm">general</span>
        <span className="text-[10px] uppercase tracking-wider font-bold text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">Voice</span>
        {voiceUsers.length > 0 && <span className="text-xs text-muted-foreground ml-1">{voiceUsers.length} in channel</span>}
      </div>

      {!inVoice ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Volume2 className="w-9 h-9 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-1">Voice Channel — general</h2>
            <p className="text-muted-foreground text-sm">
              {voiceUsers.length > 0
                ? `${voiceUsers.join(", ")} ${voiceUsers.length === 1 ? "is" : "are"} already here`
                : "No one is here yet. Be the first!"}
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
                Camera {joinWithCamera ? "ON" : "OFF"}
              </button>
              <button
                data-testid="button-prejoin-screen"
                onClick={() => { setJoinWithScreen((v) => !v); if (!joinWithScreen) setJoinWithCamera(false); }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all flex-1 justify-center ${joinWithScreen ? "border-purple-500 bg-purple-500/10 text-purple-400" : "border-border text-muted-foreground hover:border-muted-foreground"}`}
              >
                {joinWithScreen ? <Monitor className="w-4 h-4" /> : <MonitorX className="w-4 h-4" />}
                Screen {joinWithScreen ? "ON" : "OFF"}
              </button>
            </div>
            <Button
              data-testid="button-join-voice"
              onClick={handleJoin}
              className="w-full h-11 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-xl gap-2"
            >
              <Phone className="w-4 h-4" /> Join Voice Channel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 p-6 overflow-y-auto max-h-full">
            {remoteEntries.length === 0 && !showLocalVideo ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Mic className="w-10 h-10" />
                <p className="text-sm">Connected — waiting for others to join</p>
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
                  <div className="absolute bottom-2 left-2 z-10 text-xs font-semibold px-2 py-0.5 rounded-full bg-black/60 text-white">Click to exit focus</div>
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
                title={micMuted ? "Unmute" : "Mute"}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${micMuted ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-muted hover:bg-accent text-foreground"}`}
              >
                {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                data-testid="button-toggle-camera"
                onClick={toggleCamera}
                title={cameraEnabled ? "Turn camera off" : "Turn camera on"}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${cameraEnabled ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" : "bg-muted hover:bg-accent text-foreground"}`}
              >
                {cameraEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
              </button>
              <button
                data-testid="button-toggle-screen"
                onClick={screenSharing ? stopScreenShare : shareScreen}
                title={screenSharing ? "Stop sharing screen" : "Share screen"}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${screenSharing ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30" : "bg-muted hover:bg-accent text-foreground"}`}
              >
                {screenSharing ? <MonitorX className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
              </button>
              <button
                data-testid="button-sync"
                onClick={renegotiate}
                title="Sync streams"
                className="w-11 h-11 rounded-full bg-muted hover:bg-accent text-foreground flex items-center justify-center transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                data-testid="button-end-call"
                onClick={leaveVoice}
                title="End call"
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

function ChatInterface({ username, onLogout, theme, setTheme }: { username: string; onLogout: () => void; theme: "light" | "dark"; setTheme: (t: "light" | "dark") => void }) {
  const { data: fetchedUsers = [] } = useUsers();
  const { toast } = useToast();
  const [activeView, setActiveView] = useState<"chat" | "voice">("chat");
  const [activeChatId, setActiveChatId] = useState<string>("general");
  const [activeChatLabel, setActiveChatLabel] = useState<string>("general");
  const [isPrivate, setIsPrivate] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userOnlineMap, setUserOnlineMap] = useState<Map<string, boolean>>(new Map());
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  useChatWebSocket(username);
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsub = onWsMessage("presence", (data: { userId: string; username?: string; online: boolean }) => {
      console.log("[ChatInterface] Presence WS:", data);
      const userKey = data.userId || data.username;
      if (!userKey) return;
      setUserOnlineMap((prev) => {
        const next = new Map(prev);
        next.set(userKey, data.online);
        return next;
      });
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        if (data.online) next.add(userKey);
        else next.delete(userKey);
        return next;
      });
    });
    const unsubSync = onWsMessage("presence-sync", (data: { users: string[] }) => {
      console.log("[ChatInterface] Presence sync WS:", data);
      setOnlineUsers(new Set(data.users));
      const nextMap = new Map<string, boolean>();
      data.users.forEach((u) => nextMap.set(u, true));
      setUserOnlineMap(nextMap);
    });
    const unsubRefreshUserList = onWsMessage("REFRESH_USER_LIST", () => {
      console.log("Refreshing user list via WS...");
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    });
    return () => { unsub(); unsubSync(); unsubRefreshUserList(); };
  }, [queryClient]);

  const allUsers = fetchedUsers.map((u) => ({
    ...u,
    isOnline: u.username === username ? true : ((onlineUsers.has(u.username) || userOnlineMap.get(u.username)) ?? u.isOnline ?? false),
  }));

  const {
    voiceUsers, inVoice, cameraEnabled, screenSharing,
    micError, localStream, remoteStreams,
    joinVoice, leaveVoice, toggleCamera, shareScreen, stopScreenShare, renegotiate,
  } = useVoice(username);

  const remoteAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    remoteStreams.forEach((stream, user) => {
      let audioEl = remoteAudioRefs.current.get(user);
      if (!audioEl) {
        audioEl = document.createElement("audio");
        audioEl.setAttribute("data-user", user);
        remoteAudioRefs.current.set(user, audioEl);
      }
      audioEl.srcObject = stream;
      audioEl.play().catch(() => {});
    });
    const currentUsers = new Set(remoteStreams.keys());
    remoteAudioRefs.current.forEach((el, user) => {
      if (!currentUsers.has(user)) {
        el.pause();
        el.srcObject = null;
        remoteAudioRefs.current.delete(user);
      }
    });
  }, [remoteStreams]);

  useEffect(() => {
    const updateTitle = () => { document.title = document.hidden ? "new message" : APP_TITLE; };
    updateTitle();
    document.addEventListener("visibilitychange", updateTitle);
    window.addEventListener("focus", updateTitle);
    window.addEventListener("blur", updateTitle);
    return () => {
      document.removeEventListener("visibilitychange", updateTitle);
      window.removeEventListener("focus", updateTitle);
      window.removeEventListener("blur", updateTitle);
      document.title = APP_TITLE;
    };
  }, []);

  useEffect(() => {
    const onMsg = () => { if (document.hidden) document.title = "new message"; };
    window.addEventListener("chat-new-message", onMsg as EventListener);
    return () => window.removeEventListener("chat-new-message", onMsg as EventListener);
  }, []);

  const openDm = (otherUser: string) => { setActiveChatId(getDmChatId(username, otherUser)); setActiveChatLabel(otherUser); setIsPrivate(true); setActiveView("chat"); setMobileMenuOpen(false); };
  const openGeneral = (channel: string) => { setActiveChatId(CHANNEL_MESSAGE_IDS[channel as keyof typeof CHANNEL_MESSAGE_IDS] ?? channel); setActiveChatLabel(channel); setIsPrivate(false); setActiveView("chat"); setMobileMenuOpen(false); };
  const openVoice = () => { setActiveView("voice"); setMobileMenuOpen(false); };

  const handleDeleteAllMessages = async () => {
    if (username !== ADMIN_USERNAME || deleting) return;
    setDeleting(true);
    const res = await fetch("/api/messages", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
    setDeleting(false); setMenuOpen(false);
    if (!res.ok) toast({ title: "Error", description: "Failed to delete messages", variant: "destructive" });
  };

  const handleDeleteAllUsers = async () => {
    if (username !== ADMIN_USERNAME || deleting) return;
    setDeleting(true);
    const res = await fetch("/api/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
    setDeleting(false); setMenuOpen(false);
    if (!res.ok) toast({ title: "Error", description: "Failed to delete users", variant: "destructive" });
  };

  const handleKickAllVoice = async () => {
    if (username !== ADMIN_USERNAME || deleting) return;
    setDeleting(true);
    const res = await fetch("/api/voice/kick-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
    setDeleting(false);
    setMenuOpen(false);
    if (!res.ok) toast({ title: "Error", description: "Failed to kick voice users", variant: "destructive" });
  };

  return (
    <div className="h-screen w-full bg-background flex font-sans overflow-hidden">
      <div className="hidden md:flex w-60 flex-none border-r border-border bg-card flex-col">
        <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
          <h1 className="text-xl text-foreground" style={{ fontFamily: '"Comic Sans MS", "Comic Sans", cursive', fontWeight: "normal" }}>dapetonchat</h1>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-5">
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 mb-1">Text Channels</p>
              <div className="space-y-1">
                {MAIN_CHANNELS.map((channel) => (
                  <button key={channel} data-testid={`sidebar-channel-${channel}`} onClick={() => openGeneral(channel)} className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeView === "chat" && activeChatId === channel ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50 text-muted-foreground"}`}>
                    <Hash className="w-4 h-4 shrink-0" />{channel}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 mb-1 flex items-center gap-1">
                <Volume2 className="w-3 h-3" /> Voice Channels
              </p>
              <div className="space-y-1">
                <button
                  data-testid="button-voice-general"
                  onClick={openVoice}
                  className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeView === "voice" ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50 text-muted-foreground"}`}
                >
                  <Volume2 className="w-4 h-4 shrink-0" />
                  <span className="flex-1 text-left">general</span>
                  {inVoice && <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />}
                  {!inVoice && voiceUsers.length > 0 && <span className="text-[10px] font-bold">{voiceUsers.length}</span>}
                </button>
                {voiceUsers.length > 0 && (
                  <div className="ml-4 space-y-0.5">
                    {voiceUsers.map((u) => (
                      <div key={u} className="flex items-center gap-2 px-2 py-0.5 text-xs text-muted-foreground">
                        <Mic className={`w-3 h-3 shrink-0 ${u === username ? "text-green-400" : ""}`} />
                        <span className={u === ADMIN_USERNAME ? "text-red-500" : u === username ? "text-green-400" : ""}>{u === username ? `${u} (you)` : u}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 mb-1 flex items-center gap-1">
                <Users className="w-3 h-3" /> Users
              </p>
              <div className="space-y-0.5">
                {allUsers.map((u) => {
                  const chatId = getDmChatId(username, u.username);
                  const isUserOnline = u.username === username || onlineUsers.has(u.username) || onlineUsers.has(String(u.id));
                  return (
                    <button key={u.id} data-testid={`sidebar-user-${u.id}`} onClick={() => openDm(u.username)} className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeView === "chat" && activeChatId === chatId ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50 text-muted-foreground"}`}>
                      <div className="relative w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold uppercase shrink-0">
                        {u.username[0]}
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-card ${isUserOnline ? "bg-green-500" : "bg-zinc-600"}`} />
                      </div>
                      <span className={`truncate ${u.username === ADMIN_USERNAME ? "text-red-500" : ""}`}>{u.username}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </ScrollArea>
        <div className="p-3 border-t border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold uppercase shrink-0 ${username === ADMIN_USERNAME ? "text-red-500" : ""}`}>{username[0]}</div>
            <span className={`text-sm font-medium flex-1 truncate ${username === ADMIN_USERNAME ? "text-red-500" : ""}`}>{username}</span>
            <button data-testid="button-theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">{theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
            <button data-testid="button-logout" onClick={onLogout} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><LogOut className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetTrigger asChild>
          <button className="md:hidden fixed top-4 left-4 z-40 p-2 rounded-lg bg-card border border-border">
            <Menu className="w-5 h-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="w-60 p-0">
          <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
            <h1 className="text-xl text-foreground" style={{ fontFamily: '"Comic Sans MS", "Comic Sans", cursive', fontWeight: "normal" }}>dapetonchat</h1>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-5">
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 mb-1">Text Channels</p>
                <div className="space-y-1">
                  {MAIN_CHANNELS.map((channel) => (
                    <button key={channel} data-testid={`mobile-sidebar-channel-${channel}`} onClick={() => openGeneral(channel)} className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeView === "chat" && activeChatId === channel ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50 text-muted-foreground"}`}>
                      <Hash className="w-4 h-4 shrink-0" />{channel}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 mb-1 flex items-center gap-1">
                  <Volume2 className="w-3 h-3" /> Voice Channels
                </p>
                <div className="space-y-1">
                  <button
                    data-testid="mobile-button-voice-general"
                    onClick={openVoice}
                    className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeView === "voice" ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50 text-muted-foreground"}`}
                  >
                    <Volume2 className="w-4 h-4 shrink-0" />
                    <span className="flex-1 text-left">general</span>
                    {inVoice && <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />}
                    {!inVoice && voiceUsers.length > 0 && <span className="text-[10px] font-bold">{voiceUsers.length}</span>}
                  </button>
                  {voiceUsers.length > 0 && (
                    <div className="ml-4 space-y-0.5">
                      {voiceUsers.map((u) => (
                        <div key={u} className="flex items-center gap-2 px-2 py-0.5 text-xs text-muted-foreground">
                          <Mic className={`w-3 h-3 shrink-0 ${u === username ? "text-green-400" : ""}`} />
                          <span className={u === ADMIN_USERNAME ? "text-red-500" : u === username ? "text-green-400" : ""}>{u === username ? `${u} (you)` : u}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 mb-1 flex items-center gap-1">
                  <Users className="w-3 h-3" /> Users
                </p>
                <div className="space-y-0.5">
                  {allUsers.map((u) => {
                    const chatId = getDmChatId(username, u.username);
                    const isUserOnline = u.username === username || onlineUsers.has(u.username) || onlineUsers.has(String(u.id));
                    return (
                      <button key={u.id} data-testid={`mobile-sidebar-user-${u.id}`} onClick={() => openDm(u.username)} className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeView === "chat" && activeChatId === chatId ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50 text-muted-foreground"}`}>
                        <div className="relative w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold uppercase shrink-0">
                          {u.username[0]}
                          <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-card ${isUserOnline ? "bg-green-500" : "bg-zinc-600"}`} />
                        </div>
                        <span className={`truncate ${u.username === ADMIN_USERNAME ? "text-red-500" : ""}`}>{u.username}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </ScrollArea>
          <div className="p-3 border-t border-border shrink-0">
            <div className="flex items-center gap-2">
              <div className="relative w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold uppercase shrink-0">
                {username[0]}
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 border border-card" />
              </div>
              <span className={`text-sm font-medium flex-1 truncate ${username === ADMIN_USERNAME ? "text-red-500" : ""}`}>{username}</span>
              <button data-testid="mobile-button-theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">{theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
              <button data-testid="mobile-button-logout" onClick={onLogout} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><LogOut className="w-4 h-4" /></button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0">
        {activeView === "chat" ? (
          <ChatWindow key={activeChatId} chatId={activeChatId} username={username} chatLabel={activeChatLabel} isPrivate={isPrivate} />
        ) : (
          <VoicePanel
            username={username}
            voiceUsers={voiceUsers}
            inVoice={inVoice}
            cameraEnabled={cameraEnabled}
            screenSharing={screenSharing}
            micError={micError}
            localStream={localStream}
            remoteStreams={remoteStreams}
            joinVoice={joinVoice}
            leaveVoice={leaveVoice}
            toggleCamera={toggleCamera}
            shareScreen={shareScreen}
            stopScreenShare={stopScreenShare}
            renegotiate={renegotiate}
          />
        )}
      </div>

      {username === ADMIN_USERNAME && (
        <div className="fixed bottom-4 right-4 z-50">
          <button data-testid="button-admin-menu" onClick={() => setMenuOpen((v) => !v)} className="inline-flex items-center gap-2 rounded-full bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground shadow-lg hover:opacity-90">
            <MoreVertical className="h-4 w-4" /> Admin menu
          </button>
          {menuOpen && (
            <div className="absolute bottom-14 right-0 w-56 rounded-xl border border-border bg-card p-2 shadow-xl">
              <button data-testid="button-delete-all-messages" onClick={handleDeleteAllMessages} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                <Trash2 className="h-4 w-4" /> Delete all messages
              </button>
              <button data-testid="button-delete-all-users" onClick={handleDeleteAllUsers} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                <Users className="h-4 w-4" /> Delete all users
              </button>
              <button data-testid="button-kick-all-voice" onClick={handleKickAllVoice} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                <PhoneOff className="h-4 w-4" /> Kick all voice users
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const { user, isReady, logout } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => { document.documentElement.classList.toggle("dark", theme === "dark"); }, [theme]);
  if (!isReady) return <div className="h-screen w-full flex items-center justify-center bg-background"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  if (!user) return <AuthScreen onAuth={() => {}} />;
  return <ChatInterface username={user.username} onLogout={logout} theme={theme} setTheme={setTheme} />;
}
