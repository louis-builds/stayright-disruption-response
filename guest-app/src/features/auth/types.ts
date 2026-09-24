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

export interface ForgotPasswordResult {
  resetLink: string;
  expiresAt: string;
}

export interface RegisterRequest {
  email: string;
  phone: string;
  nickname: string;
  gender: string;
  language: string;
  password: string;
  confirmPassword: string;
  role: "guest";
}
