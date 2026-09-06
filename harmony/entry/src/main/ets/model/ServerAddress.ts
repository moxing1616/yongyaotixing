// Also exercised directly by the Node test runner. No device APIs required.
export function serverAddress(input: string, debug: boolean): string {
  const value = input.trim().replace(/\/+$/, '');
  const match = /^(https?):\/\/([a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?$/.exec(value);
  if (!match) throw new Error('请填写完整服务器地址，例如 https://api.example.com，不包含路径。');
  const host = match[2].toLowerCase();
  const port = match[3] ? Number(match[3]) : 443;
  if (port < 1 || port > 65535 || host.includes('..') || host.startsWith('.') || host.endsWith('.')) {
    throw new Error('服务器地址或端口不正确。');
  }
  if (match[1] === 'http') {
    const parts = host.split('.');
    const ipv4 = parts.length === 4 && parts.every((part: string) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
    const local = host === 'localhost' || (ipv4 && (parts[0] === '127' || parts[0] === '10' ||
      (parts[0] === '192' && parts[1] === '168') || (parts[0] === '172' && Number(parts[1]) >= 16 && Number(parts[1]) <= 31)));
    if (!debug || !local) throw new Error('正式服务必须使用 HTTPS；调试版仅允许局域网 HTTP。');
  }
  return value;
}
