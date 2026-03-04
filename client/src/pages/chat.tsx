import React, { useState, useRef, useEffect } from "react";
import { format } from "date-fns";
import { Send, User as UserIcon, MessageSquare, Loader2, LogOut, Settings, Moon, Sun, Users, Bell, Smile, Reply } from "lucide-react";
import { useMessages, useSendMessage, useChatWebSocket } from "@/hooks/use-chat";
import { useUsername } from "@/hooks/use-username";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

export default function ChatPage() {
  const { username, setUsername, clearUsername, isReady } = useUsername();
  const [nameInput, setNameInput] = useState("");
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

  if (!username) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-zinc-950 px-4">
        <div className="max-w-md w-full bg-zinc-900 rounded-3xl p-8 shadow-2xl border border-zinc-800">
          <h1 className="text-4xl font-black text-white mb-6 text-center tracking-tight" style={{ fontFamily: '"Comic Sans MS", "Comic Sans", cursive' }}>
            dapetonchat
          </h1>
          <form onSubmit={(e) => { e.preventDefault(); if (nameInput.trim()) setUsername(nameInput.trim()); }} className="space-y-4">
            <Input 
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Enter your username..."
              className="h-12 bg-zinc-800 border-zinc-700 text-white"
            />
            <Button type="submit" className="w-full h-12 text-lg font-bold bg-white text-black hover:bg-zinc-200 rounded-xl">
              Enter Chat
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return <ChatInterface username={username} onLogout={clearUsername} theme={theme} setTheme={setTheme} />;
}

function ChatInterface({ username, onLogout, theme, setTheme }: { username: string; onLogout: () => void; theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void }) {
  const { data: messages = [], isLoading } = useMessages(username);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const [content, setContent] = useState("");
  const [recipient, setRecipient] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<any | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  
  const { users } = useChatWebSocket(username, "", (notif) => {
    toast({
      title: "New Private Message",
      description: `From ${notif.from}: ${notif.content}`,
      duration: 5000,
    });
  });

  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || isSending) return;

    sendMessage(
      { username, content: trimmed, recipientId: recipient, replyToId: replyTo?.id },
      { onSuccess: () => { setContent(""); setReplyTo(null); } }
    );
  };

  const handleLogout = async () => {
    await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    onLogout();
  };

  const handleReact = async (msgId: number, emoji: string) => {
    await fetch(`/api/messages/${msgId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji, username })
    });
  };

  // Group users for the sidebar: General vs DMs
  const otherUsers = users.filter(u => u.username !== username);

  return (
    <div className="h-screen w-full bg-background flex font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 flex-none border-r bg-card flex flex-col hidden md:flex">
        <div className="p-4 border-b">
          <h2 className="font-bold flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Chats</h2>
        </div>
        <ScrollArea className="flex-1 p-2">
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase px-3 mb-2 tracking-wider">Public</p>
              <button
                onClick={() => setRecipient(null)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${!recipient ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}
              >
                <Users className="w-4 h-4" />
                <span className="text-sm font-medium">General Chat</span>
              </button>
            </div>
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase px-3 mb-2 tracking-wider">Direct Messages</p>
              <div className="space-y-1">
                {otherUsers.map(u => (
                  <button
                    key={u.username}
                    onClick={() => setRecipient(u.username)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${recipient === u.username ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}
                  >
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-sm font-medium truncate">{u.username}</span>
                  </button>
                ))}
                {otherUsers.length === 0 && <p className="px-3 text-xs text-muted-foreground italic">No one else online</p>}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b flex items-center justify-between px-6 bg-card/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-black tracking-tight" style={{ fontFamily: '"Comic Sans MS", "Comic Sans", cursive' }}>
              dapetonchat
            </h1>
            {recipient && (
              <div className="flex items-center gap-2 px-3 py-1 bg-primary/10 rounded-full border border-primary/20">
                <span className="text-xs font-bold text-primary uppercase">DM: {recipient}</span>
                <button onClick={() => setRecipient(null)} className="text-xs hover:text-primary">×</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon"><Settings className="w-5 h-5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                  {theme === 'dark' ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                  <LogOut className="w-4 h-4 mr-2" /> Logout & Clear Logs
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <ScrollArea className="flex-1 p-6" ref={scrollRef}>
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((msg) => {
              const isMe = msg.username === username;
              const isPrivate = !!msg.recipientId;
              const reactions = (msg.reactions as any) || {};
              const replyTarget = msg.replyToId ? messages.find(m => m.id === msg.replyToId) : null;

              return (
                <div 
                  key={msg.id} 
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                  onDoubleClick={() => {
                    // Simple logic for double click to show emoji menu could be handled via state
                  }}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      setReplyTo(msg);
                    }
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold opacity-60">{msg.username}</span>
                    <span className="text-[10px] opacity-40">{format(new Date(msg.createdAt), "EEEE, h:mm a")}</span>
                    {isPrivate && <span className="text-[10px] font-black text-primary uppercase bg-primary/10 px-1 rounded">Private</span>}
                  </div>
                  
                  {replyTarget && (
                    <div className="mb-1 text-xs text-muted-foreground bg-muted/30 px-2 py-1 rounded italic flex items-center gap-1">
                      <Reply className="w-3 h-3" /> Replying to {replyTarget.username}: {replyTarget.content.substring(0, 20)}...
                    </div>
                  )}

                  <Popover>
                    <PopoverTrigger asChild>
                      <div className={`group relative px-4 py-2 rounded-2xl max-w-[80%] break-words cursor-pointer select-none transition-all ${isMe ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-muted rounded-tl-none"} hover:brightness-110 active:scale-[0.98]`}>
                        {msg.content}
                        
                        {Object.keys(reactions).length > 0 && (
                          <div className={`absolute -bottom-3 ${isMe ? 'right-0' : 'left-0'} flex gap-1`}>
                            {Object.entries(reactions).map(([emoji, users]: [string, any]) => (
                              users.length > 0 && (
                                <div key={emoji} className="bg-card border rounded-full px-1.5 py-0.5 text-[10px] flex items-center gap-1 shadow-sm">
                                  <span>{emoji}</span>
                                  <span className="font-bold">{users.length}</span>
                                </div>
                              )
                            ))}
                          </div>
                        )}
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-1 flex gap-1">
                      {EMOJIS.map(emoji => (
                        <button 
                          key={emoji} 
                          onClick={() => handleReact(msg.id, emoji)}
                          className="hover:bg-accent p-1.5 rounded transition-colors text-lg"
                        >
                          {emoji}
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="p-6 border-t bg-card/30">
          <div className="max-w-3xl mx-auto">
            {replyTo && (
              <div className="mb-2 p-2 bg-muted/50 rounded-lg flex items-center justify-between text-xs">
                <span className="flex items-center gap-2"><Reply className="w-3 h-3" /> Replying to @{replyTo.username}</span>
                <button onClick={() => setReplyTo(null)} className="hover:text-primary">Cancel</button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="flex gap-4">
              <Input
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={recipient ? `Message @${recipient}...` : "Message everyone..."}
                className="h-12 bg-muted/50 border-0 focus-visible:ring-1 focus-visible:ring-primary"
              />
              <Button type="submit" size="icon" className="h-12 w-12 shrink-0 rounded-xl" disabled={!content.trim() || isSending}>
                {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </Button>
            </form>
            <p className="text-[10px] text-center text-muted-foreground mt-2">
              Shift + Click to reply • Double Click for reactions (via menu)
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
