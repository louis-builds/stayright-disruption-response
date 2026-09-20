export interface AuthUser {
  id: string;
  nickname: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  homeRoute: string;
  gender: string;
  language: string;
  phone: string;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface LoginRequest {
  identifier: string;
  password: string;
  rememberMe: boolean;
}
