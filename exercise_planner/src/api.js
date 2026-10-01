export async function api(path, { method = "GET", body, ...options } = {}) {
  const isFile = body instanceof FormData;
  let response;
  try {
    response = await fetch("/api" + path, {
      method,
      credentials: "include",
      headers: isFile ? {} : { "Content-Type": "application/json" },
      body:
        body === undefined ? undefined : isFile ? body : JSON.stringify(body),
      ...options,
    });
  } catch {
    throw new Error(
      "Cannot connect to the API. Start the FastAPI server and try again.",
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    const error = new Error(
      Array.isArray(detail)
        ? detail.map((e) => `${e.loc.at(-1)}: ${e.msg}`).join("; ")
        : detail || "Something went wrong. Please retry.",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
export const localDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const dateObject = (day) => new Date(day + "T12:00:00");
export const labelDate = (day, opts) =>
  dateObject(day).toLocaleDateString("en-US", opts);
export const shiftDate = (day, count) => {
  const value = dateObject(day);
  value.setDate(value.getDate() + count);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};
