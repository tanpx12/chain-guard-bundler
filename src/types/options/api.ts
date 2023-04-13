export type ApiOptions = {
  cors: string;
  address: string;
  port: number;
  enableRequestLoggin: boolean;
};

export const defaultApiOptions: ApiOptions = {
  cors: "*",
  address: "0.0.0.0",
  port: 4337,
  enableRequestLoggin: false,
};
