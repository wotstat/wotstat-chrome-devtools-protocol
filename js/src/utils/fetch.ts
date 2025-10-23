
export function fetch(url: string, options?: RequestInit) {

  const xhr = new XMLHttpRequest();
  xhr.open(options?.method || "GET", url, true);

  if (options?.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      xhr.setRequestHeader(key, value as string);
    }
  }

  return new Promise<{ status: number; data: any }>((resolve, reject) => {
    xhr.onload = () => {
      const contentType = xhr.getResponseHeader("Content-Type") || "";
      let data: any = xhr.responseText;

      if (contentType.includes("application/json")) {
        try {
          data = JSON.parse(xhr.responseText);
        } catch (e) {
          return reject(new Error("Failed to parse JSON response"));
        }
      }

      resolve({ status: xhr.status, data });
    };

    xhr.onerror = () => {
      reject(new Error("Network error"));
    };

    if (options?.body) {
      xhr.send(options.body as any);
    } else {
      xhr.send();
    }
  });
}