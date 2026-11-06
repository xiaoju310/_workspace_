import React, { useState } from 'react';
import { BackendNoteOut, BookType } from '../../types/interaction';
import { apiClient } from '../../lib/api';

interface ReadingNotesDrawerProps {
  bookId: string;
  confirmedType: BookType;
  onConfirmTypeChange: (newType: BookType) => Promise<void>;
  appMode: 'live' | 'demo';
}

export const ReadingNotesDrawer: React.FC<ReadingNotesDrawerProps> = ({
  bookId,
  confirmedType,
  onConfirmTypeChange,
  appMode,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notes, setNotes] = useState<BackendNoteOut[]>([]);
  const [activeShareUrl, setActiveShareUrl] = useState<string | null>(null);
  const [activeShareId, setActiveShareId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 1. 生成真实笔记草稿 (POST /api/books/{book_id}/notes/generate)
  const handleGenerateNote = async () => {
    setIsLoading(true);
    setStatusMsg(null);
    try {
      if (appMode === 'live') {
        const note = await apiClient.generateNoteDraft(bookId);
        setNotes((prev) => [note, ...prev]);
        setStatusMsg({ text: `✅ 服务端成功生成笔记草稿 (ID: ${note.id})`, isError: false });
      } else {
        // 演示模式
        const demoNote: BackendNoteOut = {
          id: `demo-note-${Date.now()}`,
          book_id: bookId,
          owner_id: 'demo_user',
          content: {
            title: '绘本核心启迪',
            body: '小狐狸在迷路过程中学会了观察自然，亲子互动应鼓励安全探索。',
            page_no: 1,
            video_ms: 3500,
          },
          status: 'DRAFT',
          version: 1,
          created_at: new Date().toLocaleTimeString(),
          updated_at: new Date().toLocaleTimeString(),
        };
        setNotes((prev) => [demoNote, ...prev]);
        setStatusMsg({ text: '⚠️ [演示模式] 生成本地模拟笔记草稿', isError: false });
      }
    } catch (err: any) {
      setStatusMsg({ text: `❌ 生成笔记失败: ${err.message}`, isError: true });
    } finally {
      setIsLoading(false);
    }
  };

  // 2. 主人审核笔记 (POST /api/notes/{note_id}/review)
  const handleReviewNote = async (noteId: string) => {
    setIsLoading(true);
    setStatusMsg(null);
    try {
      if (appMode === 'live') {
        const updated = await apiClient.reviewNote(noteId, 'approve');
        setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
        setStatusMsg({ text: `✅ 主人审核已通过，状态更新为: ${updated.status}`, isError: false });
      } else {
        setNotes((prev) =>
          prev.map((n) => (n.id === noteId ? { ...n, status: 'PRIVATE' } : n))
        );
        setStatusMsg({ text: '⚠️ [演示模式] 模拟主人审核通过', isError: false });
      }
    } catch (err: any) {
      setStatusMsg({ text: `❌ 审核失败: ${err.message}`, isError: true });
    } finally {
      setIsLoading(false);
    }
  };

  // 3. 创建只读安全分享 (POST /api/notes/{note_id}/shares)
  const handleCreateShare = async (noteId: string) => {
    setIsLoading(true);
    setStatusMsg(null);
    try {
      if (appMode === 'live') {
        const share = await apiClient.createNoteShare(noteId, 'link');
        const shareUrl = `${window.location.origin}/api/shared-notes/${share.token}`;
        setActiveShareUrl(shareUrl);
        setActiveShareId(share.id);
        setStatusMsg({ text: `✅ 真实只读分享已生成! 任何人凭令牌只读访问。`, isError: false });
      } else {
        const demoToken = `share-demo-token-${Date.now()}`;
        setActiveShareUrl(`${window.location.origin}/api/shared-notes/${demoToken}`);
        setActiveShareId('demo-share-id');
        setStatusMsg({ text: '⚠️ [演示模式] 生成模拟只读链接', isError: false });
      }
    } catch (err: any) {
      // 真实服务端若笔记未审核将返回 409
      setStatusMsg({ text: `❌ 创建分享被拦截: ${err.message}`, isError: true });
    } finally {
      setIsLoading(false);
    }
  };

  // 4. 撤销分享 (DELETE /api/notes/{note_id}/shares/{share_id})
  const handleRevokeShare = async (noteId: string) => {
    if (!activeShareId) return;
    setIsLoading(true);
    setStatusMsg(null);
    try {
      if (appMode === 'live') {
        await apiClient.revokeNoteShare(noteId, activeShareId);
      }
      setActiveShareUrl(null);
      setActiveShareId(null);
      setStatusMsg({ text: '🔒 分享已成功撤销，原链接即刻失效 (访问返回 404/410)。', isError: false });
    } catch (err: any) {
      setStatusMsg({ text: `❌ 撤销失败: ${err.message}`, isError: true });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b' }}>
            📚 通用图书分类与伴读笔记生命周期 ({notes.length} 条)
          </span>
          <span
            style={{
              fontSize: '11px',
              backgroundColor: '#eff6ff',
              color: '#2563eb',
              padding: '2px 8px',
              borderRadius: '10px',
            }}
          >
            当前确认类别: {confirmedType}
          </span>
        </div>
        <span style={{ fontSize: '13px', color: '#64748b' }}>{isOpen ? '收起 ▲' : '展开管理 ▼'}</span>
      </div>

      {statusMsg && (
        <div
          style={{
            fontSize: '12px',
            padding: '8px 12px',
            backgroundColor: statusMsg.isError ? '#fef2f2' : '#f0fdf4',
            color: statusMsg.isError ? '#dc2626' : '#15803d',
            border: `1px solid ${statusMsg.isError ? '#fecaca' : '#bbf7d0'}`,
            borderRadius: '6px',
          }}
        >
          {statusMsg.text}
        </div>
      )}

      {isOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
          {/* 图书分类确认 (对齐 A 后端 PATCH /api/books/{id}/classification) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#475569' }}>图书类别确认 (提交至后端)：</span>
            <select
              value={confirmedType}
              onChange={(e) => onConfirmTypeChange(e.target.value as BookType)}
              style={{
                fontSize: '12px',
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
              }}
            >
              <option value="picture_book">儿童纸质绘本 (picture_book)</option>
              <option value="textbook">通用教材 (textbook)</option>
              <option value="novel">文学小说 (novel)</option>
              <option value="science">科普读物 (science)</option>
              <option value="other">其他读物 (other)</option>
            </select>
          </div>

          {/* 生成真实笔记草稿 */}
          <div>
            <button
              type="button"
              disabled={isLoading}
              onClick={handleGenerateNote}
              style={{
                padding: '6px 14px',
                backgroundColor: '#0f766e',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {isLoading ? '处理中...' : '+ 向后端申请生成笔记草稿'}
            </button>
          </div>

          {/* 活跃的只读分享链接展示 */}
          {activeShareUrl && (
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#166534' }}>
                🔗 已生成的真实只读分享链接：
              </div>
              <input
                type="text"
                readOnly
                value={activeShareUrl}
                style={{
                  fontSize: '11px',
                  padding: '4px 8px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '4px',
                }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(activeShareUrl)}
                  style={{
                    fontSize: '11px',
                    padding: '3px 8px',
                    backgroundColor: '#e0e7ff',
                    color: '#3730a3',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  📋 复制链接
                </button>
                <button
                  type="button"
                  onClick={() => handleRevokeShare(notes[0]?.id)}
                  style={{
                    fontSize: '11px',
                    padding: '3px 8px',
                    backgroundColor: '#fee2e2',
                    color: '#991b1b',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  🚫 撤销此分享
                </button>
              </div>
            </div>
          )}

          {/* 笔记列表与真实状态 */}
          {notes.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>暂无笔记，点击上方按钮向服务端发起草稿生成。</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {notes.map((note) => (
                <div
                  key={note.id}
                  style={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                      {note.content.title || '笔记草稿'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#475569' }}>
                      {note.content.body || JSON.stringify(note.content)}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      ID: {note.id} ｜ 服务端状态:{' '}
                      <strong style={{ color: note.status === 'DRAFT' ? '#f59e0b' : '#10b981' }}>
                        {note.status}
                      </strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    {note.status === 'DRAFT' && (
                      <button
                        type="button"
                        onClick={() => handleReviewNote(note.id)}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          borderRadius: '4px',
                          border: '1px solid #cbd5e1',
                          background: '#fff',
                          cursor: 'pointer',
                        }}
                      >
                        ✅ 主人审核通过
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleCreateShare(note.id)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        border: 'none',
                        backgroundColor: '#dcfce7',
                        color: '#166534',
                        cursor: 'pointer',
                      }}
                    >
                      🔗 创建只读分享
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
