export interface AuthUser {
  id: string;
  username: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface MeResponse {
  user: {
    userId: string;
    username: string;
    iat?: number;
    exp?: number;
  };
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}
