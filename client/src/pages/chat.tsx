import React, { useState, useRef, useEffect } from "react";
import { format } from "date-fns";
import { Send, User as UserIcon, MessageSquare, Loader2, LogOut, Settings, Moon, Sun, Users, Bell } from "lucide-react";
import { useMessages, useSendMessage, useChatWebSocket } from "@/hooks/use-chat";
import { useUsername } from "@/hooks/use-username";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

const COLORS = [
  "#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF", "#4B0082", "#9400D3",
  "#FF1493", "#00CED1", "#ADFF2F", "#FFD700", "#FF4500", "#00FA9A", "#1E90FF",
  "#DA70D6", "#00FFFF"
];

export default function ChatPage() {
  const { username, color, setUsername, clearUsername, isReady } = useUsername();
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
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
          <h1 className="text-4xl font-black text-white mb-6 text-center font-display tracking-tight">
            dapetonchat
          </h1>
          <p className="text-zinc-400 mb-8 text-center">Pick a color to represent you in the chat.</p>
          
          <div className="grid grid-cols-4 gap-4 mb-8">
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setSelectedColor(c)}
                className={`w-full aspect-square rounded-xl transition-all duration-200 ${selectedColor === c ? 'ring-4 ring-white scale-110' : 'opacity-70 hover:opacity-100 hover:scale-105'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          <Button 
            className="w-full h-12 text-lg font-bold bg-white text-black hover:bg-zinc-200 rounded-xl"
            onClick={() => setUsername(`User_${Math.floor(Math.random() * 10000)}`, selectedColor)}
          >
            Enter Chat
          </Button>
        </div>
      </div>
    );
  }

  return <ChatInterface username={username} color={color || '#fff'} onLogout={clearUsername} theme={theme} setTheme={setTheme} />;
}

function ChatInterface({ username, color, onLogout, theme, setTheme }: { username: string; color: string; onLogout: () => void; theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void }) {
  const { data: messages = [], isLoading } = useMessages(username);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const [content, setContent] = useState("");
  const [recipient, setRecipient] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  
  const { users } = useChatWebSocket(username, color, (notif) => {
    toast({
      title: "New Private Message",
      description: `From ${notif.from}: ${notif.content}`,
      duration: 5000,
    });
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || isSending) return;

    sendMessage(
      { username, content: trimmed, recipientId: recipient },
      { onSuccess: () => setContent("") }
    );
  };

  return (
    <div className="h-screen w-full bg-background flex font-sans overflow-hidden">
      {/* Sidebar - Online Users */}
      <div className="w-64 flex-none border-r bg-card flex flex-col hidden md:flex">
        <div className="p-4 border-b flex items-center gap-2">
          <Users className="w-5 h-5" />
          <h2 className="font-bold">Online Users ({users.length})</h2>
        </div>
        <ScrollArea className="flex-1 p-2">
          <div className="space-y-1">
            {users.map(u => (
              <button
                key={u.username}
                onClick={() => setRecipient(u.username === username ? null : u.username)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${recipient === u.username ? 'bg-accent' : 'hover:bg-accent/50'}`}
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: u.color }} />
                <span className="text-sm font-medium truncate">{u.username} {u.username === username && "(You)"}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b flex items-center justify-between px-6 bg-card/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-black font-display tracking-tight">dapetonchat</h1>
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
                <DropdownMenuItem onClick={onLogout} className="text-destructive">
                  <LogOut className="w-4 h-4 mr-2" /> Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <ScrollArea className="flex-1 p-6" ref={scrollRef}>
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((msg, i) => {
              const isMe = msg.username === username;
              const isPrivate = !!msg.recipientId;
              return (
                <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold opacity-60">{msg.username}</span>
                    <span className="text-[10px] opacity-40">{format(new Date(msg.createdAt), "h:mm a")}</span>
                    {isPrivate && <span className="text-[10px] font-black text-primary uppercase bg-primary/10 px-1 rounded">Private</span>}
                  </div>
                  <div className={`px-4 py-2 rounded-2xl max-w-[80%] break-words ${isMe ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-muted rounded-tl-none"}`}>
                    {msg.content}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="p-6 border-t bg-card/30">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex gap-4">
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
        </div>
      </div>
    </div>
  );
}
