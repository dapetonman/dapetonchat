import { useState, useRef, useEffect, useCallback } from "react";
import { format } from "date-fns";
import MarkdownIt from "markdown-it";
import { Send, Loader2, LogOut, Moon, Sun, Users, Reply, Hash, Lock, Trash2, MoreVertical, Image, Mic, MicOff, Volume2, PhoneOff } from "lucide-react";
import { useMessages, useSendMessage, useUsers, useChatWebSocket } from "@/hooks/use-chat";
import { useVoice } from "@/hooks/use-voice";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
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
  return { __html: markdown.renderInline(content) };
}

function isImageMessage(content: string) {
  return content.startsWith("/view/");
}

function AuthScreen({ onAuth }: { onAuth: () => void }) {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    const error = tab === 'login' ? await login(username.trim(), password) : await register(username.trim(), password);
    setLoading(false);
    if (error) toast({ title: "Error", description: error, variant: "destructive" });
    else onAuth();
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-zinc-950 px-4">
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl p-8 shadow-2xl border border-zinc-800">
        <h1 className="text-3xl text-white mb-2 text-center" style={{ fontFamily: '"Comic Sans MS", "Comic Sans", cursive', fontWeight: 'normal' }}>dapetonchat</h1>
        <p className="text-zinc-500 text-center text-sm mb-8">{tab === 'login' ? 'Sign in to continue' : 'Create your account'}</p>
        <div className="flex mb-6 bg-zinc-800 rounded-xl p-1">
          <button onClick={() => setTab('login')} className={`flex-1 py-2 text-sm font-medium rounded-lg ${tab === 'login' ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}>Sign In</button>
          <button onClick={() => setTab('register')} className={`flex-1 py-2 text-sm font-medium rounded-lg ${tab === 'register' ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}>Register</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input data-testid="input-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="h-11 bg-zinc-800 border-zinc-700 text-white" />
          <Input data-testid="input-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="h-11 bg-zinc-800 border-zinc-700 text-white" />
          <Button data-testid="button-submit" type="submit" className="w-full h-11 font-semibold bg-white text-black" disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : tab === 'login' ? 'Sign In' : 'Create Account'}</Button>
        </form>
      </div>
    </div>
  );
}

function ChatWindow({ chatId, username, chatLabel, isPrivate }: { chatId: string; username: string; chatLabel: string; isPrivate: boolean; }) {
  const { data: messages = [], isLoading } = useMessages(chatId);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const { toast } = useToast();
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vp = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (vp) vp.scrollTop = vp.scrollHeight;
  }, [messages]);

  const uploadImage = useCallback(async (blob: Blob) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", blob, "screenshot.png");
      form.append("username", username);
      form.append("chatId", chatId);
      const res = await fetch("/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error("Upload failed");
    } catch {
      toast({ title: "Upload failed", description: "Could not send the image.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [username, chatId, toast]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items);
      const imgItem = items.find((item) => item.type.startsWith("image/"));
      if (!imgItem) return;
      e.preventDefault();
      const blob = imgItem.getAsFile();
      if (blob) uploadImage(blob);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [uploadImage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || isSending) return;
    sendMessage({ username, content: trimmed, chatId, replyToId: replyTo?.id ?? null }, { onSuccess: () => { setContent(''); setReplyTo(null); } });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="h-14 border-b border-border flex items-center gap-3 px-6 shrink-0 bg-card/40">
        {isPrivate ? <Lock className="w-4 h-4 text-muted-foreground" /> : <Hash className="w-4 h-4 text-muted-foreground" />}
        <span className="font-semibold text-sm">{chatLabel}</span>
        {isPrivate && <span className="text-[10px] uppercase tracking-wider font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">Private</span>}
        <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1"><Image className="w-3 h-3" /> Paste image to share</span>
      </div>
      <ScrollArea className="flex-1 px-6 py-4" ref={scrollRef}>
        {isLoading ? <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div> : (
          <div className="max-w-3xl mx-auto space-y-1">
            {messages.map((msg, i) => {
              const isMe = msg.username === username;
              const showUsername = i === 0 || messages[i - 1].username !== msg.username;
              const replyTarget = msg.replyToId ? messages.find(m => m.id === msg.replyToId) : null;
              const isImg = isImageMessage(msg.content);
              return (
                <div key={msg.id} data-testid={`message-${msg.id}`} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} ${showUsername ? 'mt-4' : 'mt-0.5'}`}>
                  {showUsername && <div className={`flex items-baseline gap-2 mb-1 ${isMe ? 'flex-row-reverse' : ''}`}><span className={`text-xs font-bold ${msg.username === ADMIN_USERNAME ? 'text-red-500' : ''}`}>{isMe ? 'You' : msg.username}</span><span className="text-[10px] text-muted-foreground">{format(new Date(msg.createdAt), 'MMM d, h:mm a')}</span></div>}
                  {replyTarget && <div className="mb-1 text-xs text-muted-foreground bg-muted/40 px-2 py-1 rounded-lg border-l-2 border-primary/30 flex items-center gap-1 max-w-[75%]"><Reply className="w-3 h-3 shrink-0" /><span className="truncate"><span className="font-medium">{replyTarget.username}:</span> {isImageMessage(replyTarget.content) ? '[image]' : replyTarget.content}</span></div>}
                  {isImg ? (
                    <div className={`relative group max-w-[75%] rounded-2xl overflow-hidden ${isMe ? 'rounded-tr-sm' : 'rounded-tl-sm'}`}>
                      <a href={msg.content} target="_blank" rel="noopener noreferrer">
                        <img data-testid={`image-${msg.id}`} src={msg.content} alt="shared screenshot" className="max-w-full max-h-80 object-contain block hover:opacity-90 transition-opacity cursor-pointer" />
                      </a>
                    </div>
                  ) : (
                    <div className={`relative group max-w-[75%] px-4 py-2 rounded-2xl text-sm break-words cursor-pointer select-none transition-all ${isMe ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-muted text-foreground rounded-tl-sm'} hover:opacity-90 active:scale-[0.99]`} onClick={(e) => { if (e.shiftKey) setReplyTo(msg); }}>
                      <span dangerouslySetInnerHTML={renderMessage(msg.content)} />
                      <button onClick={(e) => { e.stopPropagation(); setReplyTo(msg); }} className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full bg-card border border-border shadow-sm ${isMe ? '-left-8' : '-right-8'}`}><Reply className="w-3 h-3" /></button>
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
          {replyTo && <div className="mb-2 px-3 py-2 bg-muted/50 rounded-lg flex items-center justify-between text-xs border border-border"><span className="flex items-center gap-2 text-muted-foreground"><Reply className="w-3 h-3" /> Replying to <span className="font-semibold text-foreground">@{replyTo.username}</span></span><button onClick={() => setReplyTo(null)} className="text-muted-foreground hover:text-foreground transition-colors">✕</button></div>}
          <form onSubmit={handleSubmit} className="flex gap-3">
            <div className="relative flex-1">
              <Input data-testid="input-message" value={content} onChange={(e) => setContent(e.target.value)} placeholder={isPrivate ? `Message ${chatLabel}... (Ctrl+V to paste image)` : 'Message everyone... (Ctrl+V to paste image)'} className="h-11 bg-muted/50 border-border focus-visible:ring-1 focus-visible:ring-primary pr-10" />
              {uploading && <div className="absolute right-3 top-1/2 -translate-y-1/2"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
            </div>
            <Button data-testid="button-send" type="submit" size="icon" className="h-11 w-11 shrink-0 rounded-xl" disabled={!content.trim() || isSending || uploading}>{isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function VoiceChannelEntry({ username, voiceUsers, inVoice, joinVoice, leaveVoice, micError }: {
  username: string;
  voiceUsers: string[];
  inVoice: boolean;
  joinVoice: () => void;
  leaveVoice: () => void;
  micError: string | null;
}) {
  const { toast } = useToast();

  const handleClick = () => {
    if (inVoice) {
      leaveVoice();
    } else {
      joinVoice();
    }
  };

  useEffect(() => {
    if (micError) {
      toast({ title: "Microphone error", description: micError, variant: "destructive" });
    }
  }, [micError, toast]);

  return (
    <div>
      <button
        data-testid="button-voice-general"
        onClick={handleClick}
        className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors group ${inVoice ? 'bg-green-500/20 text-green-400 hover:bg-red-500/20 hover:text-red-400' : 'hover:bg-accent/50 text-muted-foreground'}`}
      >
        <Volume2 className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">general</span>
        {inVoice ? (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity"><PhoneOff className="w-3 h-3" /></span>
        ) : (
          voiceUsers.length > 0 && <span className="text-[10px] font-bold text-muted-foreground">{voiceUsers.length}</span>
        )}
      </button>

      {voiceUsers.length > 0 && (
        <div className="ml-4 mt-0.5 space-y-0.5">
          {voiceUsers.map((user) => (
            <div key={user} className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
              {user === username ? (
                <Mic className="w-3 h-3 text-green-400 shrink-0" />
              ) : (
                <Mic className="w-3 h-3 shrink-0" />
              )}
              <span className={user === ADMIN_USERNAME ? 'text-red-500' : user === username ? 'text-green-400' : ''}>{user === username ? `${user} (you)` : user}</span>
            </div>
          ))}
        </div>
      )}

      {inVoice && (
        <div className="mt-1 mx-2 px-2 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center gap-2">
          <MicOff className="w-3 h-3 text-green-400" />
          <span className="text-[10px] text-green-400">Connected — click channel to disconnect</span>
        </div>
      )}
    </div>
  );
}

function ChatInterface({ username, onLogout, theme, setTheme }: { username: string; onLogout: () => void; theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void; }) {
  const { data: allUsers = [] } = useUsers();
  const { toast } = useToast();
  const [activeChatId, setActiveChatId] = useState<string>('general');
  const [activeChatLabel, setActiveChatLabel] = useState<string>('general');
  const [isPrivate, setIsPrivate] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useChatWebSocket(username);
  const { voiceUsers, inVoice, joinVoice, leaveVoice, micError } = useVoice(username);

  useEffect(() => {
    const updateTitle = () => { document.title = document.hidden ? 'new message' : APP_TITLE; };
    updateTitle();
    document.addEventListener('visibilitychange', updateTitle);
    window.addEventListener('focus', updateTitle);
    window.addEventListener('blur', updateTitle);
    return () => {
      document.removeEventListener('visibilitychange', updateTitle);
      window.removeEventListener('focus', updateTitle);
      window.removeEventListener('blur', updateTitle);
      document.title = APP_TITLE;
    };
  }, []);

  useEffect(() => {
    const onMessage = () => { if (document.hidden) document.title = 'new message'; };
    window.addEventListener('chat-new-message', onMessage as EventListener);
    return () => window.removeEventListener('chat-new-message', onMessage as EventListener);
  }, []);

  const openDm = (otherUser: string) => {
    setActiveChatId(getDmChatId(username, otherUser));
    setActiveChatLabel(otherUser);
    setIsPrivate(true);
  };

  const openGeneral = (channel: string) => {
    setActiveChatId(CHANNEL_MESSAGE_IDS[channel as keyof typeof CHANNEL_MESSAGE_IDS] ?? channel);
    setActiveChatLabel(channel);
    setIsPrivate(false);
  };

  const handleDeleteAllMessages = async () => {
    if (username !== ADMIN_USERNAME || deleting) return;
    setDeleting(true);
    const res = await fetch('/api/messages', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
    setDeleting(false);
    setMenuOpen(false);
    if (!res.ok) toast({ title: 'Error', description: 'Failed to delete messages', variant: 'destructive' });
  };

  const handleDeleteAllUsers = async () => {
    if (username !== ADMIN_USERNAME || deleting) return;
    setDeleting(true);
    const res = await fetch('/api/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
    setDeleting(false);
    setMenuOpen(false);
    if (!res.ok) toast({ title: 'Error', description: 'Failed to delete users', variant: 'destructive' });
  };

  return (
    <div className="h-screen w-full bg-background flex font-sans overflow-hidden">
      <div className="w-60 flex-none border-r border-border bg-card flex flex-col">
        <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
          <h1 className="text-xl text-foreground" style={{ fontFamily: '"Comic Sans MS", "Comic Sans", cursive', fontWeight: 'normal' }}>dapetonchat</h1>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-5">
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 mb-1">Text Channels</p>
              <div className="space-y-1">
                {MAIN_CHANNELS.map((channel) => (
                  <button key={channel} data-testid={`sidebar-channel-${channel}`} onClick={() => openGeneral(channel)} className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeChatId === channel ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/50 text-muted-foreground'}`}>
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
                <VoiceChannelEntry
                  username={username}
                  voiceUsers={voiceUsers}
                  inVoice={inVoice}
                  joinVoice={joinVoice}
                  leaveVoice={leaveVoice}
                  micError={micError}
                />
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 mb-1 flex items-center gap-1">
                <Users className="w-3 h-3" /> Users
              </p>
              <div className="space-y-0.5">
                {allUsers.map(u => {
                  const chatId = getDmChatId(username, u.username);
                  return (
                    <button key={u.id} data-testid={`sidebar-user-${u.id}`} onClick={() => openDm(u.username)} className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeChatId === chatId ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/50 text-muted-foreground'}`}>
                      <div className={`w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold uppercase shrink-0 ${u.username === ADMIN_USERNAME ? 'text-red-500' : ''}`}>{u.username[0]}</div>
                      <span className={`truncate ${u.username === ADMIN_USERNAME ? 'text-red-500' : ''}`}>{u.username}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </ScrollArea>
        <div className="p-3 border-t border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold uppercase shrink-0 ${username === ADMIN_USERNAME ? 'text-red-500' : ''}`}>{username[0]}</div>
            <span className={`text-sm font-medium flex-1 truncate ${username === ADMIN_USERNAME ? 'text-red-500' : ''}`}>{username}</span>
            <button data-testid="button-theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">{theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
            <button data-testid="button-logout" onClick={onLogout} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><LogOut className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <ChatWindow key={activeChatId} chatId={activeChatId} username={username} chatLabel={activeChatLabel} isPrivate={isPrivate} />
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const { user, isReady, logout } = useAuth();
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);
  if (!isReady) return <div className="h-screen w-full flex items-center justify-center bg-background"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  if (!user) return <AuthScreen onAuth={() => {}} />;
  return <ChatInterface username={user.username} onLogout={logout} theme={theme} setTheme={setTheme} />;
}
