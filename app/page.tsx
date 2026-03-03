"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  KeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Image from "next/image";

// ─── Types ───────────────────────────────────────────────────────────────────

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  statusHistory: string[];
  isStreaming?: boolean;
};

type SSEEvent =
  | { type: "token"; text: string }
  | { type: "status"; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

// ─── Suggested Queries ───────────────────────────────────────────────────────

const QUICK_QUERIES = [
  {
    category: "הזמנות",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
        <rect x="9" y="3" width="6" height="4" rx="1"/>
        <line x1="9" y1="12" x2="15" y2="12"/>
        <line x1="9" y1="16" x2="12" y2="16"/>
      </svg>
    ),
    queries: [
      "הצג 10 הזמנות מכירה אחרונות",
      "רשום את כל ההזמנות הפתוחות",
      "הזמנות שנסגרו החודש",
      "הצג הזמנות עם הסכומים הגדולים ביותר",
    ],
  },
  {
    category: "לקוחות",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
    queries: [
      "רשום לקוחות פעילים",
      "לקוחות לפי סוכן",
      "הצג לקוח 400204",
      "לקוחות שנוצרו לאחרונה",
    ],
  },
  {
    category: "מוצרים",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      </svg>
    ),
    queries: [
      "הצג קטלוג מוצרים",
      "רשום את כל הפריטים עם מחירים",
      "מוצרים פעילים בלבד",
    ],
  },
  {
    category: "ניתוח",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
    ),
    queries: [
      "סיכום הכנסות מהזמנות אחרונות",
      "הזמנות לפי קו הפצה",
      "השווה הזמנות פתוחות מול סגורות",
      "10 לקוחות מובילים לפי ערך הזמנה",
    ],
  },
];

// ─── Markdown renderer ───────────────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-body" dir="rtl">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          table: ({ node, ...props }) => (
            <div className="table-wrapper">
              <table {...props} />
            </div>
          ),
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          thead: ({ node, ...props }) => <thead {...props} />,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          tbody: ({ node, ...props }) => <tbody {...props} />,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          tr: ({ node, ...props }) => <tr {...props} />,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          th: ({ node, ...props }) => <th {...props} />,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          td: ({ node, ...props }) => <td {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ─── Welcome Screen ───────────────────────────────────────────────────────────

function WelcomeScreen({ onQuery }: { onQuery: (q: string) => void }) {
  const capabilities = [
    {
      icon: "◈",
      color: "#F59E0B",
      title: "נתוני ERP בזמן אמת",
      desc: "שאילתות בזמן אמת על ישויות Priority ERP — לקוחות, הזמנות, מוצרים ועוד.",
    },
    {
      icon: "◉",
      color: "#3B82F6",
      title: "שפה טבעית",
      desc: "שאל בעברית פשוטה. קלוד מתרגם את שאלותיך לשאילתות OData מדויקות.",
    },
    {
      icon: "◎",
      color: "#10B981",
      title: "ניתוח נתונים",
      desc: "סיכומים, סכומים ותובנות — לא רק הצגת נתונים גולמיים.",
    },
    {
      icon: "◈",
      color: "#A78BFA",
      title: "שאילתות מרובות שלבים",
      desc: "שאלות מורכבות הדורשות שילוב מספר ישויות מטופלות אוטומטית.",
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full py-8 md:py-16 animate-fade-in">
      {/* Abra logo */}
      <div className="mb-4 md:mb-6">
        <Image
          src="/abra-logo.png"
          alt="Abra IT"
          width={100}
          height={21}
          style={{ filter: "brightness(0) invert(1)", opacity: 0.85 }}
          priority
        />
      </div>

      {/* Priority mark */}
      <div className="relative mb-4 md:mb-6">
        <div
          className="w-14 h-14 md:w-16 md:h-16 rounded-2xl flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, #F59E0B22, #F59E0B44)",
            border: "1px solid #F59E0B55",
          }}
        >
          <span
            className="text-xl md:text-2xl font-black"
            style={{ color: "#F59E0B", fontFamily: "Syne, sans-serif" }}
          >
            P
          </span>
        </div>
        <div
          className="absolute -bottom-1 -left-1 w-4 h-4 rounded-full flex items-center justify-center"
          style={{ background: "#10B981" }}
        >
          <div className="w-2 h-2 rounded-full bg-white" />
        </div>
      </div>

      <h1
        className="text-xl md:text-2xl font-bold mb-2 tracking-tight"
        style={{ color: "#E8E8F8", fontFamily: "Syne, sans-serif" }}
      >
        עוזר Priority ERP
      </h1>
      <p className="text-sm mb-8 md:mb-10" style={{ color: "#50507A" }}>
        מופעל על ידי ChatGPT 5.2 · סביבת moftov
      </p>

      {/* Capability cards — 1 col on mobile, 2 cols on sm+ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl w-full mb-8 md:mb-10 px-4">
        {capabilities.map((cap) => (
          <div
            key={cap.title}
            className="p-4 rounded-xl"
            style={{
              background: "#0B0B18",
              border: "1px solid #1C1C35",
            }}
          >
            <div className="text-lg mb-2 font-mono" style={{ color: cap.color }}>
              {cap.icon}
            </div>
            <div className="text-sm font-semibold mb-1" style={{ color: "#C4C4DC" }}>
              {cap.title}
            </div>
            <div className="text-xs leading-relaxed" style={{ color: "#50507A" }}>
              {cap.desc}
            </div>
          </div>
        ))}
      </div>

      {/* Sample queries */}
      <div className="flex flex-wrap gap-2 justify-center max-w-lg px-4">
        {[
          "הצג 10 הזמנות מכירה אחרונות",
          "רשום לקוחות פעילים",
          "הצג קטלוג מוצרים",
          "הזמנות שנסגרו החודש",
        ].map((q) => (
          <button
            key={q}
            onClick={() => onQuery(q)}
            className="px-3 py-1.5 rounded-full text-xs transition-all hover:scale-105 active:scale-95"
            style={{
              background: "#10101F",
              border: "1px solid #1C1C35",
              color: "#C4C4DC",
              fontFamily: "Syne, sans-serif",
            }}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const timeStr = message.timestamp.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Extract unique entity names from status history
  const entities = [
    ...new Set(
      message.statusHistory
        .map((s) => {
          const m = s.match(/Querying (\w+)/);
          return m ? m[1] : null;
        })
        .filter(Boolean) as string[]
    ),
  ];

  // In RTL layout: user messages align to start (right), assistant to end (left)
  if (isUser) {
    return (
      <div className="msg-animate flex justify-start mb-4">
        <div className="max-w-[88%] md:max-w-[70%]">
          <div
            className="px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
            style={{
              background: "linear-gradient(135deg, #D97706, #F59E0B)",
              color: "#0A0A0A",
              fontWeight: 500,
            }}
          >
            {message.content}
          </div>
          <div
            className="text-xs mt-1 text-right pr-1"
            style={{ color: "#50507A", fontFamily: "JetBrains Mono, monospace" }}
          >
            {timeStr}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg-animate flex justify-end mb-4">
      <div className="max-w-[96%] md:max-w-[85%] w-full">
        {/* Header row with entity badges */}
        <div className="flex items-center gap-2 mb-2 flex-row-reverse">
          {/* Assistant icon */}
          <div
            className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
            style={{ background: "#1C1C35", border: "1px solid #252540" }}
          >
            <span
              className="text-xs font-black"
              style={{ color: "#F59E0B", fontFamily: "JetBrains Mono, monospace" }}
            >
              P
            </span>
          </div>

          {/* Entity badges — hidden on very small screens */}
          <div className="hidden sm:flex items-center gap-2">
            {entities.map((entity) => (
              <span
                key={entity}
                className="px-1.5 py-0.5 rounded text-xs font-mono"
                style={{
                  background: "rgba(59, 130, 246, 0.12)",
                  border: "1px solid rgba(59, 130, 246, 0.25)",
                  color: "#60A5FA",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "0.65rem",
                  letterSpacing: "0.05em",
                }}
              >
                {entity}
              </span>
            ))}
          </div>

          <span
            className="text-xs mr-auto"
            style={{
              color: "#50507A",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "0.7rem",
            }}
          >
            {timeStr}
          </span>
        </div>

        {/* Message card */}
        <div
          className="px-4 md:px-5 py-4 rounded-2xl rounded-tr-sm"
          style={{
            background: "#0E0E1E",
            border: "1px solid #1C1C35",
            borderRight: "2px solid #F59E0B33",
          }}
        >
          {message.content ? (
            <MarkdownContent content={message.content} />
          ) : (
            <span className="cursor text-sm" style={{ color: "#50507A" }}>
              &nbsp;
            </span>
          )}
          {message.isStreaming && message.content && (
            <span
              className="inline-block w-0.5 h-3.5 mr-0.5 align-middle animate-blink"
              style={{ background: "#F59E0B" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Status Indicator ────────────────────────────────────────────────────────

function StatusIndicator({ status }: { status: string }) {
  return (
    <div className="msg-animate flex justify-end mb-4">
      <div
        className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl max-w-[90%]"
        style={{
          background: "#0B0B18",
          border: "1px solid #1C1C35",
          borderRight: "2px solid #F59E0B44",
        }}
      >
        <span
          className="text-xs truncate"
          style={{
            color: "#A8A8C8",
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          {status}
        </span>
        {/* Animated dots */}
        <div className="flex gap-1 flex-shrink-0">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: "#F59E0B",
                animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Chat Component ──────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Detect mobile breakpoint and set sidebar default
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    setSidebarOpen(window.innerWidth >= 768);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentStatus]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [input]);

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || isLoading) return;

      // Close sidebar on mobile after sending
      if (isMobile) setSidebarOpen(false);

      setInput("");
      setIsLoading(true);
      setCurrentStatus("");

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: text,
        timestamp: new Date(),
        statusHistory: [],
      };

      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);

      const apiMessages = updatedMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const assistantId = `a-${Date.now()}`;
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        statusHistory: [],
        isStreaming: true,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      let fullText = "";
      const statuses: string[] = [];

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: apiMessages }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }
        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            try {
              const event = JSON.parse(raw) as SSEEvent;

              if (event.type === "token") {
                fullText += event.text;
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.id !== assistantId) return prev;
                  return [...prev.slice(0, -1), { ...last, content: fullText }];
                });
              } else if (event.type === "status") {
                statuses.push(event.message);
                setCurrentStatus(event.message);
              } else if (event.type === "done") {
                setCurrentStatus("");
              } else if (event.type === "error") {
                fullText = `**שגיאה:** ${event.message}`;
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.id !== assistantId) return prev;
                  return [...prev.slice(0, -1), { ...last, content: fullText }];
                });
              }
            } catch {
              // Ignore JSON parse errors for partial chunks
            }
          }
        }
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : "החיבור נכשל";
        fullText = `**שגיאה:** ${errMsg}`;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.id !== assistantId) return prev;
          return [...prev.slice(0, -1), { ...last, content: fullText }];
        });
      } finally {
        setIsLoading(false);
        setCurrentStatus("");
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.id !== assistantId) return prev;
          return [
            ...prev.slice(0, -1),
            { ...last, isStreaming: false, statusHistory: statuses },
          ];
        });
      }
    },
    [messages, input, isLoading, isMobile]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setCurrentStatus("");
  };

  return (
    <div
      className="flex h-screen overflow-hidden scanline"
      style={{ background: "var(--bg)" }}
    >
      {/* ── Mobile backdrop (tap to close sidebar) ──────────────────────── */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: "rgba(0,0,0,0.65)" }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      {/* Mobile: fixed overlay sliding from right side (RTL).               */}
      {/* Desktop: normal flex item that collapses to width 0 when closed.   */}
      <aside
        className="flex flex-col transition-all duration-300"
        style={{
          ...(isMobile
            ? {
                position: "fixed",
                top: 0,
                right: 0,
                bottom: 0,
                width: "260px",
                zIndex: 50,
                transform: sidebarOpen ? "translateX(0)" : "translateX(100%)",
              }
            : {
                width: sidebarOpen ? "240px" : "0px",
                overflow: "hidden",
                flexShrink: 0,
              }),
          background: "var(--surface)",
          borderLeft: "1px solid var(--border)",
        }}
      >
        <div style={{ width: isMobile ? "260px" : "240px" }} className="flex flex-col h-full">
          {/* Brand header */}
          <div
            className="p-4 pb-3"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            {/* Mobile close button */}
            {isMobile && (
              <div className="flex justify-between items-center mb-3">
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="w-7 h-7 rounded flex items-center justify-center"
                  style={{ color: "#50507A" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
                <Image
                  src="/abra-logo.png"
                  alt="Abra IT"
                  width={80}
                  height={17}
                  style={{ filter: "brightness(0) invert(1)", opacity: 0.7 }}
                />
              </div>
            )}

            {/* Desktop logo */}
            {!isMobile && (
              <div className="flex justify-center mb-3">
                <Image
                  src="/abra-logo.png"
                  alt="Abra IT"
                  width={90}
                  height={19}
                  style={{ filter: "brightness(0) invert(1)", opacity: 0.7 }}
                />
              </div>
            )}

            <div className="flex items-center gap-2.5 mb-3">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(245,158,11,0.2), rgba(245,158,11,0.35))",
                  border: "1px solid rgba(245,158,11,0.4)",
                }}
              >
                <span
                  className="text-sm font-black"
                  style={{
                    color: "#F59E0B",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  P
                </span>
              </div>
              <div>
                <div
                  className="text-sm font-bold leading-none"
                  style={{ color: "#E8E8F8" }}
                >
                  Priority ERP
                </div>
                <div
                  className="text-xs mt-0.5"
                  style={{
                    color: "#50507A",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  moftov
                </div>
              </div>
            </div>

            {/* Connection status */}
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
              style={{ background: "var(--surface-2)" }}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: "#10B981" }}
              >
                <div
                  className="w-2 h-2 rounded-full animate-pulse-slow"
                  style={{ background: "#10B98166" }}
                />
              </div>
              <span
                className="text-xs"
                style={{
                  color: "#10B981",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                מחובר
              </span>
              <span className="text-xs mr-auto" style={{ color: "#50507A" }}>
                OData v4
              </span>
            </div>
          </div>

          {/* Quick queries */}
          <div className="flex-1 overflow-y-auto py-3 px-3 space-y-5">
            {QUICK_QUERIES.map((group) => (
              <div key={group.category}>
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <span style={{ color: "#F59E0B", opacity: 0.7 }}>
                    {group.icon}
                  </span>
                  <span
                    className="text-xs font-semibold tracking-widest uppercase"
                    style={{ color: "#50507A" }}
                  >
                    {group.category}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {group.queries.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      disabled={isLoading}
                      className="w-full text-right px-2.5 py-2 rounded-lg text-xs transition-all duration-150 hover:-translate-x-0.5 active:scale-95"
                      style={{
                        color: "#8888A8",
                        fontFamily: "Syne, sans-serif",
                        lineHeight: 1.4,
                      }}
                      onMouseEnter={(e) => {
                        (e.target as HTMLElement).style.background =
                          "var(--surface-3)";
                        (e.target as HTMLElement).style.color = "#C4C4DC";
                      }}
                      onMouseLeave={(e) => {
                        (e.target as HTMLElement).style.background =
                          "transparent";
                        (e.target as HTMLElement).style.color = "#8888A8";
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div
            className="p-3"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <button
              onClick={handleClearChat}
              className="w-full px-3 py-2 rounded-lg text-xs transition-all text-right active:scale-95"
              style={{ color: "#50507A" }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.background = "var(--surface-2)";
                (e.target as HTMLElement).style.color = "#C4C4DC";
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.background = "transparent";
                (e.target as HTMLElement).style.color = "#50507A";
              }}
            >
              ↺ נקה שיחה
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Area ──────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header
          className="flex items-center justify-between px-3 md:px-4 h-11 flex-shrink-0"
          style={{
            background: "var(--surface)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="w-7 h-7 rounded flex items-center justify-center transition-all flex-shrink-0"
              style={{ color: "#50507A" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "var(--surface-2)";
                (e.currentTarget as HTMLElement).style.color = "#C4C4DC";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "transparent";
                (e.currentTarget as HTMLElement).style.color = "#50507A";
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>

            <div
              className="h-4 w-px flex-shrink-0"
              style={{ background: "var(--border)" }}
            />

            <span
              className="text-sm font-semibold truncate"
              style={{ color: "#C4C4DC" }}
            >
              עוזר חכם
            </span>

            {messages.length > 0 && (
              <span
                className="px-2 py-0.5 rounded-full text-xs flex-shrink-0"
                style={{
                  background: "var(--surface-2)",
                  color: "#50507A",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {messages.filter((m) => m.role === "user").length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
            {/* Abra logo — hidden on very small screens */}
            <div className="hidden sm:block">
              <Image
                src="/abra-logo.png"
                alt="Abra IT"
                width={64}
                height={13}
                style={{ filter: "brightness(0) invert(1)", opacity: 0.4 }}
              />
            </div>
            <div
              className="hidden sm:block h-4 w-px"
              style={{ background: "var(--border)" }}
            />
            {isLoading && (
              <div className="flex items-center gap-1.5">
                <div
                  className="w-1.5 h-1.5 rounded-full status-flash flex-shrink-0"
                  style={{ background: "#F59E0B" }}
                />
                <span
                  className="text-xs"
                  style={{
                    color: "#F59E0B",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  מעבד
                </span>
              </div>
            )}
            {/* Model badge — hidden on mobile */}
            <span
              className="hidden md:inline text-xs"
              style={{ color: "#30304A", fontFamily: "JetBrains Mono, monospace" }}
            >
              ChatGPT 5.2
            </span>
          </div>
        </header>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto">
          <div
            className="min-h-full px-3 md:px-6 py-4"
            style={{
              backgroundImage:
                "linear-gradient(rgba(28,28,53,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(28,28,53,0.15) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          >
            {messages.length === 0 ? (
              <WelcomeScreen onQuery={sendMessage} />
            ) : (
              <div className="max-w-4xl mx-auto">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {isLoading && currentStatus && (
                  <StatusIndicator status={currentStatus} />
                )}
                <div ref={messagesEndRef} className="h-2" />
              </div>
            )}
          </div>
        </div>

        {/* Input area */}
        <div
          className="flex-shrink-0 p-2 md:p-4"
          style={{
            background: "var(--surface)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <div className="max-w-4xl mx-auto">
            <div
              className="flex items-end gap-2 md:gap-3 rounded-xl p-2.5 md:p-3"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border-2)",
                transition: "border-color 0.2s, box-shadow 0.2s",
              }}
              onFocus={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor =
                  "rgba(245,158,11,0.4)";
                (e.currentTarget as HTMLElement).style.boxShadow =
                  "0 0 0 1px rgba(245,158,11,0.1), 0 0 24px rgba(245,158,11,0.04)";
              }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "var(--border-2)";
                  (e.currentTarget as HTMLElement).style.boxShadow = "none";
                }
              }}
            >
              {/* Send button */}
              <button
                onClick={() => sendMessage()}
                disabled={isLoading || !input.trim()}
                className="flex-shrink-0 w-9 h-9 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-all duration-200"
                style={{
                  background:
                    !isLoading && input.trim()
                      ? "linear-gradient(135deg, #D97706, #F59E0B)"
                      : "var(--surface-3)",
                  color: !isLoading && input.trim() ? "#0A0A0A" : "#30304A",
                  cursor:
                    !isLoading && input.trim() ? "pointer" : "not-allowed",
                }}
              >
                {isLoading ? (
                  <svg
                    className="animate-spin"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="שאל על לקוחות, הזמנות, מוצרים, הכנסות..."
                rows={1}
                disabled={isLoading}
                dir="rtl"
                className="flex-1 resize-none bg-transparent text-sm outline-none leading-relaxed text-right"
                style={{
                  color: "#C4C4DC",
                  caretColor: "#F59E0B",
                  maxHeight: "120px",
                  fontFamily: "Syne, system-ui, sans-serif",
                }}
              />

              {/* Prompt indicator */}
              <div
                className="flex-shrink-0 pb-1"
                style={{
                  color: "#F59E0B",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "0.875rem",
                  opacity: 0.6,
                  userSelect: "none",
                }}
              >
                ‹
              </div>
            </div>

            {/* Keyboard hint — desktop only */}
            <div className="hidden md:flex items-center justify-between mt-1.5 px-1">
              <span
                className="text-xs"
                style={{
                  color: "#30304A",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                Ctrl+Enter לשליחה
              </span>
              {input.length > 0 && (
                <span
                  className="text-xs"
                  style={{
                    color: "#30304A",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  {input.length} תווים
                </span>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
