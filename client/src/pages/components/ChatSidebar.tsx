import { Hash, LogOut, Moon, Sun, Users, Volume2, Mic, Trash2, PhoneOff, Settings, Bell, BellOff, Menu } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { MAIN_CHANNELS, getDmChatId } from "@shared/schema";

const ADMIN_USERNAME = "dapetonman";

interface SidebarUser {
  id: number;
  username: string;
  isOnline: boolean;
}

interface ChatSidebarProps {
  username: string;
  allUsers: SidebarUser[];
  activeView: "chat" | "voice";
  activeChatId: string;
  onlineUsers: Set<string>;
  voiceUsers: string[];
  inVoice: boolean;
  menuOpen: boolean;
  deleting: boolean;
  theme: "light" | "dark";
  dnd: boolean;
  mobileMenuOpen: boolean;
  isAdmin: boolean;
  onOpenDm: (username: string) => void;
  onOpenChannel: (channel: string) => void;
  onOpenVoice: () => void;
  onLogout: () => void;
  onThemeChange: () => void;
  onDndToggle: () => void;
  onMenuToggle: () => void;
  onMobileMenuOpen: (open: boolean) => void;
  onDeleteAllMessages: () => void;
  onDeleteAllUsers: () => void;
  onKickAllVoice: () => void;
}

export default function ChatSidebar({
  username, allUsers, activeView, activeChatId, onlineUsers,
  voiceUsers, inVoice, menuOpen, deleting, theme, dnd,
  mobileMenuOpen, isAdmin,
  onOpenDm, onOpenChannel, onOpenVoice, onLogout,
  onThemeChange, onDndToggle, onMenuToggle, onMobileMenuOpen,
  onDeleteAllMessages, onDeleteAllUsers, onKickAllVoice,
}: ChatSidebarProps) {
  return (
    <>
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
                  <button key={channel} data-testid={`sidebar-channel-${channel}`} onClick={() => onOpenChannel(channel)} className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeView === "chat" && activeChatId === channel ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50 text-muted-foreground"}`}>
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
                  onClick={onOpenVoice}
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
                    <button key={u.id} data-testid={`sidebar-user-${u.id}`} onClick={() => onOpenDm(u.username)} className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeView === "chat" && activeChatId === chatId ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50 text-muted-foreground"}`}>
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
        {isAdmin && (
          <div className="relative px-3 pb-0 pt-2">
            {menuOpen && (
              <div className="absolute bottom-full mb-2 left-3 right-3 rounded-xl border border-border bg-card p-2 shadow-xl z-50">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 pb-1.5">admin</p>
                <button data-testid="button-delete-all-messages" onClick={onDeleteAllMessages} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                  <Trash2 className="h-4 w-4" /> delete all messages
                </button>
                <button data-testid="button-delete-all-users" onClick={onDeleteAllUsers} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                  <Users className="h-4 w-4" /> delete all users
                </button>
                <button data-testid="button-kick-all-voice" onClick={onKickAllVoice} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
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
            <button data-testid="button-theme" onClick={onThemeChange} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">{theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
            <button data-testid="button-dnd" onClick={onDndToggle} title={dnd ? "notifications muted" : "mute notifications"} className={`p-1.5 rounded-lg transition-colors ${dnd ? "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30" : "hover:bg-accent text-muted-foreground hover:text-foreground"}`}>{dnd ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}</button>
            {isAdmin && (
              <button data-testid="button-admin-menu" onClick={onMenuToggle} className={`p-1.5 rounded-lg hover:bg-accent transition-colors ${menuOpen ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button data-testid="button-logout" onClick={onLogout} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><LogOut className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      <Sheet open={mobileMenuOpen} onOpenChange={onMobileMenuOpen}>
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
                    <button key={channel} data-testid={`mobile-sidebar-channel-${channel}`} onClick={() => onOpenChannel(channel)} className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeView === "chat" && activeChatId === channel ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50 text-muted-foreground"}`}>
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
                    data-testid="mobile-button-voice-general"
                    onClick={onOpenVoice}
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
                      <button key={u.id} data-testid={`mobile-sidebar-user-${u.id}`} onClick={() => onOpenDm(u.username)} className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-colors ${activeView === "chat" && activeChatId === chatId ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50 text-muted-foreground"}`}>
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
          {isAdmin && (
            <div className="relative px-3 pb-0 pt-2">
              {menuOpen && (
                <div className="absolute bottom-full mb-2 left-3 right-3 rounded-xl border border-border bg-card p-2 shadow-xl z-50">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 pb-1.5">admin</p>
                  <button data-testid="mobile-button-delete-all-messages" onClick={onDeleteAllMessages} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                    <Trash2 className="h-4 w-4" /> delete all messages
                  </button>
                  <button data-testid="mobile-button-delete-all-users" onClick={onDeleteAllUsers} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                    <Users className="h-4 w-4" /> delete all users
                  </button>
                  <button data-testid="mobile-button-kick-all-voice" onClick={onKickAllVoice} disabled={deleting} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-destructive/10 text-foreground">
                    <PhoneOff className="h-4 w-4" /> kick all voice users
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
              <button data-testid="mobile-button-theme" onClick={onThemeChange} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">{theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
              <button data-testid="mobile-button-dnd" onClick={onDndToggle} title={dnd ? "notifications muted" : "mute notifications"} className={`p-1.5 rounded-lg transition-colors ${dnd ? "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30" : "hover:bg-accent text-muted-foreground hover:text-foreground"}`}>{dnd ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}</button>
              {isAdmin && (
                <button data-testid="mobile-button-admin-menu" onClick={onMenuToggle} className={`p-1.5 rounded-lg hover:bg-accent transition-colors ${menuOpen ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <Settings className="w-4 h-4" />
                </button>
              )}
              <button data-testid="mobile-button-logout" onClick={onLogout} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><LogOut className="w-4 h-4" /></button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
