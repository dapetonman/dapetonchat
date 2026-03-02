import React, { useState, useRef, useEffect } from "react";
import { format } from "date-fns";
import { Send, User as UserIcon, MessageSquare, Loader2, LogOut } from "lucide-react";
import { useMessages, useSendMessage, useChatWebSocket } from "@/hooks/use-chat";
import { useUsername } from "@/hooks/use-username";

export default function ChatPage() {
  const { username, setUsername, clearUsername, isReady } = useUsername();
  const [nameInput, setNameInput] = useState("");

  // Only render the app once we've checked localStorage
  if (!isReady) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-zinc-50">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!username) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-zinc-50 px-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl shadow-zinc-200/50 border border-zinc-100 transform transition-all">
          <div className="w-12 h-12 bg-zinc-100 rounded-2xl flex items-center justify-center mb-6">
            <MessageSquare className="w-6 h-6 text-zinc-900" />
          </div>
          <h1 className="text-3xl font-bold text-zinc-900 mb-2 font-display">
            Welcome to Chat
          </h1>
          <p className="text-zinc-500 mb-8 leading-relaxed">
            Enter a minimal, real-time chat experience. Please choose a username to get started.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setUsername(nameInput);
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-zinc-700 mb-2">
                Your Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <UserIcon className="h-5 w-5 text-zinc-400" />
                </div>
                <input
                  id="username"
                  type="text"
                  autoFocus
                  required
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all duration-200"
                  placeholder="e.g. John Doe"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={!nameInput.trim()}
              className="w-full flex items-center justify-center px-4 py-3 border border-transparent rounded-xl shadow-sm text-base font-medium text-white bg-zinc-900 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              Join Chat
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <ChatInterface username={username} onLogout={clearUsername} />;
}

function ChatInterface({ username, onLogout }: { username: string; onLogout: () => void }) {
  const { data: messages = [], isLoading, error } = useMessages();
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const [content, setContent] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Connect to WebSocket
  useChatWebSocket();

  // Auto-scroll to bottom
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
      { username, content: trimmed },
      {
        onSuccess: () => {
          setContent("");
        },
      }
    );
  };

  return (
    <div className="h-screen w-full bg-zinc-50 flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="flex-none bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between z-10 shadow-sm shadow-zinc-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center shadow-md shadow-zinc-900/20">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900 font-display leading-none">Realtime Chat</h1>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50"></span>
              <span className="text-xs font-medium text-zinc-500">Connected</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 bg-zinc-100 px-3 py-1.5 rounded-lg border border-zinc-200">
            <UserIcon className="w-4 h-4 text-zinc-500" />
            <span className="text-sm font-medium text-zinc-700">{username}</span>
          </div>
          <button
            onClick={onLogout}
            className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors"
            title="Log out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6" ref={scrollRef}>
        <div className="max-w-3xl mx-auto space-y-6 flex flex-col justify-end min-h-full">
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-300" />
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center flex-col gap-2">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                !
              </div>
              <p className="text-red-500 font-medium">Failed to load messages.</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
              <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mb-4">
                <MessageSquare className="w-8 h-8 text-zinc-300" />
              </div>
              <p className="text-zinc-500 font-medium">No messages yet.</p>
              <p className="text-zinc-400 text-sm mt-1">Be the first to say hello!</p>
            </div>
          ) : (
            messages.map((msg, index) => {
              const isMe = msg.username === username;
              const showHeader = index === 0 || messages[index - 1].username !== msg.username;
              
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"} max-w-[85%] ${isMe ? "ml-auto" : "mr-auto"}`}
                >
                  {showHeader && (
                    <span className="text-xs font-semibold text-zinc-500 mb-1.5 ml-1">
                      {isMe ? "You" : msg.username}
                    </span>
                  )}
                  <div
                    className={`group relative px-5 py-3 rounded-2xl shadow-sm inline-block ${
                      isMe
                        ? "bg-zinc-900 text-white rounded-tr-sm"
                        : "bg-white text-zinc-900 border border-zinc-200 rounded-tl-sm"
                    }`}
                  >
                    <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">
                      {msg.content}
                    </p>
                    <span
                      className={`text-[10px] mt-1.5 block opacity-0 group-hover:opacity-100 transition-opacity absolute ${
                        isMe ? "right-full mr-2 bottom-2 text-zinc-400" : "left-full ml-2 bottom-2 text-zinc-400"
                      } whitespace-nowrap`}
                    >
                      {format(new Date(msg.createdAt), "h:mm a")}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="flex-none bg-white border-t border-zinc-200 p-4 sm:p-6 shadow-[0_-4px_20px_-15px_rgba(0,0,0,0.1)]">
        <div className="max-w-3xl mx-auto">
          <form
            onSubmit={handleSubmit}
            className="flex items-end gap-3 bg-zinc-50 border border-zinc-200 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-zinc-900 focus-within:border-transparent transition-all shadow-sm"
          >
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="Type a message..."
              className="flex-1 max-h-32 min-h-[44px] bg-transparent resize-none border-0 focus:ring-0 text-zinc-900 placeholder-zinc-400 py-3 px-4 outline-none"
              rows={1}
            />
            <button
              type="submit"
              disabled={!content.trim() || isSending}
              className="p-3 mb-1 mr-1 bg-zinc-900 text-white rounded-xl hover:bg-zinc-800 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-md shadow-zinc-900/20"
            >
              {isSending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </form>
          <div className="text-center mt-2">
            <span className="text-[11px] text-zinc-400 font-medium">
              Press <kbd className="font-sans px-1 py-0.5 bg-zinc-100 border border-zinc-200 rounded text-zinc-500">Enter</kbd> to send, <kbd className="font-sans px-1 py-0.5 bg-zinc-100 border border-zinc-200 rounded text-zinc-500">Shift + Enter</kbd> for new line
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
