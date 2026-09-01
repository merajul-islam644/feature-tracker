import { toast } from "sonner";

type ToastType = "success" | "error" | "info";

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  dismiss: (id?: string | number) => void;
}

const api: ToastApi = {
  success: (message) => toast.success(message),
  error: (message) => toast.error(message),
  info: (message) => toast.info(message),
  dismiss: (id) => toast.dismiss(id),
};

export function useToast(): ToastApi {
  return api;
}
