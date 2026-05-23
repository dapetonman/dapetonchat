import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useUsers, useChatWebSocket } from "@/hooks/use-chat";
import { useQueryClient } from "@tanstack/react-query";
import { useVoice } from "@/hooks/use-voice";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { onWsMessage } from "@/lib/ws-bus";
import { CHANNEL_MESSAGE_IDS, getDmChatId } from "@shared/schema";
import AuthScreen from "./components/AuthScreen";
import ChatSidebar from "./components/ChatSidebar";
import ChatWindow from "./components/ChatWindow";
import VoicePanel from "./components/VoicePanel";

const ADMIN_USERNAME = "dapetonman";
const APP_TITLE = "dapetonchat";

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
      setOnlineUsers(new Set(data.users));
      const nextMap = new Map<string, boolean>();
      data.users.forEach((u) => nextMap.set(u, true));
      setUserOnlineMap(nextMap);
    });
    const unsubRefreshUserList = onWsMessage("REFRESH_USER_LIST", () => {
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
  const [volumes, setVolumes] = useState<Map<string, number>>(new Map());

  const {
    voiceUsers, inVoice, cameraEnabled, screenSharing,
    micError, localStream, remoteStreams,
    desktopAudioEnabled, screenQuality,
    joinVoice, leaveVoice, toggleCamera, shareScreen, stopScreenShare,
    setScreenQuality, toggleDesktopAudio, renegotiate,
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
      audioEl.volume = volumes.get(user) ?? 1;
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
  }, [remoteStreams, deafened, volumes]);

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
    if (!res.ok) toast({ title: "error", description: "Failed to delete messages", variant: "destructive" });
  };

  const handleDeleteAllUsers = async () => {
    if (username !== ADMIN_USERNAME || deleting) return;
    setDeleting(true);
    const res = await fetch("/api/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
    setDeleting(false); setMenuOpen(false);
    if (!res.ok) toast({ title: "error", description: "Failed to delete users", variant: "destructive" });
  };

  const handleKickAllVoice = async () => {
    if (username !== ADMIN_USERNAME || deleting) return;
    setDeleting(true);
    const res = await fetch("/api/voice/kick-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
    setDeleting(false);
    setMenuOpen(false);
    if (!res.ok) toast({ title: "error", description: "Failed to kick voice users", variant: "destructive" });
  };

  return (
    <div className="h-screen w-full bg-background flex font-sans overflow-hidden relative">
      {!wsConnected && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-yellow-500/90 text-yellow-950 text-xs text-center py-1 font-medium animate-pulse pointer-events-none">
          reconnecting...
        </div>
      )}
      <ChatSidebar
        username={username}
        allUsers={allUsers}
        activeView={activeView}
        activeChatId={activeChatId}
        onlineUsers={onlineUsers}
        voiceUsers={voiceUsers}
        inVoice={inVoice}
        menuOpen={menuOpen}
        deleting={deleting}
        theme={theme}
        dnd={dnd}
        mobileMenuOpen={mobileMenuOpen}
        isAdmin={username === ADMIN_USERNAME}
        onOpenDm={openDm}
        onOpenChannel={openGeneral}
        onOpenVoice={openVoice}
        onLogout={onLogout}
        onThemeChange={() => setTheme(theme === "dark" ? "light" : "dark")}
        onDndToggle={() => setDnd((v) => !v)}
        onMenuToggle={() => setMenuOpen((v) => !v)}
        onMobileMenuOpen={setMobileMenuOpen}
        onDeleteAllMessages={handleDeleteAllMessages}
        onDeleteAllUsers={handleDeleteAllUsers}
        onKickAllVoice={handleKickAllVoice}
      />
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
            volumes={volumes}
            desktopAudioEnabled={desktopAudioEnabled}
            screenQuality={screenQuality}
            joinVoice={joinVoice}
            leaveVoice={leaveVoice}
            toggleCamera={toggleCamera}
            shareScreen={shareScreen}
            stopScreenShare={stopScreenShare}
            setScreenQuality={setScreenQuality}
            toggleDesktopAudio={toggleDesktopAudio}
            renegotiate={renegotiate}
            deafened={deafened}
            onDeafenToggle={() => setDeafened((v) => !v)}
            onVolumeChange={(user, vol) => setVolumes((prev) => {
              const next = new Map(prev);
              next.set(user, vol);
              return next;
            })}
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
