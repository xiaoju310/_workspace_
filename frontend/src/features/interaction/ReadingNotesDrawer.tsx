import React, { useState } from 'react';
import { ReadingNote, BookCategoryInfo, BookCategory } from '../../types/interaction';

interface ReadingNotesDrawerProps {
  bookId: string;
  categoryInfo: BookCategoryInfo;
  onUpdateCategory: (info: BookCategoryInfo) => void;
}

export const ReadingNotesDrawer: React.FC<ReadingNotesDrawerProps> = ({
  bookId,
  categoryInfo,
  onUpdateCategory,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notes, setNotes] = useState<ReadingNote[]>([
    {
      id: 'note-001',
      book_id: bookId,
      page_no: 1,
      video_ms: 3500,
      user_id: 'owner_user',
      content: '小狐狸戴红围巾这一段，动画色彩鲜亮，适合亲子启蒙互动。',
      source_quote: '从前有一只住在森林深处的小狐狸...',
      status: 'reviewed',
      share_settings: {
        is_shared: true,
        read_only: true,
        expires_at: null,
      },
      created_at: '2026-11-04 10:30',
      updated_at: '2026-11-04 11:15',
    },
  ]);

  const [newNoteContent, setNewNoteContent] = useState('');
  const [shareTip, setShareTip] = useState<string | null>(null);

  const handleAddNote = () => {
    if (!newNoteContent.trim()) return;
    const newNote: ReadingNote = {
      id: `note-${Date.now()}`,
      book_id: bookId,
      page_no: 1,
      video_ms: 0,
      user_id: 'owner_user',
      content: newNoteContent.trim(),
      status: 'draft',
      share_settings: {
        is_shared: false,
        read_only: true,
        expires_at: null,
      },
      created_at: new Date().toLocaleTimeString(),
      updated_at: new Date().toLocaleTimeString(),
    };
    setNotes([newNote, ...notes]);
    setNewNoteContent('');
  };

  const handleToggleStatus = (id: string) => {
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n;
        const nextStatus = n.status === 'draft' ? 'reviewed' : n.status === 'reviewed' ? 'published' : 'draft';
        return { ...n, status: nextStatus };
      })
    );
  };

  const handleToggleShare = (id: string) => {
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n;
        // 规则：只有经过主人审核 (reviewed / published) 才能开启分享
        if (n.status === 'draft') {
          setShareTip('⚠️ 草稿状态笔记不可对外分享，需先经主人审核通过！');
          setTimeout(() => setShareTip(null), 3000);
          return n;
        }
        const nextShared = !n.share_settings.is_shared;
        setShareTip(nextShared ? '✅ 已生成只读分享安全链接 (已开启防篡改)' : '🔒 已撤销对外公开分享');
        setTimeout(() => setShareTip(null), 3000);
        return {
          ...n,
          share_settings: { ...n.share_settings, is_shared: nextShared },
        };
      })
    );
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
            📚 通用阅读扩展 · 图书分类与伴读笔记 ({notes.length} 条)
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
            分类: {categoryInfo.category} (置信度 {(categoryInfo.confidence * 100).toFixed(0)}%)
          </span>
        </div>
        <span style={{ fontSize: '13px', color: '#64748b' }}>{isOpen ? '收起 ▲' : '展开管理 ▼'}</span>
      </div>

      {shareTip && (
        <div
          style={{
            fontSize: '12px',
            padding: '6px 12px',
            backgroundColor: shareTip.startsWith('✅') ? '#ecfdf5' : '#fffbeb',
            color: shareTip.startsWith('✅') ? '#065f46' : '#92400e',
            borderRadius: '6px',
          }}
        >
          {shareTip}
        </div>
      )}

      {isOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
          {/* 分类确认区 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#475569' }}>图书类别主人确认：</span>
            <select
              value={categoryInfo.category}
              onChange={(e) => {
                onUpdateCategory({
                  category: e.target.value as BookCategory,
                  confidence: 1.0,
                  is_confirmed: true,
                  confirmed_by: 'owner_user',
                });
              }}
              style={{
                fontSize: '12px',
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
              }}
            >
              <option value="picture_book">儿童纸质绘本 (默认场景)</option>
              <option value="textbook">通用教材 / 教辅</option>
              <option value="literature">文学经典</option>
              <option value="science">科普百科图解</option>
            </select>
            <span style={{ fontSize: '12px', color: '#16a34a' }}>
              {categoryInfo.is_confirmed ? '✅ 主人已确认该类别' : '⏳ 待确认'}
            </span>
          </div>

          {/* 快速新增笔记 */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder="记录关于绘本画面、教育启发或阅读难点的笔记..."
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              style={{
                flex: 1,
                fontSize: '13px',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={handleAddNote}
              disabled={!newNoteContent.trim()}
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
              + 添加笔记
            </button>
          </div>

          {/* 笔记卡片列表 */}
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
                  <div style={{ fontSize: '13px', color: '#1e293b' }}>{note.content}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    来源: 第 {note.page_no} 页 ｜ 时间: {note.created_at} ｜ 状态:{' '}
                    <strong style={{ color: note.status === 'draft' ? '#f59e0b' : '#10b981' }}>
                      {note.status === 'draft' ? '草稿 (待审核)' : note.status === 'reviewed' ? '主人已审核' : '已发布'}
                    </strong>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(note.id)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      background: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    流转状态
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleShare(note.id)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      borderRadius: '4px',
                      border: 'none',
                      backgroundColor: note.share_settings.is_shared ? '#dcfce7' : '#f1f5f9',
                      color: note.share_settings.is_shared ? '#166534' : '#475569',
                      cursor: 'pointer',
                    }}
                  >
                    {note.share_settings.is_shared ? '🔗 已只读分享' : '🔒 私密'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
