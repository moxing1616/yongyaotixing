import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { camera, cameraPicker } from '@kit.CameraKit';
import { fileIo } from '@kit.CoreFileKit';
import { image } from '@kit.ImageKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { notificationManager } from '@kit.NotificationKit';
import { ReminderItem, ReminderPlan } from '../model/Models';

const MAX_REMINDERS: number = 30;
const MAX_IMAGE_EDGE: number = 1600;
const MAX_IMAGE_BYTES: number = 4 * 1024 * 1024;
const PACKER_BUFFER_BYTES: number = 16 * 1024 * 1024;
const JPEG_QUALITY: number = 80;
const NOTIFICATION_ID_BASE: number = 900000;
const APP_BUNDLE_NAME: string = 'com.moxing1616.medication';
const ENTRY_ABILITY_NAME: string = 'EntryAbility';

export class DeviceServices {
  private operationTail: Promise<void> = Promise.resolve();
  private generation: number = 0;

  async pickPhoto(context: common.UIAbilityContext, cameraRequested: boolean): Promise<string> {
    if (cameraRequested) {
      const profile: cameraPicker.PickerProfile = new cameraPicker.PickerProfile();
      profile.cameraPosition = camera.CameraPosition.CAMERA_POSITION_BACK;
      const result: cameraPicker.PickerResult = await cameraPicker.pick(
        context,
        [cameraPicker.PickerMediaType.PHOTO],
        profile
      );
      if (result.resultUri.length === 0) {
        throw new Error('未获取到拍摄的照片。');
      }
      return result.resultUri;
    }

    const options: photoAccessHelper.PhotoSelectOptions = new photoAccessHelper.PhotoSelectOptions();
    options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    options.maxSelectNumber = 1;
    const picker: photoAccessHelper.PhotoViewPicker = new photoAccessHelper.PhotoViewPicker();
    const result: photoAccessHelper.PhotoSelectResult = await picker.select(options);
    if (result.photoUris.length === 0) {
      throw new Error('未选择照片。');
    }
    return result.photoUris[0];
  }

  async imageDataUrl(uri: string): Promise<string> {
    let file: fileIo.File | undefined = undefined;
    let source: image.ImageSource | undefined = undefined;
    let pixelMap: image.PixelMap | undefined = undefined;
    let packer: image.ImagePacker | undefined = undefined;

    try {
      file = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
      source = image.createImageSource(file.fd);
      packer = image.createImagePacker();

      const info: image.ImageInfo = await source.getImageInfo();
      let targetWidth: number = info.size.width;
      let targetHeight: number = info.size.height;
      const longestEdge: number = Math.max(targetWidth, targetHeight);
      if (longestEdge > MAX_IMAGE_EDGE) {
        const scale: number = MAX_IMAGE_EDGE / longestEdge;
        targetWidth = Math.max(1, Math.floor(targetWidth * scale));
        targetHeight = Math.max(1, Math.floor(targetHeight * scale));
      }

      for (let attempt: number = 0; attempt < 6; attempt++) {
        const decodeOptions: image.DecodingOptions = {
          desiredSize: { width: targetWidth, height: targetHeight }
        };
        pixelMap = await source.createPixelMap(decodeOptions);
        const packingOptions: image.PackingOption = {
          format: 'image/jpeg',
          quality: JPEG_QUALITY,
          bufferSize: PACKER_BUFFER_BYTES
        };
        const packed: ArrayBuffer = await packer.packing(pixelMap, packingOptions);
        await this.releasePixelMap(pixelMap);
        pixelMap = undefined;

        if (packed.byteLength <= MAX_IMAGE_BYTES) {
          const base64: util.Base64Helper = new util.Base64Helper();
          return `data:image/jpeg;base64,${base64.encodeToStringSync(new Uint8Array(packed))}`;
        }

        const sizeScale: number = Math.sqrt(MAX_IMAGE_BYTES / packed.byteLength) * 0.9;
        targetWidth = Math.max(1, Math.floor(targetWidth * sizeScale));
        targetHeight = Math.max(1, Math.floor(targetHeight * sizeScale));
      }

      throw new Error('图片压缩后仍超过 4MB，请选择尺寸更小的照片。');
    } finally {
      if (pixelMap !== undefined) {
        await this.releasePixelMap(pixelMap);
      }
      if (packer !== undefined) {
        try {
          await packer.release();
        } catch {
        }
      }
      if (source !== undefined) {
        try {
          await source.release();
        } catch {
        }
      }
      if (file !== undefined) {
        try {
          fileIo.closeSync(file);
        } catch {
        }
      }
    }
  }

  async enable(context: common.UIAbilityContext): Promise<void> {
    try {
      await notificationManager.requestEnableNotification(context);
    } catch {
      throw new Error('通知权限未开启，请在系统设置中允许通知。');
    }
  }

  sync(plan: ReminderPlan): Promise<number> {
    const requestedGeneration: number = ++this.generation;
    const operation: Promise<number> = this.operationTail.then((): Promise<number> => {
      return this.syncInternal(plan, requestedGeneration);
    });
    this.operationTail = operation.then((): void => {}, (): void => {});
    return operation;
  }

  clear(): Promise<void> {
    ++this.generation;
    const operation: Promise<void> = this.operationTail.then((): Promise<void> => {
      return reminderAgentManager.cancelAllReminders();
    });
    this.operationTail = operation.then((): void => {}, (): void => {});
    return operation;
  }

  private async syncInternal(plan: ReminderPlan, requestedGeneration: number): Promise<number> {
    try {
      await reminderAgentManager.cancelAllReminders();
      this.requireCurrentGeneration(requestedGeneration);

      const now: number = Date.now();
      const items: ReminderItem[] = plan.items.filter((item: ReminderItem): boolean => {
        const timestamp: number = new Date(item.at).getTime();
        return Number.isFinite(timestamp) && timestamp > now;
      });
      items.sort((left: ReminderItem, right: ReminderItem): number => {
        return new Date(left.at).getTime() - new Date(right.at).getTime();
      });

      const limit: number = Math.min(items.length, MAX_REMINDERS);
      for (let index: number = 0; index < limit; index++) {
        this.requireCurrentGeneration(requestedGeneration);
        const request: reminderAgentManager.ReminderRequestCalendar = this.calendarRequest(items[index], index);
        await reminderAgentManager.publishReminder(request);
        this.requireCurrentGeneration(requestedGeneration);
      }
      return limit;
    } catch {
      let cleared: boolean = false;
      try {
        await reminderAgentManager.cancelAllReminders();
        cleared = true;
      } catch {
      }
      if (cleared) {
        throw new Error('同步系统提醒失败，本应用的设备提醒已清除。');
      }
      throw new Error('同步系统提醒失败，且无法确认已发布的设备提醒是否全部清除。');
    }
  }

  private calendarRequest(item: ReminderItem, index: number): reminderAgentManager.ReminderRequestCalendar {
    const at: Date = new Date(item.at);
    const closeButton: reminderAgentManager.ActionButton = {
      title: '关闭',
      type: reminderAgentManager.ActionButtonType.ACTION_BUTTON_TYPE_CLOSE
    };
    return {
      reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
      dateTime: {
        year: at.getFullYear(),
        month: at.getMonth() + 1,
        day: at.getDate(),
        hour: at.getHours(),
        minute: at.getMinutes(),
        second: at.getSeconds()
      },
      actionButton: [closeButton],
      wantAgent: {
        pkgName: APP_BUNDLE_NAME,
        abilityName: ENTRY_ABILITY_NAME
      },
      ringDuration: 5,
      notificationId: NOTIFICATION_ID_BASE + index,
      title: item.title,
      content: item.body,
      expiredContent: item.body,
      slotType: notificationManager.SlotType.SERVICE_INFORMATION,
      tapDismissed: true
    };
  }

  private requireCurrentGeneration(requestedGeneration: number): void {
    if (requestedGeneration !== this.generation) {
      throw new Error('提醒计划已过期。');
    }
  }

  private async releasePixelMap(pixelMap: image.PixelMap): Promise<void> {
    try {
      await pixelMap.release();
    } catch {
    }
  }
}

export const deviceServices: DeviceServices = new DeviceServices();
