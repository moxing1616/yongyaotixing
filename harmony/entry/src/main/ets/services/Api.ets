import { http } from '@kit.NetworkKit';
import { AuthResult, Medication, MedicationInput, MedicationRecord, Occurrence, Recognition, ReminderPlan, ServerConfig, User } from '../model/Models';
import { serverAddress } from '../model/ServerAddress';

interface Envelope<T> { data: T; error?: string; }
interface LoginBody { email: string; password: string; }
interface RegisterBody extends LoginBody { name: string; timeZone: string; }
interface RecordBody { medicationId: string; date: string; time: string; status: string; }
interface ImageBody { image: string; }
interface Success { ok: boolean; }

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

class Api {
  base: string = '';
  onUnauthorized: () => Promise<void> = async (): Promise<void> => {};
  private token: string = '';

  configure(address: string, debug: boolean): void {
    this.base = serverAddress(address, debug);
    this.token = '';
  }

  forgetSession(): void { this.token = ''; }

  private async request<T>(path: string, method: http.RequestMethod = http.RequestMethod.GET,
    body: string = ''): Promise<T> {
    if (!this.base) throw new ApiError('请先设置服务器地址。', 0);
    const request = http.createHttp();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    try {
      const response = await request.request(`${this.base}/api${path}`, {
        method: method, header: headers, extraData: body,
        expectDataType: http.HttpDataType.STRING, connectTimeout: 15000, readTimeout: 45000,
        usingCache: false
      });
      let envelope: Envelope<T>;
      try { envelope = JSON.parse(response.result as string) as Envelope<T>; }
      catch { throw new ApiError('服务器未返回有效数据，请核对地址。', response.responseCode); }
      if (response.responseCode < 200 || response.responseCode >= 300) {
        if (response.responseCode === 401 && this.token) {
          this.forgetSession();
          await this.onUnauthorized();
        }
        throw new ApiError(envelope.error || '请求未完成，请稍后重试。', response.responseCode);
      }
      return envelope.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('无法连接服务器，请检查网络、地址及 HTTPS 证书。', 0);
    } finally { request.destroy(); }
  }

  async login(email: string, password: string): Promise<User> {
    const body: LoginBody = { email: email, password: password };
    const result = await this.request<AuthResult>('/native/auth/login', http.RequestMethod.POST, JSON.stringify(body));
    this.token = result.accessToken;
    return result.user;
  }

  async register(email: string, password: string, name: string, timeZone: string): Promise<User> {
    const body: RegisterBody = { email: email, password: password, name: name, timeZone: timeZone };
    const result = await this.request<AuthResult>('/native/auth/register', http.RequestMethod.POST, JSON.stringify(body));
    this.token = result.accessToken;
    return result.user;
  }

  async logout(): Promise<void> {
    await this.request<Success>('/auth/logout', http.RequestMethod.POST, '{}');
    this.forgetSession();
  }

  me(): Promise<User> { return this.request<User>('/auth/me'); }
  config(): Promise<ServerConfig> { return this.request<ServerConfig>('/config'); }
  today(): Promise<Occurrence[]> { return this.request<Occurrence[]>('/today'); }
  medications(): Promise<Medication[]> { return this.request<Medication[]>('/medications'); }
  reminders(): Promise<ReminderPlan> { return this.request<ReminderPlan>('/native/reminders'); }
  records(from: string, to: string): Promise<MedicationRecord[]> {
    return this.request<MedicationRecord[]>(`/records?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }
  saveMedication(body: MedicationInput, id: string = ''): Promise<Medication> {
    return this.request<Medication>(id ? `/medications/${encodeURIComponent(id)}` : '/medications',
      id ? http.RequestMethod.PUT : http.RequestMethod.POST, JSON.stringify(body));
  }
  async archive(id: string): Promise<void> {
    await this.request<Success>(`/medications/${encodeURIComponent(id)}`, http.RequestMethod.DELETE);
  }
  record(item: Occurrence, status: string): Promise<Occurrence> {
    const body: RecordBody = { medicationId: item.medicationId, date: item.date, time: item.time, status: status };
    return this.request<Occurrence>('/records', http.RequestMethod.POST, JSON.stringify(body));
  }
  recognize(image: string): Promise<Recognition> {
    const body: ImageBody = { image: image };
    return this.request<Recognition>('/recognize', http.RequestMethod.POST, JSON.stringify(body));
  }
}

export const api = new Api();
