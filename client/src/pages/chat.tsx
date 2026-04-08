import { useState, useRef, useEffect } from "react";
import { format } from "date-fns";
import {
  Send, MessageSquare, Loader2, LogOut, Moon, Sun, Users, Reply, Hash, Lock
} from "lucide-react";
import { useMessages, useSendMessage, useUsers, useChatWebSocket } from "@/hooks/use-chat";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { getDmChatId } from "@shared/schema";
import type { Message } from "@shared/schema";

/* ------------------------------------------------------------------ */
/*  Auth Screen                                                         */
/* ------------------------------------------------------------------ */
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
    const error = tab === 'login'
      ? await login(username.trim(), password)
      : await register(username.trim(), password);
    setLoading(false);
    if (error) {
      toast({ title: "Error", description: error, variant: "destructive" });
    } else {
      onAuth();
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-zinc-950 px-4">
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl p-8 shadow-2xl border border-zinc-800">
        <h1
          className="text-3xl text-white mb-2 text-center"
          style={{ fontFamily: '"Comic Sans MS", "Comic Sans", cursive', fontWeight: 'normal' }}
        >
          dapetonchat
        </h1>
        <p className="text-zinc-500 text-center text-sm mb-8">
          {tab === 'login' ? 'Sign in to continue' : 'Create your account'}
        </p>

        {/* Tabs */}
        <div className="flex mb-6 bg-zinc-800 rounded-xl p-1">
          <button
            onClick={() => setTab('login')}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${tab === 'login' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
          >
            Sign In
          </button>
          <button
            onClick={() => setTab('register')}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${tab === 'register' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            data-testid="input-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            className="h-11 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
          />
          <Input
            data-testid="input-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            className="h-11 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
          />
          <Button
            data-testid="button-submit"
            type="submit"
            className="w-full h-11 font-semibold bg-white text-black hover:bg-zinc-200 rounded-xl"
            disabled={loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : tab === 'login' ? 'Sign In' : 'Create Account'}
          </Button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat Window                                                         */
/* ------------------------------------------------------------------ */
function ChatWindow({
  chatId,
  username,
  chatLabel,
  isPrivate,
}: {
  chatId: string;
  username: string;
  chatLabel: string;
  isPrivate: boolean;
}) {
  const { data: messages = [], isLoading } = useMessages(chatId);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      const vp = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (vp) vp.scrollTop = vp.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || isSending) return;
    sendMessage(
      { username, content: trimmed, chatId, replyToId: replyTo?.id ?? null },
      { onSuccess: () => { setContent(''); setReplyTo(null); } }
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Chat Header */}
      <div className="h-14 border-b border-border flex items-center gap-3 px-6 shrink-0 bg-card/40">
        {isPrivate ? (
          <Lock className="w-4 h-4 text-muted-foreground" />
        ) : (
          <Hash className="w-4 h-4 text-muted-foreground" />
        )}
        <span className="font-semibold text-sm">{chatLabel}</span>
        {isPrivate && (
          <span className="text-[10px] uppercase tracking-wider font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            Private
          </span>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-6 py-4" ref={scrollRef}>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <MessageSquare className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">No messages yet. Say something!</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-1">
            {messages.map((msg, i) => {
              const isMe = msg.username === username;
              const showUsername = i === 0 || messages[i - 1].username !== msg.username;
              const replyTarget = msg.replyToId ? messages.find(m => m.id === msg.replyToId) : null;

              return (
                <div
                  key={msg.id}
                  data-testid={`message-${msg.id}`}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} ${showUsername ? 'mt-4' : 'mt-0.5'}`}
                >
                  {showUsername && (
                    <div className={`flex items-baseline gap-2 mb-1 ${isMe ? 'flex-row-reverse' : ''}`}>
                      <span className="text-xs font-bold">{isMe ? 'You' : msg.username}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(msg.createdAt), 'MMM d, h:mm a')}
                      </span>
                    </div>
                  )}

                  {replyTarget && (
                    <div className={`mb-1 text-xs text-muted-foreground bg-muted/40 px-2 py-1 rounded-lg border-l-2 border-primary/30 flex items-center gap-1 max-w-[75%] ${isMe ? 'items-end' : ''}`}>
                      <Reply className="w-3 h-3 shrink-0" />
                      <span className="truncate">
                        <span className="font-medium">{replyTarget.username}:</span> {replyTarget.content}
                      </span>
                    </div>
                  )}

                  <div
                    className={`relative group max-w-[75%] px-4 py-2 rounded-2xl text-sm break-words cursor-pointer select-none transition-all
                      ${isMe
                        ? 'bg-primary text-primary-foreground rounded-tr-sm'
                        : 'bg-muted text-foreground rounded-tl-sm'
                      } hover:opacity-90 active:scale-[0.99]`}
                    title="Shift+click to reply"
                    onClick={(e) => {
                      if (e.shiftKey) setReplyTo(msg);
                    }}
                  >
                    {msg.content}

                    {/* Hover reply button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setReplyTo(msg); }}
                      className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full bg-card border border-border shadow-sm
                        ${isMe ? '-left-8' : '-right-8'}`}
                      title="Reply"
                    >
                      <Reply className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Input area */}
      <div className="p-4 border-t border-border bg-card/20 shrink-0">
        <div className="max-w-3xl mx-auto">
          {replyTo && (
            <div className="mb-2 px-3 py-2 bg-muted/50 rounded-lg flex items-center justify-between text-xs border border-border">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Reply className="w-3 h-3" />
                Replying to <span className="font-semibold text-foreground">@{replyTo.username}</span>
              </span>
              <button
                onClick={() => setReplyTo(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                ✕
              </button>
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-3">
            <Input
              data-testid="input-message"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={isPrivate ? `Message ${chatLabel}...` : 'Message everyone...'}
              className="h-11 bg-muted/50 border-border focus-visible:ring-1 focus-visible:ring-primary"
            />
            <Button
              data-testid="button-send"
              type="submit"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-xl"
              disabled={!content.trim() || isSending}
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
          <p className="text-[10px] text-center text-muted-foreground mt-2">
            Shift+click or hover a message to reply
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Chat Interface                                                 */
/* ------------------------------------------------------------------ */
function ChatInterface({ username, onLogout, theme, setTheme }: {
  username: string;
  onLogout: () => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
}) {
  const { data: allUsers = [] } = useUsers();
  const [activeChatId, setActiveChatId] = useState<string>('general');
  const [activeChatLabel, setActiveChatLabel] = useState<string>('general');
  const [isPrivate, setIsPrivate] = useState(false);

  useChatWebSocket(username, activeChatId);

  const openDm = (otherUser: string) => {
    const chatId = getDmChatId(username, otherUser);
    setActiveChatId(chatId);
    setActiveChatLabel(otherUser);
    setIsPrivate(true);
  };

  const openGeneral = () => {
    setActiveChatId('general');
    setActiveChatLabel('general');
    setIsPrivate(false);
  };

  const otherUsers = allUsers.filter(u => u.username !== username);

  return (
    <div className="h-screen w-full bg-background flex font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-60 flex-none border-r border-border bg-card flex flex-col">
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
          <h1
            className="text-xl text-foreground"
            style={{ fontFamily: '"Comic Sans MS", "Comic Sans", cursive', fontWeight: 'normal' }}
          >
            dapetonchat
          </h1>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-5">
            {/* General */}
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 mb-1">
                Channels
              </p>
              <button
                data-testid="sidebar-general"
                onClick={openGeneral}
                className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeChatId === 'general' ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/50 text-muted-foreground'}`}
              >
                <Hash className="w-4 h-4 shrink-0" />
                general
              </button>
            </div>

            {/* Direct Messages */}
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 mb-1 flex items-center gap-1">
                <Users className="w-3 h-3" /> Users
              </p>
              <div className="space-y-0.5">
                {otherUsers.map(u => {
                  const chatId = getDmChatId(username, u.username);
                  return (
                    <button
                      key={u.id}
                      data-testid={`sidebar-user-${u.id}`}
                      onClick={() => openDm(u.username)}
                      className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeChatId === chatId ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/50 text-muted-foreground'}`}
                    >
                      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold uppercase shrink-0">
                        {u.username[0]}
                      </div>
                      <span className="truncate">{u.username}</span>
                    </button>
                  );
                })}
                {otherUsers.length === 0 && (
                  <p className="px-2 text-xs text-muted-foreground italic py-1">No other users yet</p>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* User footer */}
        <div className="p-3 border-t border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold uppercase shrink-0">
              {username[0]}
            </div>
            <span className="text-sm font-medium flex-1 truncate">{username}</span>
            <button
              data-testid="button-theme"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              data-testid="button-logout"
              onClick={onLogout}
              className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        <ChatWindow
          key={activeChatId}
          chatId={activeChatId}
          username={username}
          chatLabel={activeChatLabel}
          isPrivate={isPrivate}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Root Page                                                           */
/* ------------------------------------------------------------------ */
export default function ChatPage() {
  const { user, isReady, logout } = useAuth();
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  if (!isReady) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuth={() => {}} />;
  }

  return (
    <ChatInterface
      username={user.username}
      onLogout={logout}
      theme={theme}
      setTheme={setTheme}
    />
  );
}
