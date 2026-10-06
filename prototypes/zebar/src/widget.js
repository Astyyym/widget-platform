import { currentWidget, startWidgetPreset } from 'zebar';

const mode = document.body.dataset.mode;

if (mode === 'summary') {
  const openButton = document.querySelector('#open-panel');
  const hideButton = document.querySelector('#hide-summary');
  const status = document.querySelector('#action-status');

  openButton.addEventListener('click', async () => {
    try {
      await startWidgetPreset('input-panel', 'default');
      status.textContent = '输入面板已打开';
    } catch {
      status.textContent = '无法打开输入面板';
    }
  });

  hideButton.addEventListener('click', async () => {
    try {
      await currentWidget().close();
    } catch {
      status.textContent = '无法隐藏摘要';
    }
  });
}

if (mode === 'input-panel') {
  const sampleInput = document.querySelector('#sample-input');
  const inputPreview = document.querySelector('#input-preview');
  const closeButton = document.querySelector('#hide-panel');

  sampleInput.addEventListener('input', () => {
    inputPreview.textContent = sampleInput.value;
  });

  closeButton.addEventListener('click', () => currentWidget().close());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      currentWidget().close();
    }
  });
}
