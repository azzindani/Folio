import { EditorApp } from './editor/app';

const app = new EditorApp(document.getElementById('app')!);
app.init()
  .then(() => {
    (window as unknown as { __folio: EditorApp }).__folio = app;
    window.dispatchEvent(new CustomEvent('folio:ready'));
  })
  .catch(err => {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize editor:', err);
  });
