let token = '';
export const setToken = value => { token = value; };

const offline = 'O programa não respondeu. Confira se a janela do Criador de capas continua aberta.';

export async function api(url, { method = 'GET', json, form } = {}) {
  const headers = {};
  if (method !== 'GET') headers['x-local-token'] = token;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  else if (form) body = form;
  let response;
  try { response = await fetch(url, { method, headers, body }); }
  catch { throw new Error(offline); }
  const data = (response.headers.get('content-type') || '').includes('json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `O programa recusou a operação (${response.status}).`);
  return data;
}

// XHR instead of fetch: it reports upload progress for large ZIPs.
export function upload(url, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('x-local-token', token);
    xhr.responseType = 'json';
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => xhr.status < 300 ? resolve(xhr.response) : reject(new Error(xhr.response?.error || `O programa recusou os arquivos (${xhr.status}).`));
    xhr.onerror = () => reject(new Error(offline));
    xhr.send(form);
  });
}

export function stream(url, handlers) {
  const source = new EventSource(url);
  for (const [type, fn] of Object.entries(handlers)) source.addEventListener(type, e => fn(JSON.parse(e.data)));
  return () => source.close();
}

export function download(url) {
  const a = document.createElement('a');
  a.href = url; a.download = '';
  document.body.append(a); a.click(); a.remove();
}
