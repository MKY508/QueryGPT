export function getApiErrorMessage(error: unknown, fallback: string): string {
  const axiosError = error as {
    response?: {
      data?: {
        error?: {
          message?: string;
        };
      };
    };
  };
  return axiosError.response?.data?.error?.message || fallback;
}

export function downloadJsonFile(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
