import { common } from '@kit.AbilityKit';
import { MedicationInput, emptyMedication, errorMessage } from '../model/Models';
import { api } from '../services/Api';
import { deviceServices } from '../services/DeviceServices';

@Component
export struct MedicationEditor {
  initial: MedicationInput = emptyMedication();
  editing: boolean = false;
  aiEnabled: boolean = false;
  onSave: (input: MedicationInput) => Promise<void> = async (_input: MedicationInput): Promise<void> => {};
  onCancel: () => void = (): void => {};
  @State name: string = '';
  @State specification: string = '';
  @State expiryDate: string = '';
  @State instructions: string = '';
  @State dose: string = '';
  @State times: string = '08:00';
  @State startDate: string = '';
  @State endDate: string = '';
  @State notes: string = '';
  @State photoUri: string = '';
  @State warnings: string = '';
  @State error: string = '';
  @State uploadingConsent: boolean = false;
  @State confirmed: boolean = false;
  @State busy: boolean = false;

  aboutToAppear(): void {
    this.name = this.initial.name;
    this.specification = this.initial.specification;
    this.expiryDate = this.initial.expiryDate;
    this.instructions = this.initial.instructions;
    this.dose = this.initial.dose;
    this.times = this.initial.times.join(', ');
    this.startDate = this.initial.startDate;
    this.endDate = this.initial.endDate;
    this.notes = this.initial.notes;
  }

  private async selectPhoto(camera: boolean): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      const uri = await deviceServices.pickPhoto(this.getUIContext().getHostContext() as common.UIAbilityContext, camera);
      if (uri) {
        this.photoUri = uri;
        this.uploadingConsent = false;
        this.confirmed = false;
      }
    } catch (error) { this.error = errorMessage(error as Error); }
    finally { this.busy = false; }
  }

  private async recognize(): Promise<void> {
    if (!this.photoUri || !this.uploadingConsent || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      const image = await deviceServices.imageDataUrl(this.photoUri);
      const result = await api.recognize(image);
      this.name = result.name;
      this.specification = result.specification;
      this.expiryDate = result.expiryDate;
      this.instructions = result.instructions;
      this.warnings = result.warnings.join('\n');
      this.confirmed = false;
    } catch (error) { this.error = errorMessage(error as Error); }
    finally { this.busy = false; }
  }

  private async save(): Promise<void> {
    if (this.busy) return;
    this.error = '';
    if (!this.confirmed) { this.error = '请先核对药品信息和服药计划。'; return; }
    if (!this.name.trim() || !this.dose.trim()) { this.error = '请填写药品名称和每次用量。'; return; }
    const timeList = this.times.split(/[,，、\s]+/).filter((time: string) => time.length > 0);
    if (timeList.length < 1 || timeList.length > 8 || timeList.some((time: string) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
      this.error = '请填写 1–8 个 HH:mm 时间，例如 08:00, 20:00。'; return;
    }
    const input: MedicationInput = {
      name: this.name, specification: this.specification, expiryDate: this.expiryDate,
      instructions: this.instructions, dose: this.dose, times: timeList,
      startDate: this.startDate, endDate: this.endDate, notes: this.notes, color: this.initial.color
    };
    this.busy = true;
    try { await this.onSave(input); }
    catch (error) { this.error = errorMessage(error as Error); }
    finally { this.busy = false; }
  }

  @Builder
  fieldLabel(label: string) {
    Text(label).fontSize(14).fontColor('#546254').width('100%').margin({ top: 12, bottom: 6 })
  }

  build() {
    Column() {
      Row() {
        Text(this.editing ? '编辑药品' : '新增药品').fontSize(24).fontWeight(FontWeight.Bold).layoutWeight(1)
        Button('返回').type(ButtonType.Normal).backgroundColor('#E5EBDD').fontColor('#315838')
          .enabled(!this.busy).onClick(() => this.onCancel())
      }.width('100%').padding(20)
      Scroll() {
        Column({ space: 10 }) {
          Text('拍下药盒，核对后再保存').fontSize(18).fontWeight(FontWeight.Medium).width('100%')
          Row({ space: 12 }) {
            Button('拍照').layoutWeight(1).backgroundColor('#315838').enabled(!this.busy)
              .onClick(() => { this.selectPhoto(true); })
            Button('从相册选择').layoutWeight(1).backgroundColor('#E5EBDD').fontColor('#315838').enabled(!this.busy)
              .onClick(() => { this.selectPhoto(false); })
          }.width('100%')
          if (this.photoUri) {
            Image(this.photoUri).height(180).width('100%').objectFit(ImageFit.Contain).borderRadius(12)
            Row() {
              Checkbox().select(this.uploadingConsent).onChange((value: boolean) => { this.uploadingConsent = value; })
              Text('同意将此照片发送至所配置的 AI 服务进行文字识别。').fontSize(13).layoutWeight(1)
            }.width('100%')
            Button(this.busy ? '处理中…' : 'AI 识别药品').width('100%').backgroundColor('#315838')
              .enabled(this.aiEnabled && this.uploadingConsent && !this.busy).onClick(() => { this.recognize(); })
          }
          if (!this.aiEnabled) {
            Text('AI 服务尚未连接，可先手动填写。').fontSize(13).fontColor('#7B6437').width('100%')
          }
          if (this.warnings) {
            Text(this.warnings).fontSize(14).fontColor('#8F522F').padding(12).backgroundColor('#FFF3DE').width('100%')
          }
          this.fieldLabel('药品名称 *')
          TextInput({ text: this.name, placeholder: '核对包装上的完整名称' }).maxLength(120)
            .onChange((value: string) => { this.name = value; this.confirmed = false; })
          this.fieldLabel('规格')
          TextInput({ text: this.specification, placeholder: '例如 10mg × 20片' }).maxLength(200)
            .onChange((value: string) => { this.specification = value; this.confirmed = false; })
          this.fieldLabel('有效期（选填，YYYY-MM-DD）')
          TextInput({ text: this.expiryDate, placeholder: '未确认具体日期时请留空' }).maxLength(10)
            .onChange((value: string) => { this.expiryDate = value; this.confirmed = false; })
          this.fieldLabel('包装说明')
          TextArea({ text: this.instructions, placeholder: '识别结果可以修正' }).height(100).maxLength(6000)
            .onChange((value: string) => { this.instructions = value; this.confirmed = false; })
          this.fieldLabel('每次用量 *')
          TextInput({ text: this.dose, placeholder: '按医嘱或已确认的用药计划填写' }).maxLength(120)
            .onChange((value: string) => { this.dose = value; this.confirmed = false; })
          this.fieldLabel('每日服药时间 *')
          TextInput({ text: this.times, placeholder: '08:00, 20:00' }).maxLength(64)
            .onChange((value: string) => { this.times = value; this.confirmed = false; })
          this.fieldLabel('开始日期 *（YYYY-MM-DD）')
          TextInput({ text: this.startDate }).maxLength(10).onChange((value: string) => { this.startDate = value; this.confirmed = false; })
          this.fieldLabel('结束日期（选填，YYYY-MM-DD）')
          TextInput({ text: this.endDate, placeholder: '留空表示持续提醒' }).maxLength(10)
            .onChange((value: string) => { this.endDate = value; this.confirmed = false; })
          this.fieldLabel('备注')
          TextInput({ text: this.notes, placeholder: '可填写已经确认的注意事项' }).maxLength(500)
            .onChange((value: string) => { this.notes = value; this.confirmed = false; })
          Row() {
            Checkbox().select(this.confirmed).onChange((value: boolean) => { this.confirmed = value; })
            Text('我已核对名称、有效期、用量及提醒时间。').fontSize(14).layoutWeight(1)
          }.width('100%')
          if (this.error) { Text(this.error).fontColor('#A13E32').fontSize(14).width('100%') }
          Button(this.busy ? '处理中…' : '确认并保存').width('100%').height(48).backgroundColor('#315838')
            .enabled(this.confirmed && !this.busy).onClick(() => { this.save(); })
          Text('提醒只执行您确认的计划，不提供诊断、处方或剂量建议。').fontSize(12).fontColor('#697465')
        }.padding({ left: 20, right: 20, bottom: 32 }).width('100%').constraintSize({ maxWidth: 640 })
      }.layoutWeight(1).width('100%').enabled(!this.busy)
    }.width('100%').height('100%').backgroundColor('#F5F6F1')
  }
}
