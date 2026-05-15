import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import {
  Send, Loader2, LogOut, Moon, Sun, Users, Reply, Hash, Lock,
  Trash2, Image, Mic, MicOff, Volume2, PhoneOff,
  Phone, Video, VideoOff, Camera, Monitor, MonitorX, File,
  FileText, FileImage, FileVideo, FileAudio, Download, ArrowLeft, Menu, RefreshCw,
  Eye, EyeOff, Settings, Search, X, Pencil, VolumeX, ChevronDown, Copy, Bell, BellOff,
  Play, Pause, Upload, SmilePlus, ChevronLeft, ChevronRight,
} from "lucide-react";
import { useMessages, useSendMessage, useEditMessage, useUsers, useChatWebSocket, useDeleteMessage, useReactions, useToggleReaction } from "@/hooks/use-chat";
import { useQueryClient } from "@tanstack/react-query";
import { useVoice } from "@/hooks/use-voice";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { onWsMessage, sendWs } from "@/lib/ws-bus";
import { CHANNEL_MESSAGE_IDS, getDmChatId, MAIN_CHANNELS } from "@shared/schema";
import type { Message } from "@shared/schema";

const ADMIN_USERNAME = "dapetonman";
const APP_TITLE = "dapetonchat";
const REACTION_EMOJIS = ["👍", "👎", "❤️", "😂", "😮", "😢", "🔥", "🎉"];

const markdown = new MarkdownIt({ linkify: true, breaks: true });
markdown.renderer.rules.underline_open = () => "<u>";
markdown.renderer.rules.underline_close = () => "</u>";
markdown.inline.ruler.before("emphasis", "underline", (state: any, silent: boolean) => {
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

function formatMessageTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3_600_000) return formatDistanceToNow(date, { addSuffix: true });
  return format(date, "h:mm a");
}

function AudioPlayer({ url, name, isMe }: { url: string; name: string; isMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const fmt = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  const accent = isMe ? "rgba(255,255,255,0.9)" : "var(--primary)";

  return (
    <div className={`flex flex-col gap-2.5 px-3 py-3 rounded-2xl min-w-[240px] max-w-[300px] ${isMe ? "bg-primary/90 text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"}`}>
      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
      />
      <p className="text-[13px] font-medium truncate">{name}</p>
      <div className="flex items-center gap-2">
        <button
          onClick={togglePlay}
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${isMe ? "bg-white/20 hover:bg-white/30" : "bg-primary/10 hover:bg-primary/20"}`}
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <div className="flex-1 flex flex-col gap-0.5">
          <input
            type="range" min={0} max={duration || 1} step={0.1} value={currentTime}
            onChange={(e) => { const t = +e.target.value; setCurrentTime(t); if (audioRef.current) audioRef.current.currentTime = t; }}
            className="w-full h-1.5 cursor-pointer rounded-full"
            style={{ accentColor: accent }}
          />
          <div className={`flex justify-between text-[10px] ${isMe ? "opacity-70" : "text-muted-foreground"}`}>
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Volume2 className="w-3 h-3 shrink-0 opacity-60" />
        <input
          type="range" min={0} max={1} step={0.05} value={volume}
          onChange={(e) => { const v = +e.target.value; setVolume(v); if (audioRef.current) audioRef.current.volume = v; }}
          className="flex-1 h-1 cursor-pointer rounded-full"
          style={{ accentColor: accent }}
        />
        <span className={`text-[10px] w-8 text-right ${isMe ? "opacity-60" : "text-muted-foreground"}`}>{Math.round(volume * 100)}%</span>
      </div>
    </div>
  );
}

function ImageModal({ messages, messageId, onClose }: { messages: Message[]; messageId: number; onClose: () => void }) {
  const imageMessages = useMemo(
    () => messages.filter((m) => isImageMessage(m.content)),
    [messages]
  );
  const [index, setIndex] = useState(() => imageMessages.findIndex((m) => m.id === messageId));

  const current = imageMessages[index];
  const hasPrev = index > 0;
  const hasNext = index < imageMessages.length - 1;

  const goPrev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);
  const goNext = useCallback(() => setIndex((i) => Math.min(i + 1, imageMessages.length - 1)), [imageMessages.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  if (!current) {
    return (
      <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="p-8 text-white text-center">
          <p className="text-sm opacity-70">No image found</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition-colors">Close</button>
        </div>
      </div>
    );
  }

  const src = current.content;

  return (
    <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-5xl max-h-full flex items-center" onClick={(e) => e.stopPropagation()}>
        {hasPrev && (
          <button onClick={goPrev} className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/70 hover:bg-black/90 text-white transition-colors backdrop-blur-sm">
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        <img src={src} alt="preview" className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl" />
        {hasNext && (
          <button onClick={goNext} className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/70 hover:bg-black/90 text-white transition-colors backdrop-blur-sm">
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
        <div className="absolute top-3 right-3 flex gap-2">
          <a href={src} download onClick={(e) => e.stopPropagation()} className="p-2 rounded-full bg-black/70 hover:bg-black/90 text-white transition-colors backdrop-blur-sm"><Download className="w-4 h-4" /></a>
          <button onClick={onClose} className="p-2 rounded-full bg-black/70 hover:bg-black/90 text-white transition-colors backdrop-blur-sm"><X className="w-4 h-4" /></button>
        </div>
        {imageMessages.length > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/70 bg-black/50 px-3 py-1 rounded-full backdrop-blur-sm">
            {index + 1} / {imageMessages.length}
          </div>
        )}
      </div>
    </div>
  );
}

function renderMessageContent(content: string, searchQuery: string): { __html: string } {
  const rendered = markdown.renderInline(content);
  if (!searchQuery.trim()) return { __html: DOMPurify.sanitize(rendered) };
  const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const highlighted = rendered.replace(
    new RegExp(`(${escaped})`, "gi"),
    '<mark style="background:rgba(234,179,8,0.35);border-radius:2px;padding:0 2px;color:inherit">$1</mark>'
  );
  return { __html: DOMPurify.sanitize(highlighted, { ADD_TAGS: ["mark"], ADD_ATTR: ["style"] }) };
}

function isMentioned(content: string, targetUsername: string): boolean {
  return new RegExp(`@${targetUsername}\\b`, "i").test(content);
}

function drawFaviconBadge() {
  const canvas = document.createElement("canvas");
  canvas.width = 32; canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = new window.Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, 32, 32);
    ctx.beginPath();
    ctx.arc(26, 6, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.fill();
    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (link) link.href = canvas.toDataURL();
  };
  img.src = "/favicon.png";
}

function resetFavicon() {
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (link) link.href = "/favicon.png";
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
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifBanner, setNotifBanner] = useState(false);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    const alreadyHandled = localStorage.getItem("notif-handled");
    if (!alreadyHandled && Notification.permission === "default") {
      setNotifBanner(true);
    }
  }, []);

  const requestNotif = async () => {
    const perm = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
    localStorage.setItem("notif-handled", "1");
    setNotifBanner(false);
    if (perm === "granted") toast({ description: "notifications enabled!" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    const error = tab === "login" ? await login(username.trim(), password) : await register(username.trim(), password);
    setLoading(false);
    if (error) {
     toast({ title: 'Error', description: error, variant: 'destructive' });
  } else {
     window.location.href = '/chat';
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-zinc-950 px-4">
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl p-8 shadow-2xl border border-zinc-800">
        <h1 className="text-3xl text-white mb-2 text-center" style={{ fontFamily: '"Comic Sans MS", "Comic Sans", cursive', fontWeight: "normal" }}>dapetonchat</h1>
        <p className="text-zinc-500 text-center text-sm mb-8">{tab === "login" ? "sign in to continue" : "create your account"}</p>
        <div className="flex mb-6 bg-zinc-800 rounded-xl p-1">
          <button onClick={() => setTab("login")} className={`flex-1 py-2 text-sm font-medium rounded-lg ${tab === "login" ? "bg-zinc-700 text-white" : "text-zinc-400"}`}>sign in</button>
          <button onClick={() => setTab("register")} className={`flex-1 py-2 text-sm font-medium rounded-lg ${tab === "register" ? "bg-zinc-700 text-white" : "text-zinc-400"}`}>register</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input data-testid="input-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" className="h-11 bg-zinc-800 border-zinc-700 text-white" />
          <div className="relative">
            <Input
              data-testid="input-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              className="h-11 bg-zinc-800 border-zinc-700 text-white pr-11"
            />
            <button
              type="button"
              data-testid="button-toggle-password"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white transition-colors"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <Button data-testid="button-submit" type="submit" className="w-full h-11 font-semibold bg-white text-black" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : tab === "login" ? "sign in" : "create account"}
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
      {notifBanner && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl px-4 py-3 flex items-center gap-3 text-sm z-50 max-w-sm w-full mx-4">
          <Bell className="w-4 h-4 text-zinc-400 shrink-0" />
          <span className="text-zinc-300 flex-1">enable notifications to stay in the loop?</span>
          <button onClick={requestNotif} className="px-3 py-1 bg-white text-black rounded-lg text-xs font-medium hover:bg-zinc-200 transition-colors">enable</button>
          <button onClick={() => { setNotifBanner(false); localStorage.setItem("notif-handled", "1"); }} className="text-zinc-500 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
}

function ChatWindow({ chatId, username, chatLabel, isPrivate }: { chatId: string; username: string; chatLabel: string; isPrivate: boolean }) {
  const { data: messages = [], isLoading } = useMessages(chatId);
  const { data: allUsers = [] } = useUsers();
  const { data: rawReactions = [] } = useReactions(chatId);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const { mutate: editMessage } = useEditMessage();
  const { mutate: deleteMessage } = useDeleteMessage();
  const { mutate: toggleReaction } = useToggleReaction();
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [dragActive, setDragActive] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [lastSeenMessageId, setLastSeenMessageId] = useState<number | null>(null);
  const [lightboxMsgId, setLightboxMsgId] = useState<number | null>(null);
  const [pickerMsgId, setPickerMsgId] = useState<number | null>(null);

  const reactionMap = useMemo(() => {
    const map = new Map<number, Array<{ emoji: string; usernames: string[] }>>();
    rawReactions.forEach(({ messageId, emoji, usernames }) => {
      if (!map.has(messageId)) map.set(messageId, []);
      map.get(messageId)!.push({ emoji, usernames });
    });
    return map;
  }, [rawReactions]);
  const typingTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const isTypingRef = useRef<boolean>(false);
  const typingThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isNearBottomRef = useRef(true);
  const tabHiddenIdRef = useRef<number>(-1);
  const lastMsgIdRef = useRef<number>(0);

  const usernames = useMemo(() => allUsers.map((u) => u.username), [allUsers]);
  const contentMentionUser = useMemo(() => {
    const m = content.match(/@(\w+)/);
    if (!m) return null;
    return usernames.find((u) => u.toLowerCase() === m[1].toLowerCase()) ?? null;
  }, [content, usernames]);

  useEffect(() => {
    const vp = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (vp && isNearBottomRef.current) vp.scrollTop = vp.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const vp = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (!vp) return;
    const onScroll = () => {
      const distFromBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
      isNearBottomRef.current = distFromBottom < 80;
      setShowScrollBtn(distFromBottom > 300);
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    return () => vp.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (messages.length > 0) lastMsgIdRef.current = messages[messages.length - 1].id;
    if (lastSeenMessageId === null && messages.length > 0) {
      setLastSeenMessageId(messages[messages.length - 1].id);
    }
  }, [messages, lastSeenMessageId]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        tabHiddenIdRef.current = lastMsgIdRef.current;
      } else {
        if (tabHiddenIdRef.current >= 0) setLastSeenMessageId(tabHiddenIdRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const scrollToBottom = useCallback(() => {
    const vp = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (vp) { vp.scrollTo({ top: vp.scrollHeight, behavior: "smooth" }); isNearBottomRef.current = true; setShowScrollBtn(false); }
  }, []);

  const startEdit = useCallback((msg: Message) => {
    setEditingId(msg.id);
    setEditContent(msg.content);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditContent("");
  }, []);

  const submitEdit = useCallback((msg: Message) => {
    const trimmed = editContent.trim();
    if (!trimmed || trimmed === msg.content) { cancelEdit(); return; }
    editMessage(
      { id: msg.id, username, content: trimmed },
      {
        onSuccess: () => cancelEdit(),
        onError: (err) => toast({ title: "Edit failed", description: (err as Error).message, variant: "destructive" }),
      }
    );
  }, [editContent, editMessage, username, cancelEdit, toast]);

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

  const sendCurrentMessage = () => {
    const trimmed = content.trim();
    if (!trimmed || isSending) return;
    if (typingThrottleRef.current) { clearTimeout(typingThrottleRef.current); typingThrottleRef.current = null; }
    sendWs({ type: "typing", chatId, userId: username, username, status: "stopped" });
    setTypingUsers((prev) => { const next = new Map(prev); next.delete(username); return next; });
    typingTimeoutRef.current.delete(username);
    isTypingRef.current = false;
    sendMessage({ username, content: trimmed, chatId, replyToId: replyTo?.id ?? null }, { onSuccess: () => { setContent(""); setReplyTo(null); setLastSeenMessageId(messages[messages.length - 1]?.id ?? 0); } });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendCurrentMessage();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendCurrentMessage();
    }
    if (e.key === "ArrowUp" && !content.trim()) {
      e.preventDefault();
      const lastOwn = [...messages].reverse().find(
        (m) => m.username === username && !isFileMessage(m.content) && !isImageMessage(m.content)
      );
      if (lastOwn) startEdit(lastOwn);
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
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
      isTypingRef.current = false;
    }, 2000);
  };

  const handleFileDrop = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    await uploadFile(file, file.name);
  }, [uploadFile]);

  return (
    <>
    <style>{`@keyframes pop{0%{transform:scale(1)}50%{transform:scale(1.2)}100%{transform:scale(1)}}.animate-pop{animation:pop .3s ease-in-out}`}</style>
    {lightboxMsgId !== null && <ImageModal messages={messages} messageId={lightboxMsgId} onClose={() => setLightboxMsgId(null)} />}
    <div
      className={`relative flex flex-col flex-1 min-h-0 ${dragActive ? "ring-2 ring-primary ring-inset" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFileDrop(e.dataTransfer.files); }}
    >
      {dragActive && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-primary/10 border-2 border-dashed border-primary/60 rounded-xl pointer-events-none gap-3">
          <Upload className="w-10 h-10 text-primary" />
          <p className="text-primary font-semibold text-base">Drop to upload</p>
        </div>
      )}
      <div className="h-14 border-b border-border flex items-center gap-3 px-4 shrink-0 bg-card/40">
        {isPrivate ? <Lock className="w-4 h-4 text-muted-foreground shrink-0" /> : <Hash className="w-4 h-4 text-muted-foreground shrink-0" />}
        <span className="font-semibold text-sm shrink-0">{chatLabel}</span>
        {isPrivate && <span className="text-[10px] uppercase tracking-wider font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">private</span>}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 pointer-events-none" />
            <input
              data-testid="input-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setSearch(""); }}
              placeholder="Search…"
              className="h-7 pl-7 pr-6 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 w-36 transition-all focus:w-48"
            />
            {search && (
              <button
                data-testid="button-clear-search"
                onClick={() => setSearch("")}
                className="absolute right-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground hidden sm:flex items-center gap-1"><Image className="w-3 h-3" /> Paste or drag</span>
        </div>
      </div>
      <ScrollArea className="flex-1 px-6 py-4" ref={scrollRef}>
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground select-none py-20">
            {isPrivate ? <Lock className="w-10 h-10 opacity-30" /> : <Hash className="w-10 h-10 opacity-30" />}
            <p className="text-base font-semibold text-foreground/60">start of the conversation</p>
            <p className="text-sm opacity-60">{isPrivate ? chatLabel : `#${chatLabel}`}</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-1">
            {(() => {
              const filteredMessages = search.trim()
                ? messages.filter((m) =>
                    (!isFileMessage(m.content) && m.content.toLowerCase().includes(search.trim().toLowerCase())) ||
                    (isFileMessage(m.content) && (parseFileMeta(m.content)?.name ?? "").toLowerCase().includes(search.trim().toLowerCase()))
                  )
                : messages;
              const firstNewIdx = lastSeenMessageId !== null && lastSeenMessageId > 0
                ? filteredMessages.findIndex((m) => m.id > lastSeenMessageId && m.username !== username)
                : -1;
              return filteredMessages.map((msg, i, arr) => {
                const isMe = msg.username === username;
                const isAdmin = username === ADMIN_USERNAME;
                const canEdit = !isFileMessage(msg.content) && !isImageMessage(msg.content) && (isAdmin || (isMe && Date.now() - new Date(msg.createdAt).getTime() < 5 * 60 * 1000));
                const showUsername = i === 0 || arr[i - 1].username !== msg.username;
                const replyTarget = msg.replyToId ? messages.find((m) => m.id === msg.replyToId) : null;
                const isImg = isImageMessage(msg.content);
                const isFile = isFileMessage(msg.content);
                const fileMeta = isFile ? parseFileMeta(msg.content) : null;
                const fileExt = fileMeta?.name.split(".").pop()?.toLowerCase() ?? "";
                const isAudioFile = fileMeta && ["mp3", "wav", "m4a", "ogg"].includes(fileExt);
                const isEditing = editingId === msg.id;
                const showDivider = i === firstNewIdx;
                const msgDate = new Date(msg.createdAt);
                return (
                  <div key={msg.id} data-testid={`message-${msg.id}`} className={`flex flex-col ${isMe ? "items-end" : "items-start"} ${showUsername ? "mt-4" : "mt-0.5"} animate-in fade-in slide-in-from-bottom-1 duration-150`}>
                    {showDivider && (
                      <div className="w-full self-stretch flex items-center gap-2 my-3">
                        <div className="flex-1 h-px bg-red-500/40" />
                        <span className="text-[10px] font-semibold text-red-500 uppercase tracking-wide px-1">new messages</span>
                        <div className="flex-1 h-px bg-red-500/40" />
                      </div>
                    )}
                    {showUsername && (
                      <div className={`flex items-baseline gap-2 mb-1 ${isMe ? "flex-row-reverse" : ""}`}>
                        <span
                          className={`text-xs font-bold cursor-pointer hover:underline underline-offset-2 ${msg.username === ADMIN_USERNAME ? "text-red-500" : ""}`}
                          onClick={() => {
                            if (!isMe) {
                              setContent((prev) => (prev.trim() ? prev.trimEnd() + ` @${msg.username} ` : `@${msg.username} `));
                              inputRef.current?.focus();
                            }
                          }}
                        >{isMe ? "You" : msg.username}</span>
                        <span className="text-[10px] text-muted-foreground" title={format(msgDate, "MM/dd/yyyy HH:mm:ss")}>{formatMessageTime(msgDate)}</span>
                        {msg.editedAt && <span className="text-[10px] text-muted-foreground/60 italic">(edited)</span>}
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
                        <img
                          data-testid={`image-${msg.id}`}
                          src={msg.content}
                          alt="shared image"
                          className="max-w-full max-h-80 object-contain block hover:opacity-90 transition-opacity cursor-pointer"
                          onClick={() => setLightboxMsgId(msg.id)}
                          onLoad={scrollToBottom}
                        />
                      </div>
                    ) : isFile && fileMeta ? (
                      <div className="relative group">
                        {isAudioFile
                          ? <AudioPlayer url={fileMeta.url} name={fileMeta.name} isMe={isMe} />
                          : <FileCard meta={fileMeta} isMe={isMe} />}
                        <button
                          onClick={(e) => { e.stopPropagation(); setReplyTo(msg); }}
                          className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full bg-card border border-border shadow-sm ${isMe ? "-left-8" : "-right-8"}`}
                        >
                          <Reply className="w-3 h-3" />
                        </button>
                      </div>
                    ) : isEditing ? (
                      <div className={`w-full max-w-[75%] flex flex-col gap-1`}>
                        <textarea
                          data-testid={`input-edit-${msg.id}`}
                          autoFocus
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(msg); }
                            if (e.key === "Escape") cancelEdit();
                          }}
                          rows={2}
                          className={`w-full resize-none rounded-xl px-3 py-2 text-sm border focus:outline-none focus:ring-1 focus:ring-primary ${isMe ? "bg-primary/80 text-primary-foreground border-primary/50" : "bg-muted border-border text-foreground"}`}
                          style={{ minHeight: 44 }}
                          onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }}
                        />
                        <div className={`flex gap-1.5 text-[10px] ${isMe ? "justify-end" : "justify-start"}`}>
                          <button data-testid={`button-save-edit-${msg.id}`} onClick={() => submitEdit(msg)} className="px-2 py-0.5 rounded bg-primary text-primary-foreground hover:opacity-80 transition-opacity">save</button>
                          <button data-testid={`button-cancel-edit-${msg.id}`} onClick={cancelEdit} className="px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-accent transition-colors">cancel</button>
                          <span className="text-muted-foreground/60 self-center">enter to save · esc to cancel</span>
                        </div>
                      </div>
                    ) : (
                      (() => {
                        const mentionedMe = !isMe && isMentioned(msg.content, username);
                        const canDelete = isMe || isAdmin;
                        const msgReactions = reactionMap.get(msg.id) ?? [];
                        return (
                        <div className="flex flex-col gap-1 max-w-[75%] min-w-0">
                        <div className={`flex items-center gap-1 group min-w-0 ${isMe ? "flex-row-reverse" : ""}`}>
                        <div
                          className={`relative px-4 py-2 rounded-2xl text-sm break-words [overflow-wrap:anywhere] cursor-pointer select-none transition-all hover:opacity-90 active:scale-[0.99]
                            ${isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"}
                            ${mentionedMe ? "border border-yellow-400/50 bg-yellow-400/10" : ""}`}
                          onClick={(e) => {
                            if (e.ctrlKey || e.metaKey) { if (canEdit) { e.preventDefault(); startEdit(msg); } }
                            else if (e.shiftKey) setReplyTo(msg);
                            else setPickerMsgId(null);
                          }}
                          title={canEdit ? "ctrl+click to edit" : undefined}
                        >
                          <span dangerouslySetInnerHTML={renderMessageContent(msg.content, search)} />
                          {!msg.editedAt && <span />}
                          {msg.editedAt && !showUsername && <span className="ml-1.5 text-[9px] opacity-50 italic">(edited)</span>}
                        </div>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 z-10 shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); setReplyTo(msg); }} className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground"><Reply className="w-3 h-3" /></button>
                            <button
                              data-testid={`button-copy-${msg.id}`}
                              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(msg.content).then(() => toast({ description: "copied!" })); }}
                              className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground"
                            ><Copy className="w-3 h-3" /></button>
                            <div className="relative">
                              <button
                                onClick={(e) => { e.stopPropagation(); setPickerMsgId(pickerMsgId === msg.id ? null : msg.id); }}
                                className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground"
                              ><SmilePlus className="w-3 h-3" /></button>
                              {pickerMsgId === msg.id && (
                                <div className={`absolute top-7 ${isMe ? "right-0" : "left-0"} z-30 flex gap-1 bg-card border border-border rounded-xl shadow-xl p-2`} onClick={(e) => e.stopPropagation()}>
                                  {REACTION_EMOJIS.map((em) => (
                                    <button key={em} onClick={() => { toggleReaction({ messageId: msg.id, username, emoji: em }); setPickerMsgId(null); }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-base transition-colors">{em}</button>
                                  ))}
                                </div>
                              )}
                            </div>
                            {canEdit && <button data-testid={`button-edit-${msg.id}`} onClick={(e) => { e.stopPropagation(); startEdit(msg); }} className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground"><Pencil className="w-3 h-3" /></button>}
                            {canDelete && <button data-testid={`button-delete-${msg.id}`} onClick={(e) => { e.stopPropagation(); deleteMessage({ id: msg.id, username, chatId }, { onError: (err) => toast({ title: "error", description: (err as Error).message, variant: "destructive" }) }); }} className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-red-500/20 hover:text-red-400 transition-colors text-foreground"><Trash2 className="w-3 h-3" /></button>}
                          </div>
                        </div>
                        {msgReactions.length > 0 && (
                          <div className={`flex flex-wrap gap-1 ${isMe ? "justify-end" : "justify-start"}`}>
                            <TooltipProvider delayDuration={200}>
                              {msgReactions.map(({ emoji, usernames }) => {
                                const hasReacted = usernames.includes(username);
                                return (
                                  <Tooltip key={`${emoji}-${hasReacted}`}>
                                    <TooltipTrigger asChild>
                                      <button
                                        onClick={() => toggleReaction({ messageId: msg.id, username, emoji })}
                                        className={`animate-pop flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${hasReacted ? "bg-primary/20 border-primary/50 text-primary" : "bg-muted border-border text-muted-foreground hover:bg-accent"}`}
                                      >
                                        <span>{emoji}</span>
                                        <span className="font-medium">{usernames.length}</span>
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" align="center" className="px-2.5 py-1.5 text-xs space-y-0.5">
                                      {usernames.map((u) => (
                                        <div key={u}>
                                          {u}<span className="text-muted-foreground/60">{u === username ? " (you)" : ""}</span>
                                        </div>
                                      ))}
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })}
                            </TooltipProvider>
                          </div>
                        )}
                        {msg.linkPreview && (
                          <a
                            href={msg.linkPreview.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid={`link-preview-${msg.id}`}
                            className={`flex gap-3 rounded-xl border border-border bg-card/60 overflow-hidden hover:bg-accent/40 transition-colors max-w-sm ${isMe ? "self-end" : "self-start"}`}
                          >
                            {msg.linkPreview.image && (
                              <img src={msg.linkPreview.image} alt="" className="w-20 h-20 object-cover shrink-0 bg-muted" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            )}
                            <div className="p-2.5 min-w-0 flex flex-col justify-center">
                              {msg.linkPreview.title && <p className="text-xs font-semibold truncate text-foreground">{msg.linkPreview.title}</p>}
                              {msg.linkPreview.description && <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{msg.linkPreview.description}</p>}
                              <p className="text-[10px] text-primary mt-1 truncate">{msg.linkPreview.url}</p>
                            </div>
                          </a>
                        )}
                      </div>
                        );
                      })()
                    )}
                  </div>
                );
              });
            })()}
          </div>
        )}
      </ScrollArea>
      {showScrollBtn && (
        <button
          data-testid="button-scroll-bottom"
          onClick={scrollToBottom}
          className="absolute bottom-28 right-6 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:opacity-90 transition-all animate-in fade-in slide-in-from-bottom-2"
        >
          <ChevronDown className="w-3.5 h-3.5" /> latest
        </button>
      )}
      <div className="p-4 border-t border-border bg-card/20 shrink-0">
        <div className="max-w-3xl mx-auto">
          {replyTo && (
            <div className="mb-2 px-3 py-2 bg-muted/50 rounded-lg flex items-center justify-between text-xs border border-border">
              <span className="flex items-center gap-2 text-muted-foreground"><Reply className="w-3 h-3" /> replying to <span className="font-semibold text-foreground">@{replyTo.username}</span></span>
              <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
          )}
          {uploading && (
            <div className="mb-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-1.5" />
            </div>
          )}
          <div className="h-4 mb-1.5 text-[10px] text-muted-foreground italic flex items-center">
            {typingUsers.size === 1 && (
              <span>{[...typingUsers.values()][0]} is typing...</span>
            )}
            {typingUsers.size === 2 && (
              <span>{[...typingUsers.values()].join(" and ")} are typing...</span>
            )}
            {typingUsers.size >= 3 && (
              <span>Several people are typing...</span>
            )}
          </div>
          <form onSubmit={handleSubmit} className="flex gap-3 items-end">
            <div className="relative flex-1">
              <textarea
                data-testid="input-message"
                ref={inputRef}
                value={content}
                onChange={handleContentChange}
                onKeyDown={handleKeyDown}
                placeholder={isPrivate ? `Message ${chatLabel}...` : "Message everyone..."}
                rows={1}
                className={`w-full resize-none rounded-xl bg-muted/50 border focus:outline-none focus:ring-1 px-4 py-3 text-sm pr-10 min-h-[44px] max-h-40 overflow-y-auto leading-5 transition-colors ${contentMentionUser ? "border-yellow-400/70 focus:ring-yellow-400/70" : "border-border focus:ring-primary"}`}
                style={{ height: "auto" }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 160) + "px";
                }}
              />
              {contentMentionUser && (
                <span className="absolute left-3 -top-5 text-[10px] font-medium text-yellow-500/80 pointer-events-none">
                  mentioning @{contentMentionUser}
                </span>
              )}
              {uploading && <div className="absolute right-3 bottom-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
            </div>
            <Button data-testid="button-send" type="submit" size="icon" className="h-11 w-11 shrink-0 rounded-xl" disabled={!content.trim() || isSending || uploading}>
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
        </div>
      </div>
    </div>
    </>
  );
}

function RemoteVideo({ stream, username, onClick, speaking }: { stream: MediaStream; username: string; onClick?: () => void; speaking?: boolean }) {
  const ref = useVideoRef(stream);
  const hasVideo = stream.getVideoTracks().length > 0;
  return (
    <div
      onClick={onClick}
      className={`relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-900 flex items-center justify-center cursor-pointer transition-all ${speaking ? "ring-2 ring-green-500 shadow-[0_0_12px_rgba(34,197,94,0.5)]" : "hover:ring-2 ring-primary"}`}
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
    </div>
  );
}

function VoicePanel({
  username, voiceUsers, inVoice, cameraEnabled, screenSharing,
  micError, localStream, remoteStreams,
  joinVoice, leaveVoice, toggleCamera, shareScreen, stopScreenShare, renegotiate,
  deafened, onDeafenToggle,
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
  deafened: boolean;
  onDeafenToggle: () => void;
}) {
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
    if (micError) toast({ title: "Device error", description: micError, variant: "destructive" });
  }, [micError, toast]);

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
            <h2 className="text-xl font-semibold mb-1">voice channel — general</h2>
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
                <p className="text-sm">connected — waiting for others to join</p>
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
                title={micMuted ? "Unmute mic" : "Mute mic"}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${micMuted ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-muted hover:bg-accent text-foreground"}`}
              >
                {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                data-testid="button-deafen"
                onClick={handleDeafen}
                title={deafened ? "Undeafen" : "Deafen (mute mic + audio)"}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${deafened ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30" : "bg-muted hover:bg-accent text-foreground"}`}
              >
                <VolumeX className="w-4 h-4" />
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
  const [wsConnected, setWsConnectedState] = useState(true);
  useChatWebSocket(username);

  useEffect(() => {
    const onStatus = (e: Event) => setWsConnectedState((e as CustomEvent).detail.connected);
    window.addEventListener("ws-status", onStatus as EventListener);
    return () => window.removeEventListener("ws-status", onStatus as EventListener);
  }, []);
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

  const [deafened, setDeafened] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [dnd, setDnd] = useState(false);

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
      audioEl.muted = deafened;
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
  }, [remoteStreams, deafened]);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default" && !localStorage.getItem("notif-handled")) {
      Notification.requestPermission().then(() => localStorage.setItem("notif-handled", "1"));
    }
  }, []);

  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) ${APP_TITLE}` : APP_TITLE;
  }, [unreadCount]);

  useEffect(() => {
    const onFocus = () => {
      setUnreadCount(0);
      resetFavicon();
      document.title = APP_TITLE;
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    const onMsg = (e: Event) => {
      const detail = (e as CustomEvent).detail as { senderUsername?: string; content?: string } | undefined;
      const sender = detail?.senderUsername ?? "";
      const msgContent = detail?.content ?? "";
      if (document.hidden) {
        setUnreadCount((c) => c + 1);
        drawFaviconBadge();
        if (!dnd && sender !== username && "Notification" in window && Notification.permission === "granted") {
          new Notification(sender, { body: msgContent.slice(0, 50), icon: "/favicon.png" });
        }
      }
    };
    window.addEventListener("chat-new-message", onMsg as EventListener);
    return () => window.removeEventListener("chat-new-message", onMsg as EventListener);
  }, [dnd, username]);

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
    <div className="h-screen w-full bg-background flex font-sans overflow-hidden relative">
      {!wsConnected && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-yellow-500/90 text-yellow-950 text-xs text-center py-1 font-medium animate-pulse pointer-events-none">
          reconnecting...
        </div>
      )}
      <div className="hidden md:flex w-60 flex-none border-r border-border bg-card flex-col">
        <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
          <h1 className="text-xl text-foreground" style={{ fontFamily: '"Comic Sans MS", "Comic Sans", cursive', fontWeight: "normal" }}>dapetonchat</h1>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-5">
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 mb-1">text channels</p>
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
                <Volume2 className="w-3 h-3" /> voice channels
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
                <Users className="w-3 h-3" /> users
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
        {username === ADMIN_USERNAME && (
          <div className="relative px-3 pb-0 pt-2">
            {menuOpen && (
              <div className="absolute bottom-full mb-2 left-3 right-3 rounded-xl border border-border bg-card p-2 shadow-xl z-50">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 pb-1.5">admin</p>
                <button data-testid="button-delete-all-messages" onClick={handleDeleteAllMessages} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                  <Trash2 className="h-4 w-4" /> delete all messages
                </button>
                <button data-testid="button-delete-all-users" onClick={handleDeleteAllUsers} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                  <Users className="h-4 w-4" /> delete all users
                </button>
                <button data-testid="button-kick-all-voice" onClick={handleKickAllVoice} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                  <PhoneOff className="h-4 w-4" /> kick all voice users
                </button>
              </div>
            )}
          </div>
        )}
        <div className="p-3 border-t border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold uppercase shrink-0 ${username === ADMIN_USERNAME ? "text-red-500" : ""}`}>{username[0]}</div>
            <span className={`text-sm font-medium flex-1 truncate ${username === ADMIN_USERNAME ? "text-red-500" : ""}`}>{username}</span>
            <button data-testid="button-theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">{theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
            <button data-testid="button-dnd" onClick={() => setDnd((v) => !v)} title={dnd ? "Notifications muted" : "Mute notifications"} className={`p-1.5 rounded-lg transition-colors ${dnd ? "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30" : "hover:bg-accent text-muted-foreground hover:text-foreground"}`}>{dnd ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}</button>
            {username === ADMIN_USERNAME && (
              <button data-testid="button-admin-menu" onClick={() => setMenuOpen((v) => !v)} className={`p-1.5 rounded-lg hover:bg-accent transition-colors ${menuOpen ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <Settings className="w-4 h-4" />
              </button>
            )}
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
            <SheetTitle className="sr-only">navigation menu</SheetTitle>
            <SheetDescription className="sr-only">channels and user list</SheetDescription>
            <h1 className="text-xl text-foreground" style={{ fontFamily: '"Comic Sans MS", "Comic Sans", cursive', fontWeight: "normal" }}>dapetonchat</h1>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-5">
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 mb-1">text channels</p>
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
          {username === ADMIN_USERNAME && (
            <div className="relative px-3 pb-0 pt-2">
              {menuOpen && (
                <div className="absolute bottom-full mb-2 left-3 right-3 rounded-xl border border-border bg-card p-2 shadow-xl z-50">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 pb-1.5">Admin</p>
                  <button data-testid="mobile-button-delete-all-messages" onClick={handleDeleteAllMessages} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                    <Trash2 className="h-4 w-4" /> Delete all messages
                  </button>
                  <button data-testid="mobile-button-delete-all-users" onClick={handleDeleteAllUsers} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                    <Users className="h-4 w-4" /> Delete all users
                  </button>
                  <button data-testid="mobile-button-kick-all-voice" onClick={handleKickAllVoice} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                    <PhoneOff className="h-4 w-4" /> Kick all voice users
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="p-3 border-t border-border shrink-0">
            <div className="flex items-center gap-2">
              <div className="relative w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold uppercase shrink-0">
                {username[0]}
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 border border-card" />
              </div>
              <span className={`text-sm font-medium flex-1 truncate ${username === ADMIN_USERNAME ? "text-red-500" : ""}`}>{username}</span>
              <button data-testid="mobile-button-theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">{theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
              <button data-testid="mobile-button-dnd" onClick={() => setDnd((v) => !v)} title={dnd ? "Notifications muted" : "Mute notifications"} className={`p-1.5 rounded-lg transition-colors ${dnd ? "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30" : "hover:bg-accent text-muted-foreground hover:text-foreground"}`}>{dnd ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}</button>
              {username === ADMIN_USERNAME && (
                <button data-testid="mobile-button-admin-menu" onClick={() => setMenuOpen((v) => !v)} className={`p-1.5 rounded-lg hover:bg-accent transition-colors ${menuOpen ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <Settings className="w-4 h-4" />
                </button>
              )}
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
            deafened={deafened}
            onDeafenToggle={() => setDeafened((v) => !v)}
          />
        )}
      </div>

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
