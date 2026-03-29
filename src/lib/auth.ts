import {
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  query,
  where,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';

/** 사용자 역할 */
export type UserRole = 'master' | 'admin' | 'worker';

/** 사용자 정보 */
export interface UserInfo {
  id: string;
  username: string;
  role: UserRole;
  name: string;
  createdAt: unknown;
  createdBy: string;
}

/** 비밀번호 해싱 (SHA-256) */
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '_pack_station_salt_2025');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 마스터 계정 초기화 (최초 1회) */
export async function initMasterAccount(): Promise<void> {
  const masterRef = doc(db, 'users', 'mazingha');
  const masterSnap = await getDoc(masterRef);

  if (!masterSnap.exists()) {
    const masterPw = process.env.NEXT_PUBLIC_MASTER_PASSWORD;
    if (!masterPw) {
      console.error('NEXT_PUBLIC_MASTER_PASSWORD 환경변수가 설정되지 않았습니다.');
      return;
    }
    const hashedPw = await hashPassword(masterPw);
    await setDoc(masterRef, {
      id: 'mazingha',
      username: 'mazingha',
      password: hashedPw,
      role: 'master',
      name: '마스터',
      createdAt: serverTimestamp(),
      createdBy: 'system',
    });
  }
}

/** 로그인 */
export async function login(
  username: string,
  password: string
): Promise<{ success: boolean; user?: UserInfo; error?: string }> {
  try {
    const userRef = doc(db, 'users', username.toLowerCase());
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return { success: false, error: '존재하지 않는 계정입니다.' };
    }

    const userData = userSnap.data();
    const hashedPw = await hashPassword(password);

    if (userData.password !== hashedPw) {
      return { success: false, error: '비밀번호가 올바르지 않습니다.' };
    }

    const user: UserInfo = {
      id: userData.id,
      username: userData.username,
      role: userData.role,
      name: userData.name,
      createdAt: userData.createdAt,
      createdBy: userData.createdBy,
    };

    /** 세션 저장 */
    localStorage.setItem('pack_station_user', JSON.stringify(user));

    return { success: true, user };
  } catch {
    return { success: false, error: '로그인 중 오류가 발생했습니다.' };
  }
}

/** 로그아웃 */
export function logout(): void {
  localStorage.removeItem('pack_station_user');
}

/** 현재 로그인된 사용자 조회 */
export function getCurrentUser(): UserInfo | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem('pack_station_user');
  if (!stored) return null;
  try {
    return JSON.parse(stored) as UserInfo;
  } catch {
    return null;
  }
}

/** 계정 생성 (마스터/관리자만 가능) */
export async function createAccount(
  username: string,
  password: string,
  name: string,
  role: UserRole,
  createdBy: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = username.toLowerCase();
    const userRef = doc(db, 'users', userId);
    const existing = await getDoc(userRef);

    if (existing.exists()) {
      return { success: false, error: '이미 존재하는 아이디입니다.' };
    }

    const hashedPw = await hashPassword(password);

    await setDoc(userRef, {
      id: userId,
      username: userId,
      password: hashedPw,
      role,
      name,
      createdAt: serverTimestamp(),
      createdBy,
    });

    return { success: true };
  } catch {
    return { success: false, error: '계정 생성 중 오류가 발생했습니다.' };
  }
}

/** 계정 역할 변경 (마스터만 가능) */
export async function updateUserRole(
  username: string,
  newRole: UserRole
): Promise<{ success: boolean; error?: string }> {
  try {
    const userRef = doc(db, 'users', username);
    await updateDoc(userRef, { role: newRole });
    return { success: true };
  } catch {
    return { success: false, error: '역할 변경 중 오류가 발생했습니다.' };
  }
}

/** 계정 삭제 (마스터만 가능) */
export async function deleteAccount(
  username: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (username === 'mazingha') {
      return { success: false, error: '마스터 계정은 삭제할 수 없습니다.' };
    }
    const userRef = doc(db, 'users', username);
    await deleteDoc(userRef);
    return { success: true };
  } catch {
    return { success: false, error: '계정 삭제 중 오류가 발생했습니다.' };
  }
}

/** 전체 계정 목록 조회 (마스터/관리자용) */
export async function getAllUsers(): Promise<UserInfo[]> {
  const snapshot = await getDocs(collection(db, 'users'));
  return snapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: data.id,
      username: data.username,
      role: data.role,
      name: data.name,
      createdAt: data.createdAt,
      createdBy: data.createdBy,
    };
  });
}

/** 권한 체크: 관리자 페이지 접근 가능 여부 */
export function canAccessAdmin(user: UserInfo | null): boolean {
  return user?.role === 'master' || user?.role === 'admin';
}

/** 권한 체크: 계정 관리 가능 여부 */
export function canManageAccounts(user: UserInfo | null): boolean {
  return user?.role === 'master' || user?.role === 'admin';
}
