"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import { linkify } from "@/lib/linkify";

interface CommentRecord {
  id: string;
  content: string;
  author: { id: string; name: string };
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// Cache session per page load — keyed by userId to avoid stale data across logins.
// The cache is invalidated on full page reload (module re-evaluation).
let sessionCache: { userId: string; role: string } | null = null;
let sessionPromise: Promise<{ userId: string; role: string } | null> | null = null;

function useSession() {
  const [session, setSession] = useState(sessionCache);
  useEffect(() => {
    if (sessionCache) {
      setSession(sessionCache);
      return;
    }
    if (!sessionPromise) {
      sessionPromise = apiFetch<{ user: { id: string }; member?: { role: string } }>("/auth/get-session")
        .then((s) => {
          sessionCache = { userId: s.user.id, role: s.member?.role || "member" };
          return sessionCache;
        })
        .catch(() => {
          sessionPromise = null;
          return null;
        });
    }
    sessionPromise.then((s) => {
      if (s) setSession(s);
    });
  }, []);
  return session;
}

/** Call this on logout to clear cached session data. */
export function clearCommentsSessionCache() {
  sessionCache = null;
  sessionPromise = null;
}

export function CommentsSection({
  targetType,
  targetId,
  commentCount: initialCount,
  alwaysExpanded = false,
}: {
  targetType: "update" | "task";
  targetId: string;
  commentCount: number;
  alwaysExpanded?: boolean;
}) {
  const session = useSession();
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [newComment, setNewComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [expanded, setExpanded] = useState(alwaysExpanded);
  const [count, setCount] = useState(initialCount);
  const [loaded, setLoaded] = useState(false);

  const canDeleteOthers = session?.role === "owner" || session?.role === "admin";

  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  const loadComments = useCallback(() => {
    apiFetch<PaginatedResponse<CommentRecord>>(
      `/comments/${targetType}/${targetId}?limit=50`,
    )
      .then((res) => {
        setComments(res.data);
        setCount(res.meta.total);
        setLoaded(true);
      })
      .catch(console.error);
  }, [targetType, targetId]);

  useEffect(() => {
    if (expanded && !loaded) {
      loadComments();
    }
  }, [expanded, loaded, loadComments]);

  const [error, setError] = useState("");

  const handlePost = async () => {
    if (!newComment.trim()) return;
    setPosting(true);
    setError("");
    try {
      await apiFetch(`/comments/${targetType}/${targetId}`, {
        method: "POST",
        body: JSON.stringify({ content: newComment }),
      });
      setNewComment("");
      loadComments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    setError("");
    try {
      await apiFetch(`/comments/${commentId}`, { method: "DELETE" });
      loadComments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete comment");
    }
  };

  return (
    <div className={alwaysExpanded ? "" : "mt-2"}>
      {!alwaysExpanded && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          data-testid={`comments-toggle-${targetId}`}
        >
          <MessageSquare size={12} />
          {expanded
            ? "Hide comments"
            : count > 0
              ? `${count} comment${count !== 1 ? "s" : ""}`
              : "Reply"}
        </button>
      )}

      {expanded && (
        <div className="mt-2 space-y-2" data-testid={`comments-list-${targetId}`}>
          {comments.map((comment) => (
            <div
              key={comment.id}
              data-testid="comment-entry"
              className="flex items-start gap-2 px-3 py-2 bg-[var(--muted)]/50 rounded-lg group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{comment.author.name}</span>
                  <span className="text-[10px] text-[var(--muted-foreground)]">
                    {formatRelativeTime(comment.createdAt)}
                  </span>
                </div>
                <p className="text-sm mt-0.5 whitespace-pre-wrap">{linkify(comment.content)}</p>
              </div>
              {(comment.author.id === session?.userId || canDeleteOthers) && (
                <button
                  onClick={() => handleDelete(comment.id)}
                  data-testid={`delete-comment-${comment.id}`}
                  className="p-1 text-[var(--muted-foreground)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handlePost();
                }
              }}
              placeholder="Write a comment..."
              maxLength={2000}
              data-testid="comment-input"
              className="flex-1 px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
            <button
              onClick={handlePost}
              disabled={posting || !newComment.trim()}
              data-testid="comment-submit"
              className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 shrink-0"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
