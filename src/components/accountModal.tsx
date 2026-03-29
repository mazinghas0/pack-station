'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, UserPlus, Trash2, Shield } from 'lucide-react';
import { getAllUsers, createAccount, updateUserRole, deleteAccount, type UserInfo, type UserRole } from '@/lib/auth';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUsername: string;
  currentRole: UserRole;
}

export default function AccountModal({ isOpen, onClose, currentUsername, currentRole }: AccountModalProps) {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('worker');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadUsers = useCallback(async () => {
    const userList = await getAllUsers();
    setUsers(userList);
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadUsers();
      setMessage(null);
    }
  }, [isOpen, loadUsers]);

  const handleCreate = async () => {
    if (!newUsername.trim() || !newPassword.trim() || !newName.trim()) {
      setMessage({ type: 'error', text: '모든 항목을 입력해주세요.' });
      return;
    }
    const result = await createAccount(newUsername.trim(), newPassword, newName.trim(), newRole, currentUsername);
    if (result.success) {
      setMessage({ type: 'success', text: `${newName} 계정이 생성되었습니다.` });
      setNewUsername('');
      setNewPassword('');
      setNewName('');
      setNewRole('worker');
      await loadUsers();
    } else {
      setMessage({ type: 'error', text: result.error || '생성 실패' });
    }
  };

  const handleDelete = async (username: string) => {
    if (!confirm(`${username} 계정을 삭제하시겠습니까?`)) return;
    const result = await deleteAccount(username);
    if (result.success) {
      setMessage({ type: 'success', text: '계정이 삭제되었습니다.' });
      await loadUsers();
    } else {
      setMessage({ type: 'error', text: result.error || '삭제 실패' });
    }
  };

  const handleRoleChange = async (username: string, role: UserRole) => {
    const result = await updateUserRole(username, role);
    if (result.success) {
      setMessage({ type: 'success', text: '역할이 변경되었습니다.' });
      await loadUsers();
    } else {
      setMessage({ type: 'error', text: result.error || '변경 실패' });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 배경 오버레이 */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* 모달 */}
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl mx-4">
        {/* 헤더 */}
        <div className="sticky top-0 flex items-center justify-between p-5 border-b border-gray-800 bg-gray-900 rounded-t-2xl z-10">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-400" />
            계정 관리
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* 메시지 */}
          {message && (
            <div className={`p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/30' : 'bg-red-500/10 text-red-400 border border-red-500/30'}`}>
              {message.text}
            </div>
          )}

          {/* 새 계정 생성 */}
          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-green-400" />
              새 계정 생성
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="아이디"
                className="px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="비밀번호"
                className="px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
              />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="이름 (예: 홍길동)"
                className="px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 text-sm"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                className="px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-blue-500 text-sm"
              >
                <option value="worker">작업자</option>
                <option value="admin">관리자</option>
              </select>
            </div>
            <button
              onClick={handleCreate}
              className="mt-3 w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
            >
              계정 생성
            </button>
          </div>

          {/* 구분선 */}
          <hr className="border-gray-800" />

          {/* 등록된 계정 목록 */}
          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-3">
              등록된 계정 ({users.length}명)
            </h3>

            <div className="space-y-2">
              {users.map((u) => (
                <div
                  key={u.username}
                  className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 border border-gray-700/50"
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                      ${u.role === 'master' ? 'bg-yellow-500/20 text-yellow-400' : ''}
                      ${u.role === 'admin' ? 'bg-blue-500/20 text-blue-400' : ''}
                      ${u.role === 'worker' ? 'bg-gray-500/20 text-gray-400' : ''}`}
                    >
                      {u.role === 'master' ? '마스터' : u.role === 'admin' ? '관리자' : '작업자'}
                    </span>
                    <div>
                      <span className="text-white text-sm font-medium">{u.name}</span>
                      <span className="text-gray-500 text-xs ml-2">@{u.username}</span>
                    </div>
                  </div>

                  {u.role !== 'master' && currentRole === 'master' && (
                    <div className="flex items-center gap-2">
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.username, e.target.value as UserRole)}
                        className="px-2 py-1 rounded bg-gray-700 text-gray-300 text-xs border-none focus:outline-none cursor-pointer"
                      >
                        <option value="worker">작업자</option>
                        <option value="admin">관리자</option>
                      </select>
                      <button
                        onClick={() => handleDelete(u.username)}
                        className="p-1.5 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
                        title="계정 삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
