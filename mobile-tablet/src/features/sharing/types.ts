// 仅展示服务端返回的状态；实际访问控制由 A 实现。
export interface ShareState {
  note_id: string
  status: 'private' | 'active' | 'revoked' | 'expired'
  mode: 'named_users' | 'expiring_link' | null
  expires_at: string | null
  owner_reviewed: boolean
}
