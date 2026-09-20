export interface UpdateProfilePayload {
  nickname: string;
  gender: string;
  language: string;
  phone: string;
  avatarUrl?: string;
}

export interface EmailChangeRequested {
  devCode: string;
}
