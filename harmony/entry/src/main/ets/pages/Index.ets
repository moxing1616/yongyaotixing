import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { i18n } from '@kit.LocalizationKit';
import { MedicationEditor } from '../components/MedicationEditor';
import { Medication, MedicationInput, MedicationRecord, Occurrence, User, emptyMedication, errorMessage, statusText } from '../model/Models';
import { api } from '../services/Api';
import { deviceServices } from '../services/DeviceServices';

@Entry
@Component
struct Index {
  @StorageLink('foregroundTick') @Watch('foregroundChanged') foregroundTick: number = 0;
  @State page: number = 0;
  @State initialized: boolean = false;
  @State busy: boolean = false;
  @State user: User | null = null;
  @State server: string = '';
  @State serverReady: boolean = false;
  @State debug: boolean = false;
  @State registering: boolean = false;
  @State email: string = '';
  @State password: string = '';
  @State name: string = '';
  @State privacyAccepted: boolean = false;
  @State error: string = '';
  @State info: string = '';
  @State safetyNotice: string = '';
  @State reminderMessage: string = '尚未启用系统提醒';
  @State remindersEnabled: boolean = false;
  @State aiEnabled: boolean = false;
  @State today: Occurrence[] = [];
  @State medications: Medication[] = [];
  @State history: MedicationRecord[] = [];
  @State editing: boolean = false;
  @State editId: string = '';
  @State draft: MedicationInput = emptyMedication();
  @State search: string = '';
  private settings: preferences.Preferences | null = null;
  private refreshTimer: number = -1;

  aboutToAppear(): void { this.initialize(); }
  aboutToDisappear(): void {
    if (this.refreshTimer !== -1) clearInterval(this.refreshTimer);
  }

  private context(): common.UIAbilityContext {
    return this.getUIContext().getHostContext() as common.UIAbilityContext;
  }

  private async initialize(): Promise<void> {
    api.onUnauthorized = async (): Promise<void> => { await this.expireSession(); };
    try {
      this.debug = this.context().applicationInfo.debug;
      this.settings = await preferences.getPreferences(this.context(), { name: 'medication_settings' });
      this.server = await this.settings.get('server', '') as string;
      this.remindersEnabled = await this.settings.get('remindersEnabled', false) as boolean;
      if (this.server) {
        api.configure(this.server, this.debug);
        this.serverReady = true;
      }
      if (this.remindersEnabled) this.reminderMessage = '设备保留上次同步的提醒；登录后更新计划。';
      this.refreshTimer = setInterval(() => {
        if (this.user && !this.busy && !this.editing) this.run(async (): Promise<void> => { await this.refresh(); });
      }, 60000);
    } catch (error) { this.error = errorMessage(error as Error); }
    finally { this.initialized = true; }
  }

  private foregroundChanged(): void {
    if (this.initialized && this.user && !this.busy && !this.editing) {
      this.run(async (): Promise<void> => { await this.refresh(); });
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.info = '';
    try { await action(); }
    catch (error) {
      this.error = errorMessage(error as Error);
    } finally { this.busy = false; }
  }

  private resetUser(): void {
    api.forgetSession();
    this.user = null;
    this.editing = false;
    this.today = [];
    this.medications = [];
    this.history = [];
  }

  private async expireSession(): Promise<void> {
    this.resetUser();
    try {
      await deviceServices.clear();
      this.reminderMessage = '登录失效，设备提醒已清理。';
    } catch {
      this.safetyNotice = '登录已失效，但旧提醒未能清理；请在系统设置中关闭本应用通知。';
    }
  }

  private async saveServer(): Promise<void> {
    api.configure(this.server, this.debug);
    this.serverReady = false;
    await api.config();
    await deviceServices.clear();
    if (this.settings) {
      await this.settings.put('server', api.base);
      await this.settings.flush();
    }
    this.server = api.base;
    this.serverReady = true;
    this.info = '服务器已连接，可以登录。';
  }

  private async authenticate(): Promise<void> {
    if (!this.serverReady) throw new Error('请先连接服务器。');
    if (!this.privacyAccepted) throw new Error('请先阅读并同意下方数据使用说明。');
    if (!this.email.trim() || !this.password) throw new Error('请填写邮箱和密码。');
    const user = this.registering
      ? await api.register(this.email.trim(), this.password, this.name.trim(), i18n.getTimeZone().getID())
      : await api.login(this.email.trim(), this.password);
    this.password = '';
    try { await deviceServices.clear(); }
    catch {
      try { await api.logout(); } catch { api.forgetSession(); }
      throw new Error('无法清理设备旧提醒，暂未进入新账号。请在系统设置中检查本应用通知后重试。');
    }
    this.safetyNotice = '';
    this.user = user;
    this.page = 0;
    await this.refresh();
  }

  private accountDate(offsetDays: number = 0): string {
    const timeZone = this.user ? this.user.timeZone : 'Asia/Shanghai';
    const calendar = i18n.getCalendar('zh-Hans', 'gregory');
    calendar.setTimeZone(timeZone);
    calendar.setTime(new Date());
    const day = new Date(Date.UTC(calendar.get('year'), calendar.get('month'), calendar.get('date'), 12));
    day.setUTCDate(day.getUTCDate() + offsetDays);
    return day.toISOString().slice(0, 10);
  }

  private async refresh(): Promise<void> {
    const today = await api.today();
    const medications = await api.medications();
    const records = await api.records(this.accountDate(-29), this.accountDate());
    const config = await api.config();
    this.today = today;
    this.medications = medications;
    this.history = records;
    this.aiEnabled = config.aiEnabled;
    await this.syncReminders();
  }

  private async syncReminders(): Promise<void> {
    if (!this.remindersEnabled) return;
    try {
      const plan = await api.reminders();
      const count = await deviceServices.sync(plan);
      const last = plan.items.length > 0 ? plan.items[plan.items.length - 1].at : '';
      this.reminderMessage = count > 0
        ? `已同步 ${count} 条提醒，最晚至 ${new Date(last).toLocaleString()}。${plan.hasMore ? '其余提醒需再次打开 App 补充。' : '请定期打开 App 更新后续计划。'}`
        : '未来 7 天没有需要提醒的任务。';
    } catch (error) {
      this.reminderMessage = `提醒同步未完成：${errorMessage(error as Error)}`;
    }
  }

  private async toggleReminders(): Promise<void> {
    if (this.remindersEnabled) {
      await deviceServices.clear();
      this.remindersEnabled = false;
      this.reminderMessage = '系统提醒已关闭。';
    } else {
      await deviceServices.enable(this.context());
      this.remindersEnabled = true;
      await this.syncReminders();
    }
    if (this.settings) {
      await this.settings.put('remindersEnabled', this.remindersEnabled);
      await this.settings.flush();
    }
  }

  private async logout(): Promise<void> {
    let serverRevoked = false;
    try { await api.logout(); serverRevoked = true; }
    finally {
      this.resetUser();
      try {
        await deviceServices.clear();
        this.reminderMessage = '已退出，设备上的提醒已清理。';
      } catch {
        this.safetyNotice = '本机已退出，但旧提醒未能清理；请在系统设置中关闭本应用通知。';
      }
      this.info = serverRevoked ? '已退出登录。' : '本机已退出；服务器会话未确认注销，将在有效期结束后失效。';
    }
  }

  private newMedication(): void {
    this.editId = '';
    const draft = emptyMedication();
    draft.startDate = this.accountDate();
    this.draft = draft;
    this.editing = true;
  }

  private editMedication(item: Medication): void {
    this.editId = item.id;
    this.draft = {
      name: item.name, specification: item.specification, expiryDate: item.expiryDate,
      instructions: item.instructions, dose: item.dose, times: item.times.slice(), startDate: item.startDate,
      endDate: item.endDate, notes: item.notes, color: item.color
    };
    this.editing = true;
  }

  private async saveMedication(input: MedicationInput): Promise<void> {
    await api.saveMedication(input, this.editId);
    this.editing = false;
    await this.run(async (): Promise<void> => {
      await deviceServices.clear();
      await this.refresh();
      this.info = '药品已保存。';
    });
  }

  private async record(item: Occurrence, status: string): Promise<void> {
    await api.record(item, status);
    await deviceServices.clear();
    await this.refresh();
    this.info = status === 'snoozed' ? '已延后 15 分钟。' : '服药记录已保存。';
  }

  private confirmArchive(item: Medication): void {
    this.getUIContext().showAlertDialog({
      title: '归档药品', message: `将停止“${item.name}”的后续提醒，历史记录会保留。`,
      primaryButton: { value: '取消', action: (): void => {} },
      secondaryButton: { value: '确认归档', action: (): void => {
        this.run(async (): Promise<void> => {
          await api.archive(item.id);
          await deviceServices.clear();
          await this.refresh();
          this.info = '药品已归档。';
        });
      } }
    });
  }

  private expiring(item: Medication): boolean {
    if (!item.expiryDate) return false;
    return item.expiryDate <= this.accountDate(30);
  }

  @Builder
  serverForm() {
    Column({ space: 12 }) {
      Text('连接您的服务器').fontSize(18).fontWeight(FontWeight.Medium).width('100%')
      Text('填写运行服药提醒后台的地址。账号和药品数据将保存在该服务器。').fontSize(13).fontColor('#687465').width('100%')
      TextInput({ text: this.server, placeholder: 'https://api.example.com' }).type(InputType.Normal)
        .onChange((value: string) => { this.server = value; this.serverReady = false; })
      Button('连接并保存').width('100%').backgroundColor('#315838').enabled(!this.busy)
        .onClick(() => { this.run(async (): Promise<void> => { await this.saveServer(); }); })
      if (this.debug) {
        Text('调试版可填写电脑局域网地址，如 http://192.168.1.10:3001；手机上的 localhost 指手机本身。')
          .fontSize(12).fontColor('#687465')
      }
    }.padding(20).backgroundColor(Color.White).borderRadius(20).width('100%')
  }

  @Builder
  authView() {
    Scroll() {
      Column({ space: 18 }) {
        Image($r('app.media.app_icon')).width(72).height(72).borderRadius(20).margin({ top: 24 })
        Text('让每一次服药，都有记录').fontSize(25).fontWeight(FontWeight.Bold).fontColor('#263E2D')
        Text('服药提醒智能体 · 鸿蒙版').fontSize(14).fontColor('#687465')
        this.serverForm()
        Column({ space: 12 }) {
          Text(this.registering ? '创建账号' : '登录您的药箱').fontSize(22).fontWeight(FontWeight.Medium).width('100%')
          TextInput({ text: this.email, placeholder: '邮箱' }).type(InputType.Email).maxLength(254)
            .onChange((value: string) => { this.email = value; })
          TextInput({ text: this.password, placeholder: '密码（至少 8 位）' }).type(InputType.Password).maxLength(128)
            .onChange((value: string) => { this.password = value; })
          if (this.registering) {
            TextInput({ text: this.name, placeholder: '称呼' }).maxLength(60).onChange((value: string) => { this.name = value; })
          }
          Text('邮箱和密码用于登录；药品、服药记录与通知计划保存在您选择的服务器。药盒照片仅在单独同意识别后发送至配置的 AI 服务。本 App 不保存登录密码，冷启动需重新登录。')
            .fontSize(12).fontColor('#687465').lineHeight(20)
          Row() {
            Checkbox().select(this.privacyAccepted).onChange((value: boolean) => { this.privacyAccepted = value; })
            Text('我已阅读并同意上述数据使用说明').fontSize(13).layoutWeight(1)
          }.width('100%')
          Button(this.busy ? '处理中…' : (this.registering ? '注册并登录' : '登录')).width('100%').height(48)
            .backgroundColor('#315838').enabled(this.serverReady && this.privacyAccepted && !this.busy)
            .onClick(() => { this.run(async (): Promise<void> => { await this.authenticate(); }); })
          Button(this.registering ? '已有账号，去登录' : '没有账号？注册').backgroundColor(Color.Transparent).fontColor('#315838')
            .enabled(!this.busy).onClick(() => { this.registering = !this.registering; this.error = ''; })
        }.padding(20).backgroundColor(Color.White).borderRadius(20).width('100%')
      }.padding(20).width('100%').constraintSize({ maxWidth: 640 })
    }.layoutWeight(1).width('100%')
  }

  @Builder
  emptyState(title: string, body: string) {
    Column({ space: 10 }) {
      Text(title).fontSize(20).fontWeight(FontWeight.Medium).fontColor('#315838')
      Text(body).fontSize(14).fontColor('#687465').textAlign(TextAlign.Center)
    }.padding(32).width('100%').backgroundColor(Color.White).borderRadius(20)
  }

  @Builder
  todayView() {
    Column({ space: 14 }) {
      Text('今天，好好照顾自己').fontSize(26).fontWeight(FontWeight.Bold).width('100%')
      Text(`${this.today.filter((item: Occurrence) => item.status === 'taken').length} 次已服用 · ${this.today.filter((item: Occurrence) => item.status === 'pending' || item.status === 'snoozed').length} 次待处理`)
        .fontSize(15).fontColor('#687465').width('100%')
      Button('＋ 添加药品').width('100%').height(46).backgroundColor('#315838').enabled(!this.busy).onClick(() => this.newMedication())
      if (this.today.length === 0) { this.emptyState('今天暂无服药任务', '添加药品并确认用量与时间后，会出现在这里。') }
      ForEach(this.today, (item: Occurrence) => {
        Column({ space: 10 }) {
          Row() {
            Text(item.time).fontSize(26).fontWeight(FontWeight.Bold).fontColor('#315838').layoutWeight(1)
            Text(statusText(item.status)).fontSize(13).fontColor('#687465')
          }.width('100%')
          Text(item.medication.name).fontSize(20).fontWeight(FontWeight.Medium).width('100%')
          Text(`${item.medication.dose}  ·  ${item.medication.specification}`).fontSize(14).fontColor('#687465').width('100%')
          if (item.medication.expiryDate && item.medication.expiryDate < this.accountDate()) {
            Text('药品已过期，请核查；不要按提醒继续服用。').fontSize(14).fontColor('#A13E32').width('100%')
          }
          if (item.snoozedUntil && item.status === 'snoozed') {
            Text(`延后至 ${new Date(item.snoozedUntil).toLocaleString()}`).fontSize(13).fontColor('#876831').width('100%')
          }
          if (item.status === 'pending' || item.status === 'snoozed') {
            Row({ space: 8 }) {
              Button('已服用').layoutWeight(1).backgroundColor('#315838').fontSize(14)
                .onClick(() => { this.run(async (): Promise<void> => { await this.record(item, 'taken'); }); })
              Button('延后').layoutWeight(1).backgroundColor('#E9EEDE').fontColor('#315838').fontSize(14)
                .onClick(() => { this.run(async (): Promise<void> => { await this.record(item, 'snoozed'); }); })
              Button('跳过').layoutWeight(1).backgroundColor('#F1F1EB').fontColor('#687465').fontSize(14)
                .onClick(() => { this.run(async (): Promise<void> => { await this.record(item, 'skipped'); }); })
            }.width('100%').enabled(!this.busy)
          }
        }.padding(18).width('100%').backgroundColor(Color.White).borderRadius(18)
      }, (item: Occurrence) => item.id)
    }.width('100%')
  }

  @Builder
  medicationsView() {
    Column({ space: 14 }) {
      Text('我的药箱').fontSize(26).fontWeight(FontWeight.Bold).width('100%')
      TextInput({ text: this.search, placeholder: '搜索药品名称' }).onChange((value: string) => { this.search = value; })
      Button('＋ 添加药品').width('100%').backgroundColor('#315838').enabled(!this.busy).onClick(() => this.newMedication())
      if (this.medications.length === 0) { this.emptyState('药箱还是空的', '拍照识别或手动添加第一种药品。') }
      ForEach(this.medications.filter((item: Medication) => item.name.includes(this.search)), (item: Medication) => {
        Column({ space: 9 }) {
          Text(item.name).fontSize(20).fontWeight(FontWeight.Medium).width('100%')
          Text(item.specification || '未填写规格').fontSize(14).fontColor('#687465').width('100%')
          Text(`${item.dose} · ${item.times.join(' / ')}`).fontSize(14).width('100%')
          Text(item.expiryDate ? `有效期至 ${item.expiryDate}${this.expiring(item) ? ' · 请核查有效期' : ''}` : '有效期尚未填写')
            .fontSize(13).fontColor(this.expiring(item) ? '#A13E32' : '#687465').width('100%')
          Row({ space: 12 }) {
            Button('编辑').layoutWeight(1).backgroundColor('#E9EEDE').fontColor('#315838').onClick(() => this.editMedication(item))
            Button('归档').layoutWeight(1).backgroundColor('#F1F1EB').fontColor('#687465').onClick(() => this.confirmArchive(item))
          }.width('100%').enabled(!this.busy)
        }.padding(18).backgroundColor(Color.White).borderRadius(18).width('100%')
      }, (item: Medication) => item.id)
    }.width('100%')
  }

  @Builder
  historyView() {
    Column({ space: 14 }) {
      Text('服药记录').fontSize(26).fontWeight(FontWeight.Bold).width('100%')
      Text('最近 30 天 · 与网站共享记录').fontSize(14).fontColor('#687465').width('100%')
      if (this.history.length === 0) { this.emptyState('还没有服药记录', '在今日列表完成一次操作后，记录会出现在这里。') }
      ForEach(this.history, (item: MedicationRecord) => {
        Column({ space: 8 }) {
          Row() {
            Text(item.medicationName).fontSize(18).fontWeight(FontWeight.Medium).layoutWeight(1)
            Text(statusText(item.status)).fontColor('#315838').fontSize(14)
          }.width('100%')
          Text(`${item.date} ${item.time} · ${item.dose}`).fontSize(14).fontColor('#687465').width('100%')
        }.padding(18).backgroundColor(Color.White).borderRadius(16).width('100%')
      }, (item: MedicationRecord) => item.id)
    }.width('100%')
  }

  @Builder
  settingsView() {
    Column({ space: 18 }) {
      Text('设置').fontSize(26).fontWeight(FontWeight.Bold).width('100%')
      Column({ space: 10 }) {
        Text(this.user ? this.user.name : '').fontSize(20).fontWeight(FontWeight.Medium).width('100%')
        Text(this.user ? this.user.email : '').fontSize(14).fontColor('#687465').width('100%')
        Text(`计划时区：${this.user ? this.user.timeZone : ''}`).fontSize(13).width('100%')
        Text(`服务器：${api.base}`).fontSize(13).fontColor('#687465').width('100%')
        Text('更换服务器前请先退出登录。').fontSize(12).fontColor('#687465').width('100%')
      }.padding(20).backgroundColor(Color.White).borderRadius(18).width('100%')
      Column({ space: 12 }) {
        Text('系统服药提醒').fontSize(20).fontWeight(FontWeight.Medium).width('100%')
        Text(this.reminderMessage).fontSize(14).lineHeight(22).width('100%')
        Button(this.remindersEnabled ? '关闭系统提醒' : '开启系统提醒').width('100%').backgroundColor('#315838').enabled(!this.busy)
          .onClick(() => { this.run(async (): Promise<void> => { await this.toggleReminders(); }); })
        Text('每次同步未来 7 天中最早的 30 条提醒。App 关闭后，系统按已同步计划提醒；请定期打开 App 补充后续任务。网站修改计划后，也需打开 App 同步，才能撤销设备上的旧提醒。')
          .fontSize(12).lineHeight(20).fontColor('#687465').width('100%')
        Text('通知可能显示药品名称与用量，请留意锁屏隐私设置。点击通知进入 App，核对最新计划后记录；关闭通知不代表已服药。')
          .fontSize(12).lineHeight(20).fontColor('#687465').width('100%')
      }.padding(20).backgroundColor(Color.White).borderRadius(18).width('100%')
      Button('退出登录').width('100%').backgroundColor('#F1E3DD').fontColor('#963F31').enabled(!this.busy)
        .onClick(() => { this.run(async (): Promise<void> => { await this.logout(); }); })
      Text('源码公开 · 非商业使用\n服药提醒智能体 1.0.0').fontSize(12).fontColor('#687465').textAlign(TextAlign.Center)
    }.width('100%')
  }

  build() {
    Column() {
      if (this.editing) {
        MedicationEditor({ initial: this.draft, editing: this.editId.length > 0, aiEnabled: this.aiEnabled,
          onSave: async (input: MedicationInput): Promise<void> => { await this.saveMedication(input); },
          onCancel: (): void => { this.editing = false; } })
      } else {
        if (this.error) { Text(this.error).fontSize(14).fontColor('#A13E32').padding(12).width('100%').backgroundColor('#FFF0EA') }
        if (this.safetyNotice) { Text(this.safetyNotice).fontSize(14).fontColor('#A13E32').padding(12).width('100%').backgroundColor('#FFF0EA') }
        if (this.info) { Text(this.info).fontSize(14).fontColor('#315838').padding(12).width('100%').backgroundColor('#E9EEDE') }
        if (!this.initialized) {
          LoadingProgress().width(40).height(40).margin(40)
        } else if (!this.user) {
          this.authView()
        } else {
          Row() {
            Text('服药提醒智能体').fontSize(16).fontWeight(FontWeight.Medium).fontColor('#315838').layoutWeight(1)
            Button(this.busy ? '同步中…' : '刷新').backgroundColor(Color.Transparent).fontColor('#315838').enabled(!this.busy)
              .onClick(() => { this.run(async (): Promise<void> => { await this.refresh(); }); })
          }.padding({ left: 20, right: 12, top: 8, bottom: 8 }).width('100%')
          Scroll() {
            Column() {
              if (this.page === 0) { this.todayView() }
              else if (this.page === 1) { this.medicationsView() }
              else if (this.page === 2) { this.historyView() }
              else { this.settingsView() }
            }.padding({ left: 20, right: 20, top: 8, bottom: 24 }).width('100%').constraintSize({ maxWidth: 720 })
          }.layoutWeight(1).width('100%')
          Row() {
            ForEach(['今日', '药箱', '记录', '设置'], (label: string, index: number) => {
              Button(label).type(ButtonType.Normal).layoutWeight(1).height(56).borderRadius(0)
                .backgroundColor(this.page === index ? '#E5EBDD' : Color.White)
                .fontColor(this.page === index ? '#315838' : '#687465')
                .onClick(() => { this.page = index; })
            }, (label: string) => label)
          }.width('100%')
        }
      }
    }.height('100%').width('100%').backgroundColor('#F5F6F1')
  }
}
