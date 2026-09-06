import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';

export default class EntryAbility extends UIAbility {
  onWindowStageCreate(windowStage: window.WindowStage): void {
    AppStorage.setOrCreate<number>('foregroundTick', 0);
    windowStage.loadContent('pages/Index');
  }

  onForeground(): void {
    AppStorage.setOrCreate<number>('foregroundTick', Date.now());
  }
}
