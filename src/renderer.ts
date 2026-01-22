import './index.css';
import { createOverlayController } from './renderer/overlay-controller';

const controller = createOverlayController();
controller.init();

window.overlayAPI.onRecordingToggle((payload) => {
  controller.handleRecordingToggle(payload);
});

window.overlayAPI.onRecordingCancel((mode) => {
  controller.handleRecordingCancel(mode);
});

window.overlayAPI.onEditWarning((message) => {
  controller.handleEditWarning(message);
});

window.overlayAPI.ready();
