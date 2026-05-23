import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import {
  Send, Loader2, Reply, Hash, Lock, Trash2, Image,
  File, FileText, FileImage, FileVideo, FileAudio, Download,
  Search, X, Pencil, ChevronDown, Copy, Play, Pause, Upload, SmilePlus,
  ChevronLeft, ChevronRight, Volume2, VolumeX, Maximize,
} from "lucide-react";
import { useMessages, useSendMessage, useEditMessage, useUsers, useDeleteMessage, useReactions, useToggleReaction } from "@/hooks/use-chat";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { onWsMessage, sendWs } from "@/lib/ws-bus";
import type { Message } from "@shared/schema";

const ADMIN_USERNAME = "dapetonman";
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
  return format(date, "h:mm a, EEE, MMM d");
}

function AudioPlayer({ url, name, isMe }: { url: string; name: string; isMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Sync initial volume and handle audio metadata reliably
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = volume;

    const handleLoadedMetadata = () => {
      if (audio.duration) setDuration(audio.duration);
    };

    if (audio.readyState >= 1 && audio.duration) {
      setDuration(audio.duration);
    }

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [url]);

  const fmt = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play()
        .then(() => setPlaying(true))
        .catch((err) => console.error("Audio playback failed:", err));
    }
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    // If the user is actively dragging the slider, block native time updates
    if (isScrubbing) return;
    setCurrentTime(e.currentTarget.currentTime);
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    setCurrentTime(t);
    
    // Update audio element concurrently for instantaneous seeking fluidness
    if (audioRef.current) {
      audioRef.current.currentTime = t;
    }
  };

  const handleSeekStart = () => {
    setIsScrubbing(true);
  };

  const handleSeekEnd = () => {
    setIsScrubbing(false);
  };

  const accent = isMe ? "rgba(255,255,255,0.9)" : "var(--primary)";

  return (
    <div className={`flex flex-col gap-2.5 px-3 py-3 rounded-2xl min-w-[240px] max-w-[300px] ${isMe ? "bg-primary/90 text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"}`}>
      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setPlaying(false)}
        preload="metadata"
      />
      <p className="text-[13px] font-medium truncate">{name}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${isMe ? "bg-white/20 hover:bg-white/30" : "bg-primary/10 hover:bg-primary/20"}`}
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <div className="flex-1 flex flex-col gap-0.5">
          <input
            type="range" 
            min={0} 
            max={duration || 1} 
            step={0.1} 
            value={currentTime}
            onChange={handleSeekChange}
            onMouseDown={handleSeekStart}
            onTouchStart={handleSeekStart}
            onMouseUp={handleSeekEnd}
            onTouchEnd={handleSeekEnd}
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
          type="range" 
          min={0} 
          max={1} 
          step={0.05} 
          value={volume}
          onChange={(e) => { 
            const v = +e.target.value; 
            setVolume(v); 
            if (audioRef.current) audioRef.current.volume = v; 
          }}
          className="flex-1 h-1 cursor-pointer rounded-full"
          style={{ accentColor: accent }}
        />
        <span className={`text-[10px] w-8 text-right ${isMe ? "opacity-60" : "text-muted-foreground"}`}>{Math.round(volume * 100)}%</span>
      </div>
    </div>
  );
}
function VideoPlayer({ url, name, isMe }: { url: string; name: string; isMe: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onMeta = () => { if (video.duration) setDuration(video.duration); };
    if (video.readyState >= 1 && video.duration) setDuration(video.duration);
    video.addEventListener("loadedmetadata", onMeta);
    return () => video.removeEventListener("loadedmetadata", onMeta);
  }, [url]);

  const fmt = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const showTemporarily = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (playing) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [playing]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); setShowControls(true); }
    else { v.play().then(() => { setPlaying(true); showTemporarily(); }).catch(() => {}); }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !muted;
    setMuted(!muted);
  };

  const toggleFullscreen = () => {
    const el = videoRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else { el.requestFullscreen(); }
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    setCurrentTime(e.currentTarget.currentTime);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    setCurrentTime(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const accent = isMe ? "rgba(255,255,255,0.9)" : "var(--primary)";

  return (
    <div
      className={`relative max-w-[400px] rounded-xl overflow-hidden bg-black ring-1 ring-white/10 ${isMe ? "rounded-tr-sm" : "rounded-tl-sm"}`}
      onMouseEnter={showTemporarily}
      onMouseMove={showTemporarily}
      onMouseLeave={() => { if (playing) { setShowControls(false); if (hideTimerRef.current) clearTimeout(hideTimerRef.current); } }}
    >
      <video
        ref={videoRef}
        src={url}
        preload="metadata"
        className="w-full aspect-video block cursor-pointer"
        onClick={togglePlay}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => { setPlaying(false); setShowControls(true); }}
      />
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center cursor-pointer" onClick={togglePlay}>
          <div className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm transition-transform hover:scale-105">
            <Play className="w-6 h-6 text-white ml-0.5" />
          </div>
        </div>
      )}
      <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent pt-8 pb-2 px-3 transition-opacity duration-200 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1 cursor-pointer rounded-full mb-1.5"
          style={{ accentColor: accent }}
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button type="button" onClick={togglePlay} className="text-white/90 hover:text-white transition-colors p-0.5">
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button type="button" onClick={toggleMute} className="text-white/70 hover:text-white transition-colors p-0.5">
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/80 font-mono">{fmt(currentTime)} / {fmt(duration)}</span>
            <button type="button" onClick={toggleFullscreen} className="text-white/70 hover:text-white transition-colors p-0.5">
              <Maximize className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
      <p className="absolute top-2 left-2 text-[10px] font-medium truncate max-w-[calc(100%-16px)] px-2 py-0.5 rounded-full bg-black/50 text-white/80 backdrop-blur-sm">
        {name}
      </p>
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
          <p className="text-sm opacity-70">no image found</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition-colors">close</button>
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

export default function ChatWindow({ chatId, username, chatLabel, isPrivate }: { chatId: string; username: string; chatLabel: string; isPrivate: boolean }) {
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

  const filteredMessages = useMemo(() => {
    return search.trim()
      ? messages.filter((m) =>
          (!isFileMessage(m.content) && m.content.toLowerCase().includes(search.trim().toLowerCase())) ||
          (isFileMessage(m.content) && (parseFileMeta(m.content)?.name ?? "").toLowerCase().includes(search.trim().toLowerCase()))
        )
      : messages;
  }, [messages, search]);

  const firstNewIdx = useMemo(() => {
    return lastSeenMessageId !== null && lastSeenMessageId > 0
      ? filteredMessages.findIndex((m) => m.id > lastSeenMessageId && m.username !== username)
      : -1;
  }, [filteredMessages, lastSeenMessageId, username]);

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
        onError: (err) => toast({ title: "edit failed", description: (err as Error).message, variant: "destructive" }),
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
        toast({ title: "upload failed", description: "Could not send the file.", variant: "destructive" });
      }
    });
    xhr.addEventListener("error", () => {
      setUploading(false);
      setUploadProgress(0);
      toast({ title: "upload failed", description: "Could not send the file.", variant: "destructive" });
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
          <p className="text-primary font-semibold text-base">drop to upload</p>
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
              placeholder="search&hellip;"
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
          <span className="text-[10px] text-muted-foreground hidden sm:flex items-center gap-1"><Image className="w-3 h-3" /> paste or drag</span>
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
            {filteredMessages.map((msg, i, arr) => {
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
                const isVideoFile = fileMeta && ["mp4", "mov", "avi", "mkv", "webm"].includes(fileExt);
                const isImageFile = fileMeta && ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(fileExt);
                const canDelete = isMe || isAdmin;
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
                      <div className={`flex ${isMe ? "flex-row-reverse" : ""} items-start gap-1 group`}>
                        <div className={`max-w-[75%] rounded-2xl overflow-hidden ${isMe ? "rounded-tr-sm" : "rounded-tl-sm"}`}>
                          <img
                            data-testid={`image-${msg.id}`}
                            src={msg.content}
                            alt="shared image"
                            className="max-w-full max-h-80 object-contain block hover:opacity-90 transition-opacity cursor-pointer"
                            onClick={() => setLightboxMsgId(msg.id)}
                            onLoad={scrollToBottom}
                          />
                        </div>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 z-10 shrink-0 self-start mt-1">
                          <button onClick={(e) => { e.stopPropagation(); setReplyTo(msg); }} className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground" title="reply"><Reply className="w-3 h-3" /></button>
                          <button
                            data-testid={`button-copy-${msg.id}`}
                            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(msg.content).then(() => toast({ description: "copied!" })); }}
                            className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground"
                            title="copy"
                          ><Copy className="w-3 h-3" /></button>
                          <div className="relative">
                            <button
                              onClick={(e) => { e.stopPropagation(); setPickerMsgId(pickerMsgId === msg.id ? null : msg.id); }}
                              className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground"
                              title="react"
                            ><SmilePlus className="w-3 h-3" /></button>
                            {pickerMsgId === msg.id && (
                              <div className={`absolute top-7 ${isMe ? "right-0" : "left-0"} z-30 flex gap-1 bg-card border border-border rounded-xl shadow-xl p-2`} onClick={(e) => e.stopPropagation()}>
                                {REACTION_EMOJIS.map((em) => (
                                  <button key={em} onClick={() => { toggleReaction({ messageId: msg.id, username, emoji: em }); setPickerMsgId(null); }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-base transition-colors">{em}</button>
                                ))}
                              </div>
                            )}
                          </div>
                          {canDelete && <button onClick={(e) => { e.stopPropagation(); deleteMessage({ id: msg.id, username, chatId }, { onError: (err) => toast({ title: "error", description: (err as Error).message, variant: "destructive" }) }); }} className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-red-500/20 hover:text-red-400 transition-colors text-foreground" title="delete"><Trash2 className="w-3 h-3" /></button>}
                        </div>
                      </div>
                    ) : isFile && fileMeta ? (
                      <div className={`flex ${isMe ? "flex-row-reverse" : ""} items-start gap-1 group`}>
                        <div>
                          {isVideoFile
                            ? <VideoPlayer key={`video-${msg.id}`} url={fileMeta.url} name={fileMeta.name} isMe={isMe} />
                            : isAudioFile
                            ? <AudioPlayer key={`audio-${msg.id}`} url={fileMeta.url} name={fileMeta.name} isMe={isMe} />
                            : isImageFile
                            ? <img src={fileMeta.url} alt={fileMeta.name} className="max-w-full max-h-80 object-contain block rounded-xl" />
                            : <FileCard meta={fileMeta} isMe={isMe} />}
                        </div>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 z-10 shrink-0 self-start mt-1">
                          <button onClick={(e) => { e.stopPropagation(); setReplyTo(msg); }} className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground" title="reply"><Reply className="w-3 h-3" /></button>
                          <button
                            data-testid={`button-copy-${msg.id}`}
                            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(msg.content).then(() => toast({ description: "copied!" })); }}
                            className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground"
                            title="copy"
                          ><Copy className="w-3 h-3" /></button>
                          <div className="relative">
                            <button
                              onClick={(e) => { e.stopPropagation(); setPickerMsgId(pickerMsgId === msg.id ? null : msg.id); }}
                              className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground"
                              title="react"
                            ><SmilePlus className="w-3 h-3" /></button>
                            {pickerMsgId === msg.id && (
                              <div className={`absolute top-7 ${isMe ? "right-0" : "left-0"} z-30 flex gap-1 bg-card border border-border rounded-xl shadow-xl p-2`} onClick={(e) => e.stopPropagation()}>
                                {REACTION_EMOJIS.map((em) => (
                                  <button key={em} onClick={() => { toggleReaction({ messageId: msg.id, username, emoji: em }); setPickerMsgId(null); }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-base transition-colors">{em}</button>
                                ))}
                              </div>
                            )}
                          </div>
                          {canDelete && <button onClick={(e) => { e.stopPropagation(); deleteMessage({ id: msg.id, username, chatId }, { onError: (err) => toast({ title: "error", description: (err as Error).message, variant: "destructive" }) }); }} className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-red-500/20 hover:text-red-400 transition-colors text-foreground" title="delete"><Trash2 className="w-3 h-3" /></button>}
                        </div>
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
                          <span className="text-muted-foreground/60 self-center">enter to save &middot; esc to cancel</span>
                        </div>
                      </div>
                    ) : (
                      (() => {
                        const mentionedMe = !isMe && isMentioned(msg.content, username);
                        const msgReactions = reactionMap.get(msg.id) ?? [];
                        return (
                        <div className={`flex ${isMe ? "flex-row-reverse" : ""} items-start gap-1 group`}>
                        <div className="flex flex-col gap-1 max-w-[75%] min-w-0">
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
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 z-10 shrink-0 self-start mt-1">
                            <button onClick={(e) => { e.stopPropagation(); setReplyTo(msg); }} className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground" title="reply"><Reply className="w-3 h-3" /></button>
                            <button
                              data-testid={`button-copy-${msg.id}`}
                              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(msg.content).then(() => toast({ description: "copied!" })); }}
                              className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground"
                              title="copy"
                            ><Copy className="w-3 h-3" /></button>
                            <div className="relative">
                              <button
                                onClick={(e) => { e.stopPropagation(); setPickerMsgId(pickerMsgId === msg.id ? null : msg.id); }}
                                className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground"
                                title="react"
                              ><SmilePlus className="w-3 h-3" /></button>
                              {pickerMsgId === msg.id && (
                                <div className={`absolute top-7 ${isMe ? "right-0" : "left-0"} z-30 flex gap-1 bg-card border border-border rounded-xl shadow-xl p-2`} onClick={(e) => e.stopPropagation()}>
                                  {REACTION_EMOJIS.map((em) => (
                                    <button key={em} onClick={() => { toggleReaction({ messageId: msg.id, username, emoji: em }); setPickerMsgId(null); }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-base transition-colors">{em}</button>
                                  ))}
                                </div>
                              )}
                            </div>
                            {canEdit && <button data-testid={`button-edit-${msg.id}`} onClick={(e) => { e.stopPropagation(); startEdit(msg); }} className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-accent transition-colors text-foreground" title="edit"><Pencil className="w-3 h-3" /></button>}
                            {canDelete && <button data-testid={`button-delete-${msg.id}`} onClick={(e) => { e.stopPropagation(); deleteMessage({ id: msg.id, username, chatId }, { onError: (err) => toast({ title: "error", description: (err as Error).message, variant: "destructive" }) }); }} className="p-1 rounded-full bg-card border border-border shadow-sm hover:bg-red-500/20 hover:text-red-400 transition-colors text-foreground" title="delete"><Trash2 className="w-3 h-3" /></button>}
                          </div>
                        </div>
                        );
                      })()
                    )}
                  </div>
                );
              })}
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
              <button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground">&times;</button>
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
              <span>several people are typing...</span>
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
                placeholder={isPrivate ? `message ${chatLabel}...` : "message everyone..."}
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
