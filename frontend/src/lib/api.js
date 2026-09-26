const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';

class APIError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let accessToken = null;

export const setAccessToken = (token) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

async function request(endpoint, options = {}, isRetry = false) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const config = {
    ...options,
    headers,
    credentials: 'include', // Important for cookies
  };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const response = await fetch(url, config);
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (response.status === 401 && !isRetry && endpoint !== '/auth/refresh' && endpoint !== '/auth/login') {
    // Attempt refresh
    try {
      const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
      const refreshData = await refreshRes.json();
      if (refreshRes.ok && refreshData.success) {
        setAccessToken(refreshData.data.accessToken);
        // Retry original request
        return request(endpoint, options, true);
      } else {
        setAccessToken(null);
        // Dispatch event so UI can redirect
        window.dispatchEvent(new Event('auth:unauthorized'));
      }
    } catch {
      setAccessToken(null);
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
  }

  if (!response.ok) {
    throw new APIError(data?.message || 'An API error occurred', response.status, data);
  }

  return data;
}

export const api = {
  get: (endpoint, options) => request(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options) => request(endpoint, { ...options, method: 'POST', body }),
  put: (endpoint, body, options) => request(endpoint, { ...options, method: 'PUT', body }),
  patch: (endpoint, body, options) => request(endpoint, { ...options, method: 'PATCH', body }),
  delete: (endpoint, options) => request(endpoint, { ...options, method: 'DELETE' }),
};
