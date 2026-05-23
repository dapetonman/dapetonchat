import { useState, useEffect } from "react";
import { ArrowLeft, Bell, Eye, EyeOff, Loader2, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function AuthScreen({ onAuth }: { onAuth: () => void }) {
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
      toast({ title: 'error', description: error, variant: 'destructive' });
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
